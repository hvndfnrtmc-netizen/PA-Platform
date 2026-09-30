/**
 * scripts/clean-compound-formats.ts
 *
 * 清洗接待形式中的"合并型"字典项（名称含 + 号，如"展厅+座谈"）
 *
 * 步骤：
 *  A. 找出所有 category=format、value 含 "+" 的字典项（仅一级，parentId=null）
 *  B. 按 + 拆分，为每个原子部分找或建对应的一级 ID
 *  C. 遍历引用了合并 ID 的 Reception 记录，替换为拆分后的原子 ID（去重）
 *  D. 确认软删除（isActive=false）已到位
 *
 * 运行：
 *   npx tsx scripts/clean-compound-formats.ts
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

async function main() {
  // ── A. 加载全量 format 字典 ─────────────────────────────────────────────
  const allDicts = await prisma.receptionDictionary.findMany({
    where:   { category: "format" },
    select:  { id: true, value: true, parentId: true, isActive: true },
    orderBy: { sortOrder: "asc" },
  });

  // 一级选项 value → id 映射（仅 parentId=null）
  const rootValueToId = new Map<string, string>();
  for (const d of allDicts) {
    if (!d.parentId) rootValueToId.set(d.value.trim(), d.id);
  }

  // ── B. 找出合并型字典项（parentId=null 且 value 含 +）─────────────────
  const compoundDicts = allDicts.filter(d => !d.parentId && d.value.includes("+"));
  if (compoundDicts.length === 0) {
    console.log("没有需要清洗的合并型字典项。");
    return;
  }

  console.log(`找到 ${compoundDicts.length} 个合并型字典项:\n`);

  for (const compound of compoundDicts) {
    const parts = compound.value.split("+").map(s => s.trim()).filter(Boolean);
    console.log(`\n== 处理: "${compound.value}" (id=${compound.id.slice(0,8)}…) ==`);
    console.log(`  拆分为: [${parts.join(", ")}]`);

    // ── 为每个原子部分找或建一级 ID ────────────────────────────────────
    const atomicIds: string[] = [];
    for (const part of parts) {
      let id = rootValueToId.get(part);
      if (id) {
        console.log(`  原子项 "${part}" 已存在: ${id.slice(0,8)}…`);
      } else {
        const created = await prisma.receptionDictionary.create({
          data: { category: "format", value: part, parentId: null, isDefault: false, isActive: true },
        });
        id = created.id;
        rootValueToId.set(part, id); // 缓存新建的
        console.log(`  原子项 "${part}" 新建: ${id.slice(0,8)}…`);
      }
      atomicIds.push(id);
    }

    // ── C. 找出所有使用了该合并 ID 的 Reception 记录 ──────────────────
    const receptions = await prisma.reception.findMany({
      where:  { formats: { array_contains: compound.id } },
      select: { id: true, formats: true },
    });
    console.log(`  影响 ${receptions.length} 条 Reception 记录`);

    for (const rec of receptions) {
      const oldFormats = (rec.formats as string[]).filter(Boolean);

      // 移除合并 ID，插入原子 ID，去重保序
      const newFormats = Array.from(new Set([
        ...oldFormats.filter(f => f !== compound.id),
        ...atomicIds,
      ]));

      await prisma.reception.update({
        where: { id: rec.id },
        data:  { formats: newFormats },
      });
      console.log(`    [OK] reception ${rec.id.slice(0,8)}… formats: [${oldFormats.join(",")}] → [${newFormats.join(",")}]`);
    }

    // ── D. 确保合并型字典项已软删除 ──────────────────────────────────
    if (compound.isActive) {
      await prisma.receptionDictionary.update({
        where: { id: compound.id },
        data:  { isActive: false },
      });
      console.log(`  已软删除合并字典项 "${compound.value}"`);
    } else {
      console.log(`  合并字典项 "${compound.value}" 已是 isActive=false，无需重复处理`);
    }
  }

  console.log("\n=== 清洗完成 ===");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
