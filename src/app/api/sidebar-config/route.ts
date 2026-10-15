/**
 * GET  /api/sidebar-config  — 读取侧边栏显示配置（SUPER_ADMIN only）
 * PUT  /api/sidebar-config  — 保存侧边栏显示配置（SUPER_ADMIN only）
 *
 * 存储：system_configs 表，key = SIDEBAR_CONFIG_KEY（JSON 字符串）
 *
 * 说明：
 *   - 侧边栏本身不调本接口 —— dashboard/layout.tsx 直接读库后以 props 下传，
 *     避免客户端二次请求造成的「先渲染全部菜单再闪一下」。
 *   - 本接口只服务「超级后台 → 侧边栏菜单」配置面板。
 *   - 本配置仅控制菜单入口的渲染，不删除任何路由与数据。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import {
  SIDEBAR_CONFIG_KEY,
  DEFAULT_SIDEBAR_CONFIG,
  normalizeSidebarConfig,
  parseSidebarConfig,
  serializeSidebarConfig,
} from "@/lib/sidebar-config";

function getIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

async function requireSuperAdmin() {
  const session = await getSession();
  if (!session?.user) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  if (session.user.role !== "SUPER_ADMIN")
    return { error: NextResponse.json({ error: "仅超级管理员可配置侧边栏菜单" }, { status: 403 }) };
  return { session };
}

export async function GET() {
  const gate = await requireSuperAdmin();
  if ("error" in gate) return gate.error;

  try {
    const row = await prisma.systemConfig.findUnique({ where: { key: SIDEBAR_CONFIG_KEY } });

    // Seed-on-demand：表内不存在时写入默认配置
    if (!row) {
      await prisma.systemConfig.create({
        data: {
          key:         SIDEBAR_CONFIG_KEY,
          value:       serializeSidebarConfig(DEFAULT_SIDEBAR_CONFIG),
          description: "侧边栏菜单显示配置（全局开关 / 角色范围 / 账号白名单）",
        },
      });
      return NextResponse.json({
        config: DEFAULT_SIDEBAR_CONFIG,
        unconfigured: true,
      });
    }

    return NextResponse.json({ config: parseSidebarConfig(row.value) });
  } catch (err) {
    console.error("[sidebar-config] GET 失败:", err);
    return NextResponse.json({ error: "读取配置失败" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireSuperAdmin();
  if ("error" in gate) return gate.error;
  const session = gate.session!;

  let body: { config?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!body.config || typeof body.config !== "object")
    return NextResponse.json({ error: "缺少 config 字段" }, { status: 400 });

  // 白名单里的邮箱统一小写，避免大小写不一致导致匹配失败
  const config = normalizeSidebarConfig(body.config);

  // 校验：账号白名单里的 moduleId 必须非空；邮箱格式做一次宽松校验
  const emails = Object.keys(config.accountWhitelist);
  const badEmail = emails.find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
  if (badEmail)
    return NextResponse.json({ error: `账号邮箱格式不合法：${badEmail}` }, { status: 400 });

  const value = serializeSidebarConfig(config);
  if (value.length > 20000)
    return NextResponse.json({ error: "配置内容过大" }, { status: 400 });

  try {
    await prisma.systemConfig.upsert({
      where:  { key: SIDEBAR_CONFIG_KEY },
      update: { value },
      create: {
        key:         SIDEBAR_CONFIG_KEY,
        value,
        description: "侧边栏菜单显示配置（全局开关 / 角色范围 / 账号白名单）",
      },
    });

    writeAuditLog({
      userId:       session.user.id,
      action:       AuditAction.GLOBAL_CONFIG,
      resourceType: "system_config",
      resourceId:   SIDEBAR_CONFIG_KEY,
      isDangerous:  true,
      metadata: {
        action:          "update",
        hiddenCount:     Object.values(config.global).filter((v) => v === false).length,
        restrictedRoles: Object.keys(config.roleScope).length,
        accountCount:    emails.length,
      },
      ipAddress: getIp(req),
    }).catch(console.error);

    return NextResponse.json({ ok: true, config });
  } catch (err) {
    console.error("[sidebar-config] PUT 失败:", err);
    return NextResponse.json({ error: "保存配置失败" }, { status: 500 });
  }
}
