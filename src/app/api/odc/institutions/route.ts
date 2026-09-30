/**
 * GET /api/odc/institutions — 获取所有用户自建 ODC 机构
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const institutions = await prisma.odcInstitution.findMany({
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(institutions);
}
