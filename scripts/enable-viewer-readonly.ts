/**
 * 把 viewer01@ruiqishenkong.com 加入 sidebar_menu_config.readonlyAccounts，
 * 启用"只读演示模式"。幂等，可重复执行。
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  DEFAULT_SIDEBAR_CONFIG,
  parseSidebarConfig,
  serializeSidebarConfig,
} from "../src/lib/sidebar-config.ts";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const KEY = "sidebar_menu_config";
const TARGET_EMAIL = "viewer01@ruiqishenkong.com";

const main = async () => {
  const row = await prisma.systemConfig.findUnique({ where: { key: KEY } });
  const current = row ? parseSidebarConfig(row.value) : { ...DEFAULT_SIDEBAR_CONFIG };

  if (!current.readonlyAccounts.includes(TARGET_EMAIL)) {
    current.readonlyAccounts.push(TARGET_EMAIL);
  } else {
    console.log(`[skip] ${TARGET_EMAIL} 已在 readonlyAccounts 中`);
  }

  const value = serializeSidebarConfig(current);
  await prisma.systemConfig.upsert({
    where:  { key: KEY },
    update: { value },
    create: {
      key:         KEY,
      value,
      description: "侧边栏菜单显示配置（全局开关 / 角色范围 / 账号白名单 / 只读演示账号）",
    },
  });

  console.log("[ok] 已写入 sidebar_menu_config.readonlyAccounts:");
  console.log("   ", current.readonlyAccounts);
  console.log("\n完整配置：");
  console.log(JSON.stringify(current, null, 2));
};

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
