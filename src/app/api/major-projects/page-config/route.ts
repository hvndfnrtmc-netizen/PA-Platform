/**
 * GET /api/major-projects/page-config  — 读取页面配置
 * PUT /api/major-projects/page-config  — 更新页面配置（非 DEPT_CONTACT）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const CONFIG_KEY = "major-projects_page_config";

interface QuickLink { title: string; url: string }
interface PageMeta  { title: string; description: string }
interface PageConfig {
  pageMeta:   PageMeta;
  quickLinks: QuickLink[];
}

const DEFAULT_CONFIG: PageConfig = {
  pageMeta:   { title: "重大项目管理", description: "项目全生命周期管理与追踪" },
  quickLinks: [],
};

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const configRow = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (configRow) {
    try {
      const stored = JSON.parse(configRow.value) as Partial<PageConfig>;
      return NextResponse.json({
        pageMeta:   { ...DEFAULT_CONFIG.pageMeta,   ...(stored.pageMeta   ?? {}) },
        quickLinks: Array.isArray(stored.quickLinks) ? stored.quickLinks : DEFAULT_CONFIG.quickLinks,
      });
    } catch {
      return NextResponse.json(DEFAULT_CONFIG);
    }
  }

  return NextResponse.json(DEFAULT_CONFIG);
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  await prisma.systemConfig.upsert({
    where:  { key: CONFIG_KEY },
    create: {
      key:         CONFIG_KEY,
      value:       JSON.stringify(body),
      description: "重大项目页面配置（pageMeta/quickLinks）",
    },
    update: { value: JSON.stringify(body) },
  });

  return NextResponse.json({ success: true });
}
