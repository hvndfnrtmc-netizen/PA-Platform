/**
 * GET /api/agreement/dashboard?year=2024
 * 返回综合评分、KPI 实际完成情况、质性义务合规率、月度数据
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  computeKpiActuals,
  computeCompositeScore,
  KPI_CONFIG,
  KPI_KEYS,
} from "@/lib/agreement-config";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const year = parseInt(
    req.nextUrl.searchParams.get("year") ?? String(new Date().getFullYear()),
  );

  const [financeRows, qualRows] = await Promise.all([
    prisma.agreementData.findMany({ where: { category: "finance" } }),
    prisma.qualitativeObligation.findMany({ orderBy: { createdAt: "asc" } }),
  ]);

  const kpis         = computeKpiActuals(year, financeRows);
  const overallScore = computeCompositeScore(kpis);

  // 距年末考核截止日天数
  const deadline       = new Date(`${year}-12-31T23:59:59Z`);
  const today          = new Date();
  const daysToDeadline = Math.max(0, Math.ceil((deadline.getTime() - today.getTime()) / 86400000));

  // 质性义务合规率
  const qualCompliant = qualRows.filter(q => q.status === "compliant").length;
  const qualTotal     = qualRows.length;
  const qualRate      = qualTotal > 0 ? Math.round((qualCompliant / qualTotal) * 100) : 0;

  // 各年目标（多年对比用）
  const allYearTargets: Record<string, Record<number, number>> = {};
  for (const key of KPI_KEYS) {
    allYearTargets[key] = KPI_CONFIG[key].targets;
  }

  // 当年各月 finance 数据（趋势图用）
  // revenue 单位：万元；localContribution 单位：万元
  const monthly = financeRows
    .filter(r => r.period.startsWith(String(year)))
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(r => {
      const p = (typeof r.payload === "object" && r.payload !== null ? r.payload : {}) as Record<string, number>;
      const localYuan = (p.vatPaidSuzhou ?? 0) + (p.citPaidSuzhou ?? 0);
      const localWan  = (p.vat ?? 0) + (p.corp_tax ?? 0);
      return {
        period:            r.period,
        revenue:           p.revenue ?? 0,
        localContribution: localWan > 0 || (p.vat != null || p.corp_tax != null) ? localWan : localYuan / 10000,
      };
    });

  return NextResponse.json({
    year,
    overallScore,
    daysToDeadline,
    kpis,
    qualCompliant,
    qualTotal,
    qualRate,
    allYearTargets,
    monthly,
  });
}
