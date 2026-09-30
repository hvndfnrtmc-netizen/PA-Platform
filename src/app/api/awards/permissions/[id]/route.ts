/**
 * DELETE /api/awards/permissions/[id]
 *   — 撤销一条部门权限记录（软撤销：isActive = false）。
 *   — 仅 SUPER_ADMIN / PA_SPECIALIST 可调用。
 *   — 写入 audit_logs（isDangerous = true��。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";

const ADMIN_ROLES = ["SUPER_ADMIN", "PA_SPECIALIST"] as const;

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id: operatorId, role } = session.user;
  if (!ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) {
    return NextResponse.json({ error: "仅 PA 管理员可撤销模块权限" }, { status: 403 });
  }

  const { id } = await params;
  const perm = await prisma.modulePermission.findUnique({
    where: { id },
    include: { department: { select: { name: true } } },
  });
  if (!perm) return NextResponse.json({ error: "权限记录不存在" }, { status: 404 });

  // 软撤销
  await prisma.modulePermission.update({
    where: { id },
    data: { isActive: false },
  });

  await writeAuditLog({
    userId: operatorId,
    action: AuditAction.REVOKE_PERMISSION,
    resourceType: "module_permission",
    resourceId: id,
    metadata: {
      moduleKey: perm.moduleKey,
      departmentId: perm.departmentId,
      departmentName: perm.department.name,
      revokedPermLevel: perm.permLevel,
    },
    ipAddress:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      undefined,
    userAgent: req.headers.get("user-agent") ?? undefined,
    isDangerous: true,
  });

  return NextResponse.json({ success: true });
}
