/**
 * 模块级权限检查工具
 *
 * 权限分层规则（优先级由高到低）：
 *   1. SUPER_ADMIN  → 所有模块永久 EDIT，不查表
 *   2. PA_SPECIALIST → 所有模块永久 EDIT，不查表
 *   3. DEPT_CONTACT  → 查 module_permissions 表，按记录判断
 *
 * 调用方只需 await checkModulePermission(...)，返回 true/false。
 * 不要在热路径上传入 required="VIEW" 时再加 EDIT 判断——本函数已处理。
 */

import prisma from "@/lib/prisma";

export type ModulePermLevel = "VIEW" | "EDIT";

const STAFF_ROLES = ["SUPER_ADMIN", "PA_SPECIALIST"] as const;

/**
 * 检查用户是否对指定模块拥有 `required` 级别或以上的权限。
 *
 * @param userRole     session.user.role
 * @param departmentId session.user.departmentId（DEPT_CONTACT 必须有）
 * @param moduleKey    模块标识，如 "awards"
 * @param required     "VIEW" | "EDIT"
 */
export async function checkModulePermission(params: {
  userRole: string;
  departmentId: string | null;
  moduleKey: string;
  required: ModulePermLevel;
}): Promise<boolean> {
  const { userRole, departmentId, moduleKey, required } = params;

  // PA 内部人员天然拥有全部权限
  if (STAFF_ROLES.includes(userRole as (typeof STAFF_ROLES)[number])) {
    return true;
  }

  if (!departmentId) return false;

  const perm = await prisma.modulePermission.findUnique({
    where: { moduleKey_departmentId: { moduleKey, departmentId } },
  });

  if (!perm || !perm.isActive) return false;
  if (perm.expiresAt && perm.expiresAt < new Date()) return false;

  // VIEW 级别：VIEW 或 EDIT 均可满足
  if (required === "VIEW") return true;

  // EDIT 级别：只有 EDIT 可满足
  return perm.permLevel === "EDIT";
}

/**
 * 返回用户对指定模块的最高权限级别（null = 无任何权限）。
 * 方便 API 在响应中附带 `canEdit` / `canView` 字段。
 */
export async function getModulePermLevel(params: {
  userRole: string;
  departmentId: string | null;
  moduleKey: string;
}): Promise<ModulePermLevel | null> {
  const { userRole, departmentId, moduleKey } = params;

  if (STAFF_ROLES.includes(userRole as (typeof STAFF_ROLES)[number])) {
    return "EDIT";
  }

  if (!departmentId) return null;

  const perm = await prisma.modulePermission.findUnique({
    where: { moduleKey_departmentId: { moduleKey, departmentId } },
  });

  if (!perm || !perm.isActive) return null;
  if (perm.expiresAt && perm.expiresAt < new Date()) return null;

  return perm.permLevel as ModulePermLevel;
}
