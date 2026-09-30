/**
 * POST /api/major-projects/patch-year
 * 一次性回填脚本：为所有 extractedYear 为空的现存项目提取年份并写入。
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { extractYearFromName } from "@/lib/majorProjectUtils";

export async function POST() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  // 只处理 extractedYear 为空的记录
  const records = await prisma.majorProject.findMany({
    where:  { deletedAt: null, extractedYear: null },
    select: { id: true, name: true },
  });

  let updated = 0;
  for (const rec of records) {
    const year = extractYearFromName(rec.name);
    if (year !== null) {
      await prisma.majorProject.update({
        where: { id: rec.id },
        data:  { extractedYear: year },
      });
      updated++;
    }
  }

  return NextResponse.json({ success: true, scanned: records.length, updated });
}
