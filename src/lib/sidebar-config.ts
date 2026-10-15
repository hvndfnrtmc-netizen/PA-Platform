/**
 * 侧边栏显示配置（纯数据模块）
 *
 * ⚠️ 本文件不得引入 prisma / lucide / next 相关依赖，因为客户端 Sidebar 会 import。
 *    DB 读写请走 /api/sidebar-config，或在 server component 内直接用 prisma。
 *
 * 配置存放位置：system_configs 表，key = "sidebar_menu_config"，value = 本结构 JSON。
 *
 * 三层过滤，优先级由高到低：
 *   1. global[moduleId] === false  → 全局隐藏（含 SUPER_ADMIN 一律看不到）
 *   2. accountWhitelist[email]     → 账号级白名单，绝对覆盖角色默认（存在即以它为准）
 *   3. roleScope[moduleId]         → 角色可见范围（空/未配置 = 不限制）
 *
 * 只读模式：
 *   readonlyAccounts[email]       → 该账号登录后整个 dashboard 进入"只读演示模式"，
 *                                   表单/输入框/提交按钮全部灰化禁用（dashboard 主内容
 *                                   区会带 data-readonly="true" 属性，由 globals.css
 *                                   兜底渲染）。导航/退出登录/搜索等只读控件不受影响
 *                                   （通过 data-allow-readonly 例外）。
 *
 * 重要约定：本配置只决定「菜单入口是否渲染」与「是否进入只读演示模式」，
 *          不删除任何路由、页面与数据。隐藏后直接访问 URL 依然可用（是否 403 由各模块
 *          自身鉴权决定）。
 */

export const SIDEBAR_CONFIG_KEY = "sidebar_menu_config";

export interface SidebarConfig {
  v: 1;
  /** moduleId → 是否在全局显示（缺省 = true） */
  global: Record<string, boolean>;
  /** moduleId → 允许看到该菜单的角色列表（缺省或空数组 = 所有角色） */
  roleScope: Record<string, string[]>;
  /**
   * 账号邮箱（小写）→ 该账号可见的 moduleId 列表。
   * 一旦某账号出现在此表中，其侧边栏「只」渲染列表内的菜单，角色默认被完全覆盖。
   */
  accountWhitelist: Record<string, string[]>;
  /**
   * 账号邮箱（小写）→ 进入「只读演示模式」的黑名单式名单。
   * 在此列表里的账号登录 dashboard 后，整个主内容区渲染为只读，
   * 用于截图演示、培训展示而不会误触写入。
   */
  readonlyAccounts: string[];
}

export const DEFAULT_SIDEBAR_CONFIG: SidebarConfig = {
  v: 1,
  global: {},
  roleScope: {},
  accountWhitelist: {},
  readonlyAccounts: [],
};

/** 侧边栏菜单项的最小结构约束（避免依赖 nav-items，防止循环引用） */
export interface SidebarFilterable {
  moduleId?: string;
  href: string;
}

/** 取配置键：优先 moduleId，回退 href —— 与 nav-items.navKey 保持一致 */
export function sidebarKey(item: SidebarFilterable): string {
  return item.moduleId ?? item.href;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

function asBoolMap(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k === "string" && k.trim() !== "") out[k.trim()] = Boolean(val);
    }
  }
  return out;
}

function asArrayMap(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof k === "string" && k.trim() !== "") out[k.trim()] = asStringArray(val);
    }
  }
  return out;
}

/** 把任意来源的对象收敛成合法 SidebarConfig（永不抛错，脏数据一律丢弃） */
export function normalizeSidebarConfig(raw: unknown): SidebarConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_SIDEBAR_CONFIG, global: {}, roleScope: {}, accountWhitelist: {}, readonlyAccounts: [] };
  }
  const r = raw as Record<string, unknown>;

  const accountWhitelist: Record<string, string[]> = {};
  for (const [email, mods] of Object.entries(asArrayMap(r.accountWhitelist))) {
    accountWhitelist[email.trim().toLowerCase()] = mods;
  }

  const readonlyAccounts: string[] = [];
  if (Array.isArray(r.readonlyAccounts)) {
    for (const e of r.readonlyAccounts) {
      if (typeof e === "string" && e.trim() !== "") {
        readonlyAccounts.push(e.trim().toLowerCase());
      }
    }
  }

  return {
    v: 1,
    global: asBoolMap(r.global),
    roleScope: asArrayMap(r.roleScope),
    accountWhitelist,
    readonlyAccounts,
  };
}

/** 从 DB 里的字符串值解析配置 */
export function parseSidebarConfig(value: string | null | undefined): SidebarConfig {
  if (!value) return { ...DEFAULT_SIDEBAR_CONFIG, global: {}, roleScope: {}, accountWhitelist: {}, readonlyAccounts: [] };
  try {
    return normalizeSidebarConfig(JSON.parse(value));
  } catch {
    return { ...DEFAULT_SIDEBAR_CONFIG, global: {}, roleScope: {}, accountWhitelist: {}, readonlyAccounts: [] };
  }
}

/** 序列化以便写库 */
export function serializeSidebarConfig(cfg: SidebarConfig): string {
  return JSON.stringify(normalizeSidebarConfig(cfg));
}

/** 该账号是否被账号级白名单约束 */
export function hasAccountRestriction(cfg: SidebarConfig, email?: string | null): boolean {
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  return Object.prototype.hasOwnProperty.call(cfg.accountWhitelist, e);
}

/** 该账号是否进入"只读演示模式" */
export function isReadOnlyAccount(cfg: SidebarConfig, email?: string | null): boolean {
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  return cfg.readonlyAccounts.includes(e);
}

/**
 * 在「角色默认权限结果」之上再套一层显示配置过滤。
 *
 * @param items 已通过角色/模块权限过滤后的菜单项
 * @param cfg   侧边栏显示配置
 * @param ctx   当前登录上下文（角色 + 邮箱）
 */
export function applySidebarConfig<T extends SidebarFilterable>(
  items: T[],
  cfg: SidebarConfig,
  ctx: { role: string; email?: string | null },
): T[] {
  const email = ctx.email?.trim().toLowerCase();
  const whitelist =
    email && Object.prototype.hasOwnProperty.call(cfg.accountWhitelist, email)
      ? new Set(cfg.accountWhitelist[email])
      : null;

  return items.filter((item) => {
    const key = sidebarKey(item);

    // 1) 全局隐藏优先，任何角色（含 SUPER_ADMIN）都看不到
    if (cfg.global[key] === false) return false;

    // 2) 账号级白名单：绝对覆盖角色默认
    if (whitelist) return whitelist.has(key) || whitelist.has(item.href);

    // 3) 角色可见范围：配置了非空列表才生效
    const scope = cfg.roleScope[key];
    if (Array.isArray(scope) && scope.length > 0) {
      return scope.includes(ctx.role);
    }

    return true;
  });
}
