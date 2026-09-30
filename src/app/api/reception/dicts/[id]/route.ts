/**
 * PATCH  /api/reception/dicts/[id]   重命名字典选项（不可改 category / parentId）
 * DELETE /api/reception/dicts/[id]   删除字典选项（有子项时拒绝）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id }    = await params;
  const { value } = (await req.json()) as { value?: string };

  if (!value?.trim())
    return NextResponse.json({ error: "value 不能为空" }, { status: 400 });

  const existing = await prisma.receptionDictionary.findUnique({ where: { id } });
  if (!existing)
    return NextResponse.json({ error: "选项不存在" }, { status: 404 });

  // 冲突检查：同层级（同 category + 同 parentId）下不允许重名
  const conflict = await prisma.receptionDictionary.findFirst({
    where: {
      category:  existing.category,
      value:     value.trim(),
      parentId:  existing.parentId,   // 只在同一父级下查重
      id:        { not: id },
    },
  });
  if (conflict)
    return NextResponse.json({ error: "该层级下已存在同名选项" }, { status: 409 });

  const updated = await prisma.receptionDictionary.update({
    where: { id },
    data:  { value: value.trim() },
  });

  return NextResponse.json({ row: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可停用字典选项" }, { status: 403 });

  const { id } = await params;

  const row = await prisma.receptionDictionary.findUnique({
    where:   { id },
    include: { children: { where: { isActive: true }, select: { id: true } } },
  });
  if (!row) return NextResponse.json({ error: "选项不存在" }, { status: 404 });
  if (row.isDefault)
    return NextResponse.json({ error: "内置默认选项不可停用" }, { status: 422 });
  if (row.children.length > 0)
    return NextResponse.json({
      error: `请先停用该选项下的 ${row.children.length} 个子选项`,
    }, { status: 422 });

  // 软删除：标记为停用，不物理删除，历史记录 ID 映射不受影响
  await prisma.receptionDictionary.update({
    where: { id },
    data:  { isActive: false },
  });
  return NextResponse.json({ success: true });
}
