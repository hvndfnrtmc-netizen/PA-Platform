/**
 * GET  /api/major-projects/dicts?category=level    查询字典列表
 * POST /api/major-projects/dicts                   新建字典选项
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const SUPPORTED_CATEGORIES = ["level", "category", "companyEntity"];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const category = req.nextUrl.searchParams.get("category") ?? "";
  if (!SUPPORTED_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "不支持的分类" }, { status: 400 });
  }

  const items = await prisma.majorProjectDictionary.findMany({
    where: { category },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  // 返回：值数组（仅激活项）+ 完整记录（含已停用项，用于历史映射）
  const activeValues = items.filter(i => i.isActive).map(i => i.value);

  return NextResponse.json({
    category,
    values: activeValues,
    rows: items,
  });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT") {
    return NextResponse.json({ error: "权限不足" }, { status: 403 });
  }

  const body = await req.json();
  const { category, value } = body;

  if (!SUPPORTED_CATEGORIES.includes(category)) {
    return NextResponse.json({ error: "不支持的分类" }, { status: 400 });
  }
  if (!value?.trim()) {
    return NextResponse.json({ error: "选项值不能为空" }, { status: 400 });
  }

  // 检查同分类下是否重名
  const existing = await prisma.majorProjectDictionary.findFirst({
    where: { category, value: value.trim() },
  });
  if (existing) {
    return NextResponse.json({ error: "该选项已存在" }, { status: 409 });
  }

  // 获取当前最大 sortOrder
  const maxSort = await prisma.majorProjectDictionary.findFirst({
    where: { category },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });

  const item = await prisma.majorProjectDictionary.create({
    data: {
      category,
      value: value.trim(),
      sortOrder: (maxSort?.sortOrder ?? -1) + 1,
      isActive: true,
    },
  });

  return NextResponse.json({ item }, { status: 201 });
}
