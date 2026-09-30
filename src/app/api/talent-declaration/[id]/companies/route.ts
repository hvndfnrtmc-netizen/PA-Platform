/**
 * GET  /api/talent-declaration/[id]/companies  — 获取项目下所有公司（含各自周期）
 * POST /api/talent-declaration/[id]/companies  — 新增公司
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;

  const companies = await prisma.talentProjectCompany.findMany({
    where: { projectId: id, deletedAt: null },
    include: {
      cycles: {
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        include: {
          owner: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { sortOrder: "asc" },
  });

  return NextResponse.json(companies);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "公司名称不能为空" }, { status: 400 });

  const project = await prisma.talentProject.findFirst({ where: { id, deletedAt: null } });
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  const company = await prisma.talentProjectCompany.create({
    data: {
      projectId: id,
      name,
      unifiedCode: (body.unifiedCode as string) || null,
    },
    include: { cycles: true },
  });

  return NextResponse.json(company, { status: 201 });
}
