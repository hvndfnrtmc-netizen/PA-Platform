/**
 * PUT    /api/departments/[id]  — 编辑部门（SUPER_ADMIN only）
 * DELETE /api/departments/[id]  — 软删除：UPDATE isActive=false（绝不执行 DELETE SQL）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { DepartmentType } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

function ip(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

async function requireAdmin(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return { session: null, err: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  if (session.user.role !== "SUPER_ADMIN") return { session: null, err: NextResponse.json({ error: "仅超级管理员可操作部门" }, { status: 403 }) };
  return { session, err: null };
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { session, err } = await requireAdmin(req);
    if (!session) return err!;

    const { id } = await ctx.params;
    const existing = await prisma.department.findFirst({ where: { id, isActive: true, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "部门不存在" }, { status: 404 });

    let body: Record<string, string | undefined>;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "请求体格式错误" }, { status: 400 }); }
    const { name, type, feishuDeptId } = body;

    const updated = await prisma.department.update({
      where: { id },
      data: {
        ...(name         ? { name:         name.trim() }                           : {}),
        ...(type         ? { type:         type as DepartmentType }                : {}),
        ...(feishuDeptId !== undefined ? { feishuDeptId: feishuDeptId?.trim() || null } : {}),
      },
    });

    writeAuditLog({
      userId:       session.user.id,
      action:       AuditAction.UPDATE_DEPARTMENT,
      resourceType: "department",
      resourceId:   id,
      metadata:     { name: updated.name, changedFields: Object.keys(body) },
      ipAddress:    ip(req),
    }).catch(console.error);

    return NextResponse.json({ department: updated });
  } catch (err) {
    console.error("[PUT /api/departments/[id]]", err);
    return NextResponse.json({ error: "服务器内部错误，请稍后重试" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const { session, err } = await requireAdmin(req);
    if (!session) return err!;

    const { id } = await ctx.params;
    const existing = await prisma.department.findFirst({ where: { id, isActive: true, deletedAt: null } });
    if (!existing) return NextResponse.json({ error: "部门不存在或已停用" }, { status: 404 });

    await prisma.department.update({
      where: { id },
      data: {
        isActive:  false,
        deletedAt: new Date(),
        deletedBy: session.user.id,
      },
    });

    writeAuditLog({
      userId:       session.user.id,
      action:       AuditAction.DELETE_DEPARTMENT,
      resourceType: "department",
      resourceId:   id,
      isDangerous:  true,
      metadata:     { name: existing.name, code: existing.code, softDelete: true },
      ipAddress:    ip(req),
    }).catch(console.error);

    return NextResponse.json({ ok: true, softDeleted: true });
  } catch (err) {
    console.error("[DELETE /api/departments/[id]]", err);
    return NextResponse.json({ error: "服务器内部错误，请稍后重试" }, { status: 500 });
  }
}
