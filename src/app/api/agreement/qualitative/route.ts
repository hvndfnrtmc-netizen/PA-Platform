/**
 * GET /api/agreement/qualitative — 列出全部 12 项质性义务
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const rows = await prisma.qualitativeObligation.findMany({
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(rows);
}
