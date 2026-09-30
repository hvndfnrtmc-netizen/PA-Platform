/**
 * PATCH  /api/reception/todo-templates/[id]  — 更新标题/链接/排序/category
 * DELETE /api/reception/todo-templates/[id]  — 软删除（isActive=false）
 *
 * 软删除不影响任何已导入的 ReceptionTodo 实例，历史数据完全隔离。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { TodoActionType } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const tpl = await prisma.receptionTodoTemplate.findUnique({ where: { id } });
  if (!tpl) return NextResponse.json({ error: "模板不存在" }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;
  const patch: Record<string, unknown> = {};

  if ("title" in body) {
    const t = typeof body.title === "string" ? body.title.trim() : "";
    if (!t) return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
    patch.title = t;
  }
  if ("category" in body && typeof body.category === "string") {
    patch.category = body.category.trim();
  }
  if ("defaultActionType" in body) {
    const at = body.defaultActionType;
    patch.defaultActionType = (
      typeof at === "string" && Object.values(TodoActionType).includes(at as TodoActionType)
    ) ? at : TodoActionType.NONE;
  }
  if ("defaultActionValue" in body) {
    patch.defaultActionValue = typeof body.defaultActionValue === "string"
      ? body.defaultActionValue
      : null;
  }
  if ("order" in body && typeof body.order === "number") {
    patch.order = body.order;
  }

  const updated = await prisma.receptionTodoTemplate.update({ where: { id }, data: patch });
  return NextResponse.json({ template: updated });
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const tpl = await prisma.receptionTodoTemplate.findUnique({ where: { id } });
  if (!tpl) return NextResponse.json({ error: "模板不存在" }, { status: 404 });

  // 软删除（isActive=false），已导入的 ReceptionTodo 实例不受影响
  // 同时级联软删该模板下的所有子模板，避免悬空子项残留
  await prisma.$transaction([
    prisma.receptionTodoTemplate.updateMany({
      where: { parentId: id },
      data:  { isActive: false },
    }),
    prisma.receptionTodoTemplate.update({
      where: { id },
      data:  { isActive: false },
    }),
  ]);

  return NextResponse.json({ success: true });
}
