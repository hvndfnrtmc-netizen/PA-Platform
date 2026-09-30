/**
 * POST /api/major-projects/bulk-delete
 * 批量软删除：将选中项目及其子项目的 deletedAt 设置为当前时间
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  let body: { ids?: unknown };
  try {
    body = await req.json() as { ids?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!Array.isArray(body.ids) || body.ids.length === 0)
    return NextResponse.json({ error: "ids 不能为空" }, { status: 400 });

  const ids = (body.ids as unknown[]).filter((id): id is string => typeof id === "string");
  if (ids.length === 0)
    return NextResponse.json({ error: "ids 格式错误" }, { status: 400 });
  if (ids.length > 1000)
    return NextResponse.json({ error: "单次最多删除 1000 条" }, { status: 400 });

  const now = new Date();

  // 软删除选中的项目，同时级联软删除其子项目
  const result = await prisma.majorProject.updateMany({
    where: {
      OR: [
        { id: { in: ids }, deletedAt: null },
        { parentId: { in: ids }, deletedAt: null }, // 级联子项目
      ],
    },
    data: { deletedAt: now },
  });

  return NextResponse.json({ success: true, deleted: result.count });
}
