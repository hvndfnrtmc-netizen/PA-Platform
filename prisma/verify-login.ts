/**
 * 校验虚拟账号密码是否可通过登录逻辑（bcrypt.compare），不打印任何密码。
 */
import "dotenv/config";
import { PrismaClient, UserRole } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

async function main() {
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });

  const email = "admin@ruiqishenkong.com";
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) throw new Error("ADMIN_PASSWORD 未设置");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.log("RESULT: account_missing");
    return;
  }
  const ok = user.passwordHash ? await bcrypt.compare(pw, user.passwordHash) : false;
  console.log("RESULT: " + (ok ? "login_ok" : "password_mismatch"));
  console.log("isActive: " + user.isActive);
  console.log("role: " + user.role);
}

main().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
