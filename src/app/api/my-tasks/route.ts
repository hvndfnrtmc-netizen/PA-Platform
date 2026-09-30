/**
 * GET /api/my-tasks
 *
 * 业务部门专属接口：只返回当前登录人所属部门的任务分配记录。
 *
 * 安全设计（数据隔离三道防线）：
 *   ① 角色检查：只有 DEPT_CONTACT 可调用，PA 角色使用全量任务接口
 *   ② 部门绑定：departmentId 严格从 session.user.departmentId 取得，
 *      客户端不得传入任何 departmentId 参数，防止越权查询
 *   ③ 查询层过滤：WHERE departmentId = session.departmentId，
 *      数据库层面隔离，任何情况下都不会返回其他部门数据
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";

export async function GET(req: NextRequest) {
  // ── 1. 鉴权：必须登录 ─────────────────────────────────────────
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id: userId, role, departmentId } = session.user;

  // ── 2. 角色检查：仅 DEPT_CONTACT 使用此接口 ──────────────────
  // PA 角色使用 /dashboard/tasks 的完整视图，不走此接口
  if (role !== "DEPT_CONTACT") {
    return NextResponse.json(
      { error: "此接口专为业务部门对接人设计，PA 角色请使用管理后台" },
      { status: 403 }
    );
  }

  // ── 3. 部门检查：必须有绑定部门 ──────────────────────────────
  if (!departmentId) {
    return NextResponse.json(
      { error: "你的账号尚未绑定业务部门，请联系 PA 管理员配置" },
      { status: 422 }
    );
  }

  // ── 4. 核心查询：只查本部门的 task_assignments ────────────────
  // departmentId 完全来自 session，客户端无法干预
  const rawAssignments = await prisma.taskAssignment.findMany({
    where: {
      departmentId, // ← 铁律：只能是自己的部门
      task: { deletedAt: null },
    },
    include: {
      task: {
        select: {
          id: true,
          title: true,
          description: true,
          type: true,
          status: true,
          deadline: true,
          feishuSheetUrl: true,
          feishuSpreadsheetToken: true,
          deptPermissions: true,
          createdAt: true,
        },
      },
    },
    orderBy: [
      { task: { deadline: "asc" } },
      { createdAt: "desc" },
    ],
  });

  // 计算每条 assignment 对应本部门的权限等级，过滤掉 "none" 权限的任务
  const assignments = rawAssignments
    .map((a) => {
      const perms = a.task.deptPermissions as Record<string, string> | null;
      // 归档任务未配置权限时默认 "view"，需管理员主动授权才能编辑
      // 非归档任务未配置权限时默认 "edit"（正常填报流程）
      const defaultPerm = a.task.status === "ARCHIVED" ? "view" : "edit";
      const permLevel: "edit" | "view" | "none" = perms
        ? ((perms[departmentId] ?? defaultPerm) as "edit" | "view" | "none")
        : defaultPerm;
      return { ...a, permLevel };
    })
    .filter((a) => a.permLevel !== "none"); // "none" 权限：对部门完全隐藏

  // ── 5. 统计数据 ───────────────────────────────────────────────
  const stats = {
    total:        assignments.length,
    pendingSend:  assignments.filter((a) => a.status === "PENDING_SEND").length,
    pendingFill:  assignments.filter((a) => a.status === "PENDING_FILL").length,
    submitted:    assignments.filter((a) => a.status === "SUBMITTED").length,
    rejected:     assignments.filter((a) => a.status === "REJECTED").length,
    archived:     assignments.filter((a) => a.status === "ARCHIVED").length,
    urgent:       assignments.filter((a) => {
      if (!a.task.deadline) return false;
      const daysLeft = (new Date(a.task.deadline).getTime() - Date.now()) / 86400000;
      return daysLeft <= 3 && (a.status === "PENDING_FILL" || a.status === "REJECTED");
    }).length,
  };

  // ── 6. 写审计日志（非阻塞）────────────────────────────────────
  writeAuditLog({
    userId,
    action: AuditAction.VIEW_DASHBOARD,
    resourceType: "my_tasks",
    metadata: { departmentId, taskCount: assignments.length },
    ipAddress:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      undefined,
  }).catch((e) => console.error("[my-tasks] 审计日志写入失败:", e));

  return NextResponse.json({ assignments, stats, departmentId });
}
