/**
 * POST /api/tasks/lock
 * 归档任务：向所有参与人发送完结感谢卡片，更新所有分配记录为 ARCHIVED
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { UserRole } from "@prisma/client";
import { sendTaskCard } from "@/lib/feishu";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://pa-platform-kappa.vercel.app";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id: operatorId, role } = session.user;
  if (role !== UserRole.SUPER_ADMIN && role !== UserRole.PA_SPECIALIST) {
    return NextResponse.json({ error: "权限不足" }, { status: 403 });
  }

  let taskId: string;
  try {
    ({ taskId } = await req.json() as { taskId: string });
    if (!taskId) throw new Error("missing taskId");
  } catch {
    return NextResponse.json({ error: "请求体缺少 taskId" }, { status: 400 });
  }

  const task = await prisma.task.findUnique({
    where:   { id: taskId, deletedAt: null },
    include: {
      assignments: {
        include: { department: true },
      },
    },
  });

  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (task.status === "ARCHIVED") {
    return NextResponse.json({ error: "任务已归档" }, { status: 422 });
  }

  const now = new Date();

  // ── 向所有已接受邀请的成员发送完结感谢卡（Template ID 模式）────
  const cardErrors: string[] = [];

  for (const a of task.assignments) {
    if (a.status === "PENDING_SEND") continue; // 从未接触，不发

    // 取指派人中第一个有 feishuOpenId 的用户，fallback 部门 head
    const assigneeIds = (a.assigneeUserIds ?? []) as string[];
    let recipientOpenId: string | null = null;
    let recipientName = a.department.headName ?? a.department.name;
    if (assigneeIds.length > 0) {
      const u = await prisma.user.findFirst({
        where: { id: { in: assigneeIds }, feishuOpenId: { not: null } },
        select: { name: true, feishuOpenId: true },
      });
      if (u?.feishuOpenId) { recipientOpenId = u.feishuOpenId; recipientName = u.name; }
    } else {
      recipientOpenId = a.department.headFeishuOpenId ?? null;
    }

    if (!recipientOpenId) continue;

    try {
      await sendTaskCard({
        type:         "COMPLETE",
        receiveId:    recipientOpenId,
        user_name:    recipientName,
        project_name: task.title,
        fillUrl:      task.feishuSheetUrl,
      });
    } catch (err) {
      const msg = `${recipientName}: ${(err as Error).message}`;
      cardErrors.push(msg);
      console.error("[lock] 归档卡发送失败:", msg);
    }
  }

  // ── 更新数据库 ────────────────────────────────────────────────
  await prisma.taskAssignment.updateMany({
    where: { taskId },
    data:  { status: "ARCHIVED" },
  });

  await prisma.task.update({
    where: { id: taskId },
    data:  {
      status:     "ARCHIVED",
      lockedAt:   now,
      lockedById: operatorId,
      archivedAt: now,
    },
  });

  await writeAuditLog({
    userId:       operatorId,
    action:       AuditAction.LOCK_TASK,
    resourceType: "task",
    resourceId:   taskId,
    metadata:     { taskTitle: task.title, cardErrors },
    isDangerous:  false,
    ipAddress:    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });

  return NextResponse.json({
    success:    true,
    cardErrors: cardErrors.length > 0 ? cardErrors : undefined,
    message:    cardErrors.length > 0
      ? `归档成功，但有 ${cardErrors.length} 个卡片发送失败`
      : `任务「${task.title}」已归档`,
  });
}
