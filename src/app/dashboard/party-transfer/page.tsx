/**
 * Party Transfer 主页面（Server Component）
 *
 * 角色路由：
 *  - 审批侧（SUPER_ADMIN 或 hasPartyAdminAccess）→ AdminView（双 Tab：审批工作台 + 我的申请）
 *  - 其余已授权用户                               → UserTransferPortal（员工提交端）
 *
 * 任务一（Hydration 闭环）：
 *  服务端预取当前用户最新记录，作为 initialData 传给客户端组件，
 *  确保刷新页面后草稿数据能立即回显，无需等待 SWR 请求。
 */

// 任务一：强制禁用 Next.js 页面级缓存，确保每次请求都重新查数据库
export const dynamic   = "force-dynamic";
export const revalidate = 0;

import { getSession } from "@/lib/auth";
import prisma         from "@/lib/prisma";
import { getPartyAccess } from "@/lib/party-auth";
import UserTransferPortal from "./components/UserTransferPortal";
import AdminView          from "./components/AdminView";

export default async function PartyTransferPage() {
  const session = await getSession();

  // 审批侧路由：SUPER_ADMIN 或持有 hasPartyAdminAccess 的账号
  const access = session?.user
    ? await getPartyAccess({ userId: session.user.id, role: session.user.role })
    : { isAdmin: false, canAccessModule: false };

  if (access.isAdmin) {
    return <AdminView />;
  }

  // ── 服务端预取：获取当前用户的最新可编辑/查看记录 ─────────────────
  let initialData: Record<string, unknown> | null = null;
  if (session?.user?.id) {
    const record = await prisma.partyTransferRecord.findFirst({
      where: {
        userId: session.user.id,
        status: {
          // 排除已完成，其余非终态均可回显
          not: "COMPLETED",
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (record) {
      // 序列化：把 Date 转为字符串，避免 Server→Client 传递 Date 对象报错
      initialData = {
        id:               record.id,
        status:           record.status,
        currentStage:     record.currentStage,
        transferType:     record.transferType,
        materials:        record.materials         as Record<string, unknown>,
        draftData:        record.draftData         as Record<string, unknown> | null,
        rejectReason:     record.rejectReason      ?? null,
        targetBranchName: record.targetBranchName  ?? null,
        realName:         record.realName          ?? null,
        idCardNumber:     record.idCardNumber      ?? null,
        partyFeeData:     record.partyFeeData      as Record<string, unknown> | null,
        createdAt:        record.createdAt.toISOString(),
        updatedAt:        record.updatedAt.toISOString(),
      };
    }
  }

  return <UserTransferPortal initialData={initialData} />;
}
