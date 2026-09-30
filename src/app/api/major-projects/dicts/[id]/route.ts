/**
 * PATCH  /api/major-projects/dicts/[id]   更新字典选项（重命名）
 * DELETE /api/major-projects/dicts/[id]   停用字典选项（软删除）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT") {
    return NextResponse.json({ error: "权限不足" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { value } = body;

  if (!value?.trim()) {
    return NextResponse.json({ error: "选项值不能为空" }, { status: 400 });
  }

  const existing = await prisma.majorProjectDictionary.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "字典项不存在" }, { status: 404 });
  }

  // 检查同分类下是否重名（排除自己）
  const duplicate = await prisma.majorProjectDictionary.findFirst({
    where: {
      category: existing.category,
      value: value.trim(),
      id: { not: id },
    },
  });
  if (duplicate) {
    return NextResponse.json({ error: "该选项已存在" }, { status: 409 });
  }

  const updated = await prisma.majorProjectDictionary.update({
    where: { id },
    data: { value: value.trim() },
  });

  return NextResponse.json({ item: updated });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "仅超级管理员可删除字典项" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await prisma.majorProjectDictionary.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "字典项不存在" }, { status: 404 });
  }

  // 软删除：设置 isActive = false
  await prisma.majorProjectDictionary.update({
    where: { id },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true });
}
