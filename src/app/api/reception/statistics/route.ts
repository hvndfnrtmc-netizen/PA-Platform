/**
 * GET /api/reception/statistics
 * 聚合接待数据，供看板视图使用。不分页，返回全量聚合结果。
 * Query params: q, level, status, purpose, startFrom, startTo, range(week|30days|by-month|by-year)
 */

export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { loadHostDicts, resolveHostRootName, resolveHostRootNames } from "@/lib/receptionHostUtils";
import { loadFormatDicts, resolveToRootNames } from "@/lib/receptionFormatUtils";

const pad = (n: number) => String(n).padStart(2, "0");

const LEVEL_ORDER = ['国家级', '省级', '市级', '区级', '板块', '企业/院所', '媒体'];

function buildTrend(
  dates:     Date[],
  range:     string,
  startFrom: string,
  startTo:   string,
): Array<{ label: string; count: number }> {
  const labels: string[] = [];
  const cntMap = new Map<string, number>();

  if (range === "week" || range === "30days") {
    // 近 N 天（相对今天，固定窗口，不受 startFrom/startTo 影响）
    const days = range === "week" ? 7 : 30;
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d   = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      labels.push(key);
      cntMap.set(key, 0);
    }
    dates.forEach(dt => {
      const key = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
      if (cntMap.has(key)) cntMap.set(key, (cntMap.get(key) ?? 0) + 1);
    });
    return labels.map(label => ({ label, count: cntMap.get(label) ?? 0 }));
  }

  if (dates.length === 0 && !startFrom && !startTo) return [];

  // 确定历史区间边界
  const lo = startFrom
    ? new Date(startFrom)
    : dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : new Date();
  const hi = startTo
    ? new Date(startTo + "T23:59:59.999Z")
    : dates.length > 0 ? new Date(Math.max(...dates.map(d => d.getTime()))) : new Date();

  if (range === "by-year") {
    for (let y = lo.getFullYear(); y <= hi.getFullYear(); y++) {
      const key = String(y);
      labels.push(key);
      cntMap.set(key, 0);
    }
    dates.forEach(dt => {
      const key = String(dt.getFullYear());
      if (cntMap.has(key)) cntMap.set(key, (cntMap.get(key) ?? 0) + 1);
    });
  } else {
    // by-month（默认）
    let cur = new Date(lo.getFullYear(), lo.getMonth(), 1);
    const endM = new Date(hi.getFullYear(), hi.getMonth(), 1);
    while (cur <= endM) {
      const key = `${cur.getFullYear()}-${pad(cur.getMonth() + 1)}`;
      labels.push(key);
      cntMap.set(key, 0);
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
    }
    dates.forEach(dt => {
      const key = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
      if (cntMap.has(key)) cntMap.set(key, (cntMap.get(key) ?? 0) + 1);
    });
  }

  return labels.map(label => ({ label, count: cntMap.get(label) ?? 0 }));
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const sp        = req.nextUrl.searchParams;
  const q         = sp.get("q")         ?? "";
  const level     = sp.get("level")     ?? "";
  const status    = sp.get("status")    ?? "";
  const purpose   = sp.get("purpose")   ?? "";
  const hostName  = sp.get("hostName")  ?? "";
  const format    = sp.get("format")    ?? "";
  const startFrom = sp.get("startFrom") ?? "";
  const startTo   = sp.get("startTo")   ?? "";
  const range     = sp.get("range")     ?? "by-month";

  // 加载主接待字典（用于筛选和聚合，须在 where 构建前完成）
  const hostDictById = await loadHostDicts();

  const where: Prisma.ReceptionWhereInput = { deletedAt: null };
  if (q)        where.title    = { contains: q };
  if (level)    where.level    = level;
  if (status)   where.status   = status;
  if (purpose)  where.purpose  = purpose;
  if (format)   (where as Record<string, unknown>).formats = { array_contains: format };
  if (startFrom || startTo) {
    const range_: Prisma.DateTimeFilter = {};
    if (startFrom) range_.gte = new Date(startFrom);
    if (startTo)   range_.lte = new Date(startTo + "T23:59:59.999Z");
    where.startTime = range_;
  }
  // hostName 过滤：匹配一级根名，同时覆盖文本字段和字典 ID 字段
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

  const [recs, formatDictById] = await Promise.all([
    prisma.reception.findMany({
      where,
      select: {
        id:          true,
        title:       true,
        level:       true,
        status:      true,
        purpose:     true,
        startTime:   true,
        formats:     true,
        hostName:    true,
        hostDictId:  true,
        hostDictIds: true,
        hostUser:    { select: { name: true } },
      },
    }),
    loadFormatDicts(),
  ]);

  const byLevel:    Record<string, number> = {};
  const byStatus:   Record<string, number> = {};
  const byPurpose:  Record<string, number> = {};
  const byFormat:   Record<string, number> = {};
  // byHostRoot：只按一级根节点聚合，子节点数据向上归并
  const byHostRoot: Record<string, number> = {};

  recs.forEach(r => {
    if (r.level)   byLevel[r.level]     = (byLevel[r.level]     ?? 0) + 1;
    if (r.status)  byStatus[r.status]   = (byStatus[r.status]   ?? 0) + 1;
    if (r.purpose) byPurpose[r.purpose] = (byPurpose[r.purpose] ?? 0) + 1;
    // formats：UUID 解析为一级根名后聚合
    const fmtIds = Array.isArray(r.formats) ? (r.formats as string[]) : [];
    const fmtRootNames = resolveToRootNames(fmtIds, formatDictById);
    fmtRootNames.forEach(name => { byFormat[name] = (byFormat[name] ?? 0) + 1; });

    // 主接待：优先 hostDictIds（新多选），降级 hostDictId（旧单选），全部解析为一级根节点
    // 同一条记录的多个 ID 若解析到同一根节点，只计一次
    const effectiveIds = (r.hostDictIds as string[]).length > 0
      ? (r.hostDictIds as string[])
      : r.hostDictId ? [r.hostDictId] : [];
    const resolvedRootNames = resolveHostRootNames(effectiveIds, hostDictById);
    const uniqueRootNames = [...new Set(resolvedRootNames)];
    if (uniqueRootNames.length > 0) {
      // 字典 ID 成功解析：按根节点归并计数
      uniqueRootNames.forEach(name => {
        byHostRoot[name] = (byHostRoot[name] ?? 0) + 1;
      });
    } else if (r.hostName?.trim()) {
      // 字典 ID 无法解析（旧数据、已删除字典项）时，降级使用文本 hostName 字段
      const fallbackName = r.hostName.trim();
      byHostRoot[fallbackName] = (byHostRoot[fallbackName] ?? 0) + 1;
    }
    // 三层均无主接待信息的记录直接跳过，不生成"未指定"分类
  });

  // 按数量降序
  const hostTop = Object.entries(byHostRoot)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  const ids = recs.map(r => r.id);
  const receptionTitleMap = new Map(recs.map(r => [r.id, r.title]));

  const [todoTotal, todoDone, pendingTaskRows] = ids.length > 0
    ? await Promise.all([
        prisma.receptionTodoTask.count({ where: { receptionId: { in: ids }, deletedAt: null } }),
        prisma.receptionTodoTask.count({ where: { receptionId: { in: ids }, deletedAt: null, isCompleted: true } }),
        prisma.receptionTodoTask.findMany({
          where:   { receptionId: { in: ids }, deletedAt: null, isCompleted: false },
          select:  { id: true, content: true, receptionId: true },
          orderBy: [{ receptionId: "asc" }, { sortOrder: "asc" }],
        }),
      ])
    : [0, 0, [] as Array<{ id: string; content: string; receptionId: string }>];

  const pendingTodos = pendingTaskRows.map(t => ({
    id:            t.id,
    title:         t.content,
    receptionId:   t.receptionId,
    receptionName: receptionTitleMap.get(t.receptionId) ?? "未知接待",
  }));

  return NextResponse.json({
    total:     recs.length,
    byLevel:   Object.entries(byLevel)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => {
        const ai = LEVEL_ORDER.indexOf(a.name);
        const bi = LEVEL_ORDER.indexOf(b.name);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      }),
    byStatus:  Object.entries(byStatus).map(([name, value]) => ({ name, value })),
    byHost:    hostTop,
    byFormat:  Object.entries(byFormat).sort(([, a], [, b]) => b - a).slice(0, 8).map(([name, count]) => ({ name, count })),
    byPurpose: Object.entries(byPurpose).sort(([, a], [, b]) => b - a).slice(0, 8).map(([name, count]) => ({ name, count })),
    trend:     buildTrend(recs.map(r => r.startTime), range, startFrom, startTo),
    todoTotal,
    todoDone,
    pendingTodos,
  });
}
