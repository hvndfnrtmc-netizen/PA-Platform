/**
 * scripts/migrate-visit-purpose.ts
 *
 * 来访目的字典整合与历史数据清洗
 *
 * 合并规则：
 *   业务洽谈, 业务支持          → 企业交流
 *   政府宣传, 政府视察, 关系维护  → 政府调研
 *   政府会议, 项目审查           → 保持不变
 *
 * 执行：
 *   cd pa-platform
 *   npx tsx scripts/migrate-visit-purpose.ts
 */

import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(__dirname, "../.env.local") });
config({ path: resolve(__dirname, "../.env") });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 })) } as any);

// ── 合并映射 ──────────────────────────────────────────────────────────────────
const MERGE_MAP: Record<string, string> = {
  "业务洽谈": "企业交流",
  "业务支持": "企业交流",
  "政府宣传": "政府调研",
  "政府视察": "政府调研",
  "关系维护": "政府调研",
};

// 最终保留的标准目的（含原有不变项）
const STANDARD_PURPOSES = ["企业交流", "政府调研", "政府会议", "项目审查"];

// 废弃项（迁移后禁用）
const DEPRECATED = Object.keys(MERGE_MAP);

async function main() {
  console.log("=== Step A：确保标准字典项存在 ===");
  for (const value of STANDARD_PURPOSES) {
    const existing = await prisma.receptionDictionary.findFirst({
      where: { category: "purpose", value, isActive: true },
    });
    if (existing) {
      console.log(`  已存在: ${value}`);
    } else {
      await prisma.receptionDictionary.create({
        data: { category: "purpose", value, parentId: null, isDefault: false, isActive: true },
      });
      console.log(`  创建: ${value}`);
    }
  }

  console.log("\n=== Step B：清洗 Reception.purpose ===");
  const recs = await prisma.reception.findMany({
    where:  { deletedAt: null },
    select: { id: true, purpose: true },
  });

  let updated = 0, skipped = 0;
  for (const rec of recs) {
    const newValue = MERGE_MAP[rec.purpose];
    if (newValue) {
      await prisma.reception.update({ where: { id: rec.id }, data: { purpose: newValue } });
      console.log(`  [OK] ${rec.id.slice(0, 8)}… "${rec.purpose}" → "${newValue}"`);
      updated++;
    } else {
      skipped++;
    }
  }
  console.log(`\n  更新 ${updated} 条，跳过 ${skipped} 条（已是标准值或为空）`);

  console.log("\n=== Step C：禁用废弃字典项 ===");
  for (const value of DEPRECATED) {
    const result = await prisma.receptionDictionary.updateMany({
      where: { category: "purpose", value },
      data:  { isActive: false },
    });
    if (result.count > 0) {
      console.log(`  停用: ${value} (${result.count} 条)`);
    } else {
      console.log(`  未找到: ${value}（可能从未入库）`);
    }
  }

  console.log("\n=== 完成 ===");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
