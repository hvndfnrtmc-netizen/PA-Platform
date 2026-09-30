/**
 * GET  /api/reception/todo-templates  — 树形模板列表（仅返回 isActive=true 项）
 * POST /api/reception/todo-templates  — 新增模板（大类 or 子任务）
 */

export const dynamic   = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { TodoActionType } from "@prisma/client";

function buildTree(flat: Awaited<ReturnType<typeof loadFlat>>) {
  const parents  = flat.filter(t => t.parentId === null);
  const byParent = new Map<string, typeof flat>();
  for (const t of flat) {
    if (!t.parentId) continue;
    const arr = byParent.get(t.parentId) ?? [];
    arr.push(t);
    byParent.set(t.parentId, arr);
  }
  return parents.map(p => ({
    ...p,
    children: (byParent.get(p.id) ?? []).sort((a, b) => a.order - b.order),
  }));
}

async function loadFlat(onlyActive: boolean) {
  return prisma.receptionTodoTemplate.findMany({
    where:   onlyActive ? { isActive: true } : {},
    orderBy: [{ order: "asc" }],
  });
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  // 始终只返回 isActive=true 的模板，软删后不再复活
  const flat = await loadFlat(true);
  return NextResponse.json({ templates: buildTree(flat) });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json() as Record<string, unknown>;
  const title    = typeof body.title    === "string" ? body.title.trim()    : "";
  const category = typeof body.category === "string" ? body.category.trim() : "";

  if (!title)    return NextResponse.json({ error: "title 不能为空" },    { status: 400 });
  if (!category) return NextResponse.json({ error: "category 不能为空" }, { status: 400 });

  const parentId = typeof body.parentId === "string" ? body.parentId : null;

  const actionType = (
    typeof body.defaultActionType === "string" &&
    Object.values(TodoActionType).includes(body.defaultActionType as TodoActionType)
  ) ? (body.defaultActionType as TodoActionType) : TodoActionType.NONE;

  const actionValue = typeof body.defaultActionValue === "string" ? body.defaultActionValue : null;

  // order = 同层最大值 + 10
  const maxRow = await prisma.receptionTodoTemplate.aggregate({
    where: { parentId: parentId ?? null, isActive: true },
    _max:  { order: true },
  });
  const order = (maxRow._max.order ?? 0) + 10;

  const tpl = await prisma.receptionTodoTemplate.create({
    data: { title, category, parentId, defaultActionType: actionType, defaultActionValue: actionValue, order },
  });

  const flat = await loadFlat(false);
  return NextResponse.json({ template: tpl, templates: buildTree(flat) }, { status: 201 });
}
