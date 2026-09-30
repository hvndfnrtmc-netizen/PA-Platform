/**
 * GET  /…/awardees  — 获取入选人员名单
 * POST /…/awardees  — 添加入选人员
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type RouteParams = { params: Promise<{ cycId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { cycId } = await params;

  const awardees = await prisma.talentAwardee.findMany({
    where: { cycleId: cycId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(awardees);
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { cycId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "姓名不能为空" }, { status: 400 });

  const cycle = await prisma.talentProjectCycle.findFirst({
    where: { id: cycId, deletedAt: null },
  });
  if (!cycle) return NextResponse.json({ error: "周期不存在" }, { status: 404 });

  const awardee = await prisma.talentAwardee.create({
    data: {
      cycleId:       cycId,
      name,
      batch:         (body.batch        as string) || "",
      feishuOpenId:  (body.feishuOpenId as string) || null,
      subsidy:       body.subsidy ? parseFloat(String(body.subsidy)) : null,
      approvedAmount:body.approvedAmount ? parseFloat(String(body.approvedAmount)) : null,
      status:        (body.status       as string) || "待确认",
    },
    include: { disbursements: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json(awardee, { status: 201 });
}
