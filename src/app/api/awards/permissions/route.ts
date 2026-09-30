/**
 * GET  /api/awards/permissions
 *   — 返回所有非 PA 部门及其当前对 awards 模块的权限级别。
 *   — 仅 SUPER_ADMIN / PA_SPECIALIST 可调用。
 *
 * POST /api/awards/permissions
 *   — 授予或更新某个部门对 awards 模块的权限（UPSERT）。
 *   — 仅 SUPER_ADMIN / PA_SPECIALIST 可调用。
 *   — 写入 audit_logs（isDangerous = true）。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { PermLevel } from "@prisma/client";

const MODULE = "awards";
const ADMIN_ROLES = ["SUPER_ADMIN", "PA_SPECIALIST"] as const;

function getIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

async function requireAdmin(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return { session: null, error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  }
  if (!ADMIN_ROLES.includes(session.user.role as (typeof ADMIN_ROLES)[number])) {
    return {
      session: null,
      error: NextResponse.json({ error: "仅 PA 管理员可管理模块权限" }, { status: 403 }),
    };
  }
  return { session, error: null };
}

// ──────────────────────────────────────────────
// GET /api/awards/permissions
// ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { session, error } = await requireAdmin(req);
  if (!session) return error!;

  // 拉取所有部门（不含 PA 自身）+ 它们当前的权限记录
  const [departments, perms] = await Promise.all([
    prisma.department.findMany({
      where: { isActive: true, deletedAt: null, type: "BUSINESS" },
      select: { id: true, name: true, code: true },
      orderBy: { name: "asc" },
    }),
    prisma.modulePermission.findMany({
      where: { moduleKey: MODULE, isActive: true },
      select: { id: true, departmentId: true, permLevel: true, expiresAt: true },
    }),
  ]);

  const permMap = new Map(perms.map((p) => [p.departmentId, p]));

  const items = departments.map((d) => {
    const perm = permMap.get(d.id);
    return {
      departmentId: d.id,
      departmentName: d.name,
      departmentCode: d.code,
      permId: perm?.id ?? null,
      permLevel: perm?.permLevel ?? null,  // null = 无权限
      expiresAt: perm?.expiresAt ?? null,
    };
  });

  return NextResponse.json({ items });
}

// ──────────────────────────────────────────────
// POST /api/awards/permissions
// ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { session, error } = await requireAdmin(req);
  if (!session) return error!;

  const { id: granterId } = session.user;

  let body: { departmentId: string; permLevel: string; expiresAt?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!body.departmentId || typeof body.departmentId !== "string") {
    return NextResponse.json({ error: "缺少 departmentId" }, { status: 400 });
  }
  if (!["VIEW", "EDIT"].includes(body.permLevel)) {
    return NextResponse.json({ error: "permLevel 必须为 VIEW 或 EDIT" }, { status: 400 });
  }

  // 校验部门是否存在
  const dept = await prisma.department.findUnique({
    where: { id: body.departmentId, isActive: true, deletedAt: null },
    select: { name: true },
  });
  if (!dept) return NextResponse.json({ error: "部门不存在" }, { status: 404 });

  const perm = await prisma.modulePermission.upsert({
    where: {
      moduleKey_departmentId: { moduleKey: MODULE, departmentId: body.departmentId },
    },
    update: {
      permLevel:   body.permLevel as PermLevel,
      isActive:    true,
      grantedById: granterId,
      expiresAt:   body.expiresAt ? new Date(body.expiresAt) : null,
    },
    create: {
      moduleKey:    MODULE,
      departmentId: body.departmentId,
      permLevel:    body.permLevel as PermLevel,
      grantedById:  granterId,
      expiresAt:    body.expiresAt ? new Date(body.expiresAt) : null,
    },
  });

  await writeAuditLog({
    userId: granterId,
    action: AuditAction.GRANT_PERMISSION,
    resourceType: "module_permission",
    resourceId: perm.id,
    metadata: {
      moduleKey: MODULE,
      departmentId: body.departmentId,
      departmentName: dept.name,
      permLevel: body.permLevel,
    },
    ipAddress: getIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
    isDangerous: true,
  });

  return NextResponse.json(perm, { status: 201 });
}
