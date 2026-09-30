/**
 * Momenta PA Platform — Prisma Seed Script
 * 初始化基础数据：超级管理员账号、部门拓扑、示例任务、示例资产
 *
 * 运行: npx prisma db seed
 */

import "dotenv/config";
import { PrismaClient, UserRole, DepartmentType, TaskType, TaskStatus, AssetCategory, AuditAction } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

async function main() {
  console.log("🌱 开始初始化数据库种子数据...");
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });

  // ── 1. 创建部门拓扑 ──────────────────────────────────────────

  const paRoot = await prisma.department.upsert({
    where: { code: "PA" },
    update: {},
    create: {
      name: "公共事务部",
      code: "PA",
      type: DepartmentType.PA,
    },
  });

  const deptFinance = await prisma.department.upsert({
    where: { code: "FINANCE" },
    update: {},
    create: { name: "财务部", code: "FINANCE", type: DepartmentType.BUSINESS },
  });

  const deptHR = await prisma.department.upsert({
    where: { code: "HR" },
    update: {},
    create: { name: "人力资源部", code: "HR", type: DepartmentType.BUSINESS },
  });

  const deptLegal = await prisma.department.upsert({
    where: { code: "LEGAL" },
    update: {},
    create: { name: "法务部", code: "LEGAL", type: DepartmentType.BUSINESS },
  });

  const deptRD = await prisma.department.upsert({
    where: { code: "RD" },
    update: {},
    create: { name: "研发部", code: "RD", type: DepartmentType.BUSINESS },
  });

  const deptOperation = await prisma.department.upsert({
    where: { code: "OPERATION" },
    update: {},
    create: {
      name: "运营部",
      code: "OPERATION",
      type: DepartmentType.BUSINESS,
    },
  });

  console.log("✅ 部门拓扑创建完成");

  // ── 2. 创建用户 ──────────────────────────────────────────────

  const adminPw = await bcrypt.hash("Admin@Momenta2025!", 12);

  const adminUser = await prisma.user.upsert({
    where: { email: "admin@momenta.ai" },
    update: {},
    create: {
      name: "LPA 超级管理员",
      email: "admin@momenta.ai",
      role: UserRole.SUPER_ADMIN,
      passwordHash: adminPw,
      departmentId: paRoot.id,
    },
  });

  const specialistUser = await prisma.user.upsert({
    where: { email: "specialist@momenta.ai" },
    update: {},
    create: {
      name: "LPA 专员-张三",
      email: "specialist@momenta.ai",
      role: UserRole.PA_SPECIALIST,
      passwordHash: await bcrypt.hash("Specialist@2025!", 12),
      departmentId: paRoot.id,
    },
  });

  const financeContact = await prisma.user.upsert({
    where: { email: "finance@momenta.ai" },
    update: {},
    create: {
      name: "财务对接人-李四",
      email: "finance@momenta.ai",
      role: UserRole.DEPT_CONTACT,
      passwordHash: await bcrypt.hash("Finance@2025!", 12),
      departmentId: deptFinance.id,
    },
  });

  const rdContact = await prisma.user.upsert({
    where: { email: "rd@momenta.ai" },
    update: {},
    create: {
      name: "研发对接人-王五",
      email: "rd@momenta.ai",
      role: UserRole.DEPT_CONTACT,
      passwordHash: await bcrypt.hash("RD@2025!", 12),
      departmentId: deptRD.id,
    },
  });

  // 更新部门联系人
  await prisma.department.update({
    where: { id: deptFinance.id },
    data: { contactUserId: financeContact.id },
  });
  await prisma.department.update({
    where: { id: deptRD.id },
    data: { contactUserId: rdContact.id },
  });

  console.log("✅ 用户创建完成");

  // ── 3. 创建任务模板 ───────────────────────────────────────────

  const quarterlyTemplate = await prisma.taskTemplate.upsert({
    where: { id: "tpl_quarterly_report" },
    update: {},
    create: {
      id: "tpl_quarterly_report",
      name: "季度政务申报标准模板",
      description: "每季度向交通运输部/工信部上报核心运营指标",
      type: TaskType.PERIODIC,
      cronExpression: "0 9 1 1,4,7,10 *",
      fieldsSchema: [
        {
          fieldKey: "total_revenue",
          label: "本季度营收",
          deptCode: "FINANCE",
          unit: "万元",
          required: true,
        },
        {
          fieldKey: "total_patents",
          label: "累计专利总数",
          deptCode: "RD",
          unit: "件",
          required: true,
        },
        {
          fieldKey: "new_patents_quarter",
          label: "本季度新增专利",
          deptCode: "RD",
          unit: "件",
          required: true,
        },
        {
          fieldKey: "headcount",
          label: "在职员工总数",
          deptCode: "HR",
          unit: "人",
          required: true,
        },
      ],
    },
  });

  console.log("✅ 任务模板创建完成");

  // ── 4. 创建示例任务 ───────────────────────────────────────────

  const exampleTask = await prisma.task.upsert({
    where: { id: "task_2025_q1" },
    update: {},
    create: {
      id: "task_2025_q1",
      title: "2025年Q1 季度政务申报数据收集",
      description: "请各部门于4月15日前完成2025年Q1核心指标填报，逾期系统将自动提醒。",
      type: TaskType.PERIODIC,
      status: TaskStatus.ARCHIVED,
      templateId: quarterlyTemplate.id,
      deadline: new Date("2025-04-15"),
      archivedAt: new Date("2025-04-16"),
      lockedAt: new Date("2025-04-16"),
      lockedById: adminUser.id,
      createdById: adminUser.id,
    },
  });

  // 分配给各部门
  for (const dept of [deptFinance, deptRD, deptOperation, deptHR, deptLegal]) {
    await prisma.taskAssignment.upsert({
      where: {
        taskId_departmentId: { taskId: exampleTask.id, departmentId: dept.id },
      },
      update: {},
      create: {
        taskId: exampleTask.id,
        departmentId: dept.id,
        status: "APPROVED",
        submittedAt: new Date("2025-04-14"),
        reviewerId: specialistUser.id,
        reviewedAt: new Date("2025-04-15"),
      },
    });
  }

  console.log("✅ 示例任务与分配创建完成");

  // ── 5. 创建核心资产大盘数据 ──────────────────────────────────

  const assets = [
    {
      metricKey: "2025_Q1_total_revenue",
      metricName: "2025年Q1营收",
      category: AssetCategory.FINANCIAL,
      value: "18500",
      unit: "万元",
      period: "2025-Q1",
      periodLabel: "2025年第一季度",
      sourceFeishuUrl: "https://example.feishu.cn/sheets/xxx?sheet=FinanceSheet",
      sourceCellRef: "FinanceSheet!D5",
      isEncrypted: true,
    },
    {
      metricKey: "2025_Q1_total_patents",
      metricName: "2025年Q1累计专利总数",
      category: AssetCategory.RD_PATENT,
      value: "1524",
      unit: "件",
      period: "2025-Q1",
      periodLabel: "2025年第一季度",
      sourceCellRef: "RDSheet!B3",
    },
    {
      metricKey: "2025_Q1_new_patents",
      metricName: "2025年Q1新增专利",
      category: AssetCategory.RD_PATENT,
      value: "87",
      unit: "件",
      period: "2025-Q1",
      periodLabel: "2025年第一季度",
      sourceCellRef: "RDSheet!B4",
    },
    {
      metricKey: "2025_Q1_headcount",
      metricName: "2025年Q1在职员工数",
      category: AssetCategory.PERSONNEL,
      value: "3200",
      unit: "人",
      period: "2025-Q1",
      periodLabel: "2025年第一季度",
      sourceCellRef: "HRSheet!A2",
    },
  ];

  for (const a of assets) {
    await prisma.asset.upsert({
      where: { metricKey_period: { metricKey: a.metricKey, period: a.period } },
      update: {},
      create: {
        ...a,
        sourceTaskId: exampleTask.id,
        createdById: adminUser.id,
      },
    });
  }

  console.log("✅ 核心资产大盘数据创建完成");

  // ── 6. 创建审计日志示例 ───────────────────────────────────────

  await prisma.auditLog.createMany({
    data: [
      {
        userId: adminUser.id,
        action: AuditAction.LOGIN,
        ipAddress: "10.0.1.100",
        userAgent: "Mozilla/5.0 (Macintosh)",
      },
      {
        userId: adminUser.id,
        action: AuditAction.ARCHIVE_TASK,
        resourceType: "Task",
        resourceId: exampleTask.id,
        isDangerous: false,
        metadata: { taskTitle: exampleTask.title },
      },
      {
        userId: adminUser.id,
        action: AuditAction.LOCK_TASK,
        resourceType: "Task",
        resourceId: exampleTask.id,
        isDangerous: true,
        metadata: { note: "所有部门已提交，一键锁定" },
      },
    ],
  });

  console.log("✅ 审计日志示例创建完成");
  console.log("\n🎉 种子数据初始化完毕！");
  console.log("──────────────────────────────────────");
  console.log("超级管理员账号: admin@momenta.ai");
  console.log("初始密码:       Admin@Momenta2025!");
  console.log("──────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error("❌ Seed 失败:", e);
    process.exit(1);
  });
