/**
 * POST /api/reception/[id]/admin-order-notify
 *
 * 行政支持工单专用飞书通知接口。
 * 与普通接待通知不同，该接口使用橙色表头、定制卡片结构。
 *
 * Body:
 *   fields:      Array<{ label: string; value: string }>  — 组装好的内容字段
 *   targetIds:   string[]                                  — 飞书群/个人 ID
 *   meetingTime: string                                    — 会议时间字符串（用于卡片标题）
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { sendCardToTarget } from "@/lib/receptionNotify";

type Params = { params: Promise<{ id: string }> };

// ── 卡片构建 ──────────────────────────────────────────────────────────────────

function buildAdminOrderCard(
  meetingTime: string,
  receptionId: string,
  fields:      Array<{ label: string; value: string }>,
  mentionIds:  string[],
): object {
  const APP_URL  = process.env.NEXT_PUBLIC_APP_URL ?? "https://pa-platform-kappa.vercel.app";
  const elements: object[] = [];

  // 构建个人 @Mention 字符串（仅使用前端明确选中要 @ 的人员 ID）
  const personalIds = mentionIds.filter(id => id.startsWith("ou_") || id.startsWith("on_"));
  const atString    = personalIds.map(id => `<at id="${id}"></at>`).join(" ");
  const greeting    = atString
    ? `${atString} ✨ **您好！本次重要接待需要Admin团队的支持，辛苦您帮忙统筹阿姨们提前准备以下会场物资，非常感谢！** 🌹`
    : "✨ **您好！本次重要接待需要Admin团队的支持，辛苦您帮忙统筹阿姨们提前准备以下会场物资，非常感谢！** 🌹";

  // 顶部问候语
  elements.push({
    tag:     "markdown",
    content: greeting,
  });
  elements.push({ tag: "hr" });

  // 会议背景模块：会议地点 + 参会人数
  const locationField = fields.find(f => f.label === "📍 会议地点");
  const countField    = fields.find(f => f.label === "👥 参会人数");
  if (locationField || countField) {
    const bgLines: string[] = [];
    if (locationField) bgLines.push(`**📍 会议地点：** ${locationField.value}`);
    if (countField)    bgLines.push(`**👥 参会人数：** ${countField.value}`);
    elements.push({
      tag:     "markdown",
      content: `**📍 会议背景**\n${bgLines.join("\n")}`,
    });
  }

  // 其余字段（物资明细、补充说明等），跳过已渲染的字段和"📅 会议时间"
  const rendered = new Set(["📅 会议时间", "📍 会议地点", "👥 参会人数"]);
  for (const f of fields.filter(f => !rendered.has(f.label))) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: `**${f.label}**\n${f.value}` });
  }

  elements.push({ tag: "hr" });
  elements.push({
    tag:     "markdown",
    content: `👉 **[一键跳转应用平台查看详细信息](${APP_URL}/dashboard/reception?id=${receptionId})**`,
  });

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      template: "orange",
      title:    { content: `🛎️ 【${meetingTime || "待确认"}】重要政府接待`, tag: "plain_text" },
    },
    body: { elements },
  };
}

// ── Route Handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const reception = await prisma.reception.findUnique({ where: { id, deletedAt: null } });
  if (!reception) return NextResponse.json({ error: "接待记录不存在" }, { status: 404 });

  let body: { fields?: unknown; targetIds?: unknown; mentionIds?: unknown; meetingTime?: unknown };
  try {
    body = await req.json() as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
  }

  const fields: Array<{ label: string; value: string }> = Array.isArray(body.fields)
    ? (body.fields as Array<{ label: string; value: string }>).filter(f => f.label && f.value)
    : [];
  if (fields.length === 0)
    return NextResponse.json({ error: "请至少包含一个内容字段" }, { status: 400 });

  const targetIds: string[] = Array.isArray(body.targetIds)
    ? (body.targetIds as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  if (targetIds.length === 0)
    return NextResponse.json({ error: "请至少选择一个通知目标" }, { status: 400 });

  const mentionIds: string[] = Array.isArray(body.mentionIds)
    ? (body.mentionIds as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];

  const meetingTime = typeof body.meetingTime === "string" ? body.meetingTime : "";

  const card    = buildAdminOrderCard(meetingTime, reception.id, fields, mentionIds);
  const results = await Promise.allSettled(targetIds.map(tid => sendCardToTarget(tid, card)));
  const failed  = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

  return NextResponse.json({
    sent:   results.length - failed.length,
    failed: failed.length,
    errors: failed.map(r => r.reason instanceof Error ? r.reason.message : String(r.reason)),
  });
}
