import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { checkModulePermission } from "@/lib/module-auth";

const MODULE = "reception";
const VALID_CATEGORIES = ["level", "format", "purpose", "status"] as const;
type DictCategory = (typeof VALID_CATEGORIES)[number];

// ──────────────────────────────────────────────
// GET /api/reception-dict
// 支持 ?category=level|format|purpose|status 过滤
// ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const category = req.nextUrl.searchParams.get("category") ?? undefined;

  const items = await prisma.receptionDictionary.findMany({
    where: category ? { category } : undefined,
    orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { value: "asc" }],
  });

  return NextResponse.json({ items });
}

// ──────────────────────────────────────────────
// POST /api/reception-dict
// Body: { category, value }
// 幂等：同 category+value 已存在则直接返回，不重复插入
// ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { role, departmentId } = session.user;
  const canEdit = await checkModulePermission({
    userRole: role,
    departmentId,
    moduleKey: MODULE,
    required: "EDIT",
  });
  if (!canEdit) {
    return NextResponse.json({ error: "权限不足：需要接待模块编辑权" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const category = String(body.category ?? "").toLowerCase().trim();
  const value = String(body.value ?? "").trim();

  if (!VALID_CATEGORIES.includes(category as DictCategory)) {
    return NextResponse.json(
      { error: `category 必须为 ${VALID_CATEGORIES.join(" / ")} 之一` },
      { status: 400 }
    );
  }
  if (!value) {
    return NextResponse.json({ error: "value 不能为空" }, { status: 400 });
  }

  const existing = await prisma.receptionDictionary.findFirst({
    where: { category, value, parentId: null },
  });
  const item = existing ?? await prisma.receptionDictionary.create({
    data: { category, value },
  });

  return NextResponse.json({ item }, { status: 201 });
}
