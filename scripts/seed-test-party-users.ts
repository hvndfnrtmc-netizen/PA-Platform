/**
 * 党员关系模块测试数据管理脚本
 *
 * 功能：
 *   1. 清空 party_transfer_records 和 party_transfer_out_requests 中的所有测试数据
 *   2. 创建 3 个测试账号（DEPT_CONTACT + hasPartyModuleAccess=true）
 *
 * 运行：
 *   cd pa-platform
 *   npx tsx scripts/seed-test-party-users.ts
 */

import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

async function main() {
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });

  // ── 1. 清空所有党员关系历史测试记录 ────────────────────────────

  const deletedRecords = await prisma.partyTransferRecord.deleteMany({});
  console.log(`🗑️  已清空 party_transfer_records：${deletedRecords.count} 条`);

  const deletedOutRequests = await prisma.partyTransferOutRequest.deleteMany({});
  console.log(`🗑️  已清空 party_transfer_out_requests：${deletedOutRequests.count} 条`);

  // ── 2. 创建 3 个测试账号 ────────────────────────────────────────

  const password = await bcrypt.hash("Test@1234!", 12);

  const testUsers = [
    { email: "test1@momenta.ai", name: "测试党员甲" },
    { email: "test2@momenta.ai", name: "测试党员乙" },
    { email: "test3@momenta.ai", name: "测试党员丙" },
  ];

  for (const u of testUsers) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name,
        passwordHash: password,
        role: UserRole.DEPT_CONTACT,
        hasPartyModuleAccess: true,
      },
      create: {
        email: u.email,
        name: u.name,
        passwordHash: password,
        role: UserRole.DEPT_CONTACT,
        hasPartyModuleAccess: true,
      },
    });
    console.log(`✅  账号已创建/更新：${user.name} <${user.email}>`);
  }

  console.log("\n🎉 完成！测试账号信息：");
  console.log("   邮箱              密码");
  console.log("   test1@momenta.ai  Test@1234!");
  console.log("   test2@momenta.ai  Test@1234!");
  console.log("   test3@momenta.ai  Test@1234!");
  console.log("\n   角色：DEPT_CONTACT（只能看到个人申请端，看不到审批工作台）");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("❌ 脚本执行失败：", e);
  process.exit(1);
});
