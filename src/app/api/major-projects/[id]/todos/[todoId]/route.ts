/**
 * PATCH /api/major-projects/[id]/todos/[todoId]
 * 单条待办勾选/取消勾选（即时触发，无需整体保存）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Params = { params: Promise<{ id: string; todoId: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { todoId } = await params;
  const { isCompleted } = await req.json() as { isCompleted: boolean };

  const todo = await prisma.projectTodo.update({
    where: { id: todoId },
    data:  { isCompleted: Boolean(isCompleted) },
  });
  return NextResponse.json({ todo });
}
