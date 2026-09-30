/**
 * PATCH  /…/tasks/[taskId]  — 更新任务（勾选完成 / 修改内容）
 * DELETE /…/tasks/[taskId]  — 删除任务
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type RouteParams = { params: Promise<{ taskId: string }> };

export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { taskId } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const task = await prisma.talentCycleTask.update({
    where: { id: taskId },
    data: {
      ...(body.content !== undefined     && { content:     String(body.content).trim() }),
      ...(body.isCompleted !== undefined && { isCompleted: Boolean(body.isCompleted) }),
    },
  });

  return NextResponse.json(task);
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { taskId } = await params;

  await prisma.talentCycleTask.delete({ where: { id: taskId } });

  return NextResponse.json({ ok: true });
}
