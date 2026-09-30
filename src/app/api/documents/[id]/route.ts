/**
 * GET    /api/documents/[id]  — 单条详情
 * DELETE /api/documents/[id]  — 删除（同时删除文件）
 */

import { NextRequest, NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const doc = await prisma.document.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      task:      { select: { id: true, title: true } },
    },
  });
  if (!doc) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  return NextResponse.json({ document: doc });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  // 删除物理文件（忽略不存在错误）
  const tryDelete = async (rel: string | null) => {
    if (!rel) return;
    try { await unlink(path.join(process.cwd(), UPLOAD_DIR, rel)); } catch {}
  };
  await tryDelete(doc.templateFile !== "form-generated" ? doc.templateFile : null);
  await tryDelete(doc.outputFile);

  await prisma.document.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
