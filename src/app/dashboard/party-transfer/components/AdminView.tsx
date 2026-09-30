"use client";

import { useState } from "react";
import AdminAuditBoard from "./AdminAuditBoard";
import UserTransferPortal from "./UserTransferPortal";

export default function AdminView() {
  const [tab, setTab] = useState<"admin" | "portal">("admin");

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "#f7f6f5" }}>
      {/* 顶部 Tab 切换栏 */}
      <div className="px-6 pt-4 pb-0" style={{ background: "white", borderBottom: "1px solid #f1f5f9" }}>
        <div className="flex items-center justify-between mb-0">
          <h1 className="text-lg font-bold text-slate-800 pb-3">党员关系转接管理</h1>
          <div className="flex gap-1 p-1 rounded-xl mb-3" style={{ background: "#f1f5f9" }}>
            <button
              onClick={() => setTab("admin")}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: tab === "admin" ? "white" : "transparent",
                color:      tab === "admin" ? "#1e293b" : "#64748b",
                boxShadow:  tab === "admin" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}>
              🛡️ 审批工作台
            </button>
            <button
              onClick={() => setTab("portal")}
              className="px-4 py-1.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: tab === "portal" ? "white" : "transparent",
                color:      tab === "portal" ? "#1e293b" : "#64748b",
                boxShadow:  tab === "portal" ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}>
              👤 我的申请
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      {tab === "admin" ? <AdminAuditBoard /> : <UserTransferPortal />}
    </div>
  );
}
