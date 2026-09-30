/**
 * POST /api/users/patch-chinese-names
 * 临时测试工具：将数据库中 5 个用户的 name 字段强制更新为中文名
 * 用于验证「人才申报」搜索框是否支持纯中文检索
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const CHINESE_NAMES = ["张三", "李四", "王五", "赵六", "钱七"];

export async function POST() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  // 查找前 5 个活跃用户
  const users = await prisma.user.findMany({
    where: { deletedAt: null, isActive: true },
    take: 5,
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });

  if (users.length === 0) {
    return NextResponse.json({ error: "数据库中没有活跃用户" }, { status: 404 });
  }

  const updates = await Promise.all(
    users.map((u, i) =>
      prisma.user.update({
        where: { id: u.id },
        data: { name: CHINESE_NAMES[i] },
        select: { id: true, name: true },
      })
    )
  );

  return NextResponse.json({
    updated: updates.length,
    names: updates.map(u => u.name),
    message: `已成功将 ${updates.length} 个用户的名字修改为中文名，请刷新页面后在搜索框输入"张"进行验证。`,
  });
}
