/**
 * GET /api/reception/force-cleanup
 * 临时排障接口：全量拉取 -> 内存容错分组 -> 批量软删除重复记录
 * 去重规则：title（trim 后）+ startTime（截取到天）相同视为重复，保留 createdAt 最新的一条
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  // 1. 拉取全量有效记录
  const records = await prisma.reception.findMany({
    where: { deletedAt: null },
    select: { id: true, title: true, startTime: true, createdAt: true },
  });

  // 2. 内存容错分组：key = trim(title) + "_" + startTime 截取到天
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

  // 3. 筛选重复组，按 createdAt 倒序，收集旧记录 ID
  const idsToSoftDelete: string[] = [];

  groupMap.forEach(group => {
    if (group.length > 1) {
      group.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const olderRecords = group.slice(1);
      idsToSoftDelete.push(...olderRecords.map(r => r.id));
    }
  });

  // 4. 批量软删除
  if (idsToSoftDelete.length > 0) {
    await prisma.reception.updateMany({
      where: { id: { in: idsToSoftDelete } },
      data: { deletedAt: new Date() },
    });
  }

  console.log(`[force-cleanup] 软删除重复记录 ${idsToSoftDelete.length} 条`);

  return NextResponse.json({
    success: true,
    message: "清理完成",
    deletedCount: idsToSoftDelete.length,
    deletedIds: idsToSoftDelete,
  });
}
