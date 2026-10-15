/**
 * 一次性脚本：清空「落地协议」模块数据
 * 运行: npx tsx prisma/clear-agreement-data.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const adapter = new PrismaPg(process.env.DATABASE_URL!);
  const prisma = new PrismaClient({ adapter });

  // 由于外键关系（onDelete: Cascade），先清子表再清父表更稳妥；
  // Prisma 也支持直接删除父表，但显式顺序删除便于统计。
  const deletedKpis = await prisma.agreementKPI.deleteMany({});
  const deletedDeliverables = await prisma.agreementDeliverable.deleteMany({});
  const deletedAgreements = await prisma.landingAgreement.deleteMany({});
  const deletedAgreementData = await prisma.agreementData.deleteMany({});
  const deletedAgreementFiles = await prisma.agreementFile.deleteMany({});
  const deletedQualitativeObligations = await prisma.qualitativeObligation.deleteMany({});

  console.log("✅ 落地协议模块数据已清空");
  console.log("   AgreementKPI:            " + deletedKpis.count);
  console.log("   AgreementDeliverable:    " + deletedDeliverables.count);
  console.log("   LandingAgreement:        " + deletedAgreements.count);
  console.log("   AgreementData:           " + deletedAgreementData.count);
  console.log("   AgreementFile:           " + deletedAgreementFiles.count);
  console.log("   QualitativeObligation:   " + deletedQualitativeObligations.count);

  await prisma.$disconnect();
}

main()
  .catch((e) => {
    console.error("❌ 清空失败:", e);
    process.exit(1);
  });
