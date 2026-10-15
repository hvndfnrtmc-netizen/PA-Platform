/**
 * 一次性脚本：创建虚拟登录账号（SUPER_ADMIN）
 * 仅用于本地体验平台，数据无需种子。
 * 运行: node --env-file=.env --import=tsx/esm prisma/create-virtual-admin.ts
 */
import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

async function main() {
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });

  const email = "admin@ruiqishenkong.com";
  const name = "瑞启深空 管理员";
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    throw new Error("ADMIN_PASSWORD 未在 .env 中设置");
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
      deletedAt: null,
    },
    create: {
      email,
      name,
      passwordHash,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  console.log("✅ 虚拟账号已就绪");
  console.log("   邮箱:   " + user.email);
  console.log("   姓名:   " + user.name);
  console.log("   角色:   " + user.role);
  console.log("   id:     " + user.id);
}

main()
  .catch((e) => {
    console.error("❌ 创建失败:", e);
    process.exit(1);
  });
