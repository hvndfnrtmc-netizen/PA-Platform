/**
 * GET  /api/admin/feishu-targets           — 获取通知目标列表
 *   ?module=reception                       — 按模块过滤（has 条件）
 *   不传 module 时返回全量（超级后台管理用）
 * POST /api/admin/feishu-targets           — 新增通知目标（仅 SUPER_ADMIN）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const module = req.nextUrl.searchParams.get("module") ?? undefined;

  const targets = await prisma.feishuNotificationTarget.findMany({
    where:   module ? { modules: { has: module } } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ targets });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "权限不足，仅超级管理员可新增通知目标" }, { status: 403 });

  const body = await req.json() as { name?: string; feishuId?: string };
  const name     = body.name?.trim();
  const feishuId = body.feishuId?.trim();

  if (!name || !feishuId)
    return NextResponse.json({ error: "name 和 feishuId 不能为空" }, { status: 400 });

  if (!/^(oc_|ou_|on_)/.test(feishuId))
    return NextResponse.json({ error: "feishuId 须以 oc_ / ou_ / on_ 开头" }, { status: 400 });

  const type = feishuId.startsWith("oc_") ? "GROUP" : "USER";

  try {
    const target = await prisma.feishuNotificationTarget.create({
      data: { name, feishuId, type },
    });
    return NextResponse.json({ target }, { status: 201 });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === "P2002")
      return NextResponse.json({ error: "该飞书 ID 已存在，请勿重复添加" }, { status: 409 });
    throw e;
  }
}
