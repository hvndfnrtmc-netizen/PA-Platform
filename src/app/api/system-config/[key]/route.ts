/**
 * GET   /api/system-config/[key]  — 读取单条配置（任意已登录用户，用于前端动态绑定）
 * PATCH /api/system-config/[key]  — 更新单个配置项的 value（SUPER_ADMIN only）
 * 请求体(PATCH): { value: string }
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";

type Ctx = { params: Promise<{ key: string }> };

function getIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { key } = await ctx.params;
  const config  = await prisma.systemConfig.findUnique({
    where:  { key },
    select: { key: true, value: true, description: true, updatedAt: true },
  });

  if (!config)
    return NextResponse.json({ error: "配置项不存在" }, { status: 404 });

  return NextResponse.json({ config });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可修改配置" }, { status: 403 });

  const { key } = await ctx.params;

  const existing = await prisma.systemConfig.findUnique({ where: { key } });
  if (!existing)
    return NextResponse.json({ error: "配置项不存在" }, { status: 404 });

  let body: { value?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (typeof body.value !== "string" || !body.value.trim())
    return NextResponse.json({ error: "value 不能为空" }, { status: 400 });

  const updated = await prisma.systemConfig.update({
    where: { key },
    data:  { value: body.value.trim() },
  });

  // 写入审计日志（高危操作：全局配置变更）
  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.GLOBAL_CONFIG,
    resourceType: "system_config",
    resourceId:   key,
    isDangerous:  true,
    metadata: {
      key,
      oldValue: existing.value,
      newValue: updated.value,
      operator: session.user.name,
    },
    ipAddress: getIp(req),
  }).catch(console.error);

  return NextResponse.json({ config: updated });
}
