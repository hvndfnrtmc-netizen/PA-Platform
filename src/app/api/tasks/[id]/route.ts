/**
 * GET    /api/tasks/[id]  — 任务详情
 * PUT    /api/tasks/[id]  — 更新任务
 * DELETE /api/tasks/[id]  — 软删除任务
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { TaskStatus, TaskType } from "@prisma/client";

type Ctx = { params: Promise<{ id: string }> };

function ip(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

async function findTask(id: string) {
  return prisma.task.findFirst({
    where: { id, deletedAt: null },
    include: {
      createdBy: { select: { id: true, name: true } },
      assignments: {
        include: {
          department: { select: { id: true, name: true, code: true } },
        },
      },
    },
  });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!["SUPER_ADMIN", "PA_SPECIALIST"].includes(session.user.role))
    return NextResponse.json({ error: `权限不足：当前账号角色为 ${session.user.role}，需要 PA 专员或超级管理员权限` }, { status: 403 });

  const { id } = await ctx.params;
  const task = await findTask(id);
  if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  return NextResponse.json({ task });
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!["SUPER_ADMIN", "PA_SPECIALIST"].includes(session.user.role))
    return NextResponse.json({ error: `权限不足：当前账号角色为 ${session.user.role}，需要 PA 专员或超级管理员权限` }, { status: 403 });

  const { id } = await ctx.params;
  const existing = await findTask(id);
  if (!existing) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  const body = await req.json();
  const {
    title, description, type, status, deadline,
    feishuSheetUrl, feishuSpreadsheetToken,
    fieldsSchema, deptPermissions,
    // 新统一格式：完整分配数组（含 assigneeUserIds）
    assignments: assignmentsInput,
    // 旧格式兼容（仅保留，不再推荐）
    departmentIds,
  } = body;

  console.log(`[PUT /api/tasks/${id}] assignments:`, JSON.stringify(assignmentsInput ?? departmentIds ?? "none"));

  // ── 主体更新 + 分配全量覆盖（事务）────────────────────────
  await prisma.$transaction(async (tx) => {
    // 1. 更新任务本体
    await tx.task.update({
      where: { id },
      data: {
        ...(title              !== undefined ? { title:                  title.trim()                           } : {}),
        ...(description        !== undefined ? { description:            description?.trim() ?? null            } : {}),
        ...(type               !== undefined ? { type:                   type as TaskType                       } : {}),
        ...(status             !== undefined ? { status:                 status as TaskStatus                   } : {}),
        ...(deadline           !== undefined ? { deadline:               deadline ? new Date(deadline) : null  } : {}),
        ...(feishuSheetUrl     !== undefined ? { feishuSheetUrl:         feishuSheetUrl?.trim() ?? null         } : {}),
        ...(feishuSpreadsheetToken !== undefined ? { feishuSpreadsheetToken: feishuSpreadsheetToken?.trim() ?? null } : {}),
        ...(fieldsSchema       !== undefined ? { fieldsSchema:           fieldsSchema    ?? null                } : {}),
        ...(deptPermissions    !== undefined ? { deptPermissions:        deptPermissions ?? null                } : {}),
      },
    });

    // 2. 分配全量覆盖：只要传了新格式或旧格式分配数据，就整体重写
    type AssignInput = { deptId: string; assigneeUserIds?: string[] };

    const newAssignments: AssignInput[] = (() => {
      if (Array.isArray(assignmentsInput) && assignmentsInput.length >= 0) {
        return assignmentsInput as AssignInput[];
      }
      if (Array.isArray(departmentIds)) {
        return (departmentIds as string[]).map(deptId => ({ deptId }));
      }
      return null as unknown as AssignInput[];  // 未传：不修改分配
    })();

    if (newAssignments !== null) {
      // 获取现有分配，保留已完成/归档的，只覆盖待填报及以前的
      const existing = await tx.taskAssignment.findMany({ where: { taskId: id } });
      const preservedStatuses = new Set(["SUBMITTED", "APPROVED", "ARCHIVED"]);

      // 删除：不在新列表中 且 未进入完成状态 的分配
      const newDeptIds = new Set(newAssignments.map(a => a.deptId));
      for (const ea of existing) {
        if (!newDeptIds.has(ea.departmentId) && !preservedStatuses.has(ea.status)) {
          await tx.taskAssignment.delete({ where: { id: ea.id } });
        }
      }

      // 新增或更新
      for (const na of newAssignments) {
        const exA = existing.find(e => e.departmentId === na.deptId);
        if (exA) {
          // 已存在：更新 assigneeUserIds（仅当未完成时更新）
          if (!preservedStatuses.has(exA.status)) {
            await tx.taskAssignment.update({
              where: { id: exA.id },
              data:  { assigneeUserIds: na.assigneeUserIds ?? [] },
            });
          }
        } else {
          // 新增
          await tx.taskAssignment.create({
            data: {
              taskId:          id,
              departmentId:    na.deptId,
              assigneeUserIds: na.assigneeUserIds ?? [],
              status:          "PENDING_SEND",
            },
          });
        }
      }
    }
  });

  writeAuditLog({
    userId: session.user.id,
    action: AuditAction.UPDATE_TASK,
    resourceType: "task",
    resourceId: id,
    metadata: { title: title ?? existing.title, changedFields: Object.keys(body) },
    ipAddress: ip(req),
  }).catch(console.error);

  return NextResponse.json({ task: await findTask(id) });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可删除任务" }, { status: 403 });

  const { id } = await ctx.params;
  const existing = await findTask(id);
  if (!existing) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  await prisma.task.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  writeAuditLog({
    userId: session.user.id,
    action: AuditAction.DELETE_TASK,
    resourceType: "task",
    resourceId: id,
    isDangerous: true,
    metadata: { title: existing.title },
    ipAddress: ip(req),
  }).catch(console.error);

  return NextResponse.json({ ok: true });
}
