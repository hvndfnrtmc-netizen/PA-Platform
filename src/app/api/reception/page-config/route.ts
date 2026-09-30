/**
 * GET /api/reception/page-config  — 读取完整页面配置
 * PUT /api/reception/page-config  — 更新完整页面配置（非 DEPT_CONTACT）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const CONFIG_KEY = "reception_page_config";
const LEGACY_LINKS_KEY = "reception_quick_links";

interface QuickLink { title: string; url: string }
interface DrawerField { key: string; label: string; visible: boolean; order: number; isCustom?: boolean; type?: string }
interface PageMeta { title: string; description: string }
interface PageConfig {
  pageMeta:     PageMeta;
  quickLinks:   QuickLink[];
  drawerFields: DrawerField[];
}

const DEFAULT_DRAWER_FIELDS: DrawerField[] = [
  { key: "title",       label: "会议名称 / 来访人员", visible: true, order: 1  },
  { key: "startTime",   label: "开始时间",            visible: true, order: 2  },
  { key: "endTime",     label: "结束时间",             visible: true, order: 3  },
  { key: "level",       label: "接待级别",             visible: true, order: 4  },
  { key: "status",      label: "状态",                 visible: true, order: 5  },
  { key: "host",        label: "主接待人",             visible: true, order: 6  },
  { key: "dressCode",   label: "着装要求",             visible: true, order: 7  },
  { key: "formats",     label: "接待形式",             visible: true, order: 8  },
  { key: "purpose",     label: "来访/会议目的",        visible: true, order: 9  },
  { key: "background",  label: "来访/会议背景",        visible: true, order: 10 },
  { key: "address",     label: "地址",                 visible: true, order: 11 },
  { key: "leaderIntro", label: "领导介绍",             visible: true, order: 12 },
  { key: "remarks",     label: "备注",                 visible: true, order: 13 },
];

const DEFAULT_QUICK_LINKS: QuickLink[] = [
  { title: "接待流程指引", url: "" },
  { title: "展厅讲解",     url: "" },
  { title: "展车讲解",     url: "" },
  { title: "接待信息备份", url: "" },
];

const DEFAULT_CONFIG: PageConfig = {
  pageMeta:     { title: "政府接待", description: "接待记录管理与归档" },
  quickLinks:   DEFAULT_QUICK_LINKS,
  drawerFields: DEFAULT_DRAWER_FIELDS,
};

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  // 优先读取新的统一配置
  const configRow = await prisma.systemConfig.findUnique({ where: { key: CONFIG_KEY } });
  if (configRow) {
    try {
      const stored = JSON.parse(configRow.value) as Partial<PageConfig>;
      return NextResponse.json({
        pageMeta:     { ...DEFAULT_CONFIG.pageMeta,     ...(stored.pageMeta     ?? {}) },
        quickLinks:   Array.isArray(stored.quickLinks)   ? stored.quickLinks   : DEFAULT_CONFIG.quickLinks,
        drawerFields: Array.isArray(stored.drawerFields) ? stored.drawerFields : DEFAULT_CONFIG.drawerFields,
      });
    } catch {
      return NextResponse.json(DEFAULT_CONFIG);
    }
  }

  // 回退：迁移旧的 quick-links 配置（已有数据不丢失）
  const legacyRow = await prisma.systemConfig.findUnique({ where: { key: LEGACY_LINKS_KEY } });
  if (legacyRow) {
    try {
      const legacyLinks = JSON.parse(legacyRow.value) as QuickLink[];
      return NextResponse.json({
        ...DEFAULT_CONFIG,
        quickLinks: Array.isArray(legacyLinks) ? legacyLinks : DEFAULT_CONFIG.quickLinks,
      });
    } catch {
      // 忽略解析失败，使用默认值
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
      description: "接待页面完整配置（pageMeta/quickLinks/drawerFields）",
    },
    update: { value: JSON.stringify(body) },
  });

  return NextResponse.json({ success: true });
}
