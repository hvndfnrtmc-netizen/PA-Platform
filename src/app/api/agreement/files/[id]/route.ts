/**
 * DELETE /api/agreement/files/[id] — 删除文件（admin only）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

type P = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: P) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const role = session.user.role ?? "";
  if (!["SUPER_ADMIN", "ADMIN", "admin", "EDITOR", "editor"].includes(role))
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.agreementFile.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  await prisma.agreementFile.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
