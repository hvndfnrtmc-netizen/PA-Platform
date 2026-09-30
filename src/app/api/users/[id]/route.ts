/**
 * PUT    /api/users/[id]  — 更新用户
 * DELETE /api/users/[id]  — 软删除用户（SUPER_ADMIN only）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { UserRole } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

function ip(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可修改用户" }, { status: 403 });

  const { id } = await ctx.params;
  const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  const body = await req.json();
  const { name, role, departmentId, isActive, feishuOpenId } = body;

  // feishuOpenId 唯一性冲突检查
  if (feishuOpenId) {
    const conflict = await prisma.user.findFirst({
      where: { feishuOpenId: feishuOpenId.trim(), NOT: { id } },
    });
    if (conflict) {
      return NextResponse.json(
        { error: `该飞书 open_id 已被「${conflict.name}」使用，请确认后重试` },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(role !== undefined ? { role: role as UserRole } : {}),
      ...(departmentId !== undefined ? { departmentId: departmentId ?? null } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(feishuOpenId !== undefined ? { feishuOpenId: feishuOpenId?.trim() || null } : {}),
    },
    select: {
      id: true, name: true, email: true, role: true, isActive: true,
      feishuOpenId: true,
      departmentId: true, department: { select: { id: true, name: true } },
    },
  });

  writeAuditLog({
    userId: session.user.id,
    action: AuditAction.UPDATE_USER,
    resourceType: "user",
    resourceId: id,
    isDangerous: role !== undefined,
    metadata: { changedFields: Object.keys(body) },
    ipAddress: ip(req),
  }).catch(console.error);

  return NextResponse.json({ user: updated });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可删除用户" }, { status: 403 });

  const { id } = await ctx.params;
  if (id === session.user.id)
    return NextResponse.json({ error: "不能删除自己" }, { status: 400 });

  const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "用户不存在" }, { status: 404 });

  await prisma.user.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  writeAuditLog({
    userId: session.user.id,
    action: AuditAction.DELETE_USER,
    resourceType: "user",
    resourceId: id,
    isDangerous: true,
    metadata: { name: existing.name, email: existing.email },
    ipAddress: ip(req),
  }).catch(console.error);

  return NextResponse.json({ ok: true });
}
