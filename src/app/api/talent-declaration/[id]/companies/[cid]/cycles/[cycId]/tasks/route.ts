/**
 * POST /api/talent-declaration/[id]/companies/[cid]/cycles/[cycId]/tasks  — 添加任务
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type RouteParams = { params: Promise<{ id: string; cid: string; cycId: string }> };

export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { cycId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const content = String(body.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "任务内容不能为空" }, { status: 400 });

  const cycle = await prisma.talentProjectCycle.findFirst({
    where: { id: cycId, deletedAt: null },
  });
  if (!cycle) return NextResponse.json({ error: "周期不存在" }, { status: 404 });

  // 计算 sortOrder = 当前最大值 + 1
  const lastTask = await prisma.talentCycleTask.findFirst({
    where: { cycleId: cycId },
    orderBy: { sortOrder: "desc" },
  });
  const sortOrder = (lastTask?.sortOrder ?? -1) + 1;

  const task = await prisma.talentCycleTask.create({
    data: { cycleId: cycId, content, sortOrder },
  });

  return NextResponse.json(task, { status: 201 });
}
