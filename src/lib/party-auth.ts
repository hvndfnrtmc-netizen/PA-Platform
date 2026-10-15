/**
 * 党员关系模块 —— 统一访问控制
 *
 * 两条相互独立的能力：
 *   canAccessModule 提交侧：可进入「党员关系」模块并提交/续编自己的转接申请
 *   isAdmin         审批侧：进入审批工作台，查看全部记录并执行审核/驳回/台账修改
 *
 * 授权来源：
 *   SUPER_ADMIN            → 两侧全通，无需查库
 *   其他角色                → 查 users 表 has_party_module_access / has_party_admin_access
 *                            （has_party_admin_access 隐含提交侧权限）
 *
 * 本文件是唯一判定入口，页面 / 布局 / API 必须统一走这里，避免各处硬编码
 * role === "SUPER_ADMIN" 导致「仅授予审批权」的账号被拒。
 */

import prisma from "@/lib/prisma";

export interface PartyAccess {
  isAdmin: boolean;
  canAccessModule: boolean;
}

export async function getPartyAccess(params: {
  userId: string;
  role: string;
}): Promise<PartyAccess> {
  if (params.role === "SUPER_ADMIN") {
    return { isAdmin: true, canAccessModule: true };
  }

  const user = await prisma.user.findUnique({
    where:  { id: params.userId },
    select: { hasPartyModuleAccess: true, hasPartyAdminAccess: true },
  });

  const isAdmin = user?.hasPartyAdminAccess ?? false;
  return {
    isAdmin,
    canAccessModule: isAdmin || (user?.hasPartyModuleAccess ?? false),
  };
}
