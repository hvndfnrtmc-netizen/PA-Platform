/**
 * PATCH /api/users/[id]/party-access
 *
 * 专用于超级管理员开关单个用户的【党员关系】模块个人白名单授权。
 * 请求体: { hasPartyModuleAccess: boolean }
 * 权限:   仅 SUPER_ADMIN
 * 审计:   每次变更均写入审计日志（高危操作）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

function getIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可修改党员模块授权" }, { status: 403 });

  const { id } = await ctx.params;

  const existing = await prisma.user.findFirst({
    where:  { id, deletedAt: null },
    select: { id: true, name: true, email: true, hasPartyModuleAccess: true },
  });
  if (!existing)
    return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  let body: { hasPartyModuleAccess?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (typeof body.hasPartyModuleAccess !== "boolean")
    return NextResponse.json(
      { error: "hasPartyModuleAccess 必须为布尔值" },
      { status: 400 }
    );

  const updated = await prisma.user.update({
    where:  { id },
    data:   { hasPartyModuleAccess: body.hasPartyModuleAccess },
    select: { id: true, name: true, hasPartyModuleAccess: true },
  });

  // 高危操作：写入审计日志（异步，不阻塞响应）
  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.PERMISSION_CHANGE,
    resourceType: "user",
    resourceId:   id,
    isDangerous:  true,
    metadata: {
      field:       "hasPartyModuleAccess",
      newValue:    body.hasPartyModuleAccess,
      targetUser:  existing.name,
      targetEmail: existing.email,
      operator:    session.user.name,
    },
    ipAddress: getIp(req),
  }).catch(console.error);

  return NextResponse.json({ user: updated });
}
