/**
 * 模拟账号初始化脚本（幂等，可重复执行）
 *
 * 生成 3 个演示账号，并把它们的「侧边栏可见范围」写入
 * system_configs.sidebar_menu_config 的 accountWhitelist：
 *
 *   账号1  viewer01@ruiqishenkong.com      仅可查阅：重大项目 / 荣誉资质 / 人才申报 / 会议接待
 *   账号2  party-member@ruiqishenkong.com  党员，可提交党员关系转接管理申请（提交端）
 *   账号3  party-admin@ruiqishenkong.com   党员关系模块全部功能（审批工作台 + 我的申请）
 *
 * 运行：
 *   cd C:\Users\admin\PA-Platform
 *   node --env-file=.env --import=tsx/esm scripts/create-demo-accounts.ts
 *
 * 只做新增/更新，不删除任何既有账号、部门与业务数据。
 */

import "dotenv/config";
import { PrismaClient, UserRole, PermLevel, DepartmentType } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

// ── 与 src/lib/sidebar-config.ts 保持一致的键名与最小解析逻辑 ──────
// （脚本不直接 import 该文件：项目为 CJS 工程，跨目录 import .ts 会触发
//   ERR_REQUIRE_CYCLE_MODULE，故此处内联，语义与主程序完全一致）

const SIDEBAR_CONFIG_KEY = "sidebar_menu_config";

interface SidebarConfigShape {
  v: 1;
  global: Record<string, boolean>;
  roleScope: Record<string, string[]>;
  accountWhitelist: Record<string, string[]>;
  readonlyAccounts: string[];
}

function parseSidebarConfig(value: string | null | undefined): SidebarConfigShape {
  const empty: SidebarConfigShape = { v: 1, global: {}, roleScope: {}, accountWhitelist: {}, readonlyAccounts: [] };
  if (!value) return empty;
  try {
    const raw = JSON.parse(value) as Partial<SidebarConfigShape>;
    const accountWhitelist: Record<string, string[]> = {};
    if (raw.accountWhitelist && typeof raw.accountWhitelist === "object") {
      for (const [email, mods] of Object.entries(raw.accountWhitelist)) {
        accountWhitelist[email.trim().toLowerCase()] = Array.isArray(mods) ? mods.filter((m) => typeof m === "string") : [];
      }
    }
    const readonlyRaw = Array.isArray(raw.readonlyAccounts) ? raw.readonlyAccounts : [];
    const readonlyAccounts = readonlyRaw
      .filter((e): e is string => typeof e === "string" && e.trim() !== "")
      .map((e) => e.trim().toLowerCase());
    return {
      v: 1,
      global:          raw.global && typeof raw.global === "object" ? raw.global : {},
      roleScope:       raw.roleScope && typeof raw.roleScope === "object" ? raw.roleScope : {},
      accountWhitelist,
      readonlyAccounts,
    };
  } catch {
    return empty;
  }
}

function serializeSidebarConfig(cfg: SidebarConfigShape): string {
  return JSON.stringify(cfg);
}

// ── 演示参数 ──────────────────────────────────────────────────

const DEMO_PASSWORD = "Pa@2026demo";

const DEMO_DEPT = {
  name: "演示·业务部门",
  code: "DEMO-BIZ",
  type: DepartmentType.BUSINESS,
};

/** 账号1 允许查阅的模块（同时作为部门模块授权与侧边栏白名单） */
const VIEWER_MODULES = ["major-projects", "awards", "talent-declaration", "reception"];

interface DemoAccount {
  email:         string;
  name:          string;
  role:          UserRole;
  hasPartyModuleAccess: boolean;
  hasPartyAdminAccess:  boolean;
  /** 是否挂到演示部门（账号1 需要部门才能生效模块授权） */
  attachDept:    boolean;
  /** 侧边栏账号级白名单 */
  whitelist:     string[];
  /** 是否进入"只读演示模式"（dashboard 内表单输入与提交按钮灰化） */
  readonly:      boolean;
  note:          string;
}

const ACCOUNTS: DemoAccount[] = [
  {
    email:                "viewer01@ruiqishenkong.com",
    name:                 "演示·查阅账号",
    role:                 UserRole.DEPT_CONTACT,
    hasPartyModuleAccess: false,
    hasPartyAdminAccess:  false,
    attachDept:           true,
    whitelist:            VIEWER_MODULES,
    readonly:             true,
    note:                 "仅可查阅：重大项目 / 荣誉资质 / 人才申报 / 会议接待（只读演示模式，所有表单输入灰化禁用）",
  },
  {
    email:                "party-member@ruiqishenkong.com",
    name:                 "演示·党员（提交端）",
    role:                 UserRole.DEPT_CONTACT,
    hasPartyModuleAccess: true,
    hasPartyAdminAccess:  false,
    attachDept:           false,
    whitelist:            ["party-transfer"],
    readonly:             false,
    note:                 "党员：可提交党员关系转接管理申请（员工提交端）",
  },
  {
    email:                "party-admin@ruiqishenkong.com",
    name:                 "演示·党员关系管理员",
    role:                 UserRole.PA_SPECIALIST,
    hasPartyModuleAccess: true,
    hasPartyAdminAccess:  true,
    attachDept:           false,
    whitelist:            ["party-transfer"],
    readonly:             false,
    note:                 "党员关系模块全部功能：审批工作台 + 我的申请",
  },
];

