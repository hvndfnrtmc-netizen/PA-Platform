/**
 * GET /api/reception/patch-dress-code
 * 临时数据修补接口：将着装要求为 null 或空字符串的历史记录批量填充为"司服"。
 * 执行一次后可删除此文件。
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const result = await prisma.reception.updateMany({
    where: {
      OR: [
        { dressCode: null },
        { dressCode: "" },
      ],
    },
    data: {
      dressCode: "司服",
    },
  });

  return NextResponse.json({ success: true, updatedCount: result.count });
}
