"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { LogOut, ChevronRight, ChevronLeft, Bell, Shield, Inbox } from "lucide-react";
import {
  type NavItem,
  getNavItems,
  ROLE_LABEL,
} from "@/lib/nav-items";
import {
  type SidebarConfig,
  DEFAULT_SIDEBAR_CONFIG,
  applySidebarConfig,
} from "@/lib/sidebar-config";

// ──────────────────────────────────────────────
// 单个导航链接（含折叠 Tooltip）
// ──────────────────────────────────────────────

function NavLinkItem({
  item,
  collapsed,
  active,
}: {
  item:      NavItem;
  collapsed: boolean;
  active:    boolean;
}) {
  const Icon = item.icon;
  return (
    <div className="relative group">
      <Link
        href={item.href}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 relative${collapsed ? " justify-center" : ""}`}
        style={{
          background: active ? "#1e3a5f" : "transparent",
          color:      active ? "#93c5fd" : "#64748b",
        }}
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.background = "#1a2944";
            e.currentTarget.style.color      = "#cbd5e1";
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color      = "#64748b";
          }
        }}
      >
        {/* 激活指示条（仅展开时） */}
        {active && !collapsed && (
          <span
            className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r-full"
            style={{ background: "#3b82f6" }}
          />
        )}
        <Icon size={17} className="flex-shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 truncate">{item.label}</span>
            {item.superAdminOnly && !active && (
              <Shield size={12} style={{ color: "#475569" }} />
            )}
            {active && (
              <ChevronRight size={14} style={{ color: "#3b82f6" }} />
            )}
          </>
        )}
      </Link>

      {/* 折叠模式下的悬浮 Tooltip */}
      {collapsed && (
        <div
          className="absolute left-full top-1/2 -translate-y-1/2 ml-3 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap pointer-events-none z-[9999] opacity-0 group-hover:opacity-100 transition-opacity duration-150"
          style={{
            background: "#1e293b",
            color:      "#e2e8f0",
            border:     "1px solid #334155",
            boxShadow:  "0 4px 16px rgba(0,0,0,0.35)",
          }}
        >
          {item.label}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────
// 侧边栏主组件
// ──────────────────────────────────────────────

interface SidebarProps {
  userName?:             string;
  userRole?:             string;
  userAvatar?:           string;
  departmentId?:         string;
  pendingCount?:         number;
  grantedModuleKeys?:    string[];
  /** 由 layout.tsx 从 DB 查询后注入，控制"党员关系"菜单的可见性 */
  hasPartyModuleAccess?: boolean;
  /** FeishuNotificationTarget 模块授权列表（null = 无记录，按旧逻辑处理） */
  feishuAuthorizedModules?: string[] | null;
  /** 当前登录账号邮箱（账号级白名单按邮箱匹配） */
  userEmail?:            string;
  /**
   * 由 layout.tsx 从 system_configs 读取后注入的侧边栏显示配置。
   * 缺省时不做任何额外过滤，行为与改造前完全一致。
   */
  sidebarConfig?:        SidebarConfig | null;
}

export function Sidebar({
  userName,
  userRole = "DEPT_CONTACT",
  userAvatar,
  pendingCount,
  grantedModuleKeys = [],
  hasPartyModuleAccess = false,
  feishuAuthorizedModules = null,
  userEmail,
  sidebarConfig = null,
}: SidebarProps) {
  const [collapsed,     setCollapsed]     = useState(false);
  // 动态平台名称，fallback 确保任何情况下都不会出现空白
  const [platformName, setPlatformName] = useState("瑞启深空 PA");

  useEffect(() => {
    fetch("/api/system-config/platform_name")
      .then(r => r.ok ? r.json() : null)
      .then((d: { config?: { value?: string } } | null) => {
        if (d?.config?.value) setPlatformName(d.config.value);
      })
      .catch(() => { /* 静默失败，fallback 保持不变 */ });
  }, []);

  const pathname      = usePathname();
  // 第一层：角色 + 模块授权（与改造前完全一致的原有逻辑）
  const roleItems     = getNavItems(userRole, grantedModuleKeys, hasPartyModuleAccess, feishuAuthorizedModules);
  // 第二层：超级后台「侧边栏菜单」配置（全局隐藏 / 角色范围 / 账号白名单）
  const navItems      = applySidebarConfig(
    roleItems,
    sidebarConfig ?? DEFAULT_SIDEBAR_CONFIG,
    { role: userRole, email: userEmail },
  );
  const isDeptContact = userRole === "DEPT_CONTACT";

  // 分离底部锚定项（超级后台）与普通导航项
  const mainItems   = navItems.filter((i) => !i.bottomAnchor);
  const bottomItems = navItems.filter((i) => i.bottomAnchor);

  return (
    <aside
      className="hidden md:flex flex-col h-full flex-shrink-0"
      style={{
        background:  "#0b1120",
        borderRight: "1px solid #1e2d45",
        // W_expanded = 256px, W_collapsed = 80px
        width:      collapsed ? 80 : 256,
        transition: "width 300ms ease",
        // 不设 overflow，保持 visible 使 Tooltip 可溢出
      }}
    >
      {/* ── Logo 区 + 折叠切换按钮 ────────────────── */}
      <div
        className={`flex items-center gap-3 py-4 flex-shrink-0${collapsed ? " px-3 justify-between" : " px-4"}`}
        style={{ borderBottom: "1px solid #1e2d45" }}
      >
        {/* 瑞启深空 Logo 图标 */}
        <div
          className="flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0"
          style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}
        >
          <svg width="18" height="18" viewBox="0 0 32 32" fill="none">
            <path
              d="M6 26V6l10 6 10-6v20l-10-6-10 6z"
              stroke="white"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        {/* 标题文字（仅展开时渲染） */}
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white leading-none truncate">
              {platformName}
            </p>
            <p className="text-xs mt-0.5 truncate" style={{ color: "#475569" }}>
              {isDeptContact ? "业务填报工作台" : "可视化工作集成平台"}
            </p>
          </div>
        )}

        {/* 展开 / 收起切换按钮 */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
          style={{ color: "#475569" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "#1a2944")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          title={collapsed ? "展开侧边栏" : "收起侧边栏"}
          data-allow-readonly="true"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      {/* ── 模式徽章（仅展开时显示） ─────────────── */}
      {!collapsed && (
        isDeptContact ? (
          <div
            className="mx-3 mt-3 px-3 py-2 rounded-lg flex items-center gap-2"
            style={{
              background: "rgba(245,158,11,0.1)",
              border:     "1px solid rgba(245,158,11,0.2)",
            }}
          >
            <Inbox size={12} style={{ color: "#f59e0b", flexShrink: 0 }} />
            <span className="text-xs" style={{ color: "#fbbf24" }}>
              业务录入模式
            </span>
          </div>
        ) : (
          pendingCount !== undefined && pendingCount > 0 && (
            <div
              className="mx-3 mt-3 px-3 py-2 rounded-lg flex items-center gap-2"
              style={{
                background: "rgba(59,130,246,0.12)",
                border:     "1px solid rgba(59,130,246,0.25)",
              }}
            >
              <Bell size={13} className="flex-shrink-0" style={{ color: "#60a5fa" }} />
              <span className="text-xs" style={{ color: "#93c5fd" }}>
                <span className="font-semibold">{pendingCount}</span> 个任务待处理
              </span>
            </div>
          )
        )
      )}

      {/* ── 主导航列表 ───────────────────────────── */}
      {/*
        展开时: overflow-y auto（支持多菜单滚动）
        折叠时: overflow visible（Tooltip 可溢出侧边栏右边界）
        D_content = flex-1 自动填满腾出的空间
      */}
      <nav
        className={`flex-1 py-3 space-y-0.5${collapsed ? " px-2" : " px-3"}`}
        style={{
          overflowY: collapsed ? "visible" : "auto",
          overflowX: "visible",
        }}
      >
        {mainItems.map((item) => (
          <NavLinkItem
            key={item.href}
            item={item}
            collapsed={collapsed}
            active={pathname.startsWith(item.href)}
          />
        ))}
      </nav>

      {/* ── 底部锚定区（超级后台，与主菜单保持间距） ── */}
      {bottomItems.length > 0 && (
        <div
          className={`flex-shrink-0 pb-2${collapsed ? " px-2" : " px-3"}`}
          style={{ borderTop: "1px solid #1e2d45" }}
        >
          <div className="pt-2 space-y-0.5">
            {bottomItems.map((item) => (
              <NavLinkItem
                key={item.href}
                item={item}
                collapsed={collapsed}
                active={pathname.startsWith(item.href)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 用户信息 ─────────────────────────────── */}
      <div
        className={`flex-shrink-0 pb-4${collapsed ? " px-2" : " px-4"}`}
        style={{ borderTop: "1px solid #1e2d45" }}
      >
        <div
          className={`flex items-center gap-3 px-3 py-3 rounded-xl mt-3${collapsed ? " justify-center" : ""}`}
          style={{ background: "#0f172a" }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}
          >
            {userAvatar ? (
              <img
                src={userAvatar}
                alt=""
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              (userName?.[0] ?? "U").toUpperCase()
            )}
          </div>

          {!collapsed && (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">
                  {userName ?? "用户"}
                </p>
                <p className="text-xs truncate" style={{ color: "#475569" }}>
                  {ROLE_LABEL[userRole] ?? userRole}
                </p>
              </div>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="flex-shrink-0 p-1.5 rounded-lg transition-colors"
                style={{ color: "#475569" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#334155")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                title="退出登录"
                data-allow-readonly="true"
              >
                <LogOut size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
