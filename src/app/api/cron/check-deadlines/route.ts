/**
 * GET /api/cron/check-deadlines
 *
 * 每小时整点由 Vercel Cron 触发，执行 12h DDL 催办扫描。
 *
 * 业务逻辑：
 *   1. 查找 deadline 在 [now, now+12h] 之间的所有活跃任务
 *   2. 在这些任务的 assignments 中筛选：
 *      - status === PENDING_FILL（已发出邀请但尚未提交）
 *      - isReminderSent === false（尚未发过催办）
 *   3. 对每条符合条件的 assignment，查出所有指派人的 feishuOpenId
 *   4. 发送 REMINDER 模板卡片，成功后将 isReminderSent 置为 true
 *
 * 安全：
 *   - 生产环境校验 Authorization: Bearer $CRON_SECRET header
 *   - 开发环境跳过校验
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendTaskCard } from "@/lib/feishu";
import { logger } from "@/lib/logger";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://pa-platform-kappa.vercel.app";

export async function GET(req: NextRequest) {
  // ── 安全校验 ──────────────────────────────────────────────────
  if (process.env.NODE_ENV === "production") {
    const cronSecret = process.env.CRON_SECRET;
    const auth       = req.headers.get("authorization") ?? "";
    if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const now     = new Date();
  const in12h   = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  // ── 查询需要催办的 assignments ─────────────────────────────────
  const dueAssignments = await prisma.taskAssignment.findMany({
    where: {
      status:         "PENDING_FILL",
      isReminderSent: false,
      task: {
        deletedAt: null,
        status:    { notIn: ["ARCHIVED", "CANCELLED"] },
        deadline:  { gte: now, lte: in12h },  // deadline 在未来 12 小时内
      },
    },
    include: {
      task:       { select: { id: true, title: true, deadline: true, feishuSheetUrl: true } },
      department: { select: { name: true, headFeishuOpenId: true } },
    },
  });

  logger.info("check-deadlines scan", { time: now.toISOString(), count: dueAssignments.length });

  let sent    = 0;
  let failed  = 0;
  const errors: string[] = [];

  for (const a of dueAssignments) {
    // 收集该 assignment 所有指派人的 feishuOpenId
    const assigneeIds = (a.assigneeUserIds ?? []) as string[];
    const recipients: Array<{ name: string; feishuOpenId: string }> = [];

    if (assigneeIds.length > 0) {
      const users = await prisma.user.findMany({
        where:  { id: { in: assigneeIds }, feishuOpenId: { not: null }, isActive: true, deletedAt: null },
        select: { name: true, feishuOpenId: true },
      });
      for (const u of users) {
        if (u.feishuOpenId) recipients.push({ name: u.name, feishuOpenId: u.feishuOpenId });
      }
    }

    // Fallback：部门 headFeishuOpenId
    if (recipients.length === 0 && a.department.headFeishuOpenId) {
      recipients.push({ name: a.department.name, feishuOpenId: a.department.headFeishuOpenId });
    }

    if (recipients.length === 0) {
      logger.warn("No feishuOpenId for assignment, skipping", { assignmentId: a.id });
      continue;
    }

    const taskUrl  = `${APP_URL}/dashboard/tasks`;
    const deadline = a.task.deadline?.toISOString() ?? null;

    let allSuccess = true;
    for (const r of recipients) {
      try {
        await sendTaskCard({
          type:         "REMINDER",
          receiveId:    r.feishuOpenId,
          user_name:    r.name,
          project_name: a.task.title,
          deadline,
          fillUrl:      a.task.feishuSheetUrl ?? taskUrl,
        });
        sent++;
        logger.info("Reminder card sent", { recipient: r.name, task: a.task.title });
      } catch (err) {
        allSuccess = false;
        failed++;
        const msg = `${a.task.title} / ${r.name}: ${(err as Error).message}`;
        errors.push(msg);
        logger.error("Failed to send reminder card", err, { task: a.task.title, recipient: r.name });
      }
    }

    // 只有全部发送成功才标记已发，避免部分失败时漏发
    if (allSuccess) {
      await prisma.taskAssignment.update({
        where: { id: a.id },
        data:  { isReminderSent: true },
      });
    }
  }

  return NextResponse.json({
    ok:        true,
    scannedAt: now.toISOString(),
    window:    "12h",
    checked:   dueAssignments.length,
    sent,
    failed,
    errors:    errors.length > 0 ? errors : undefined,
  });
}
