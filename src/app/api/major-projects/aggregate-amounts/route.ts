/**
 * POST /api/major-projects/aggregate-amounts
 * 从子项目自动汇总总金额或已到账金额到父项目
 *
 * 请求体: { projectIds: string[], target: 'total' | 'received' | 'both' }
 * 返回:   { updated: number, results: { id, name, totalAmount?, receivedAmount? }[] }
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  let body: { projectIds?: unknown; target?: unknown };
  try {
    body = await req.json() as { projectIds?: unknown; target?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const { projectIds, target } = body;

  if (!Array.isArray(projectIds) || projectIds.length === 0)
    return NextResponse.json({ error: "projectIds 不能为空" }, { status: 400 });
  if (!["total", "received", "both"].includes(target as string))
    return NextResponse.json({ error: "target 必须为 total / received / both" }, { status: 400 });

  const doTotal    = target === "total"    || target === "both";
  const doReceived = target === "received" || target === "both";

  const results: { id: string; name: string; totalAmount?: number | null; receivedAmount?: number }[] = [];
  let updated = 0;

  for (const id of projectIds as string[]) {
    // 只对有子项目的父项目操作
    const children = await prisma.majorProject.findMany({
      where: { parentId: id, deletedAt: null },
      select: { totalAmount: true, receivedAmount: true },
    });

    if (children.length === 0) continue; // 子项目跳过

    const sumTotal    = children.reduce((acc, c) => acc + (c.totalAmount ?? 0), 0);
    const sumReceived = children.reduce((acc, c) => acc + (c.receivedAmount ?? 0), 0);

    const data: Record<string, number> = {};
    if (doTotal)    data.totalAmount    = sumTotal;
    if (doReceived) data.receivedAmount = sumReceived;

    const rec = await prisma.majorProject.update({
      where: { id },
      data,
      select: { id: true, name: true, totalAmount: true, receivedAmount: true },
    });

    // 若汇总了到账金额且结果 > 0，自动维护一条汇总明细节点（防重：remark 固定为"汇总自动生成"）
    if (doReceived && sumReceived > 0) {
      const existingRecord = await prisma.projectPaymentRecord.findFirst({
        where: { projectId: id, remark: "汇总自动生成" },
      });
      if (existingRecord) {
        await prisma.projectPaymentRecord.update({
          where: { id: existingRecord.id },
          data: { amount: sumReceived, paymentDate: new Date() },
        });
      } else {
        await prisma.projectPaymentRecord.create({
          data: { projectId: id, amount: sumReceived, paymentDate: new Date(), remark: "汇总自动生成" },
        });
      }
    }

    results.push(rec);
    updated++;

    console.log(`[aggregate-amounts] 父项目 ${rec.name} (${id}): 子项目 ${children.length} 个`
      + (doTotal    ? ` | 总金额 → ${sumTotal}`    : "")
      + (doReceived ? ` | 已到账 → ${sumReceived}` : ""));
  }

  return NextResponse.json({ success: true, updated, results });
}
