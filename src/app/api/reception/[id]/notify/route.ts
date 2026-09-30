/**
 * POST   /api/reception/[id]/notify   立即或定时发送飞书卡片通知
 * DELETE /api/reception/[id]/notify   撤回尚未发送的定时通知（调用 QStash 删除并标记 CANCELLED）
 *
 * POST Body:
 *   fields:              NotifyField[]  — 要推送的字段列表
 *   targetIds?:          string[]       — 飞书目标 ID（群/个人），fallback 到环境变量
 *   leaderIntroImages?:  string[]       — 领导介绍图片 URL 列表（后端转 image_key）
 *   meetingPhotoUrls?:   string[]       — 会议照片 URL 列表（后端转 image_key，展示为折叠面板）
 *   scheduledAt?:        string         — ISO 8601，有则定时发送，无则立即发送
 */

import { NextRequest, NextResponse } from "next/server";
import { Client } from "@upstash/qstash";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import {
  executeNotify,
  type NotifyField,
  type SendNotifyPayload,
} from "@/lib/receptionNotify";

type Params = { params: Promise<{ id: string }> };

function ip(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT") return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const reception = await prisma.reception.findUnique({ where: { id, deletedAt: null } });
  if (!reception) return NextResponse.json({ error: "接待记录不存在" }, { status: 404 });

  const body = await req.json() as {
    fields?:             NotifyField[];
    targetIds?:          unknown;
    leaderIntroImages?:  unknown;
    meetingPhotoUrls?:   unknown;
    scheduledAt?:        unknown;
  };

  const fields: NotifyField[] = Array.isArray(body.fields)
    ? body.fields.filter(f => f.label && f.value)
    : [];
  if (fields.length === 0) return NextResponse.json({ error: "请至少选择一个字段" }, { status: 400 });

  // ── 解析目标 ID ──────────────────────────────────────────────
  let targetIds: string[] = [];
  if (Array.isArray(body.targetIds) && body.targetIds.length > 0) {
    targetIds = (body.targetIds as unknown[])
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map(v => v.trim());
  }
  if (targetIds.length === 0) {
    const envRaw = process.env.FEISHU_RECEPTION_NOTIFY_CHAT_ID ?? "";
    targetIds = envRaw.split(",").map(s => s.trim()).filter(Boolean);
  }
  if (targetIds.length === 0)
    return NextResponse.json({ error: "请输入至少一个目标飞书 ID，或联系管理员配置默认推送群" }, { status: 400 });

  const leaderIntroImages: string[] = Array.isArray(body.leaderIntroImages)
    ? (body.leaderIntroImages as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const meetingPhotoUrls: string[] = Array.isArray(body.meetingPhotoUrls)
    ? (body.meetingPhotoUrls as unknown[]).filter((v): v is string => typeof v === "string")
    : [];

  const payload: SendNotifyPayload = {
    receptionId:      reception.id,
    receptionTitle:   reception.title,
    fields,
    targetIds,
    leaderIntroImages,
    meetingPhotoUrls,
  };

  // ── 定时发送分流：投递 QStash 延迟任务（SDK 模式）─────────────
  if (body.scheduledAt && typeof body.scheduledAt === "string") {
    const scheduledAt = new Date(body.scheduledAt);

    console.log("[Notify][schedule] 前端传入 scheduledAt（原始）:", body.scheduledAt);
    console.log("[Notify][schedule] 解析后 scheduledAt（UTC）:", scheduledAt.toISOString());
    console.log("[Notify][schedule] 当前服务器时间（UTC）:", new Date().toISOString());
    console.log("[Notify][schedule] 时间差（秒）:", Math.round((scheduledAt.getTime() - Date.now()) / 1000));

    if (isNaN(scheduledAt.getTime())) {
      console.error("[Notify][schedule] ❌ scheduledAt 格式无效");
      return NextResponse.json({ error: "scheduledAt 格式无效，请使用 ISO 8601 格式" }, { status: 400 });
    }
    if (scheduledAt.getTime() <= Date.now()) {
      console.error("[Notify][schedule] ❌ scheduledAt 已过期:", scheduledAt.toISOString(), "当前:", new Date().toISOString());
      return NextResponse.json({ error: "计划发送时间必须晚于当前时间" }, { status: 400 });
    }

    const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
    if (!QSTASH_TOKEN) {
      console.error("[Notify][schedule] ❌ QSTASH_TOKEN 未配置");
      return NextResponse.json({ error: "系统未配置 QStash，无法定时发送" }, { status: 500 });
    }

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://pa-platform-kappa.vercel.app";
    const callbackUrl = `${APP_URL}/api/webhook/qstash-reception`;

    console.log("[Notify][schedule] 即将投递 QStash payload keys:", Object.keys(payload));
    console.log("[Notify][schedule] targetIds:", payload.targetIds);
    console.log("[Notify][schedule] fields count:", payload.fields.length);
    console.log("[Notify][schedule] callback URL:", callbackUrl);

    // 使用 QStash SDK 投递延迟任务
    try {
      const qstash = new Client({ token: QSTASH_TOKEN });
      const result = await qstash.publishJSON({
        url:       callbackUrl,
        body:      payload,
        notBefore: Math.floor(scheduledAt.getTime() / 1000), // Unix 时间戳（秒）
      });

      const messageId = result.messageId;
      console.log("[Notify][schedule] ✅ QStash 投递成功 messageId:", messageId);

      // 写入数据库，同时将 qstashMessageId 存为专用字段（便于撤回）
      const record = await prisma.scheduledNotification.create({
        data: {
          receptionId:     reception.id,
          scheduledAt,
          status:          "PENDING",
          payload:         JSON.parse(JSON.stringify(payload)),
          qstashMessageId: messageId,
          createdById:     session.user.id,
        },
      });
      console.log("[Notify][schedule] ✅ 入库成功 id:", record.id, "scheduledAt:", record.scheduledAt.toISOString());

      writeAuditLog({
        userId:       session.user.id,
        action:       AuditAction.UPDATE_RECEPTION,
        resourceType: "reception",
        resourceId:   reception.id,
        metadata:     { action: "schedule_notify", scheduledAt: scheduledAt.toISOString(), qstashMessageId: messageId },
        ipAddress:    ip(req),
      }).catch(console.error);

      // 显式指定 Asia/Shanghai 时区格式化，避免 Vercel/UTC 环境下时间显示偏移 8 小时
      const displayTime = new Intl.DateTimeFormat("zh-CN", {
        timeZone:  "Asia/Shanghai",
        year:      "numeric",
        month:     "2-digit",
        day:       "2-digit",
        hour:      "2-digit",
        minute:    "2-digit",
        hour12:    false,
      }).format(scheduledAt);

      return NextResponse.json({
        scheduled:   true,
        scheduledAt: scheduledAt.toISOString(),
        message:     `定时通知已就绪，将于 ${displayTime}（北京时间）发送`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[Notify][schedule] ❌ QStash SDK 投递失败:", errMsg);
      return NextResponse.json({ error: `QStash 投递失败：${errMsg}` }, { status: 502 });
    }
  }

  // ── 立即发送 ─────────────────────────────────────────────────
  const result = await executeNotify(payload);

  if (result.sent === 0) {
    return NextResponse.json({ error: result.errors[0] ?? "全部发送失败" }, { status: 502 });
  }

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.UPDATE_RECEPTION,
    resourceType: "reception",
    resourceId:   reception.id,
    metadata:     { action: "notify", sent: result.sent, failed: result.failed },
    ipAddress:    ip(req),
  }).catch(console.error);

  return NextResponse.json({
    sent:   result.sent,
    failed: result.failed,
    errors: result.errors.length > 0 ? result.errors : undefined,
  });
}

// ── DELETE /api/reception/[id]/notify — 批量撤回定时通知 ───────
//
// Body: { notificationIds: string[] }  — 要撤回的 ScheduledNotification.id 数组
//       （为空时降级为撤回该接待的所有 PENDING 通知）

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT") return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const reception = await prisma.reception.findUnique({ where: { id, deletedAt: null } });
  if (!reception) return NextResponse.json({ error: "接待记录不存在" }, { status: 404 });

  // 解析请求体中的 notificationIds（允许 body 为空 → 撤回全部）
  let requestedIds: string[] = [];
  try {
    const body = await req.json() as { notificationIds?: unknown };
    if (Array.isArray(body.notificationIds) && body.notificationIds.length > 0) {
      requestedIds = (body.notificationIds as unknown[]).filter((v): v is string => typeof v === "string");
    }
  } catch {
    // body 为空或非 JSON —— 降级为全部撤回，不报错
  }

  // 查询符合条件的待撤回通知
  const notifications = await prisma.scheduledNotification.findMany({
    where: {
      receptionId:     id,
      status:          "PENDING",
      qstashMessageId: { not: null },
      ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
    },
    select: { id: true, qstashMessageId: true, scheduledAt: true },
  });

  if (notifications.length === 0) {
    return NextResponse.json({ error: "未找到待撤回的定时通知，可能已发送或已撤回" }, { status: 404 });
  }

  const QSTASH_TOKEN = process.env.QSTASH_TOKEN;
  if (!QSTASH_TOKEN) {
    return NextResponse.json({ error: "系统未配置 QStash，无法撤回" }, { status: 500 });
  }

  const qstash = new Client({ token: QSTASH_TOKEN });

  // 并行调用 QStash 删除，单条失败不阻塞其余
  const qstashResults = await Promise.allSettled(
    notifications.map(async (n) => {
      try {
        await qstash.messages.delete(n.qstashMessageId!);
        console.log("[Notify][cancel] ✅ QStash 消息已删除 messageId:", n.qstashMessageId);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        // 404 / not found → 消息已触发，视为成功（继续更新 DB）
        if (errMsg.toLowerCase().includes("not found") || errMsg.includes("404")) {
          console.warn("[Notify][cancel] 消息可能已触发，继续标记 CANCELLED id:", n.id);
          return;
        }
        throw err; // 其他错误向上抛
      }
    }),
  );

  // 统计 QStash 操作结果
  const qstashFailed = qstashResults
    .map((r, i) => r.status === "rejected"
      ? { id: notifications[i].id, error: r.reason instanceof Error ? r.reason.message : String(r.reason) }
      : null)
    .filter((x): x is { id: string; error: string } => x !== null);

  // 将 QStash 操作成功（或 404 忽略）的通知 ID 批量更新数据库
  const cancelledIds = notifications
    .filter((n) => !qstashFailed.find(f => f.id === n.id))
    .map(n => n.id);

  if (cancelledIds.length > 0) {
    await prisma.scheduledNotification.updateMany({
      where: { id: { in: cancelledIds } },
      data:  { status: "CANCELLED", qstashMessageId: null },
    });
  }

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.CANCEL_RECEPTION_NOTIFY,
    resourceType: "reception",
    resourceId:   reception.id,
    metadata:     {
      cancelledIds,
      failedIds: qstashFailed.map(f => f.id),
      scheduledAts: notifications.map(n => n.scheduledAt.toISOString()),
    },
    ipAddress:    ip(req),
  }).catch(console.error);

  if (cancelledIds.length === 0) {
    return NextResponse.json({
      error: `全部撤回失败：${qstashFailed[0]?.error ?? "未知错误"}`,
    }, { status: 502 });
  }

  return NextResponse.json({
    cancelled: cancelledIds.length,
    failed:    qstashFailed.length,
    message:   qstashFailed.length === 0
      ? `已成功撤回 ${cancelledIds.length} 条定时提醒`
      : `撤回 ${cancelledIds.length} 条成功，${qstashFailed.length} 条失败`,
  });
}
