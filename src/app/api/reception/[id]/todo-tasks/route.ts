/**
 * POST /api/reception/[id]/todo-tasks
 *   手动新建一条子任务
 *   Body: { category: string; content: string }
 *
 * PATCH /api/reception/[id]/todo-tasks
 *   批量更新 sortOrder（拖拽排序持久化）
 *   Body: { items: { id: string; sortOrder: number }[] }
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id: receptionId } = await params;
  const body = await req.json() as { category?: string; content?: string };

  if (!body.category?.trim() || !body.content?.trim())
    return NextResponse.json({ error: "category 和 content 不能为空" }, { status: 400 });

  // 计算当前该分类最大 sortOrder
  const maxTask = await prisma.receptionTodoTask.findFirst({
    where:   { receptionId, category: body.category, deletedAt: null },
    orderBy: { sortOrder: "desc" },
    select:  { sortOrder: true },
  });

  const task = await prisma.receptionTodoTask.create({
    data: {
      receptionId,
      category:  body.category.trim(),
      content:   body.content.trim(),
      sortOrder: (maxTask?.sortOrder ?? -1) + 1,
    },
  });
  return NextResponse.json({ task }, { status: 201 });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id: receptionId } = await params;
  const body = await req.json() as { items?: { id: string; sortOrder: number }[] };

  if (!Array.isArray(body.items) || body.items.length === 0)
    return NextResponse.json({ error: "items 不能为空" }, { status: 400 });

  // 批量更新 sortOrder（逐条，Prisma 无原生 bulk update by id list）
  await Promise.all(
    body.items.map(({ id, sortOrder }) =>
      prisma.receptionTodoTask.updateMany({
        where: { id, receptionId, deletedAt: null },
        data:  { sortOrder },
      }),
    ),
  );

  return NextResponse.json({ count: body.items.length });
}
