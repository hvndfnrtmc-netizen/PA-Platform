/**
 * DELETE /api/talent-declaration/[id]/companies/[cid]  — 软删除公司
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { cid } = await params;

  const existing = await prisma.talentProjectCompany.findFirst({
    where: { id: cid, deletedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "公司不存在" }, { status: 404 });

  await prisma.talentProjectCompany.update({
    where: { id: cid },
    data: { deletedAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
