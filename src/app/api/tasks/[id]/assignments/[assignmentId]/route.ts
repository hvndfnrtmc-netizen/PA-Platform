/**
 * PATCH /api/tasks/[id]/assignments/[assignmentId]
 * 独立驳回单条 assignment，发飞书驳回卡片
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { sendTaskCard } from "@/lib/feishu";
import { writeAuditLog, AuditAction } from "@/lib/audit";

// APP_URL 由 sendTaskCard 内部处理，此处不再需要

type Ctx = { params: Promise<{ id: string; assignmentId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!["SUPER_ADMIN", "PA_SPECIALIST"].includes(session.user.role))
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id: taskId, assignmentId } = await params;
  const { rejectNote } = await req.json() as { rejectNote?: string };

  if (!rejectNote?.trim())
    return NextResponse.json({ error: "驳回原因不能为空" }, { status: 400 });

  const assignment = await prisma.taskAssignment.findFirst({
    where:   { id: assignmentId, taskId },
    include: { task: true, department: true },
  });

  if (!assignment) return NextResponse.json({ error: "分配记录不存在" }, { status: 404 });
  if (assignment.status !== "SUBMITTED") {
    return NextResponse.json({ error: "只能驳回已提交的记录" }, { status: 422 });
  }

  // ── 发驳回卡片：查指派人 feishuOpenId，fallback 部门 headFeishuOpenId ──
  const assigneeUserIds = (assignment.assigneeUserIds ?? []) as string[];
  let recipientOpenId: string | null = null;
  let recipientName = assignment.department.headName ?? assignment.department.name;

  if (assigneeUserIds.length > 0) {
    const firstUser = await prisma.user.findFirst({
      where: { id: { in: assigneeUserIds }, feishuOpenId: { not: null } },
      select: { name: true, feishuOpenId: true },
    });
    if (firstUser?.feishuOpenId) {
      recipientOpenId = firstUser.feishuOpenId;
      recipientName   = firstUser.name;
    }
  } else {
    recipientOpenId = assignment.department.headFeishuOpenId ?? null;
  }

  if (recipientOpenId) {
    try {
      await sendTaskCard({
        type:           "REJECT",
        receiveId:      recipientOpenId,
        user_name:      recipientName,
        project_name:   assignment.task.title,
        feedback_notes: rejectNote.trim(),
        deadline:       assignment.task.deadline?.toISOString() ?? null,
        fillUrl:        assignment.task.feishuSheetUrl,
      });
    } catch (err) {
      console.error("[reject] 驳回卡片发送失败:", err);
      return NextResponse.json(
        { error: `驳回卡片发送失败：${(err as Error).message}` },
        { status: 502 }
      );
    }
  }

  // ── 更新状态 ───────────────────────────────────────────────────
  const now     = new Date();
  const updated = await prisma.taskAssignment.update({
    where: { id: assignmentId },
    data:  {
      status:       "REJECTED",
      rejectNote:   rejectNote.trim(),
      rejectedById: session.user.id,
      rejectedAt:   now,
    },
  });

  await prisma.task.update({
    where: { id: taskId },
    data:  { status: "IN_PROGRESS" },
  });

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.UPDATE_TASK,
    resourceType: "task_assignment",
    resourceId:   assignmentId,
    metadata:     { action: "reject", rejectNote: rejectNote.trim() },
    isDangerous:  true,
    ipAddress:    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  }).catch(console.error);

  return NextResponse.json({ assignment: updated });
}
