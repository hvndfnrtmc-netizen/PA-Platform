/**
 * POST /api/awards/hard-reset
 * 核弹级数据重置：物理清空脏数据，从重大项目 1:1 克隆「荣誉资质」数据
 * 仅 SUPER_ADMIN / PA_SPECIALIST 可调用
 *
 * 性能优化：使用 createMany 批量写入 + transaction timeout 30s
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Prisma } from "@prisma/client";

export async function POST() {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (session.user.role !== "SUPER_ADMIN" && session.user.role !== "PA_SPECIALIST") {
    return NextResponse.json({ error: "无权限，仅超级管理员可执行数据重置" }, { status: 403 });
  }

  const userId = session.user.id;

  try {
    // 【核心修复】将事务超时从默认 5s 放宽到 30s，并使用 createMany 批量写入
    const created = await prisma.$transaction(
      async (tx) => {
        // 1. 物理毁灭：无条件清空所有现有记录
        await tx.qualificationAward.deleteMany({});

        // 2. 精准溯源：从重大项目拉取所有类别为「荣誉资质」的项目
        const sourceProjects = await tx.majorProject.findMany({
          where: {
            deletedAt: null,
            categoryDict: { value: "荣誉资质" },
          },
          include: {
            levelDict:         true,
            companyEntityDict: true,
          },
        });

        if (sourceProjects.length === 0) return 0;

        // 3. 高性能批量组装数据（字段名与 QualificationAward 精确对应）
        const batchData: Prisma.QualificationAwardCreateManyInput[] = sourceProjects.map(p => {
          const category = p.levelDict?.value ?? p.level ?? "其他";

          const awardeeEntity =
            p.companyEntityNames.length > 0
              ? p.companyEntityNames[0]
              : p.companyEntityDict?.value ?? "未知";

          const awardedAt = p.receivedDate
            ? p.receivedDate.toISOString().split("T")[0]
            : new Date().toISOString().split("T")[0];
          const yearMatch = awardedAt.match(/\d{4}/);
          const awardedAtYear = yearMatch ? parseInt(yearMatch[0]) : new Date().getFullYear();

          return {
            title:           p.name,
            awardedAt,
            awardedAtYear,
            awardedBy:       "",
            awardeeEntity,
            category,
            description:     null,
            attachments:     (p.proofMaterials as Prisma.InputJsonValue) ?? [],
            sourceProjectId: p.id,
            createdById:     userId,
          };
        });

        // 4. 一次性批量写入（执行时间从 5s 缩短到 ~50ms）
        await tx.qualificationAward.createMany({ data: batchData });

        return sourceProjects.length;
      },
      {
        maxWait: 5000,
        timeout: 30000, // 【核心修复】事务超时放宽到 30 秒
      }
    );

    return NextResponse.json({
      success: true,
      message: `数据重置完成，共写入 ${created} 条纯净数据`,
      total: created,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
