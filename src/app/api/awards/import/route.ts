/**
 * POST /api/awards/import
 * 批量导入奖项记录（批量去重 + createMany）
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { writeAuditLog, AuditAction } from "@/lib/audit";

interface ImportRow {
  title: string;
  awardedAt: string;
  awardedBy: string;
  awardeeEntity: string;
  category?: string;
  importanceLevel?: number;
  regionLabel?: string;
  description?: string;
  sourceFeishuUrl?: string;
}

function extractYear(awardedAt: string): number {
  const match = awardedAt.match(/(\d{4})/);
  return match ? Number(match[1]) : new Date().getFullYear();
}

function normalizeCategory(raw?: string): string {
  if (!raw) return "AWARD";
  const v = raw.trim().toUpperCase();
  if (v === "QUALIFICATION" || raw.includes("资质") || raw.includes("认证")) return "QUALIFICATION";
  if (v === "HONOR" || raw.includes("荣誉")) return "HONOR";
  return "AWARD";
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { records } = await req.json() as { records: ImportRow[] };

  if (!Array.isArray(records) || records.length === 0)
    return NextResponse.json({ error: "导入数据不能为空" }, { status: 400 });

  if (records.length > 200)
    return NextResponse.json({ error: "单次最多导入 200 条" }, { status: 400 });

  // 验证必填字段
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (!r.title?.trim())         return NextResponse.json({ error: `第 ${i + 1} 行：奖项名称不能为空` }, { status: 400 });
    if (!r.awardedAt?.trim())     return NextResponse.json({ error: `第 ${i + 1} 行：获奖时间不能为空` }, { status: 400 });
    if (!r.awardedBy?.trim())     return NextResponse.json({ error: `第 ${i + 1} 行：授予单位不能为空` }, { status: 400 });
    if (!r.awardeeEntity?.trim()) return NextResponse.json({ error: `第 ${i + 1} 行：获奖主体不能为空` }, { status: 400 });
  }

  // 计算每条记录的年份（一次性，避免重复计算）
  const withYear = records.map(r => ({ ...r, year: extractYear(r.awardedAt) }));

  // 批量查询已存在的记录（一次 DB round-trip）
  const existing = await prisma.qualificationAward.findMany({
    where: {
      isActive:  true,
      deletedAt: null,
      OR: withYear.map(r => ({
        title:         { equals: r.title.trim(), mode: "insensitive" as const },
        awardedAtYear: r.year,
      })),
    },
    select: { title: true, awardedAtYear: true },
  });

  // 构建去重 Set：key = `${title.toLowerCase()}::${year}`
  const existingSet = new Set(
    existing.map(e => `${e.title.trim().toLowerCase()}::${e.awardedAtYear}`),
  );

  const toInsert: typeof withYear = [];
  let duplicates = 0;

  for (const r of withYear) {
    const key = `${r.title.trim().toLowerCase()}::${r.year}`;
    if (existingSet.has(key)) {
      duplicates++;
    } else {
      toInsert.push(r);
      existingSet.add(key); // 防止本批次内自我重复
    }
  }

  // 批量写入（一次 DB round-trip）
  const result = toInsert.length > 0
    ? await prisma.qualificationAward.createMany({
        data: toInsert.map(r => ({
          title:          r.title.trim(),
          awardedAt:      r.awardedAt.trim(),
          awardedAtYear:  r.year,
          awardedBy:      r.awardedBy.trim(),
          awardeeEntity:  r.awardeeEntity.trim(),
          category:       normalizeCategory(r.category),
          importanceLevel: Number(r.importanceLevel) || 3,
          regionLabel:    r.regionLabel?.trim() || null,
          description:    r.description?.trim() || null,
          sourceFeishuUrl: r.sourceFeishuUrl?.trim() || null,
          attachments:    [],
          createdById:    session.user.id,
        })),
        skipDuplicates: true,
      })
    : { count: 0 };

  const inserted = result.count;

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.CREATE_AWARD,
    resourceType: "QualificationAward",
    metadata:     { imported: inserted, duplicates, source: "bulk_import" },
    isDangerous:  false,
  }).catch(console.error);

  return NextResponse.json({ inserted, duplicates, errors: [], total: records.length });
}
