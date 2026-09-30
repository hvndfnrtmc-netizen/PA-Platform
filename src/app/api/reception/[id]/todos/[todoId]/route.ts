/**
 * PATCH  /api/reception/[id]/todos/[todoId]  — 更新单条（标题/完成状态/链接/备注）
 * DELETE /api/reception/[id]/todos/[todoId]  — 软删除（若有子任务先拒绝）
 *
 * ⚠️ remark 字段只写入 ReceptionTodo（实例表），绝不回写 ReceptionTodoTemplate（模板表）。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { TodoActionType } from "@prisma/client";

type Params = { params: Promise<{ id: string; todoId: string }> };

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id, todoId } = await params;
  const todo = await prisma.receptionTodo.findFirst({
    where: { id: todoId, receptionId: id, deletedAt: null },
  });
  if (!todo) return NextResponse.json({ error: "待办不存在" }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if ("title" in body) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (!t) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
    patch.title = t;
  }
  if ("isCompleted" in body && typeof body.isCompleted === "boolean") {
    patch.isCompleted = body.isCompleted;
  }
  if ("actionType" in body) {
    const at = body.actionType;
    patch.actionType = (typeof at === "string" && Object.values(TodoActionType).includes(at as TodoActionType))
      ? at
      : TodoActionType.NONE;
  }
  if ("actionValue" in body) {
    patch.actionValue = typeof body.actionValue === "string" ? body.actionValue : null;
  }
  // remark 只更新实例表，绝不触碰模板表
  if ("remark" in body) {
    patch.remark = typeof body.remark === "string" && body.remark.trim()
      ? body.remark.trim()
      : null;
  }

  const updated = await prisma.receptionTodo.update({ where: { id: todoId }, data: patch });
  return NextResponse.json({ todo: updated });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id, todoId } = await params;
  const todo = await prisma.receptionTodo.findFirst({
    where: { id: todoId, receptionId: id, deletedAt: null },
  });
  if (!todo) return NextResponse.json({ error: "待办不存在" }, { status: 404 });

  // Restrict：有未删除子任务时拒绝
  const childCount = await prisma.receptionTodo.count({
    where: { parentId: todoId, deletedAt: null },
  });
  if (childCount > 0)
    return NextResponse.json({ error: "请先删除所有子任务后再删除父任务" }, { status: 409 });

  await prisma.receptionTodo.update({
    where: { id: todoId },
    data:  { deletedAt: new Date() },
  });

  return NextResponse.json({ success: true });
}
