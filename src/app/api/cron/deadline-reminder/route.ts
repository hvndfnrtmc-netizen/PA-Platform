/**
 * GET /api/cron/deadline-reminder
 *
 * Vercel Cron Job — 每天 UTC 01:00（北京时间 09:00）执行。
 * 查找 24 小时内截止且仍有未提交分配的任务，向对应部门负责人发送飞书催办卡片。
 *
 * 安全：通过 CRON_SECRET 校验请求合法性（Vercel 自动注入 Authorization: Bearer）。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendCard, buildDeadlineReminderCard } from "@/lib/feishu";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // ── 校验 Cron 密钥 ────────────────────────────────────────────
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (process.env.NODE_ENV === "production" && auth !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now        = new Date();
  const in24h      = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  // 查找：deadline 在 24 小时内，且状态不是已归档/取消，且有未提交的分配
  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      status:    { notIn: ["ARCHIVED", "CANCELLED"] },
      deadline:  { gte: now, lte: in24h },
      assignments: {
        some: { status: { in: ["PENDING_FILL", "REJECTED"] } },
      },
    },
    include: {
      assignments: {
        where: { status: { in: ["PENDING_FILL", "REJECTED"] } },
        include: {
          department: {
            include: {
              contactUser: { select: { feishuUserId: true, name: true } },
            },
          },
        },
      },
    },
  });

  let sent = 0;
  for (const task of tasks) {
    for (const assignment of task.assignments) {
      const contactUser = assignment.department.contactUser;
      if (!contactUser?.feishuUserId) continue;

      const card = buildDeadlineReminderCard({
        taskTitle:      task.title,
        deadline:       task.deadline!.toISOString(),
        feishuSheetUrl: task.feishuSheetUrl,
        deptName:       assignment.department.name,
      });

      await sendCard(contactUser.feishuUserId, card);
      sent++;
    }
  }

  logger.info("Deadline reminder scan complete", { tasksChecked: tasks.length, notificationsSent: sent });
  return NextResponse.json({ ok: true, tasksChecked: tasks.length, notificationsSent: sent });
}
