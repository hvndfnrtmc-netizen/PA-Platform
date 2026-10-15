/**
 * POST /api/webhook/qstash-reception
 *
 * QStash 延迟任务回调端点：时间到期后，QStash 主动 POST 回来。
 *
 * ── 安全机制 ──────────────────────────────────────────────────────────────────
 * 使用 @upstash/qstash/nextjs 的 verifySignatureAppRouter 中间件验证请求签名，
 * 确保请求来自 Upstash QStash 而非恶意伪造。
 *
 * ── 工作流程 ──────────────────────────────────────────────────────────────────
 * 1. 自动验证签名（中间件层，失败直接返回 401）
 * 2. 解析 payload（包含 receptionId / targetIds / fields / leaderIntroImages / meetingPhotoUrls）
 * 3. 调用 executeNotify 发送飞书卡片
 * 4. 更新数据库中对应 ScheduledNotification 状态为 SENT / FAILED
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { executeNotify, type SendNotifyPayload } from "@/lib/receptionNotify";

export const dynamic = "force-dynamic";

async function handler(req: NextRequest) {
  const startAt = Date.now();
  console.log("[QStash][Reception] ===== 收到回调请求 =====");
  console.log("[QStash][Reception] 触发时间（UTC）:", new Date().toISOString());

  // ── 1. 解析 payload ────────────────────────────────────────────
  let payload: SendNotifyPayload;
  try {
    const body = await req.json() as Partial<SendNotifyPayload>;
    if (!body.receptionId || !body.receptionTitle || !Array.isArray(body.targetIds) || !Array.isArray(body.fields)) {
      throw new Error("payload 格式不完整：缺少 receptionId / receptionTitle / targetIds / fields");
    }
    payload = body as SendNotifyPayload;
  } catch (err) {
    console.error("[QStash][Reception] ❌ payload 解析失败:", err);
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  console.log("[QStash][Reception] receptionId:", payload.receptionId);
  console.log("[QStash][Reception] targetIds:", payload.targetIds);
  console.log("[QStash][Reception] fields count:", payload.fields.length);

  // ── 2. 调用飞书发送逻辑 ────────────────────────────────────────
  let result: { sent: number; failed: number; errors: string[] };
  try {
    result = await executeNotify(payload);
    console.log("[QStash][Reception] executeNotify 完成 sent:", result.sent, "failed:", result.failed);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[QStash][Reception] ❌ executeNotify 失败:", errMsg);

    // 更新数据库状态为 FAILED（尽力而为，允许失败）
    await prisma.scheduledNotification.updateMany({
      where: { receptionId: payload.receptionId, status: "PENDING" },
      data:  { status: "FAILED", errorMessage: errMsg },
    }).catch(e => console.error("[QStash][Reception] ❌ 回写 FAILED 失败:", e));

    return NextResponse.json({ error: errMsg }, { status: 502 });
  }

  // ── 3. 更新数据库状态为 SENT ───────────────────────────────────
  // 注意：由于 QStash 不传回 ScheduledNotification.id，我们只能按 receptionId + PENDING 匹配
  // 若同一 reception 有多个 PENDING 记录，会全部更新为 SENT
  const updated = await prisma.scheduledNotification.updateMany({
    where: { receptionId: payload.receptionId, status: "PENDING" },
    data:  { status: "SENT", errorMessage: null },
  });
  console.log("[QStash][Reception] ✅ 数据库状态更新：", updated.count, "条记录标记为 SENT");

  if (result.sent === 0) {
    console.error("[QStash][Reception] ❌ 全部目标发送失败");
    return NextResponse.json({ error: "全部目标发送失败", errors: result.errors }, { status: 502 });
  }

  const elapsed = Date.now() - startAt;
  console.log(`[QStash][Reception] ===== END ===== 耗时=${elapsed}ms sent=${result.sent} failed=${result.failed}`);

  return NextResponse.json({
    ok:        true,
    sent:      result.sent,
    failed:    result.failed,
    errors:    result.errors.length > 0 ? result.errors : undefined,
    elapsedMs: elapsed,
  });
}

// 使用 verifySignatureAppRouter 包裹 handler，自动验证 QStash 签名。
// ⚠️ 必须懒初始化：verifySignatureAppRouter 在模块加载阶段就会读取
//    QSTASH_CURRENT_SIGNING_KEY / QSTASH_NEXT_SIGNING_KEY，若在顶层执行，
//    next build 收集页面数据时（未配置该 env）会直接抛错导致构建失败。
let _verifiedHandler: ((req: NextRequest) => Promise<Response>) | null = null;

export async function POST(req: NextRequest) {
  if (!_verifiedHandler) {
    _verifiedHandler = verifySignatureAppRouter(handler) as (
      req: NextRequest,
    ) => Promise<Response>;
  }
  return _verifiedHandler(req);
}
