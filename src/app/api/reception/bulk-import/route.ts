/**
 * POST /api/reception/bulk-import
 * 批量 Upsert 飞书解析出的接待记录。
 * - 有 feishuRecordId：用飞书 record_id 做唯一键 upsert（覆盖更新，软删除记录自动复活）
 * - 无 feishuRecordId：直接 create（兜底，理论上不应发生）
 * - 超过 100 条时自动分块提交，避免事务超时
 * Body: { records: IncomingRecord[] }
 * Response: { count: number }
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { Prisma } from "@prisma/client";

interface IncomingRecord {
  title:           string;
  startTime:       string | null;
  endTime:         string | null;
  level:           string;
  hostName:        string;
  formats:         string[];
  dressCode?:      string | null;
  background:      string;
  purpose:         string;
  status:          string;
  feishuRecordId?: string | null;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

const CHUNK_SIZE = 100;

/**
 * 去重清理：全量拉取 -> 内存容错分组 -> 批量软删除。
 * key = trim(title) + "_" + startTime 截取到天，保留 createdAt 最新的一条。
 * 仅在 bulk-import 完成后调用，不影响事务原子性。
 */
async function cleanupDuplicateReceptions(): Promise<number> {
  // 1. 全量拉取有效记录
  const records = await prisma.reception.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, startTime: true, createdAt: true },
  });

  if (records.length === 0) return 0;

  // 2. 内存容错分组：trim 名称 + 截取日期到天
  const groupMap = new Map<string, typeof records>();

  records.forEach(record => {
    const cleanTitle = (record.title || "未命名").trim();
    const dateStr = record.startTime
      ? new Date(record.startTime).toISOString().split("T")[0]
      : "无日期";
    const key = `${cleanTitle}_${dateStr}`;

    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(record);
  });

  // 3. 收集重复组中的旧记录 ID（createdAt 倒序，保留第 0 位）
  const idsToSoftDelete: string[] = [];

  groupMap.forEach(group => {
    if (group.length > 1) {
      group.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      idsToSoftDelete.push(...group.slice(1).map(r => r.id));
    }
  });

  if (idsToSoftDelete.length === 0) return 0;

  // 4. 批量软删除（绝不使用 deleteMany）
  await prisma.reception.updateMany({
    where: { id: { in: idsToSoftDelete } },
    data:  { deletedAt: new Date() },
  });

  console.log(`[bulk-import] 去重清理：软删除 ${idsToSoftDelete.length} 条重复接待记录`);
  return idsToSoftDelete.length;
}

function ip(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  let body: { records?: unknown };
  try {
    body = await req.json() as { records?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!Array.isArray(body.records) || body.records.length === 0)
    return NextResponse.json({ error: "records 不能为空" }, { status: 400 });

  if (body.records.length > 500)
    return NextResponse.json({ error: "单次最多导入 500 条" }, { status: 400 });

  const valid = (body.records as IncomingRecord[])
    .filter(r => typeof r.title === "string" && r.title.trim());

  if (valid.length === 0)
    return NextResponse.json({ error: "有效记录数为 0（title 不能为空）" }, { status: 400 });

  let count = 0;

  for (const chunk of chunkArray(valid, CHUNK_SIZE)) {
    const ops: Prisma.PrismaPromise<unknown>[] = chunk.map(r => {
      const startTime = r.startTime ? new Date(r.startTime) : new Date();
      const endTime   = r.endTime   ? new Date(r.endTime)   : null;
      const formats   = (Array.isArray(r.formats) ? r.formats : []) as Prisma.InputJsonValue;

      const createData = {
        title:          r.title.trim(),
        startTime,
        endTime,
        level:          r.level      ?? "",
        hostName:       r.hostName   || null,
        hostUserId:     null as string | null,
        formats,
        dressCode:      r.dressCode  || "司服",
        background:     r.background || null,
        purpose:        r.purpose    ?? "",
        status:         r.status     || "正常",
        surveyFiles:    [] as unknown as Prisma.InputJsonValue,
        meetingMinutes: [] as unknown as Prisma.InputJsonValue,
        todos:          [] as unknown as Prisma.InputJsonValue,
        createdById:    session.user.id,
        feishuRecordId: r.feishuRecordId ?? null,
      };

      if (!r.feishuRecordId) {
        return prisma.reception.create({ data: createData });
      }

      return prisma.reception.upsert({
        where:  { feishuRecordId: r.feishuRecordId },
        create: createData,
        update: {
          title:          r.title.trim(),
          startTime,
          endTime,
          level:          r.level      ?? "",
          hostName:       r.hostName   || null,
          formats,
          dressCode:      r.dressCode  || "司服",
          background:     r.background || null,
          purpose:        r.purpose    ?? "",
          status:         r.status     || "正常",
          feishuRecordId: r.feishuRecordId,
          deletedAt:      null,  // 复活软删除的记录
        },
      });
    });

    await prisma.$transaction(ops);
    count += chunk.length;
  }

  // 注意：去重清理（cleanupDuplicateReceptions）已从导入热路径移除，
  // 避免全表扫描导致 Vercel 函数超时。如需清理重复数据，请手动调用
  // GET /api/reception/force-cleanup 接口。

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.CREATE_RECEPTION,
    resourceType: "reception",
    metadata:     { source: "feishu_bulk_import", count },
    ipAddress:    ip(req),
  }).catch(console.error);

  return NextResponse.json({ count }, { status: 201 });
}
