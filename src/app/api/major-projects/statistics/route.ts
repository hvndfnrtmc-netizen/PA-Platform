/**
 * GET /api/major-projects/statistics
 *
 * 返回重大项目的可视化统计数据
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const timeRange = sp.get("timeRange") ?? "all"; // all | week | month | year | custom
  const startDate = sp.get("startDate") ?? "";
  const endDate = sp.get("endDate") ?? "";

  // 获取所有项目（用于聚合统计）
  const where: Record<string, unknown> = { deletedAt: null };
  const projects = await prisma.majorProject.findMany({
    where,
    include: {
      categoryDict: true,
      companyEntityDict: true,
      levelDict: true,
      paymentRecords: true,
    },
  });

  // ============ 1. 核心指标统计 ============
  const total = projects.length;
  const mainProjects = projects.filter(p => !p.parentId);
  const subProjectCount = projects.length - mainProjects.length;
  const mainProjectCount = mainProjects.length;
  // 金额仅统计主项目（parentId: null），避免子项目金额被重复计入
  const totalAmount = mainProjects.reduce((sum, p) => sum + (p.totalAmount ?? 0), 0);

  // ============ 2. 时间范围筛选的到账金额 ============
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paymentWhere: any = {};

  if (timeRange === "week") {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    paymentWhere.paymentDate = { gte: weekAgo };
  } else if (timeRange === "month") {
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    paymentWhere.paymentDate = { gte: monthAgo };
  } else if (timeRange === "year") {
    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    paymentWhere.paymentDate = { gte: yearAgo };
  } else if (timeRange === "custom" && startDate && endDate) {
    paymentWhere.paymentDate = {
      gte: new Date(startDate),
      lte: new Date(endDate),
    };
  }

  const paymentRecords = await prisma.projectPaymentRecord.findMany({
    where: paymentWhere,
  });
  const receivedAmountInRange = paymentRecords.reduce((sum, r) => sum + r.amount, 0);

  // 全部历史到账金额
  const allPayments = await prisma.projectPaymentRecord.findMany();
  const totalReceivedAmount = allPayments.reduce((sum, r) => sum + r.amount, 0);

  // ============ 3. 项目类别分布（含 dictId 用于点击穿透） ============
  const byCategoryMap: Record<string, { dictId: string | null; value: number }> = {};
  projects.forEach((p) => {
    const cat = p.categoryDict?.value ?? "未分类";
    if (!byCategoryMap[cat]) byCategoryMap[cat] = { dictId: p.categoryDictId, value: 0 };
    byCategoryMap[cat].value++;
  });

  // ============ 4. 收款公司主体分布 ============
  const byCompanyEntity: Record<string, number> = {};
  projects.forEach((p) => {
    if (p.companyEntityNames && p.companyEntityNames.length > 0) {
      p.companyEntityNames.forEach((name) => {
        byCompanyEntity[name] = (byCompanyEntity[name] || 0) + 1;
      });
    } else {
      const entity = p.companyEntityDict?.value ?? "未指定";
      byCompanyEntity[entity] = (byCompanyEntity[entity] || 0) + 1;
    }
  });

  // ============ 5. 项目级别分布（含 dictId 用于点击穿透） ============
  const byLevelMap: Record<string, { dictId: string | null; value: number }> = {};
  projects.forEach((p) => {
    const level = p.levelDict?.value ?? "未分类";
    if (!byLevelMap[level]) byLevelMap[level] = { dictId: p.levelDictId, value: 0 };
    byLevelMap[level].value++;
  });

  // ============ 6. 归属分布 ============
  const byAffiliation: Record<string, number> = {};
  projects.forEach((p) => {
    const aff = p.affiliation ?? "未指定";
    byAffiliation[aff] = (byAffiliation[aff] || 0) + 1;
  });

  // ============ 7. 金额统计（按级别）—— 仅主项目，避免双重计算 ============
  const amountByLevel: Record<string, number> = {};
  mainProjects.forEach((p) => {
    const level = p.levelDict?.value ?? "未分类";
    amountByLevel[level] = (amountByLevel[level] || 0) + (p.totalAmount ?? 0);
  });

  return NextResponse.json({
    // 核心指标
    total,
    mainProjectCount,
    subProjectCount,
    totalAmount: Math.round(totalAmount * 100) / 100,
    totalReceivedAmount: Math.round(totalReceivedAmount * 100) / 100,
    receivedAmountInRange: Math.round(receivedAmountInRange * 100) / 100,

    // 分布数据（含 dictId 用于点击联动）
    byCategory: Object.entries(byCategoryMap)
      .map(([name, { dictId, value }]) => ({ name, dictId, value }))
      .sort((a, b) => b.value - a.value),

    byCompanyEntity: Object.entries(byCompanyEntity)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),

    byLevel: Object.entries(byLevelMap)
      .map(([name, { dictId, value }]) => ({ name, dictId, value }))
      .sort((a, b) => b.value - a.value),

    byAffiliation: Object.entries(byAffiliation)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),

    amountByLevel: Object.entries(amountByLevel)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value),
  });
}
