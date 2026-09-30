/**
 * GET /api/reception/quick-links  — 读取顶部快捷链接配置（任意已登录用户）
 * PUT /api/reception/quick-links  — 更新快捷链接配置（非 DEPT_CONTACT）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const CONFIG_KEY = "reception_quick_links";

interface QuickLink { title: string; url: string }

const DEFAULT_LINKS: QuickLink[] = [
  { title: "接待流程指引", url: "" },
  { title: "展厅讲解",     url: "" },
  { title: "展车讲解",     url: "" },
  { title: "接待信息备份", url: "" },
];

function parseLinks(raw: string): QuickLink[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_LINKS;
    return (parsed as unknown[]).map((item, i) => ({
      title: typeof (item as QuickLink).title === "string" ? (item as QuickLink).title : (DEFAULT_LINKS[i]?.title ?? ""),
      url:   typeof (item as QuickLink).url   === "string" ? (item as QuickLink).url   : "",
    }));
  } catch {
    return DEFAULT_LINKS;
  }
}

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const config = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  const links = config ? parseLinks(config.value) : DEFAULT_LINKS;
  return NextResponse.json({ links });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  let body: { links?: unknown };
  try {
    body = await req.json() as { links?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!Array.isArray(body.links))
    return NextResponse.json({ error: "links 必须是数组" }, { status: 400 });

  const links: QuickLink[] = (body.links as unknown[]).map((item, i) => ({
    title: typeof (item as QuickLink).title === "string" ? (item as QuickLink).title : (DEFAULT_LINKS[i]?.title ?? ""),
    url:   typeof (item as QuickLink).url   === "string" ? (item as QuickLink).url   : "",
  }));

  await prisma.systemConfig.upsert({
    where:  { key: CONFIG_KEY },
    create: { key: CONFIG_KEY, value: JSON.stringify(links), description: "接待页面顶部快捷链接" },
    update: { value: JSON.stringify(links) },
  });

  return NextResponse.json({ success: true, links });
}
