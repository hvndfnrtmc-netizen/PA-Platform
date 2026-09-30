/**
 * GET /…/awardees/[awardeeId]/disbursements  — 获取该人员的拨付流水
 * PUT /…/awardees/[awardeeId]/disbursements  — 批量覆盖保存（先删后建）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type RouteParams = { params: Promise<{ awardeeId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { awardeeId } = await params;

  const disbursements = await prisma.fundDisbursement.findMany({
    where: { awardeeId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(disbursements);
}

interface DisbursementInput {
  trancheName: string;
  amount: string | number;
  expectedDate?: string | null;
  isReceived?: boolean;
  receivedDate?: string | null;
  remark?: string | null;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { awardeeId } = await params;

  let body: { disbursements?: DisbursementInput[]; approvedAmount?: string | number | null };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const items: DisbursementInput[] = Array.isArray(body.disbursements) ? body.disbursements : [];

  // 校验每一行
  for (const item of items) {
    if (!item.trancheName?.toString().trim()) {
      return NextResponse.json({ error: "期数名称不能为空" }, { status: 400 });
    }
    const amt = parseFloat(String(item.amount ?? ""));
    if (isNaN(amt) || amt < 0) {
      return NextResponse.json({ error: "金额格式错误" }, { status: 400 });
    }
  }

  // 在事务中：删除旧流水 + 批量新建 + 可选更新 approvedAmount
  const result = await prisma.$transaction(async tx => {
    await tx.fundDisbursement.deleteMany({ where: { awardeeId } });

    const created = items.length > 0
      ? await tx.fundDisbursement.createManyAndReturn({
          data: items.map(item => {
            const isReceived = Boolean(item.isReceived);
            return {
              awardeeId,
              trancheName:  item.trancheName.toString().trim(),
              amount:       parseFloat(String(item.amount)),
              expectedDate: item.expectedDate ? new Date(item.expectedDate) : null,
              isReceived,
              receivedDate: isReceived
                ? (item.receivedDate ? new Date(item.receivedDate) : new Date())
                : null,
              remark: item.remark?.toString() || null,
            };
          }),
        })
      : [];

    // 如果同时传入了 approvedAmount，一并更新
    if (body.approvedAmount !== undefined && body.approvedAmount !== null) {
      const amt = parseFloat(String(body.approvedAmount));
      if (!isNaN(amt)) {
        await tx.talentAwardee.update({
          where: { id: awardeeId },
          data: { approvedAmount: amt },
        });
      }
    }

    return created;
  });

  return NextResponse.json(result);
}
