/**
 * 重大项目模块数据迁移脚本
 *
 * 功能：
 * 1. 初始化字典表（level, category, companyEntity, awardingUnit）
 * 2. 将旧的时间字段迁移到 ProjectMilestone 表
 * 3. 将旧的 ProjectIndicator 数据复制到 ProjectKPI 表
 * 4. 回填新字段的默认值
 *
 * 注意：本脚本保留所有旧字段作为备份，不删除任何数据
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// 使用与项目相同的 Prisma Client 配置
const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
  max: 1,
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// 默认字典数据
const DEFAULT_DICTS = {
  level: ['区级', '市级', '省级', '国家级', '板块'],
  category: ['落地协议', '科研项目', '产业扶持', '人才计划'],
  companyEntity: ['主体公司A', '主体公司B', '主体公司C'],
  awardingUnit: ['科技局', '发改委', '工信局', '人社局'],
};

async function main() {
  console.log('🚀 开始重大项目模块数据迁移...\n');

  // ════════════════════════════════════════════════════════════════
  // Step 1: 初始化字典表
  // ════════════════════════════════════════════════════════════════
  console.log('📚 Step 1: 初始化字典表...');

  for (const [category, values] of Object.entries(DEFAULT_DICTS)) {
    const existingCount = await prisma.majorProjectDictionary.count({
      where: { category },
    });

    if (existingCount === 0) {
      console.log(`  ├─ 创建 ${category} 字典，共 ${values.length} 项...`);
      await prisma.majorProjectDictionary.createMany({
        data: values.map((value, index) => ({
          category,
          value,
          sortOrder: index,
          isActive: true,
        })),
      });
      console.log(`  └─ ✅ ${category} 字典创建完成`);
    } else {
      console.log(`  └─ ⏭️  ${category} 字典已存在，跳过`);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Step 2: 迁移旧的 level 字段到字典外键
  // ════════════════════════════════════════════════════════════════
  console.log('\n🔗 Step 2: 迁移 level 字段到字典外键...');

  const projectsWithOldLevel = await prisma.majorProject.findMany({
    where: {
      level: { not: null },
      levelDictId: null, // 还未迁移
    },
    select: { id: true, level: true },
  });

  console.log(`  ├─ 找到 ${projectsWithOldLevel.length} 个项目需要迁移 level`);

  for (const project of projectsWithOldLevel) {
    if (!project.level || project.level === '') continue;

    // 查找或创建对应的字典项
    let dictItem = await prisma.majorProjectDictionary.findFirst({
      where: { category: 'level', value: project.level },
    });

    if (!dictItem) {
      console.log(`  ├─ 创建新字典项: level="${project.level}"`);
      dictItem = await prisma.majorProjectDictionary.create({
        data: {
          category: 'level',
          value: project.level,
          sortOrder: 999, // 自定义项排序靠后
          isActive: true,
        },
      });
    }

    // 回填外键
    await prisma.majorProject.update({
      where: { id: project.id },
      data: { levelDictId: dictItem.id },
    });
  }

  console.log(`  └─ ✅ level 字段迁移完成`);

  // ════════════════════════════════════════════════════════════════
  // Step 3: 迁移金额字段
  // ════════════════════════════════════════════════════════════════
  console.log('\n💰 Step 3: 迁移金额字段...');

  const projectsWithOldAmount = await prisma.majorProject.findMany({
    where: {
      OR: [
        { totalSubsidy: { not: null } },
        { received: { not: null } },
      ],
      totalAmount: null, // 还未迁移
    },
    select: { id: true, totalSubsidy: true, received: true },
  });

  console.log(`  ├─ 找到 ${projectsWithOldAmount.length} 个项目需要迁移金额`);

  for (const project of projectsWithOldAmount) {
    await prisma.majorProject.update({
      where: { id: project.id },
      data: {
        totalAmount: project.totalSubsidy,
        receivedAmount: project.received ?? 0,
      },
    });
  }

  console.log(`  └─ ✅ 金额字段迁移完成`);

  // ════════════════════════════════════════════════════════════════
  // Step 4: 迁移时间字段到 ProjectMilestone 表
  // ════════════════════════════════════════════════════════════════
  console.log('\n📅 Step 4: 迁移时间字段到里程碑表...');

  const projectsWithDates = await prisma.majorProject.findMany({
    where: {
      OR: [
        { applyDate: { not: null } },
        { startDate: { not: null } },
        { midCheckDate: { not: null } },
        { endDate: { not: null } },
      ],
    },
    select: {
      id: true,
      applyDate: true,
      startDate: true,
      midCheckDate: true,
      endDate: true,
      milestones: true,
    },
  });

  console.log(`  ├─ 找到 ${projectsWithDates.length} 个项目需要迁移时间`);

  for (const project of projectsWithDates) {
    const existingMilestones = project.milestones;

    // 检查是否已有里程碑，避免重复创建
    const existingTypes = new Set(existingMilestones.map(m => m.type));

    const milestonesToCreate = [];

    // APPLY 节点（申报时间，使用 startDate）
    if (project.applyDate && !existingTypes.has('APPLY')) {
      milestonesToCreate.push({
        projectId: project.id,
        type: 'APPLY',
        startDate: project.applyDate,
        endDate: null,
        date: null,
        status: 'DONE',
        notes: '从旧字段 applyDate 迁移',
        attachments: [],
      });
    }

    // START 节点（开始时间）
    if (project.startDate && !existingTypes.has('START')) {
      milestonesToCreate.push({
        projectId: project.id,
        type: 'START',
        startDate: null,
        endDate: null,
        date: project.startDate,
        status: 'DONE',
        notes: '从旧字段 startDate 迁移',
        attachments: [],
      });
    }

    // MID_CHECK 节点（中期验收时间）
    if (project.midCheckDate && !existingTypes.has('MID_CHECK')) {
      milestonesToCreate.push({
        projectId: project.id,
        type: 'MID_CHECK',
        startDate: null,
        endDate: null,
        date: project.midCheckDate,
        status: 'DONE',
        notes: '从旧字段 midCheckDate 迁移',
        attachments: [],
      });
    }

    // END 节点（结项时间）
    if (project.endDate && !existingTypes.has('END')) {
      milestonesToCreate.push({
        projectId: project.id,
        type: 'END',
        startDate: null,
        endDate: null,
        date: project.endDate,
        status: 'DONE',
        notes: '从旧字段 endDate 迁移',
        attachments: [],
      });
    }

    if (milestonesToCreate.length > 0) {
      await prisma.projectMilestone.createMany({
        data: milestonesToCreate,
      });
      console.log(`  ├─ 项目 ${project.id}: 创建 ${milestonesToCreate.length} 个里程碑`);
    }
  }

  console.log(`  └─ ✅ 时间字段迁移完成`);

  // ════════════════════════════════════════════════════════════════
  // Step 5: 复制 ProjectIndicator 数据到 ProjectKPI 表
  // ════════════════════════════════════════════════════════════════
  console.log('\n📊 Step 5: 复制指标数据到 KPI 表...');

  const indicators = await prisma.projectIndicator.findMany();

  console.log(`  ├─ 找到 ${indicators.length} 条指标记录`);

  const kpiData = indicators.map(ind => ({
    projectId: ind.projectId,
    name: ind.name,
    content: ind.content,
    ownerFeishuOpenId: null, // 旧数据中 owner 是字符串，需后续手动绑定
    isCustom: ind.isCustom,
    sortOrder: ind.sortOrder,
  }));

  if (kpiData.length > 0) {
    await prisma.projectKPI.createMany({
      data: kpiData,
      skipDuplicates: true,
    });
    console.log(`  └─ ✅ 成功复制 ${kpiData.length} 条指标到 KPI 表`);
  } else {
    console.log(`  └─ ⏭️  无指标数据需要复制`);
  }

  // ════════════════════════════════════════════════════════════════
  // Step 6: 统计信息
  // ════════════════════════════════════════════════════════════════
  console.log('\n📈 迁移统计：');

  const stats = {
    projects: await prisma.majorProject.count(),
    dicts: await prisma.majorProjectDictionary.count(),
    milestones: await prisma.projectMilestone.count(),
    kpis: await prisma.projectKPI.count(),
    oldIndicators: await prisma.projectIndicator.count(),
    todos: await prisma.projectTodo.count(),
  };

  console.log(`  ├─ 项目总数: ${stats.projects}`);
  console.log(`  ├─ 字典条目: ${stats.dicts}`);
  console.log(`  ├─ 里程碑: ${stats.milestones}`);
  console.log(`  ├─ KPI 指标: ${stats.kpis}`);
  console.log(`  ├─ 旧指标（保留备份）: ${stats.oldIndicators}`);
  console.log(`  └─ 待办事项: ${stats.todos}`);

  console.log('\n✅ 迁移完成！所有旧字段已保留作为备份。');
  console.log('⚠️  注意：KPI 表中的 ownerFeishuOpenId 字段为空，需前端手动绑定飞书人员。');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ 迁移失败:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
