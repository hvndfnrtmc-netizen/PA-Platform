/**
 * 侧边栏导航目录（单一数据源）
 *
 * 被两处消费：
 *   1. src/components/layout/Sidebar.tsx  —— 渲染真实侧边栏
 *   2. src/app/dashboard/settings/page.tsx —— 超级后台「侧边栏菜单」配置面板
 *
 * ⚠️ 本文件包含 lucide-react 图标组件，只能在客户端组件中引入。
 *    服务端（layout / API）请勿 import，避免把图标打进服务端包。
 *
 * moduleId 是「侧边栏显示配置」的唯一键：全局开关、角色范围、账号白名单
 * 全部按 moduleId 索引。新增菜单项时务必给一个稳定的 moduleId。
 */

import type { ElementType } from "react";
import {
  ClipboardList, Database, FileText, Settings,
  Award, Inbox, Sparkles, Star, ScrollText, Gift,
  Briefcase, Building2, Flag, GraduationCap,
} from "lucide-react";

// ──────────────────────────────────────────────
// 类型定义
// ──────────────────────────────────────────────

export interface NavItem {
  label:            string;
  href:             string;
  icon:             ElementType;
  description:      string;
  superAdminOnly?:  boolean;
  paOnly?:          boolean;
  deptContactOnly?: boolean;
  allRoles?:        boolean;
  moduleKey?:       string;
  /** 侧边栏显示配置的唯一键（必填语义，缺失时回退到 href） */
  moduleId?:        string;
  /** 渲染到侧边栏最底部（通过 mt-auto 分隔区实现） */
  bottomAnchor?:    boolean;
  /**
   * 需要个人白名单授权才可见。
   * SUPER_ADMIN 无条件放行；其他角色需 hasPartyModuleAccess === true。
   */
  requiresPartyAccess?: boolean;
}

/** 取配置键：优先 moduleId，回退 href */
export function navKey(item: NavItem): string {
  return item.moduleId ?? item.href;
}

// ──────────────────────────────────────────────
// 导航项配置（顺序严格按需求文档，href 完全保留原值）
// ──────────────────────────────────────────────

export const ALL_NAV_ITEMS: NavItem[] = [
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
    label:       "会议接待",
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
    moduleId:            "party-transfer",
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
    moduleId:       "settings",
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
    moduleId:        "my-tasks",
    deptContactOnly: true,
  },
];

// ──────────────────────────────────────────────
// 权限过滤（角色 + 模块授权）
// ──────────────────────────────────────────────

export function getNavItems(
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
    return ALL_NAV_ITEMS.filter((i) => {
      if (i.deptContactOnly) return true;
      if (i.allRoles && !i.requiresPartyAccess) return true;
      if (i.requiresPartyAccess) return partyOk;
      // 模块授权键：优先 moduleKey，回退 moduleId（二者同一套词表）
      const grantKey = i.moduleKey ?? i.moduleId;
      return !!grantKey && grantedModules.includes(grantKey);
    });
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

export const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN:   "超级管理员",
  PA_SPECIALIST: "PA 专员",
  DEPT_CONTACT:  "部门对接人",
};

/** 配置面板用的角色顺序 */
export const CONFIG_ROLES = ["SUPER_ADMIN", "PA_SPECIALIST", "DEPT_CONTACT"] as const;
