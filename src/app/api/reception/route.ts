/**
 * GET    /api/reception   列表（分页 / 过滤 / 排序）
 * POST   /api/reception   新建
 * DELETE /api/reception   批量软删除（body: { ids: string[] }）
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { syncTodoTasks } from "@/lib/receptionTodoSync";
import { loadFormatDicts, resolveToRootNames } from "@/lib/receptionFormatUtils";
import { loadHostDicts, resolveHostRootNames, resolveHostRootName } from "@/lib/receptionHostUtils";

function ip(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const sp        = req.nextUrl.searchParams;
  const q         = sp.get("q")         ?? "";
  const level     = sp.get("level")     ?? "";
  const purpose   = sp.get("purpose")   ?? "";
  const status    = sp.get("status")    ?? "";
  const hostName  = sp.get("hostName")  ?? "";
  const format    = sp.get("format")    ?? "";
  const startFrom = sp.get("startFrom") ?? "";
  const startTo   = sp.get("startTo")   ?? "";
  const sort      = sp.get("sort")      ?? "startTime";
  const order     = sp.get("order")     ?? "desc";
  const fetchAll  = sp.get("fetchAll") === "true";
  const page      = Math.max(1, Number(sp.get("page")  ?? 1));
  const limit     = fetchAll ? 10000 : Math.min(500, Math.max(1, Number(sp.get("limit") ?? 20)));

  // 加载主接待字典（须在 where 构建前完成，用于字典 ID 精确匹配）
  const hostDictById = await loadHostDicts();

  const where: Record<string, unknown> = { deletedAt: null };
  if (q)       where.title   = { contains: q };
  if (level)   where.level   = level;
  if (purpose) where.purpose = purpose;
  if (status)  where.status  = status;
  // hostName 过滤：同时覆盖文本字段和字典 ID 字段，确保字典多选记录也能被正确筛选
  if (hostName) {
    const matchingDictIds = [...hostDictById.keys()]
      .filter(id => resolveHostRootName(id, hostDictById) === hostName);
    if (matchingDictIds.length > 0) {
      where.OR = [
        { hostName: { contains: hostName } },
        { hostDictIds: { hasSome: matchingDictIds } },
        { hostDictId: { in: matchingDictIds } },
      ];
    } else {
      where.hostName = { contains: hostName };
    }
  }
  // format 过滤：参数可以是 dict ID 或名称字符串（向后兼容）
  if (format) {
    const isId = /^c[a-z0-9]{24,}$/i.test(format);
    if (isId) {
      where.formats = { array_contains: format };
    } else {
      // 名称 → 查出所有匹配条目的 ID（含子项，按名称匹配）
      const matchedDicts = await prisma.receptionDictionary.findMany({
        where:  { category: "format", value: format },
        select: { id: true },
      });
      if (matchedDicts.length > 0) {
        where.formats = { array_contains: matchedDicts[0].id };
      } else {
        // 没有匹配的字典项，回退到旧的字符串匹配（兼容迁移前数据）
        where.formats = { array_contains: format };
      }
    }
  }
  if (startFrom || startTo) {
    const range: Record<string, Date> = {};
    if (startFrom) range.gte = new Date(startFrom);
    if (startTo)   range.lte = new Date(startTo + "T23:59:59.999Z");
    where.startTime = range;
  }

  const allowedSort = ["startTime", "title", "level", "purpose", "status", "createdAt"];
  const sortKey = allowedSort.includes(sort) ? sort : "startTime";

  const [[receptions, total], dictById] = await Promise.all([
    Promise.all([
      prisma.reception.findMany({
        where,
        orderBy: { [sortKey]: order === "asc" ? "asc" : "desc" },
        ...(fetchAll ? {} : { skip: (page - 1) * limit, take: limit }),
        include: {
          hostUser:  { select: { id: true, name: true } },
          todoTasks: {
            where:   { deletedAt: null },
            select:  { id: true, receptionId: true, category: true, content: true, isCompleted: true, link: true, sortOrder: true },
            orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
          },
          scheduledNotifications: {
            where:   { status: "PENDING", qstashMessageId: { not: null } },
            orderBy: { scheduledAt: "asc" },
            select:  { id: true, scheduledAt: true, payload: true },
          },
        },
      }),
      prisma.reception.count({ where }),
    ]),
    loadFormatDicts(),
  ]);

  // 为每条记录附加 formatsDisplay（视图层一级名称数组）和 pendingNotifications
  const receptionsWithDisplay = receptions.map((r) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { scheduledNotifications: _sn, ...rest } = r;
    // hostDisplay：优先用 hostDictIds 新字段，降级用 hostDictId，再降级用 hostName
    // 同部门多人只展示部门名一次，跨部门平铺去重后用空格连接
    const effectiveIds = r.hostDictIds.length > 0 ? r.hostDictIds : r.hostDictId ? [r.hostDictId] : [];
    const rootNames = resolveHostRootNames(effectiveIds, hostDictById);
    const uniqueNames = [...new Set(rootNames)];
    const hostDisplay = uniqueNames.length > 0
      ? uniqueNames.join(" ")
      : r.hostName ?? null;
    return {
      ...rest,
      formatsDisplay: resolveToRootNames(Array.isArray(r.formats) ? (r.formats as string[]) : [], dictById),
      hostDisplay,
      pendingNotifications: r.scheduledNotifications.map((n) => {
        const p = n.payload as Record<string, unknown>;
        const targetIds = Array.isArray(p?.targetIds) ? (p.targetIds as string[]) : [];
        return { id: n.id, scheduledAt: n.scheduledAt.toISOString(), targetIds };
      }),
    };
  });

  return NextResponse.json({ receptions: receptionsWithDisplay, total, page, limit });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json();
  if (!body.title?.trim())
    return NextResponse.json({ error: "会议名称不能为空" }, { status: 400 });
  if (!body.startTime)
    return NextResponse.json({ error: "开始时间不能为空" }, { status: 400 });

  const reception = await prisma.reception.create({
    data: {
      title:          body.title.trim(),
      startTime:      new Date(body.startTime),
      endTime:        body.endTime        ? new Date(body.endTime)   : null,
      level:          body.level          ?? "",
      hostUserId:     body.hostUserId     ?? null,
      hostName:       body.hostName       ?? null,
      hostDictId:     body.hostDictId     ?? null,
      hostDictIds:    Array.isArray(body.hostDictIds)
        ? (body.hostDictIds as unknown[]).filter((u): u is string => typeof u === "string")
        : [],
      dressCode:      body.dressCode      ?? null,
      formats:        body.formats        ?? [],
      background:        body.background        ?? null,
      address:            body.address            ?? null,
      navigationAddress:  body.navigationAddress  ?? null,
      leaderIntroText:   typeof body.leaderIntroText === "string" ? body.leaderIntroText || null : null,
      leaderIntroImages: Array.isArray(body.leaderIntroImages) ? (body.leaderIntroImages as unknown[]).filter((u): u is string => typeof u === "string") : [],
      purpose:           body.purpose           ?? "",
      status:            body.status            ?? "正常",
      surveyFiles:       body.surveyFiles       ?? [],
      meetingMinutes:    body.meetingMinutes     ?? [],
      meetingPhotos:     Array.isArray(body.meetingPhotos) ? (body.meetingPhotos as string[]).filter((u: unknown): u is string => typeof u === "string") : [],
      todos:             body.todos             ?? [],
      customData:        body.customData        ?? {},
      createdById:       session.user.id,
    },
  });

  // 创建后同步子任务（捕获异常，不阻断创建请求）
  if (Array.isArray(body.todos) && body.todos.length > 0) {
    const categories = (body.todos as unknown[]).filter((v): v is string => typeof v === "string");
    if (categories.length > 0) {
      try {
        await syncTodoTasks(reception.id, categories);
      } catch (syncErr) {
        console.error("[POST /reception] syncTodoTasks failed:", syncErr);
      }
    }
  }

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.CREATE_RECEPTION,
    resourceType: "reception",
    resourceId:   reception.id,
    metadata:     { title: reception.title },
    ipAddress:    ip(req),
  }).catch(console.error);

  return NextResponse.json({ reception }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  let body: { ids?: unknown };
  try { body = await req.json() as typeof body; }
  catch { return NextResponse.json({ error: "请求体格式错误" }, { status: 400 }); }

  const ids = Array.isArray(body.ids)
    ? (body.ids as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  if (ids.length === 0)
    return NextResponse.json({ error: "请至少提供一个 ID" }, { status: 400 });

  const now = new Date();
  const { count } = await prisma.reception.updateMany({
    where: { id: { in: ids }, deletedAt: null },
    data:  { deletedAt: now },
  });

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.DELETE_RECEPTION,
    resourceType: "reception",
    resourceId:   ids.join(","),
    metadata:     { ids, count },
    isDangerous:  true,
    ipAddress:    ip(req),
  }).catch(console.error);

  return NextResponse.json({ deleted: count });
}
