/**
 * GET /api/system-config/public?keys=key1,key2
 *
 * 任意已登录用户均可读取指定的配置项（SUPER_ADMIN only 的写入接口保留在主路由）。
 * 首次访问某个 key 时，若数据库中不存在则自动写入默认值（seed-on-demand）。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// 所有允许公开读取的 key 及其默认值
const PUBLIC_DEFAULTS: Record<string, { value: string; description: string }> = {
  major_projects_title: {
    value:       "重大项目全管理",
    description: "重大项目页面主标题",
  },
  major_projects_subtitle: {
    value:       "Major Projects Full Management · 多视图智能看板",
    description: "重大项目页面副标题",
  },
  platform_name: {
    value:       "Momenta LPA 平台",
    description: "侧边栏顶部的平台名称",
  },
  external_report_subtitle: {
    value:       "告别繁琐的表格流转，大幅减少各部门的重复性填报工作。",
    description: "对外填报模块页面的副标题",
  },
  copilot_banner_title: {
    value:       "智库 Copilot 已就绪",
    description: "数据中台页面 Copilot 提示条主标题",
  },
  copilot_banner_subtitle: {
    value:       "可直接提问，如：「2025年Q1的专利总数是多少？」— 所有回答均附溯源链接",
    description: "数据中台页面 Copilot 提示条副标题",
  },
};

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });

  const rawKeys = req.nextUrl.searchParams.get("keys") ?? "";
  const requestedKeys = rawKeys
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (requestedKeys.length === 0)
    return NextResponse.json({ error: "请求体缺少 keys 参数" }, { status: 400 });

  // 只允许读取白名单内的 key
  const allowedKeys = requestedKeys.filter((k) => k in PUBLIC_DEFAULTS);

  // Seed-on-demand：找出 DB 中不存在的 key，批量写入默认值
  const existing = await prisma.systemConfig.findMany({
    where: { key: { in: allowedKeys } },
    select: { key: true, value: true },
  });
  const existingKeys = new Set(existing.map((c) => c.key));
  const missingKeys  = allowedKeys.filter((k) => !existingKeys.has(k));

  if (missingKeys.length > 0) {
    await prisma.systemConfig.createMany({
      data: missingKeys.map((k) => ({
        key:         k,
        value:       PUBLIC_DEFAULTS[k].value,
        description: PUBLIC_DEFAULTS[k].description,
      })),
      skipDuplicates: true,
    });
  }

  // 再查一次（含刚写入的默认值）
  const configs = await prisma.systemConfig.findMany({
    where:  { key: { in: allowedKeys } },
    select: { key: true, value: true },
  });

  return NextResponse.json({ configs });
}
