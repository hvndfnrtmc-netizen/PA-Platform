/**
 * GET /api/agreement/files?category=&year= — 列出协议文件（不返回 data 字段）
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
  const category = sp.get("category");
  const yearStr  = sp.get("year");

  const where: Record<string, unknown> = {};
  if (category) where.category = category;
  if (yearStr)  where.year     = parseInt(yearStr);

  const files = await prisma.agreementFile.findMany({
    where,
    select: {
      id: true, name: true, url: true, size: true,
      mimeType: true, category: true, year: true,
      remark: true, uploadedBy: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(files);
}
