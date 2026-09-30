/**
 * GET  /api/system-config  — 获取全部配置项（SUPER_ADMIN only）
 * POST /api/system-config  — 新增配置项（SUPER_ADMIN only）
 *
 * GET 首次访问时若表为空，自动插入默认配置（Seed-on-demand）。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";

function getIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

// ── 默认配置（表为空时自动写入） ──────────────────────────────
const DEFAULT_CONFIGS = [
  {
    key:         "platform_name",
    value:       "Momenta LPA 平台",
    description: "侧边栏顶部的平台名称",
  },
  {
    key:         "external_report_subtitle",
    value:       "告别繁琐的表格流转，大幅减少各部门的重复性填报工作。",
    description: "对外填报模块页面的副标题",
  },
  {
    key:         "empty_state_contact",
    value:       "如有疑问，欢迎随时联系 PA 运营专员",
    description: "列表为空时的联系提示语",
  },
  {
    key:         "copilot_banner_title",
    value:       "智库 Copilot 已就绪",
    description: "数据中台页面 Copilot 提示条主标题",
  },
  {
    key:         "copilot_banner_subtitle",
    value:       "可直接提问，如：「2025年Q1的专利总数是多少？」— 所有回答均附溯源链接",
    description: "数据中台页面 Copilot 提示条副标题",
  },
  {
    key:         "party_module_contact",
    value:       "如需办理相关业务，请联系超级管理员开通个人授权",
    description: "党员关系模块无权限时的提示语",
  },
  {
    key:         "major_projects_title",
    value:       "重大项目全管理",
    description: "重大项目页面主标题",
  },
  {
    key:         "major_projects_subtitle",
    value:       "Major Projects Full Management · 多视图智能看板",
    description: "重大项目页面副标题",
  },
];

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可查看配置" }, { status: 403 });

  // Seed-on-demand：表为空时写入默认配置
  const count = await prisma.systemConfig.count();
  if (count === 0) {
    await prisma.systemConfig.createMany({ data: DEFAULT_CONFIGS });
  }

  const configs = await prisma.systemConfig.findMany({
    orderBy: { updatedAt: "asc" },
  });

  return NextResponse.json({ configs });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可新增配置" }, { status: 403 });

  let body: { key?: unknown; value?: unknown; description?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (typeof body.key   !== "string" || !body.key.trim())
    return NextResponse.json({ error: "配置键名 key 不能为空" }, { status: 400 });
  if (typeof body.value !== "string" || !body.value.trim())
    return NextResponse.json({ error: "文案内容 value 不能为空" }, { status: 400 });

  const keyClean = body.key.trim();
  const existing = await prisma.systemConfig.findUnique({ where: { key: keyClean } });
  if (existing)
    return NextResponse.json({ error: `键名 "${keyClean}" 已存在，请直接编辑或更换键名` }, { status: 409 });

  const config = await prisma.systemConfig.create({
    data: {
      key:         keyClean,
      value:       (body.value as string).trim(),
      description: typeof body.description === "string" && body.description.trim()
                     ? body.description.trim()
                     : null,
    },
  });

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.GLOBAL_CONFIG,
    resourceType: "system_config",
    resourceId:   keyClean,
    isDangerous:  true,
    metadata:     { action: "create", key: keyClean, value: config.value },
    ipAddress:    getIp(req),
  }).catch(console.error);

  return NextResponse.json({ config }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可修改配置" }, { status: 403 });

  let body: { updates?: Array<{ key: string; value: string }> };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const updates = body.updates;
  if (!Array.isArray(updates) || updates.length === 0)
    return NextResponse.json({ error: "updates 不能为空" }, { status: 400 });

  for (const u of updates) {
    if (typeof u.key !== "string" || !u.key.trim())
      return NextResponse.json({ error: "每项 key 不能为空" }, { status: 400 });
    if (typeof u.value !== "string" || !u.value.trim())
      return NextResponse.json({ error: `key "${u.key}" 的 value 不能为空` }, { status: 400 });
  }

  // 批量 Upsert：存在则更新，不存在则创建
  const results = await prisma.$transaction(
    updates.map(u =>
      prisma.systemConfig.upsert({
        where:  { key: u.key.trim() },
        update: { value: u.value.trim() },
        create: { key: u.key.trim(), value: u.value.trim() },
      })
    )
  );

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.GLOBAL_CONFIG,
    resourceType: "system_config",
    resourceId:   "bulk_upsert",
    isDangerous:  true,
    metadata:     { count: updates.length, keys: updates.map(u => u.key) },
    ipAddress:    getIp(req),
  }).catch(console.error);

  return NextResponse.json({ updated: results.length });
}
