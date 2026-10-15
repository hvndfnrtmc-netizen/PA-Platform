/**
 * 一次性脚本：按年份清空「落地协议」模块 2024、2025 年数据
 * 运行: npx tsx prisma/clear-agreement-data-by-year.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });

  const years = [2024, 2025];

  // 先删子表中带 year 的记录
  const deletedKpis = await prisma.agreementKPI.deleteMany({
    where: { year: { in: years } },
  });

  // AgreementData 的 period 格式为 "YYYY-MM"
  const deletedAgreementData = await prisma.agreementData.deleteMany({
    where: {
      OR: years.map((y) => ({ period: { startsWith: String(y) } })),
    },
  });

  const deletedAgreementFiles = await prisma.agreementFile.deleteMany({
    where: { year: { in: years } },
  });

  // 删除 2024/2025 年起始的协议；其 deliverables 通过 onDelete: Cascade 级联删除
  const deletedAgreements = await prisma.landingAgreement.deleteMany({
    where: { startYear: { in: years } },
  });

  console.log("✅ 落地协议模块 2024/2025 年数据已清空");
  console.log("   AgreementKPI (year=2024/2025):       " + deletedKpis.count);
  console.log("   AgreementData (period=2024/2025):    " + deletedAgreementData.count);
  console.log("   AgreementFile (year=2024/2025):      " + deletedAgreementFiles.count);
  console.log("   LandingAgreement (startYear=2024/25): " + deletedAgreements.count);

  await prisma.$disconnect();
}

main()
  .catch((e) => {
    console.error("❌ 清空失败:", e);
    process.exit(1);
  });
