/**
 * POST /api/tasks/[id]/assignments/[assignmentId]/invite
 *
 * 群发邀请卡片：读取 assigneeUserIds，查每个人的 feishuOpenId，
 * 逐一发送飞书邀请卡片，状态 PENDING_SEND → PENDING_FILL
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { sendTaskCard } from "@/lib/feishu";
import { writeAuditLog, AuditAction } from "@/lib/audit";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://pa-platform-kappa.vercel.app";

type Ctx = { params: Promise<{ id: string; assignmentId: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!["SUPER_ADMIN", "PA_SPECIALIST"].includes(session.user.role))
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id: taskId, assignmentId } = await params;

  const assignment = await prisma.taskAssignment.findFirst({
    where:   { id: assignmentId, taskId },
    include: { task: true, department: true },
  });

  if (!assignment) return NextResponse.json({ error: "分配记录不存在" }, { status: 404 });
  if (assignment.status !== "PENDING_SEND") {
    return NextResponse.json(
      { error: `当前状态为 ${assignment.status}，只有待发送状态可发邀请` },
      { status: 422 }
    );
  }

  // ── 解析指派人列表 ────────────────────────────────────────────
  const assigneeUserIds = (assignment.assigneeUserIds ?? []) as string[];

  // 查出所有指派人（只取有 feishuOpenId 的）
  let recipients: Array<{ name: string; feishuOpenId: string }> = [];

  if (assigneeUserIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: assigneeUserIds }, isActive: true, deletedAt: null },
      select: { id: true, name: true, feishuOpenId: true },
    });
    recipients = users
      .filter(u => u.feishuOpenId)
      .map(u => ({ name: u.name, feishuOpenId: u.feishuOpenId! }));

    if (recipients.length === 0) {
      return NextResponse.json(
        { error: `所选的 ${assigneeUserIds.length} 位用户均未配置飞书 open_id，无法发送。请在超级后台为其添加 open_id 后重试。` },
        { status: 422 }
      );
    }
  } else {
    // fallback：部门 headFeishuOpenId
    const deptOpenId = assignment.department.headFeishuOpenId;
    const deptName   = assignment.department.headName ?? assignment.department.name;
    if (!deptOpenId) {
      return NextResponse.json(
        { error: "未指定负责人且部门未配置 open_id，请在超级后台为用户添加飞书 open_id 后重试" },
        { status: 422 }
      );
    }
    recipients = [{ name: deptName, feishuOpenId: deptOpenId }];
  }

  // ── 获取管理员 open_id，构建卡片 ─────────────────────────────
  const sent:   string[] = [];
  const failed: string[] = [];

  for (const r of recipients) {
    try {
      await sendTaskCard({
        type:         "INVITE",
        receiveId:    r.feishuOpenId,
        user_name:    r.name,
        project_name: assignment.task.title,
        deadline:     assignment.task.deadline?.toISOString() ?? null,
        fillUrl:      assignment.task.feishuSheetUrl,
      });
      sent.push(r.name);
      console.log(`[invite] 模板卡片已发送 → ${r.name} (${r.feishuOpenId})`);
    } catch (err) {
      const msg = (err as Error).message;
      failed.push(`${r.name}: ${msg}`);
      console.error(`[invite] 发卡失败 → ${r.name}:`, msg);
    }
  }

  if (sent.length === 0) {
    return NextResponse.json(
      { error: `全部发送失败：${failed.join("；")}` },
      { status: 502 }
    );
  }

  // ── 更新状态 ───────────────────────────────────────────────────
  await prisma.taskAssignment.update({
    where: { id: assignmentId },
    data:  { status: "PENDING_FILL" },
  });

  const siblings = await prisma.taskAssignment.findMany({ where: { taskId } });
  const allSent  = siblings.every((a) => a.status !== "PENDING_SEND");
  if (allSent) {
    await prisma.task.update({
      where: { id: taskId },
      data:  { status: "IN_PROGRESS" },
    });
  }

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.UPDATE_TASK,
    resourceType: "task_assignment",
    resourceId:   assignmentId,
    metadata:     { action: "send_invite", sent, failed },
    ipAddress:    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
  }).catch(console.error);

  return NextResponse.json({
    ok:     true,
    sent:   sent.length,
    failed: failed.length > 0 ? failed : undefined,
    message: failed.length > 0
      ? `已向 ${sent.join("、")} 发送，${failed.length} 人发送失败`
      : `已向 ${sent.join("、")} 发送邀请卡片`,
  });
}
