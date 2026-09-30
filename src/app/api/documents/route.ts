/**
 * GET  /api/documents  — 列出公文记录
 * 支持 ?mode=templates|generated|all（默认 all）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const mode = req.nextUrl.searchParams.get("mode") ?? "all";

  const where =
    mode === "templates"  ? { outputFile: null }  :
    mode === "generated"  ? { outputFile: { not: null } } :
    {};

  const documents = await prisma.document.findMany({
    where,
    include: {
      createdBy: { select: { id: true, name: true } },
      task:      { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({ documents });
}
