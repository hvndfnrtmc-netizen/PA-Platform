/**
 * GET    /api/talent-declaration/[id]/companies/[cid]/cycles/[cycId]  — 获取周期详情（含任务+名单）
 * PATCH  /…/cycles/[cycId]  — 更新周期元数据
 * DELETE /…/cycles/[cycId]  — 软删除周期
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type RouteParams = { params: Promise<{ id: string; cid: string; cycId: string }> };

export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { cycId } = await params;

  const cycle = await prisma.talentProjectCycle.findFirst({
    where: { id: cycId, deletedAt: null },
    include: {
      owner: { select: { id: true, name: true } },
      tasks: { orderBy: { sortOrder: "asc" } },
      awardees: {
        orderBy: { createdAt: "asc" },
        include: { disbursements: { orderBy: { createdAt: "asc" } } },
      },
    },
  });

  if (!cycle) return NextResponse.json({ error: "周期不存在" }, { status: 404 });
  return NextResponse.json(cycle);
}

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { cycId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const existing = await prisma.talentProjectCycle.findFirst({
    where: { id: cycId, deletedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "周期不存在" }, { status: 404 });

  try {
    const cycle = await prisma.talentProjectCycle.update({
      where: { id: cycId },
      data: {
        ...(body.name !== undefined            && { name:             String(body.name) }),
        ...(body.ownerId !== undefined         && { ownerId:          (body.ownerId as string) || null }),
        ...(body.totalFunding !== undefined    && { totalFunding:     body.totalFunding ? parseFloat(String(body.totalFunding)) : null }),
        ...(body.headcount !== undefined       && { headcount:        body.headcount ? parseInt(String(body.headcount)) : null }),
        ...(body.declarationNodes !== undefined && { declarationNodes: body.declarationNodes as object[] }),
        ...(body.windowStartDate !== undefined && { windowStartDate:  body.windowStartDate ? new Date(body.windowStartDate as string) : null }),
        ...(body.windowEndDate !== undefined   && { windowEndDate:    body.windowEndDate   ? new Date(body.windowEndDate   as string) : null }),
        ...(body.feishuGroupUrl !== undefined  && { feishuGroupUrl:   (body.feishuGroupUrl as string) || null }),
      },
      include: {
        owner: { select: { id: true, name: true } },
        tasks: { orderBy: { sortOrder: "asc" } },
        awardees: {
          orderBy: { createdAt: "asc" },
          include: { disbursements: { orderBy: { createdAt: "asc" } } },
        },
      },
    });
    return NextResponse.json(cycle);
  } catch (error) {
    console.error("【周期保存失败详情】:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `保存失败：${msg}` }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { cycId } = await params;

  const existing = await prisma.talentProjectCycle.findFirst({
    where: { id: cycId, deletedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "周期不存在" }, { status: 404 });

  await prisma.talentProjectCycle.update({
    where: { id: cycId },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
