/**
 * GET  /api/reception/[id]/todos  — 获取待办（树形），首次自动迁移旧 todoList JSON
 * POST /api/reception/[id]/todos  — 从模板批量导入 OR 手动新增单条
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { TodoActionType } from "@prisma/client";

type Params = { params: Promise<{ id: string }> };

// ── 树形构建 ──────────────────────────────────────────────────────────────────

type FlatTodo = Awaited<ReturnType<typeof fetchFlat>>[number];

function buildTree(flat: FlatTodo[]) {
  const parents  = flat.filter(t => t.parentId === null);
  const byParent = new Map<string, FlatTodo[]>();
  for (const t of flat) {
    if (t.parentId === null) continue;
    const arr = byParent.get(t.parentId) ?? [];
    arr.push(t);
    byParent.set(t.parentId, arr);
  }
  return parents.map(p => ({
    ...p,
    children: (byParent.get(p.id) ?? []).sort((a, b) => a.order - b.order),
  }));
}

async function fetchFlat(receptionId: string) {
  return prisma.receptionTodo.findMany({
    where:   { receptionId, deletedAt: null },
    orderBy: [{ order: "asc" }],
  });
}

// ── 旧数据迁移（Reception.todoList → ReceptionTodo 表）────────────────────────
// 仅在 ReceptionTodo 为空时执行一次，安全幂等

interface OldLinkConfig  { type: "url" | "feishu_doc" | "feishu_chat"; target: string }
interface OldTodoTask    { id?: string; content: string; isCompleted: boolean; link?: OldLinkConfig }
interface OldTodoCategory{ id?: string; title: string; tasks: OldTodoTask[] }

function mapLinkType(t: string): TodoActionType {
  if (t === "feishu_doc")  return TodoActionType.FEISHU_DOC;
  if (t === "feishu_chat") return TodoActionType.FEISHU_CHAT;
  if (t === "url")         return TodoActionType.URL;
  return TodoActionType.NONE;
}

async function migrateOldTodoList(receptionId: string) {
  const reception = await prisma.reception.findUnique({
    where:  { id: receptionId, deletedAt: null },
    select: { todoList: true },
  });
  if (!reception) return;

  const raw = reception.todoList;
  if (!Array.isArray(raw) || raw.length === 0) return;

  const categories = raw as unknown as OldTodoCategory[];
  let orderCursor  = 10;

  for (const cat of categories) {
    if (!cat.title) continue;
    const parent = await prisma.receptionTodo.create({
      data: {
        receptionId,
        title:       cat.title,
        actionType:  TodoActionType.NONE,
        parentId:    null,
        order:       orderCursor,
      },
    });
    orderCursor += 10;

    const tasks = Array.isArray(cat.tasks) ? cat.tasks : [];
    let childOrder = 10;
    for (const task of tasks) {
      if (typeof task.content !== "string") continue;
      const actionType  = task.link?.type ? mapLinkType(task.link.type) : TodoActionType.NONE;
      const actionValue = task.link?.target ?? null;
      await prisma.receptionTodo.create({
        data: {
          receptionId,
          title:       task.content,
          isCompleted: task.isCompleted ?? false,
          actionType,
          actionValue,
          parentId:    parent.id,
          order:       childOrder,
        },
      });
      childOrder += 10;
    }
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const reception = await prisma.reception.findUnique({ where: { id, deletedAt: null } });
  if (!reception) return NextResponse.json({ error: "接待记录不存在" }, { status: 404 });

  let flat = await fetchFlat(id);

  // 首次访问：若新表为空但旧字段有数据，自动迁移
  if (flat.length === 0) {
    await migrateOldTodoList(id);
    flat = await fetchFlat(id);
  }

  return NextResponse.json({ todos: buildTree(flat) });
}

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const reception = await prisma.reception.findUnique({ where: { id, deletedAt: null } });
  if (!reception) return NextResponse.json({ error: "接待记录不存在" }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;

  // ── A：从模板批量导入 ────────────────────────────────────────────────────────
  if (Array.isArray(body.templateIds)) {
    const templateIds = (body.templateIds as unknown[]).filter((v): v is string => typeof v === "string");
    if (templateIds.length === 0) {
      const flat = await fetchFlat(id);
      return NextResponse.json({ todos: buildTree(flat), created: 0 });
    }

    const templates = await prisma.receptionTodoTemplate.findMany({
      where:   { id: { in: templateIds }, isActive: true, parentId: null },
      include: { children: { where: { isActive: true }, orderBy: { order: "asc" } } },
      orderBy: { order: "asc" },
    });

    const existing = await prisma.receptionTodo.findMany({
      where:  { receptionId: id, deletedAt: null, templateId: { not: null } },
      select: { templateId: true },
    });
    const importedSet = new Set(existing.map(e => e.templateId!));

    const maxRow = await prisma.receptionTodo.aggregate({
      where: { receptionId: id, parentId: null, deletedAt: null },
      _max:  { order: true },
    });
    let orderCursor = (maxRow._max.order ?? 0) + 10;
    let created     = 0;

    for (const tpl of templates) {
      if (importedSet.has(tpl.id)) continue;
      const parent = await prisma.receptionTodo.create({
        data: {
          receptionId: id,
          templateId:  tpl.id,
          title:       tpl.title,
          actionType:  tpl.defaultActionType,
          actionValue: tpl.defaultActionValue ?? null,
          parentId:    null,
          order:       orderCursor,
        },
      });
      created++;
      orderCursor += 10;

      for (const child of tpl.children) {
        if (importedSet.has(child.id)) continue;
        await prisma.receptionTodo.create({
          data: {
            receptionId: id,
            templateId:  child.id,
            title:       child.title,
            actionType:  child.defaultActionType,
            actionValue: child.defaultActionValue ?? null,
            parentId:    parent.id,
            order:       child.order,
          },
        });
        created++;
      }
    }

    const flat = await fetchFlat(id);
    return NextResponse.json({ todos: buildTree(flat), created });
  }

  // ── B：手动新增单条 ──────────────────────────────────────────────────────────
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "任务标题不能为空" }, { status: 400 });

  const parentId   = typeof body.parentId === "string" ? body.parentId : null;
  const actionType = (typeof body.actionType === "string" &&
    Object.values(TodoActionType).includes(body.actionType as TodoActionType))
    ? (body.actionType as TodoActionType)
    : TodoActionType.NONE;
  const actionValue = typeof body.actionValue === "string" ? body.actionValue : null;

  const maxRow = await prisma.receptionTodo.aggregate({
    where: { receptionId: id, parentId: parentId ?? null, deletedAt: null },
    _max:  { order: true },
  });
  const order = (maxRow._max.order ?? 0) + 10;

  const todo = await prisma.receptionTodo.create({
    data: { receptionId: id, title, actionType, actionValue, parentId, order },
  });

  const flat = await fetchFlat(id);
  return NextResponse.json({ todo, todos: buildTree(flat) }, { status: 201 });
}
