/**
 * POST /api/tasks/unarchive
 * 取消归档：将任务从 ARCHIVED 恢复为 IN_PROGRESS
 * 所有 ARCHIVED assignment 恢复为 PENDING_SEND（可重新发送邀请）
 * 两步更新包裹在同一事务中保证原子性
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { UserRole } from "@prisma/client";

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
    where: { id: taskId, deletedAt: null },
  });

  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (task.status !== "ARCHIVED") {
    return NextResponse.json({ error: "任务未归档，无需取消归档" }, { status: 422 });
  }

  // 事务：同时恢复 assignment + 任务状态，保证原子性
  await prisma.$transaction([
    // 所有已归档的 assignment → PENDING_SEND（PA 可重新发邀请）
    prisma.taskAssignment.updateMany({
      where: { taskId, status: "ARCHIVED" },
      data:  { status: "PENDING_SEND" },
    }),
    // 任务本身恢复为进行中，清空归档相关字段
    prisma.task.update({
      where: { id: taskId },
      data:  {
        status:     "IN_PROGRESS",
        archivedAt: null,
        lockedAt:   null,
        lockedById: null,
      },
    }),
  ]);

  await writeAuditLog({
    userId:       operatorId,
    action:       AuditAction.UPDATE_TASK,
    resourceType: "task",
    resourceId:   taskId,
    metadata:     { taskTitle: task.title, action: "unarchive" },
    isDangerous:  false,
    ipAddress:    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  });

  return NextResponse.json({
    success: true,
    message: `任务「${task.title}」已取消归档，各部门可重新发送邀请`,
  });
}
