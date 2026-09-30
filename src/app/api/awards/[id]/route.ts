/**
 * GET    /api/awards/[id]  — 查询单条
 * PUT    /api/awards/[id]  — 更新（需 EDIT 权限）
 * DELETE /api/awards/[id]  — 软删除（需 EDIT 权限；SUPER_ADMIN 可硬删除）
 *
 * 所有写操作均写入 audit_logs。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { checkModulePermission, getModulePermLevel } from "@/lib/module-auth";
import { Prisma } from "@prisma/client";

const MODULE = "awards";

function getIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

// ───────���──────────────────────────────────────
// GET /api/awards/[id]
// ──────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { role, departmentId } = session.user;
  const permLevel = await getModulePermLevel({ userRole: role, departmentId, moduleKey: MODULE });
  if (!permLevel) return NextResponse.json({ error: "无查看权限" }, { status: 403 });

  const { id } = await params;
  const record = await prisma.qualificationAward.findUnique({
    where: { id, isActive: true, deletedAt: null },
  });
  if (!record) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  return NextResponse.json({ ...record, level: record.category });
}

// ──────────────────────────────────────────────
// PUT /api/awards/[id]
// ──────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id: userId, role, departmentId } = session.user;

  // ── 鉴权：必须拥有 EDIT 权限 ────────────────────────────────────
  const canEdit = await checkModulePermission({
    userRole: role,
    departmentId,
    moduleKey: MODULE,
    required: "EDIT",
  });
  if (!canEdit) {
    return NextResponse.json(
      { error: "权限不足：你的部门未被授予资质奖项模块的编辑权，如需操作请联系 PA 管理员" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await prisma.qualificationAward.findUnique({
    where: { id, isActive: true, deletedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  // 仅更新请求体中携带的字段（partial update）
  const update: Prisma.QualificationAwardUpdateInput = {};

  if (body.awardedAt !== undefined) {
    update.awardedAt = String(body.awardedAt);
    const yearMatch = String(body.awardedAt).match(/\d{4}/);
    update.awardedAtYear = yearMatch ? parseInt(yearMatch[0]) : existing.awardedAtYear;
  }
  if (body.awardedBy      !== undefined) update.awardedBy     = String(body.awardedBy);
  if (body.awardeeEntity  !== undefined) update.awardeeEntity = String(body.awardeeEntity);
  if (body.title       !== undefined) update.title       = String(body.title);
  if (body.level !== undefined || body.category !== undefined)
    update.category = String(body.level ?? body.category);
  if (body.description !== undefined) update.description = body.description ? String(body.description) : null;
  if (body.sourceProjectId !== undefined) update.sourceProjectId = body.sourceProjectId ? String(body.sourceProjectId) : null;
  if (Array.isArray(body.attachments)) {
    update.attachments = body.attachments as Prisma.InputJsonValue;
  }

  const updated = await prisma.qualificationAward.update({ where: { id }, data: update });

  await writeAuditLog({
    userId,
    action: AuditAction.UPDATE_AWARD,
    resourceType: "qualification_award",
    resourceId: id,
    metadata: {
      title: updated.title,
      changedFields: Object.keys(update),
      before: { title: existing.title, awardedAt: existing.awardedAt },
    },
    ipAddress: getIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json(updated);
}

// ──────────────────────────────────────────────
// DELETE /api/awards/[id]
// ──────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id: userId, role, departmentId } = session.user;

  const canEdit = await checkModulePermission({
    userRole: role,
    departmentId,
    moduleKey: MODULE,
    required: "EDIT",
  });
  if (!canEdit) {
    return NextResponse.json(
      { error: "权限不足：删除操作需要 EDIT 权限" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const existing = await prisma.qualificationAward.findUnique({
    where: { id, deletedAt: null },
  });
  if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  // 软删除：保留数据，仅标记 deletedAt
  await prisma.qualificationAward.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  await writeAuditLog({
    userId,
    action: AuditAction.DELETE_AWARD,
    resourceType: "qualification_award",
    resourceId: id,
    metadata: { title: existing.title, awardeeEntity: existing.awardeeEntity },
    ipAddress: getIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
    isDangerous: true,
  });

  return NextResponse.json({ success: true });
}
