/**
 * 一次性脚本：将 19 个人才申报项目批量导入数据库
 * 运行方式：npx tsx scripts/seed-talent-programs.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const pool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 1 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as Parameters<typeof PrismaClient>[0]);

const TALENT_PROGRAMS = [
  { name: "国家启明计划",                             level: "国家级", region: "全国"   },
  { name: "江苏省双创人才",                           level: "省级",   region: "江苏省" },
  { name: "上海白玉兰人才计划",                       level: "省级",   region: "上海市" },
  { name: "金桥人才租房补贴",                         level: "省级",   region: "上海市" },
  { name: "苏州市创新领军人才",                       level: "市级",   region: "苏州市" },
  { name: "苏州市高端人才奖励计划",                   level: "市级",   region: "苏州市" },
  { name: "姑苏重点产业紧缺人才计划",                 level: "市级",   region: "苏州市" },
  { name: "苏州市优秀人才贡献奖励计划",               level: "市级",   region: "苏州市" },
  { name: "苏州市人才乐居",                           level: "市级",   region: "苏州市" },
  { name: "应届生租房补贴",                           level: "市级",   region: "苏州市" },
  { name: "深圳市聚龙青年人才（优秀大学毕业生）",     level: "市级",   region: "深圳市" },
  { name: "深圳市境外人才个税奖励",                   level: "市级",   region: "深圳市" },
  { name: "深圳市坪山区聚龙领军人才",                 level: "市级",   region: "深圳市" },
  { name: "相城区创新领军人才",                       level: "区级",   region: "相城区" },
  { name: "相城区产业人才专项奖励",                   level: "区级",   region: "相城区" },
  { name: "相城区人才乐居",                           level: "区级",   region: "相城区" },
  { name: "相城区重点产业人才薪酬补贴",               level: "区级",   region: "相城区" },
  { name: "相城区人才房票",                           level: "区级",   region: "相城区" },
  { name: "相城区高层次人才子女就读非公办学校学费补贴", level: "区级", region: "相城区" },
];

async function main() {
  console.log(`开始导入 ${TALENT_PROGRAMS.length} 个人才申报项目...`);

  let created = 0;
  let skipped = 0;

  for (const p of TALENT_PROGRAMS) {
    const existing = await prisma.talentProject.findFirst({
      where: { name: p.name, deletedAt: null },
    });
    if (existing) {
      console.log(`  ⏭  已存在，跳过：${p.name}`);
      skipped++;
      continue;
    }
    await prisma.talentProject.create({
      data: {
        name:   p.name,
        level:  p.level,
        region: p.region,
        declarationNodes: [],
        policyLinks:      [],
        attachments:      [],
      },
    });
    console.log(`  ✓  已创建：${p.name}`);
    created++;
  }

  console.log(`\n导入完成：新增 ${created} 条，跳过 ${skipped} 条（已存在）。`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
