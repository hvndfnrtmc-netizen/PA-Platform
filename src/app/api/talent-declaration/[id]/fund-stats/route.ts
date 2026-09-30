/**
 * GET /api/talent-declaration/[id]/fund-stats
 * 返回该项目的全局资金汇总：累计获批金额 + 实际到账金额
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;

  // 找到该项目下所有公司 -> 周期 -> 人员
  const awardees = await prisma.talentAwardee.findMany({
    where: {
      cycle: {
        deletedAt: null,
        company: {
          deletedAt: null,
          projectId: id,
        },
      },
    },
    select: {
      approvedAmount: true,
      disbursements: {
        select: { amount: true, isReceived: true },
      },
    },
  });

  let totalApproved = 0;
  let totalReceived = 0;

  for (const a of awardees) {
    if (a.approvedAmount !== null && a.approvedAmount !== undefined) {
      totalApproved += parseFloat(a.approvedAmount.toString());
    }
    for (const d of a.disbursements) {
      if (d.isReceived) {
        totalReceived += parseFloat(d.amount.toString());
      }
    }
  }

  return NextResponse.json({
    totalApproved: totalApproved.toFixed(2),
    totalReceived: totalReceived.toFixed(2),
  });
}
