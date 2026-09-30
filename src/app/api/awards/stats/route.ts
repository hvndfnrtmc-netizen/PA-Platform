/**
 * GET /api/awards/stats
 * 大屏专属统计 API：全量聚合，不截断
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getModulePermLevel } from "@/lib/module-auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { role, departmentId } = session.user;
  const permLevel = await getModulePermLevel({ userRole: role, departmentId, moduleKey: "awards" });
  if (!permLevel) {
    return NextResponse.json({ error: "无查看权限" }, { status: 403 });
  }

  // 数据库已由 hard-reset 清洗完毕，直接全量拉取，无需客户端去重
  const allRecords = await prisma.qualificationAward.findMany({
    where: { isActive: true, deletedAt: null },
    select: {
      awardedAt:     true,
      awardeeEntity: true,
      category:      true,
    },
  });

  // 1. 首行 KPI：总数量 & 高级奖项（国家级 + 省级）
  const totalCount     = allRecords.length;
  const highLevelCount = allRecords.filter(
    r => r.category === "国家级" || r.category === "省级"
  ).length;

  // 2. 趋势线：按授予时间的年月 (YYYY-MM) 分组统计
  const trendMap: Record<string, number> = {};
  for (const r of allRecords) {
    const month = (r.awardedAt ?? "").slice(0, 7); // "YYYY-MM"
    if (month.length === 7) trendMap[month] = (trendMap[month] ?? 0) + 1;
  }
  const trendData = Object.keys(trendMap)
    .sort()
    .map(month => ({ month, count: trendMap[month] }));

  // 3. 资质主体分布（全量，不截断）
  const entityMap: Record<string, number> = {};
  for (const r of allRecords) {
    const k = r.awardeeEntity || "未知";
    entityMap[k] = (entityMap[k] ?? 0) + 1;
  }
  const entityData = Object.entries(entityMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

  // 4. 项目级别分布：强制清洗 + 排序
  const LEVEL_ORDER: Record<string, number> = { 国家级: 1, 省级: 2, 市级: 3, 区级: 4, 板块: 5 };
  const rawLevelMap: Record<string, number> = {};
  for (const r of allRecords) {
    const key = LEVEL_ORDER[r.category] !== undefined ? r.category : "其他";
    rawLevelMap[key] = (rawLevelMap[key] ?? 0) + 1;
  }
  const categoryData = Object.entries(rawLevelMap)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => (LEVEL_ORDER[a.name] ?? 99) - (LEVEL_ORDER[b.name] ?? 99));

  return NextResponse.json({
    totalCount,
    highLevelCount,
    trendData,
    entityData,
    categoryData,
  });
}
