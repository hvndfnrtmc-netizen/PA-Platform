/**
 * 为各业务部门补充测试账号
 * 运行: node --env-file=.env --import=tsx/esm prisma/add_test_users.ts
 */

import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

async function main() {
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma  = new PrismaClient({ adapter });

  console.log("🔍 查询现有部门...");
  const depts = await prisma.department.findMany({ orderBy: { code: "asc" } });
  console.log("部门列表:", depts.map(d => `${d.code}(${d.name})`).join(", "));

  console.log("\n🔍 查询现有账号...");
  const existing = await prisma.user.findMany({
    select: { email: true, role: true, department: { select: { code: true, name: true } } },
  });
  for (const u of existing) {
    console.log(`  ${u.email.padEnd(35)} ${u.role.padEnd(15)} ${u.department?.name ?? "(无部门)"}`);
  }

  // 每个部门一个测试账号（DEPT_CONTACT）
  // 若 email 已存在则跳过
  const toCreate: { code: string; email: string; name: string; password: string }[] = [
    { code: "FINANCE",   email: "finance@momenta.ai",   name: "财务对接人-李四",   password: "Finance@2025!"   },
    { code: "HR",        email: "hr@momenta.ai",        name: "人力资源对接人-赵六", password: "HR@2025!"       },
    { code: "LEGAL",     email: "legal@momenta.ai",     name: "法务对接人-孙七",   password: "Legal@2025!"    },
    { code: "RD",        email: "rd@momenta.ai",        name: "研发对接人-王五",   password: "RD@2025!"       },
    { code: "OPERATION", email: "operation@momenta.ai", name: "运营对接人-周八", password: "Operation@2025!" },
  ];

  const existingEmails = new Set(existing.map(u => u.email));
  const deptMap = new Map(depts.map(d => [d.code, d]));

  console.log("\n➕ 创建/跳过账号...");
  for (const spec of toCreate) {
    if (existingEmails.has(spec.email)) {
      console.log(`  ⏩ 跳过（已存在）: ${spec.email}`);
      continue;
    }
    const dept = deptMap.get(spec.code);
    if (!dept) {
      console.log(`  ⚠️  部门 ${spec.code} 不存在，跳过`);
      continue;
    }
    const hash = await bcrypt.hash(spec.password, 12);
    const user = await prisma.user.create({
      data: {
        name:         spec.name,
        email:        spec.email,
        role:         UserRole.DEPT_CONTACT,
        passwordHash: hash,
        departmentId: dept.id,
      },
    });
    // 设置部门联系人
    await prisma.department.update({
      where: { id: dept.id },
      data:  { contactUserId: user.id },
    });
    console.log(`  ✅ 创建成功: ${spec.email}  密码: ${spec.password}`);
  }

  console.log("\n🎉 完成！所有部门测试账号汇总：");
  console.log("─────────────────────────────────────────────────────────");
  console.log("角色            邮箱                                密码");
  console.log("─────────────────────────────────────────────────────────");
  console.log("超级管理员      admin@momenta.ai                   Admin@Momenta2025!");
  console.log("LPA 专员        specialist@momenta.ai              Specialist@2025!");
  console.log("财务部对接人    finance@momenta.ai                 Finance@2025!");
  console.log("人力资源对接人  hr@momenta.ai                      HR@2025!");
  console.log("法务部对接人    legal@momenta.ai                   Legal@2025!");
  console.log("研发部对接人    rd@momenta.ai                      RD@2025!");
  console.log("运营对接人      operation@momenta.ai               Operation@2025!");
  console.log("─────────────────────────────────────────────────────────");

  await prisma.$disconnect();
}

main().catch((e) => { console.error("❌ 失败:", e); process.exit(1); });
