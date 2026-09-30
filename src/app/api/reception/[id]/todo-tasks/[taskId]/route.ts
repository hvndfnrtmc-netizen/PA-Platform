/**
 * PATCH /api/reception/[id]/todo-tasks/[taskId]
 *   isCompleted / content / link / actionType / actionValue
 *
 * DELETE /api/reception/[id]/todo-tasks/[taskId]
 *   软删除
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id, taskId } = await params;
  const task = await prisma.receptionTodoTask.findFirst({
    where: { id: taskId, receptionId: id, deletedAt: null },
  });
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  let body: {
    isCompleted?: boolean;
    content?:     string;
    link?:        string | null;
    actionType?:  string | null;
    actionValue?: string | null;
  } = {};
  try { body = await req.json(); } catch { /**/ }

  const data: Record<string, unknown> = {};
  if (typeof body.isCompleted === "boolean") data.isCompleted = body.isCompleted;
  else if (Object.keys(body).length === 0)   data.isCompleted = !task.isCompleted; // 纯 toggle
  if ("content"     in body && body.content?.trim()) data.content     = body.content.trim();
  if ("link"        in body) data.link        = body.link        ?? null;
  if ("actionType"  in body) data.actionType  = body.actionType  ?? null;
  if ("actionValue" in body) data.actionValue = body.actionValue ?? null;

  const updated = await prisma.receptionTodoTask.update({ where: { id: taskId }, data });
  return NextResponse.json({ task: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id, taskId } = await params;
  const task = await prisma.receptionTodoTask.findFirst({
    where: { id: taskId, receptionId: id, deletedAt: null },
  });
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  await prisma.receptionTodoTask.update({ where: { id: taskId }, data: { deletedAt: new Date() } });
  return NextResponse.json({ success: true });
}
