/**
 * GET    /api/assets/[id]  — 资产详情
 * PUT    /api/assets/[id]  — 更新资产（创建版本快照）
 * DELETE /api/assets/[id]  — 删除资产（hard delete，走版本保留）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { AssetCategory } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

function ip(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await ctx.params;
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, name: true } },
      sourceTask: { select: { id: true, title: true } },
      versions: {
        include: { changedBy: { select: { id: true, name: true } } },
        orderBy: { changedAt: "desc" },
        take: 10,
      },
    },
  });
  if (!asset) return NextResponse.json({ error: "资产不存在" }, { status: 404 });

  return NextResponse.json({ asset });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await ctx.params;
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "资产不存在" }, { status: 404 });

  const body = await req.json();
  const { metricName, category, value, unit, period, periodLabel, sourceFeishuUrl, confidence, changeReason } = body;

  // 如果 value 改变，记录版本历史
  if (value !== undefined && value !== existing.value) {
    await prisma.assetVersion.create({
      data: {
        assetId:      id,
        oldValue:     existing.value,
        newValue:     value,
        changeReason: changeReason ?? null,
        changedById:  session.user.id,
      },
    });
  }

  const updated = await prisma.asset.update({
    where: { id },
    data: {
      ...(metricName !== undefined ? { metricName: metricName.trim() } : {}),
      ...(category !== undefined ? { category: category as AssetCategory } : {}),
      ...(value !== undefined ? { value: value.trim() } : {}),
      ...(unit !== undefined ? { unit: unit?.trim() ?? null } : {}),
      ...(period !== undefined ? { period: period.trim() } : {}),
      ...(periodLabel !== undefined ? { periodLabel: periodLabel.trim() } : {}),
      ...(sourceFeishuUrl !== undefined ? { sourceFeishuUrl: sourceFeishuUrl?.trim() ?? null } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    },
    include: { createdBy: { select: { id: true, name: true } } },
  });

  writeAuditLog({
    userId: session.user.id,
    action: AuditAction.EXPORT_ASSET,
    resourceType: "asset",
    resourceId: id,
    metadata: { metricName: updated.metricName, changedFields: Object.keys(body) },
    ipAddress: ip(req),
  }).catch(console.error);

  return NextResponse.json({ asset: updated });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可删除资产" }, { status: 403 });

  const { id } = await ctx.params;
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "资产不存在" }, { status: 404 });

  await prisma.asset.delete({ where: { id } });

  writeAuditLog({
    userId: session.user.id,
    action: AuditAction.VIEW_ASSET,
    resourceType: "asset",
    resourceId: id,
    isDangerous: true,
    metadata: { metricName: existing.metricName, period: existing.period, action: "DELETE" },
    ipAddress: ip(req),
  }).catch(console.error);

  return NextResponse.json({ ok: true });
}
