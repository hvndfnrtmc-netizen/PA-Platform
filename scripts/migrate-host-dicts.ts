/**
 * scripts/migrate-host-dicts.ts
 *
 * 一次性迁移脚本：
 *  Step A：向 ReceptionDictionary 播种 host 层级字典
 *  Step B：遍历 Reception 记录，按 hostName 匹配 dict entry，写入 hostDictId
 *
 * 运行：
 *   cd pa-platform
 *   npx tsx scripts/migrate-host-dicts.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool    = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 });
const adapter = new PrismaPg(pool);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma  = new PrismaClient({ adapter } as any);

// ── 层级字典结构 ──────────────────────────────────────────────────
const HOST_TREE: Array<{ value: string; children: string[] }> = [
  { value: "LPA",  children: ["Yuting", "Yara", "Nerida", "Zoe"] },
  { value: "S&PA", children: [] },
  { value: "CPA",  children: [] },
  { value: "管理层", children: ["Xudong", "Kevin", "Larry", "George"] },
];

// hostName → 匹配关键词（大小写不敏感）
// 支持历史数据中各种写法
const NAME_ALIASES: Record<string, string> = {
  yuting:  "Yuting",
  yara:    "Yara",
  nerida:  "Nerida",
  zoe:     "Zoe",
  xudong:  "Xudong",
  kevin:   "Kevin",
  larry:   "Larry",
  george:  "George",
  lpa:     "LPA",
  "s&pa":  "S&PA",
  spa:     "S&PA",
  cpa:     "CPA",
  "管理层":  "管理层",
};

async function main() {
  console.log("=== Step A: 播种 host 层级字典 ===");

  // 检查是否已播种
  const existing = await prisma.receptionDictionary.findFirst({
    where: { category: "host" },
  });
  if (existing) {
    console.log("host 字典已存在，跳过播种（如需重置请手动清空 reception_dicts where category='host'）");
  } else {
    for (let i = 0; i < HOST_TREE.length; i++) {
      const { value, children } = HOST_TREE[i];
      const parent = await prisma.receptionDictionary.create({
        data: { category: "host", value, parentId: null, sortOrder: i, isDefault: false, isActive: true },
      });
      console.log(`  创建一级: ${value} (id=${parent.id})`);

      for (let j = 0; j < children.length; j++) {
        const child = await prisma.receptionDictionary.create({
          data: { category: "host", value: children[j], parentId: parent.id, sortOrder: j, isDefault: false, isActive: true },
        });
        console.log(`    创建二级: ${children[j]} (id=${child.id})`);
      }
    }
    console.log("播种完成。\n");
  }

  // 构建 value → id 查找表（所有 host 字典项）
  const allHostDicts = await prisma.receptionDictionary.findMany({
    where: { category: "host", isActive: true },
  });
  const valueToId = new Map(allHostDicts.map((d) => [d.value.toLowerCase(), d.id]));

  console.log("=== Step B: 迁移 Reception.hostName → hostDictId ===");

  const receptions = await prisma.reception.findMany({
    where:  { deletedAt: null },
    select: { id: true, hostName: true, hostDictId: true },
  });

  let matched = 0, skipped = 0, notFound = 0;

  for (const rec of receptions) {
    // 已有 hostDictId 的跳过
    if (rec.hostDictId) { skipped++; continue; }
    if (!rec.hostName)  { skipped++; continue; }

    const raw         = rec.hostName.trim().toLowerCase();
    const canonical   = NAME_ALIASES[raw] ?? rec.hostName.trim();
    const dictId      = valueToId.get(canonical.toLowerCase());

    if (dictId) {
      await prisma.reception.update({
        where: { id: rec.id },
        data:  { hostDictId: dictId },
        // hostName 保留原值，供统计等历史逻辑继续使用
      });
      console.log(`  [OK] ${rec.id.slice(0,8)}… hostName="${rec.hostName}" → dictId=${dictId} (${canonical})`);
      matched++;
    } else {
      console.log(`  [--] ${rec.id.slice(0,8)}… hostName="${rec.hostName}" 未匹配字典，保留原值`);
      notFound++;
    }
  }

  console.log(`\n迁移完成：匹配 ${matched} 条，已有ID跳过 ${skipped} 条，未匹配 ${notFound} 条`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
