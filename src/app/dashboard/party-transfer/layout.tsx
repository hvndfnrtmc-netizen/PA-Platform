/**
 * 党员关系模块 — 个人白名单访问控制
 *
 * 规则：
 *   SUPER_ADMIN          → 无条件放行
 *   其他角色              → 必须持有 hasPartyModuleAccess 或 hasPartyAdminAccess 授权
 *
 * 拦截时渲染优雅的 403 页面，不抛出异常、不崩溃。
 */

import { redirect } from "next/navigation";
import { Lock } from "lucide-react";
import { getSession } from "@/lib/auth";
import { getPartyAccess } from "@/lib/party-auth";

export default async function PartyTransferLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const { role, id: userId } = session.user;

  // 统一判定：SUPER_ADMIN / hasPartyModuleAccess / hasPartyAdminAccess
  const access = await getPartyAccess({ userId, role });
  if (access.canAccessModule) return <>{children}</>;

  // ── 403 优雅拦截页 ────────────────────────────────────────────
  return (
    <div className="flex-1 flex items-center justify-center min-h-full bg-slate-50">
      <div
        className="flex flex-col items-center text-center max-w-sm w-full mx-6 px-8 py-12 rounded-3xl bg-white shadow-sm"
        style={{ border: "1px solid #e2e8f0" }}
      >
        {/* 锁图标 */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
          style={{
            background: "rgba(239,68,68,0.07)",
            border:     "1.5px solid rgba(239,68,68,0.18)",
          }}
        >
          <Lock size={32} style={{ color: "#ef4444" }} />
        </div>

        {/* 403 标签 */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-full mb-5 text-xs font-semibold"
          style={{
            background: "rgba(239,68,68,0.08)",
            color:      "#dc2626",
            border:     "1px solid rgba(239,68,68,0.2)",
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: "#dc2626" }}
          />
          403 · 访问受限
        </div>

        {/* 标题 */}
        <h1 className="text-lg font-bold text-slate-800 mb-3">
          无访问权限
        </h1>

        {/* 提示文案（严格按需求文档） */}
        <p className="text-sm text-slate-500 leading-relaxed">
          您暂无【党员关系】模块的访问权限，如需办理相关业务，请联系超级管理员开通个人授权。
        </p>

        {/* 操作指引 */}
        <div
          className="mt-6 w-full px-4 py-3 rounded-xl text-xs text-slate-400 leading-relaxed text-left"
          style={{ background: "#f8fafc", border: "1px solid #f1f5f9" }}
        >
          当前角色不具备此模块的默认访问权。超级管理员可在
          <span className="font-medium text-slate-500">「超级后台 → 组织与人员」</span>
          中为您开启个人授权。
        </div>
      </div>
    </div>
  );
}
