/**
 * GET /api/page-config?pageId=xxx  — 读取页面配置
 * PUT /api/page-config?pageId=xxx  — 更新页面配置（非 DEPT_CONTACT）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

interface QuickLink { name: string; url: string }

const DEFAULTS: Record<string, { title: string; description: string }> = {
  "major-projects":           { title: "重大项目管理",          description: "项目全生命周期管理与追踪" },
  "awards":                   { title: "企业资质与奖项库",       description: "历年政府奖项、资质认证与行业荣誉" },
  "honor_and_qualifications": { title: "企业资质与奖项库",       description: "历年政府奖项、资质认证与行业荣誉，证明附件可直接预览" },
  "odc":                      { title: "ODC 政企关系网络",       description: "全国政务资源对接矩阵、政策情报中枢与沟通网络" },
  "agreement-tracking":       { title: "落地协议追踪与对赌管理", description: "协议核心 KPI 动态追踪、红绿灯预警及履约凭证管理" },
  "assets":                   { title: "数据中台",               description: "核心指标汇聚与溯源" },
};

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const pageId = req.nextUrl.searchParams.get("pageId") ?? "";
  if (!pageId) return NextResponse.json({ error: "缺少 pageId" }, { status: 400 });

  const row = await prisma.pageConfig.findUnique({ where: { pageId } });
  const def = DEFAULTS[pageId] ?? { title: pageId, description: "" };

  if (row) {
    let links: QuickLink[] = [];
    try { links = Array.isArray(row.links) ? (row.links as unknown as QuickLink[]) : JSON.parse(String(row.links)); } catch { /* empty */ }
    let customData: Record<string, unknown> = {};
    try { customData = (typeof row.customData === "object" && row.customData !== null) ? row.customData as Record<string, unknown> : {}; } catch { /* empty */ }
    return NextResponse.json({ title: row.title || def.title, description: row.description ?? def.description, links, customData });
  }

  return NextResponse.json({ title: def.title, description: def.description, links: [], customData: {} });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const pageId = req.nextUrl.searchParams.get("pageId") ?? "";
  if (!pageId) return NextResponse.json({ error: "缺少 pageId" }, { status: 400 });

  let body: { title?: string; description?: string; links?: QuickLink[]; customData?: Record<string, unknown> };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  // Fetch existing to merge customData (avoid overwriting unrelated keys)
  const existing = await prisma.pageConfig.findUnique({ where: { pageId } });
  const prevCustom = (existing?.customData && typeof existing.customData === "object") ? existing.customData as Record<string, unknown> : {};
  const mergedCustom = body.customData !== undefined
    ? { ...prevCustom, ...body.customData }
    : prevCustom;

  await prisma.pageConfig.upsert({
    where:  { pageId },
    create: {
      pageId,
      title:       body.title       ?? "",
      description: body.description ?? null,
      links:       (body.links ?? []) as object[],
      customData:  mergedCustom as object,
    },
    update: {
      ...(body.title       !== undefined && { title:       body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.links       !== undefined && { links:       body.links as object[] }),
      customData: mergedCustom as object,
    },
  });

  return NextResponse.json({ success: true });
}
