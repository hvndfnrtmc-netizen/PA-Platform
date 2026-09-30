/**
 * POST /api/awards/migrate-from-projects
 * 将类别为「荣誉资质」的重大项目一键迁移到企业资质与奖项库
 * 仅 SUPER_ADMIN 可调用；具备幂等防重保护（通过 sourceProjectId 判断）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Prisma } from "@prisma/client";


export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "无权限，仅超级管理员可执行数据迁移" }, { status: 403 });
  }

  const userId = session.user.id;

  // 仅拉取类别为「荣誉资质」的重大项目
  const projects = await prisma.majorProject.findMany({
    where: {
      deletedAt: null,
      categoryDict: { value: "荣誉资质" },
    },
    include: {
      levelDict: true,
      companyEntityDict: true,
    },
  });

  let created = 0;
  let skipped = 0;

  for (const project of projects) {
    // 幂等防重：已迁移过的项目跳过
    const existing = await prisma.qualificationAward.findFirst({
      where: { sourceProjectId: project.id },
    });
    if (existing) {
      skipped++;
      continue;
    }

    // 类别：取项目级别（国家级、省级、市级、区级等）
    const category = project.levelDict?.value ?? project.level ?? "其他";

    // 资质主体：优先用多选名称数组第一个
    const awardeeEntity =
      project.companyEntityNames.length > 0
        ? project.companyEntityNames[0]
        : project.companyEntityDict?.value ?? "未知";

    // 授予时间/到账时间
    const awardedAt = project.receivedDate
      ? project.receivedDate.toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];
    const yearMatch = awardedAt.match(/\d{4}/);
    const awardedAtYear = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();

    await prisma.qualificationAward.create({
      data: {
        title:           project.name,
        awardedAt,
        awardedAtYear,
        awardedBy:       "",  // 授予单位留空，后续手动补充
        awardeeEntity,
        category,
        description:     null,
        attachments:     (project.proofMaterials as Prisma.InputJsonValue) ?? [],
        sourceProjectId: project.id,
        createdById:     userId,
      },
    });

    created++;
  }

  return NextResponse.json({
    message: "迁移完成",
    total:   projects.length,
    created,
    skipped,
  });
}
