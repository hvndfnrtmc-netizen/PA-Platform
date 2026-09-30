/**
 * PATCH  /…/awardees/[awardeeId]  — 更新人员信息（状态、金额等）
 * DELETE /…/awardees/[awardeeId]  — 删除人员
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type RouteParams = { params: Promise<{ awardeeId: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { awardeeId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const awardee = await prisma.talentAwardee.update({
    where: { id: awardeeId },
    data: {
      ...(body.name           !== undefined && { name:          String(body.name).trim() }),
      ...(body.batch          !== undefined && { batch:         String(body.batch) }),
      ...(body.status         !== undefined && { status:        String(body.status) }),
      ...(body.feishuOpenId   !== undefined && { feishuOpenId:  (body.feishuOpenId as string) || null }),
      ...(body.subsidy        !== undefined && { subsidy:       body.subsidy ? parseFloat(String(body.subsidy)) : null }),
      ...(body.approvedAmount !== undefined && { approvedAmount:body.approvedAmount ? parseFloat(String(body.approvedAmount)) : null }),
    },
    include: { disbursements: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json(awardee);
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { awardeeId } = await params;

  await prisma.talentAwardee.delete({ where: { id: awardeeId } });

  return NextResponse.json({ ok: true });
}
