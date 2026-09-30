/**
 * GET  /api/agreement/data?year=&category=  — 查询月度数据
 * POST /api/agreement/data                  — 录入/更新月度数据（editor+）
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const sp       = req.nextUrl.searchParams;
  const year     = sp.get("year");
  const category = sp.get("category");
  const period   = sp.get("period");

  const where: Record<string, unknown> = {};
  if (period)   where.period   = period;
  else if (year) where.period  = { startsWith: year };
  if (category) where.category = category;

  const rows = await prisma.agreementData.findMany({
    where,
    orderBy: [{ period: "desc" }, { category: "asc" }],
  });

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const role = session.user.role ?? "";
  if (!["SUPER_ADMIN", "ADMIN", "admin", "EDITOR", "editor"].includes(role))
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  let body: { period?: string; category?: string; payload?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "请求体格式错误" }, { status: 400 }); }

  if (!body.period?.trim() || !body.category?.trim())
    return NextResponse.json({ error: "period 和 category 为必填项" }, { status: 400 });

  const row = await prisma.agreementData.upsert({
    where:  { period_category: { period: body.period, category: body.category } },
    create: {
      period:      body.period,
      category:    body.category,
      payload:     (body.payload ?? {}) as object,
      submittedBy: session.user.id,
    },
    update: {
      payload:     (body.payload ?? {}) as object,
      submittedBy: session.user.id,
    },
  });

  return NextResponse.json(row);
}
