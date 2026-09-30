/**
 * GET  /api/departments  — 部门列表（用于下拉选择器等）
 * POST /api/departments  — 新建部门（SUPER_ADMIN only)
 *
 * Refactored with withErrorHandler + Zod validation (Phase 1).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { withErrorHandler, UnauthorizedError, ForbiddenError, ValidationError } from "@/lib/api-handler";
import { logger } from "@/lib/logger";
import { createDepartmentSchema } from "@/lib/validations/users";
import { DepartmentType } from "@prisma/client";

function ip(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

export const GET = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session?.user) throw new UnauthorizedError("未登录");

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") as DepartmentType | null;

  const departments = await prisma.department.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      ...(type ? { type } : {}),
    },
    include: {
      _count: { select: { users: true, taskAssignments: true } },
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ departments });
});

export const POST = withErrorHandler(async (req: Request) => {
  const session = await getSession();
  if (!session?.user) throw new UnauthorizedError("未登录");
  if (session.user.role !== "SUPER_ADMIN")
    throw new ForbiddenError("仅超级管理员可创建部门");

  const body = await req.json().catch(() => {
    throw new ValidationError("请求体格式错误，需要 JSON");
  });

  const parsed = createDepartmentSchema.parse({
    ...body,
    type: body.type ?? "BUSINESS",
    feishuDeptId: body.feishuDeptId?.trim() || undefined,
  });

  // 自动生成唯一部门代码（前端不再需要用户填写）
  const autoCode = `DEPT_${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

  const dept = await prisma.department.create({
    data: {
      name:         parsed.name.trim(),
      code:         autoCode,
      type:         (parsed.type ?? "BUSINESS") as DepartmentType,
      feishuDeptId: parsed.feishuDeptId ?? null,
    },
  });

  writeAuditLog({
    userId: session.user.id,
    action: AuditAction.CREATE_DEPARTMENT,
    resourceType: "department",
    resourceId: dept.id,
    metadata: { name: dept.name, code: dept.code, type: dept.type },
    ipAddress: ip(req),
  }).catch((err) => logger.error("Audit log failed", err));

  return NextResponse.json({ department: dept }, { status: 201 });
});
