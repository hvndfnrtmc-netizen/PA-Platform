/**
 * DELETE /api/admin/feishu-targets/[id]  — 删除通知目标（仅 SUPER_ADMIN）
 * PATCH  /api/admin/feishu-targets/[id]  — 更新 modules 字段（仅 SUPER_ADMIN）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "权限不足，仅超级管理员可删除通知目标" }, { status: 403 });

  const { id } = await params;

  try {
    await prisma.feishuNotificationTarget.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "删除失败，记录可能不存在" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "权限不足，仅超级管理员可修改通知目标" }, { status: 403 });

  const { id } = await params;
  const body = await req.json() as { modules?: string[] };

  if (!Array.isArray(body.modules))
    return NextResponse.json({ error: "modules 必须为字符串数组" }, { status: 400 });

  try {
    const target = await prisma.feishuNotificationTarget.update({
      where: { id },
      data:  { modules: body.modules },
    });
    return NextResponse.json({ target });
  } catch {
    return NextResponse.json({ error: "更新失败，记录可能不存在" }, { status: 500 });
  }
}
