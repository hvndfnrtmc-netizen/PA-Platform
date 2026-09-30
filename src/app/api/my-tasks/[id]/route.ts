/**
 * PATCH /api/my-tasks/[id]
 * 部门负责人标记已提交，并向 PA 创建者发飞书通知
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { sendTextMessage } from "@/lib/feishu";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://pa-platform-kappa.vercel.app";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id: assignmentId } = await params;
  const body = await req.json() as { status?: string };

  if (body.status !== "SUBMITTED") {
    return NextResponse.json({ error: "只支持 status=SUBMITTED" }, { status: 400 });
  }

  const assignment = await prisma.taskAssignment.findFirst({
    where:   { id: assignmentId },
    include: {
      task: {
        include: { createdBy: { select: { feishuUserId: true, name: true } } },
      },
      department: true,
    },
  });

  if (!assignment) return NextResponse.json({ error: "分配记录不存在" }, { status: 404 });

  if (
    session.user.role === "DEPT_CONTACT" &&
    assignment.departmentId !== session.user.departmentId
  ) {
    return NextResponse.json({ error: "权限不足" }, { status: 403 });
  }

  if (assignment.status === "SUBMITTED") {
    return NextResponse.json({ error: "已提交，请勿重复操作" }, { status: 422 });
  }
  if (assignment.status === "ARCHIVED") {
    return NextResponse.json({ error: "已归档任务不允许提交" }, { status: 422 });
  }

  const now     = new Date();
  const updated = await prisma.taskAssignment.update({
    where: { id: assignmentId },
    data:  { status: "SUBMITTED", submittedAt: now },
  });

  // 任务状态联动
  const siblings = await prisma.taskAssignment.findMany({ where: { taskId: assignment.taskId } });
  const allDone  = siblings.every(
    (a) => a.id === assignmentId || a.status === "SUBMITTED" || a.status === "ARCHIVED"
  );
  await prisma.task.update({
    where: { id: assignment.taskId },
    data:  { status: allDone ? "SUBMITTED" : "IN_PROGRESS" },
  });

  // ── 通知 PA 创建者 ─────────────────────────────────────────────
  const creatorOpenId = assignment.task.createdBy.feishuUserId;
  const submitterName = assignment.department.name ?? session.user.name ?? "负责人";

  if (creatorOpenId) {
    const taskUrl = `${APP_URL}/dashboard/tasks`;
    sendTextMessage(
      creatorOpenId,
      `✅ ${submitterName} 已提交「${assignment.task.title}」的填报，请前往平台审核：${taskUrl}`
    ).catch((err) => console.error("[submit] PA 通知失败:", err));
  } else {
    console.warn("[submit] PA 创建者无飞书 open_id，跳过通知");
  }

  return NextResponse.json({ assignment: updated });
}