// ── 主流程 ────────────────────────────────────────────────────

async function main() {
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma  = new PrismaClient({ adapter });

  try {
    // 0) 取超级管理员作为授权人（ModulePermission.grantedById 必填）
    const admin = await prisma.user.findFirst({
      where:  { role: UserRole.SUPER_ADMIN, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    });
    if (!admin) throw new Error("未找到超级管理员账号，无法填写授权人");
    console.log(`👤 授权人（超级管理员）：${admin.name}\n`);

    // 1) 演示部门
    const dept = await prisma.department.upsert({
      where:  { code: DEMO_DEPT.code },
      update: { name: DEMO_DEPT.name, type: DEMO_DEPT.type, isActive: true },
      create: { name: DEMO_DEPT.name, code: DEMO_DEPT.code, type: DEMO_DEPT.type },
    });
    console.log(`🏢 演示部门：${dept.name}（${dept.code}）`);

    // 2) 部门模块授权（账号1 的 DEPT_CONTACT 可见性依赖 module_permissions）
    for (const moduleKey of VIEWER_MODULES) {
      await prisma.modulePermission.upsert({
        where:  { moduleKey_departmentId: { moduleKey, departmentId: dept.id } },
        update: { permLevel: PermLevel.VIEW, isActive: true, grantedById: admin.id, expiresAt: null },
        create: {
          moduleKey,
          departmentId: dept.id,
          permLevel:    PermLevel.VIEW,
          isActive:     true,
          grantedById:  admin.id,
        },
      });
    }
    console.log(`🔑 已授权 ${VIEWER_MODULES.length} 个模块（VIEW）：${VIEWER_MODULES.join(", ")}\n`);

    // 3) 账号
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const whitelistPatch: Record<string, string[]> = {};

    for (const acc of ACCOUNTS) {
      const user = await prisma.user.upsert({
        where:  { email: acc.email },
        update: {
          name:                 acc.name,
          role:                 acc.role,
          passwordHash,
          isActive:             true,
          deletedAt:            null,
          hasPartyModuleAccess: acc.hasPartyModuleAccess,
          hasPartyAdminAccess:  acc.hasPartyAdminAccess,
          ...(acc.attachDept ? { departmentId: dept.id } : {}),
        },
        create: {
          email:                acc.email,
          name:                 acc.name,
          role:                 acc.role,
          passwordHash,
          isActive:             true,
          hasPartyModuleAccess: acc.hasPartyModuleAccess,
          hasPartyAdminAccess:  acc.hasPartyAdminAccess,
          departmentId:         acc.attachDept ? dept.id : null,
        },
      });
      whitelistPatch[acc.email.toLowerCase()] = acc.whitelist;
      console.log(`✅ ${user.name}`);
      console.log(`    邮箱：${user.email}`);
      console.log(`    角色：${user.role}${acc.hasPartyAdminAccess ? "（含党员审批权限）" : ""}`);
      console.log(`    说明：${acc.note}`);
      console.log(`    侧边栏仅显示：${acc.whitelist.join(", ")}\n`);
    }

    // 4) 合并写入侧边栏账号白名单 + 只读演示名单（保留既有全局开关与角色范围）
    const row  = await prisma.systemConfig.findUnique({ where: { key: SIDEBAR_CONFIG_KEY } });
    const cfg  = parseSidebarConfig(row?.value);
    cfg.accountWhitelist = { ...cfg.accountWhitelist, ...whitelistPatch };
    for (const acc of ACCOUNTS) {
      if (acc.readonly && !cfg.readonlyAccounts.includes(acc.email.toLowerCase())) {
        cfg.readonlyAccounts.push(acc.email.toLowerCase());
      }
    }
    const value = serializeSidebarConfig(cfg);

    await prisma.systemConfig.upsert({
      where:  { key: SIDEBAR_CONFIG_KEY },
      update: { value },
      create: {
        key:         SIDEBAR_CONFIG_KEY,
        value,
        description: "侧边栏菜单显示配置（全局开关 / 角色范围 / 账号白名单 / 只读演示账号）",
      },
    });
    console.log("🎛️  已写入侧边栏账号白名单：");
    for (const [email, mods] of Object.entries(whitelistPatch)) {
      console.log(`    ${email} → [${mods.join(", ")}]`);
    }
    if (cfg.readonlyAccounts.length > 0) {
      console.log(`🔒 只读演示账号：${cfg.readonlyAccounts.join(", ")}`);
    }

    console.log("\n🎉 完成！登录信息：");
    console.log("    统一密码：" + DEMO_PASSWORD);
    for (const acc of ACCOUNTS) {
      console.log(`    ${acc.email.padEnd(38)} ${acc.note}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("❌ 脚本执行失败：", e);
  process.exit(1);
});
