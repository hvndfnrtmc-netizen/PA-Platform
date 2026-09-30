/**
 * PATCH /api/reception/[id]/todos/reorder
 *
 * 接收前端拖拽后的完整排序数组，批量更新 order 字段。
 *
 * Body:
 *   { items: { id: string; order: number }[] }
 *
 * 只更新属于该 reception 的 todos，拒绝跨接待操作。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

interface OrderItem {
  id:    string;
  order: number;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const reception = await prisma.reception.findUnique({ where: { id, deletedAt: null } });
  if (!reception) return NextResponse.json({ error: "接待记录不存在" }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;
  if (!Array.isArray(body.items))
    return NextResponse.json({ error: "items 必须为数组" }, { status: 400 });

  const items = (body.items as unknown[]).filter((v): v is OrderItem =>
    typeof v === "object" && v !== null &&
    typeof (v as Record<string, unknown>).id === "string" &&
    typeof (v as Record<string, unknown>).order === "number",
  );

  if (items.length === 0) return NextResponse.json({ updated: 0 });

  // 验证所有 id 均属于该 reception（防跨记录攻击）
  const ownedIds = await prisma.receptionTodo.findMany({
    where: { receptionId: id, deletedAt: null, id: { in: items.map(i => i.id) } },
    select: { id: true },
  });
  const ownedSet = new Set(ownedIds.map(o => o.id));
  const safe = items.filter(i => ownedSet.has(i.id));

  await prisma.$transaction(
    safe.map(item =>
      prisma.receptionTodo.update({
        where: { id: item.id },
        data:  { order: item.order },
      }),
    ),
  );

  return NextResponse.json({ updated: safe.length });
}
