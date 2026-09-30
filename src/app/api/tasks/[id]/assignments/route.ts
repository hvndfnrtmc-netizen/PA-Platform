/**
 * POST /api/tasks/[id]/assignments
 * 动态追加新成员到已有任务，初始状态 PENDING_SEND
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!["SUPER_ADMIN", "PA_SPECIALIST"].includes(session.user.role))
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id: taskId } = await params;
  const { deptId, assigneeUserIds } = await req.json() as {
    deptId:            string;
    assigneeUserIds?:  string[];
  };

  if (!deptId?.trim()) return NextResponse.json({ error: "deptId 不能为空" }, { status: 400 });

  const task = await prisma.task.findUnique({
    where: { id: taskId, deletedAt: null },
  });
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (task.status === "ARCHIVED") {
    return NextResponse.json({ error: "已归档任务不能追加成员" }, { status: 422 });
  }

  // 同一部门不允许重复添加（可以覆盖 assigneeOpenId）
  const existing = await prisma.taskAssignment.findUnique({
    where: { taskId_departmentId: { taskId, departmentId: deptId } },
  });

  let assignment;
  if (existing) {
    // 已存在则更新负责人信息（允许换人）
    assignment = await prisma.taskAssignment.update({
      where: { id: existing.id },
      data:  {
        assigneeUserIds: assigneeUserIds ?? (existing.assigneeUserIds as string[]),
        status:          existing.status === "ARCHIVED" ? "PENDING_SEND" : existing.status,
      },
    });
  } else {
    assignment = await prisma.taskAssignment.create({
      data: {
        taskId,
        departmentId:    deptId,
        assigneeUserIds: assigneeUserIds ?? [],
        status:          "PENDING_SEND",
      },
    });
  }

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.UPDATE_TASK,
    resourceType: "task_assignment",
    resourceId:   assignment.id,
    metadata:     { action: "add_assignment", deptId, assigneeUserIds },
    ipAddress:    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  }).catch(console.error);

  return NextResponse.json({ assignment }, { status: 201 });
}
