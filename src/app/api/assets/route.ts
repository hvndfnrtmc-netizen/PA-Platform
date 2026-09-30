/**
 * GET    /api/assets       — 资产列表
 * POST   /api/assets       — 新建资产条目
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { AssetCategory } from "@prisma/client";

function ip(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const q        = searchParams.get("q") ?? "";
  const category = searchParams.get("category") as AssetCategory | null;
  const take     = Math.min(Number(searchParams.get("take") ?? 50), 200);
  const skip     = Number(searchParams.get("skip") ?? 0);
  const taskId   = searchParams.get("taskId");

  const where = {
    ...(q ? { metricName: { contains: q, mode: "insensitive" as const } } : {}),
    ...(category ? { category } : {}),
    ...(taskId ? { sourceTaskId: taskId } : {}),
  };

  const [assets, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true } },
        sourceTask: { select: { id: true, title: true } },
        _count: { select: { versions: true } },
      },
      orderBy: [{ category: "asc" }, { period: "desc" }, { createdAt: "desc" }],
      take,
      skip,
    }),
    prisma.asset.count({ where }),
  ]);

  // 分类统计（不受筛选影响，用于侧边卡片）
  const categoryCountsRaw = await prisma.asset.groupBy({
    by: ["category"],
    _count: { id: true },
  });
  const categoryCounts: Record<string, number> = {};
  for (const row of categoryCountsRaw) {
    categoryCounts[row.category] = row._count.id;
  }

  writeAuditLog({
    userId: session.user.id,
    action: AuditAction.VIEW_ASSET,
    resourceType: "assets",
    metadata: { q, category, take, skip },
    ipAddress: ip(req),
  }).catch(console.error);

  return NextResponse.json({ assets, total, categoryCounts });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json();
  const {
    metricKey, metricName, category, value, unit,
    period, periodLabel, sourceFeishuUrl, sourceCellRef,
    sourceTaskId, confidence, isEncrypted,
  } = body;

  if (!metricKey?.trim()) return NextResponse.json({ error: "指标键名不能为空" }, { status: 400 });
  if (!metricName?.trim()) return NextResponse.json({ error: "指标名称不能为空" }, { status: 400 });
  if (!value?.trim()) return NextResponse.json({ error: "指标值不能为空" }, { status: 400 });
  if (!period?.trim()) return NextResponse.json({ error: "统计周期不能为空" }, { status: 400 });
  // RAG 防幻觉���制要求：每条数据必须有可溯源的飞书链接
  if (!sourceFeishuUrl?.trim()) return NextResponse.json({ error: "飞书溯源链接为必填项，每条数据必须有可追溯的来源 URL（RAG 防幻觉要求）" }, { status: 400 });

  const existing = await prisma.asset.findUnique({
    where: { metricKey_period: { metricKey: metricKey.trim(), period: period.trim() } },
  });
  if (existing) return NextResponse.json({ error: "该指标在此周期已存在" }, { status: 409 });

  const asset = await prisma.asset.create({
    data: {
      metricKey:      metricKey.trim(),
      metricName:     metricName.trim(),
      category:       (category ?? "MISC") as AssetCategory,
      value:          value.trim(),
      unit:           unit?.trim() ?? null,
      period:         period.trim(),
      periodLabel:    (periodLabel ?? period).trim(),
      sourceFeishuUrl: sourceFeishuUrl?.trim() ?? null,
      sourceCellRef:  sourceCellRef?.trim() ?? null,
      sourceTaskId:   sourceTaskId ?? null,
      confidence:     confidence ?? 1.0,
      isEncrypted:    isEncrypted ?? false,
      createdById:    session.user.id,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  });

  return NextResponse.json({ asset }, { status: 201 });
}
