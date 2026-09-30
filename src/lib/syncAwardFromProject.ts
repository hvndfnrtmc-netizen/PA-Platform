/**
 * syncAwardFromProject
 *
 * 当重大项目类别为「荣誉资质」时，自动同步一条对应的 QualificationAward 记录。
 * 使用 findFirst + create/update 实现幂等写入（sourceProjectId 无 @unique 约束）。
 */

import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export async function syncAwardFromProject(projectId: string, userId: string): Promise<void> {
  const project = await prisma.majorProject.findUnique({
    where: { id: projectId },
    include: {
      categoryDict: true,
      levelDict:    true,
    },
  });

  if (!project || project.deletedAt) return;
  if (project.categoryDict?.value !== "荣誉资质") return;

  const category      = project.levelDict?.value ?? project.level ?? "其他";
  const awardeeEntity = project.companyEntityNames.length > 0
    ? project.companyEntityNames[0]
    : "未知";

  const awardedAt = project.receivedDate
    ? project.receivedDate.toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];
  const yearMatch     = awardedAt.match(/\d{4}/);
  const awardedAtYear = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();

  const existing = await prisma.qualificationAward.findFirst({
    where:  { sourceProjectId: projectId },
    select: { id: true },
  });

  if (existing) {
    await prisma.qualificationAward.update({
      where: { id: existing.id },
      data: {
        title:        project.name,
        category,
        awardeeEntity,
        awardedAt,
        awardedAtYear,
        attachments:  (project.proofMaterials as Prisma.InputJsonValue) ?? [],
      },
    });
  } else {
    await prisma.qualificationAward.create({
      data: {
        title:           project.name,
        category,
        awardeeEntity,
        awardedAt,
        awardedAtYear,
        awardedBy:       "",
        description:     null,
        attachments:     (project.proofMaterials as Prisma.InputJsonValue) ?? [],
        sourceProjectId: projectId,
        createdById:     userId,
      },
    });
  }
}
