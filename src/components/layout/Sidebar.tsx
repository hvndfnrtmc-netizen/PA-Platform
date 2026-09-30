"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  ClipboardList, Database, FileText, Settings, LogOut,
  ChevronRight, ChevronLeft, Bell, Shield, Award,
  Inbox, Sparkles, Star, ScrollText, Gift, Briefcase, Building2, Flag, GraduationCap,
} from "lucide-react";

// ──────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────

interface NavItem {
  label:            string;
  href:             string;
  icon:             React.ElementType;
  description:      string;
  superAdminOnly?:  boolean;
  paOnly?:          boolean;
  deptContactOnly?: boolean;
  allRoles?:           boolean;
  moduleKey?:          string;
  moduleId?:           string;
  /** 渲染到侧边栏最底部（通过 mt-auto 分隔区实现） */
  bottomAnchor?:       boolean;
  /**
   * 需要个人白名单授权才可见。
   * SUPER_ADMIN 无条件放行；其他角色需 hasPartyModuleAccess === true。
   */
  requiresPartyAccess?: boolean;
}

// ──────────────────────────────────────────────
// 导航项配置（顺序严格按需求文档，href 完全保留原值）
// ──────────────────────────────────────────────

const ALL_NAV_ITEMS: NavItem[] = [
  // ── PA 主菜单 ──────────────────────────────
  {
    label:       "重大项目",
    href:        "/dashboard/major-projects",
    icon:        Flag,
    description: "重大项目管理与跟踪",
    moduleId:    "major-projects",
    paOnly:      true,
  },
  {
    label:       "荣誉资质",
    href:        "/dashboard/awards",
    icon:        Award,
    description: "企业资质认证与荣誉",
    paOnly:      true,
    moduleId:    "awards",
    moduleKey:   "awards",
  },
  {
    label:       "人才福利",
    href:        "/dashboard/talent",
    icon:        Gift,
    description: "人才引进与福利管理",
    moduleId:    "talent",
    paOnly:      true,
  },
  {
    label:       "人才申报",
    href:        "/dashboard/talent-declaration",
    icon:        GraduationCap,
    description: "人才项目申报导航大厅",
    moduleId:    "talent-declaration",
    paOnly:      true,
  },
  {
    label:       "政府接待",
    href:        "/dashboard/reception",
    icon:        Briefcase,
    description: "政府来访接待管理",
    moduleId:    "reception",
    paOnly:      true,
  },
  {
    label:       "ODC",
    href:        "/dashboard/odc",
    icon:        Building2,
    description: "ODC 管理与协同",
    moduleId:    "odc",
    paOnly:      true,
  },
  {
    label:       "对外填报",
    href:        "/dashboard/tasks",
    icon:        ClipboardList,
    description: "任务派发与红绿灯看板",
    moduleId:    "tasks",
    paOnly:      true,
  },
  {
    label:       "落地协议",
    href:        "/dashboard/agreement-tracking",
    icon:        ScrollText,
    description: "政企落地协议进度追踪",
    moduleId:    "agreement-tracking",
    paOnly:      true,
  },
  {
    label:               "党员关系",
    href:                "/dashboard/party-transfer",
    icon:                Star,
    description:         "党组织关系转入 / 转出办理",
    requiresPartyAccess: true,
  },
  {
    label:       "公文生成",
    href:        "/dashboard/documents",
    icon:        FileText,
    description: "Word 占位符一键渲染",
    moduleId:    "documents",
    paOnly:      true,
  },
  {
    label:       "智库chat",
    href:        "/dashboard/copilot",
    icon:        Sparkles,
    description: "RAG 驱动的数据问答助手",
    moduleId:    "copilot",
    paOnly:      true,
  },
  {
    label:       "数据中台",
    href:        "/dashboard/assets",
    icon:        Database,
    description: "核心指标汇聚与溯源",
    moduleId:    "assets",
    paOnly:      true,
  },
  // ── 底部锚定（超级后台，mt-auto 与其余菜单保持间距） ──
  {
    label:          "超级后台",
    href:           "/dashboard/settings",
    icon:           Settings,
    description:    "组织架构与权限配置",
    paOnly:         true,
    superAdminOnly: true,
    bottomAnchor:   true,
  },

  // ── 业务部门专属 ─────────────────────────────
  {
    label:           "部门数据录入",
    href:            "/dashboard/my-tasks",
    icon:            Inbox,
    description:     "我的填报任务工作台",
    deptContactOnly: true,
  },
];

// ──────────────────────────────────────────────
// 权限过滤
// ──────────────────────────────────────────────

function getNavItems(
  role: string,
  grantedModules: string[] = [],
  hasPartyModuleAccess = false,
  feishuAuthorizedModules: string[] | null = null,
): NavItem[] {
  // SUPER_ADMIN 对党员关系始终放行
  const partyOk = role === "SUPER_ADMIN" || hasPartyModuleAccess;

  if (role === "SUPER_ADMIN") {
    // SUPER_ADMIN 可见全部非 deptContactOnly 条目（含 requiresPartyAccess）
    return ALL_NAV_ITEMS.filter((i) => !i.deptContactOnly);
  }

  // 若有 FeishuNotificationTarget 授权记录，以此为准过滤（PA_SPECIALIST）
  if (role === "PA_SPECIALIST" && feishuAuthorizedModules !== null) {
    const hasAll = feishuAuthorizedModules.includes("all");
    return ALL_NAV_ITEMS.filter((i) => {
      if (i.superAdminOnly) return false;
      if (i.deptContactOnly) return false;
      if (i.requiresPartyAccess) return partyOk;
      if (!i.moduleId) return true; // 无 moduleId 的项目默认可见
      return hasAll || feishuAuthorizedModules.includes(i.moduleId);
    });
  }

  if (role === "DEPT_CONTACT") {
    return ALL_NAV_ITEMS.filter(
      (i) =>
        i.deptContactOnly ||
        (i.allRoles && !i.requiresPartyAccess) ||
        (i.requiresPartyAccess && partyOk) ||
        (i.moduleKey && grantedModules.includes(i.moduleKey))
    );
  }

  // PA_SPECIALIST 无 FeishuNotificationTarget 记录时回退到旧行为
  return ALL_NAV_ITEMS.filter(
    (i) =>
      (i.allRoles && !i.requiresPartyAccess) ||
      (i.requiresPartyAccess && partyOk) ||
      (i.paOnly && !i.superAdminOnly)
  );
}

// ──────────────────────────────────────────────
// 角色标签
// ──────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN:   "超级管理员",
  PA_SPECIALIST: "LPA 专员",
  DEPT_CONTACT:  "部门对接人",
};

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
}

export function Sidebar({
  userName,
  userRole = "DEPT_CONTACT",
  userAvatar,
  pendingCount,
  grantedModuleKeys = [],
  hasPartyModuleAccess = false,
  feishuAuthorizedModules = null,
}: SidebarProps) {
  const [collapsed,     setCollapsed]     = useState(false);
  // 动态平台名称，fallback 确保任何情况下都不会出现空白
  const [platformName, setPlatformName] = useState("Momenta LPA");

  useEffect(() => {
    fetch("/api/system-config/platform_name")
      .then(r => r.ok ? r.json() : null)
      .then((d: { config?: { value?: string } } | null) => {
        if (d?.config?.value) setPlatformName(d.config.value);
      })
      .catch(() => { /* 静默失败，fallback 保持不变 */ });
  }, []);

  const pathname      = usePathname();
  const navItems      = getNavItems(userRole, grantedModuleKeys, hasPartyModuleAccess, feishuAuthorizedModules);
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
        {/* Momenta Logo 图标 */}
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
