/**
 * GET  /api/tasks   — 任务列表（PA 专用）
 * POST /api/tasks   — 新建任务并分配（支持二级指派到具体人）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { TaskStatus, TaskType } from "@prisma/client";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://pa-platform-kappa.vercel.app";

// V1.0 MVP：创建任务后状态为 PENDING_SEND，PA 手动逐条确认后才发卡片
// 不再自动发送，避免批量误发

interface AssignmentInput {
  deptId:           string;
  assigneeUserIds?: string[];
}

function ip(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const q      = searchParams.get("q") ?? "";
  const status = searchParams.get("status") as TaskStatus | null;
  const type   = searchParams.get("type") as TaskType | null;
  const take   = Math.min(Number(searchParams.get("take") ?? 50), 100);
  const skip   = Number(searchParams.get("skip") ?? 0);

  const where = {
    deletedAt: null,
    ...(q ? { title: { contains: q } } : {}),
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  };

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        createdBy: { select: { id: true, name: true } },
        assignments: {
          include: {
            department: { select: { id: true, name: true, code: true } },
          },
          orderBy: { createdAt: "asc" as const },
        },
      },
      orderBy: [{ createdAt: "desc" }],
      take,
      skip,
    }),
    prisma.task.count({ where }),
  ]);

  const allTasks = await prisma.task.findMany({
    where: { deletedAt: null },
    select: { status: true },
  });
  const stats = {
    total:      allTasks.length,
    draft:      allTasks.filter((t) => t.status === "DRAFT").length,
    pending:    allTasks.filter((t) => t.status === "PENDING").length,
    inProgress: allTasks.filter((t) => t.status === "IN_PROGRESS").length,
    submitted:  allTasks.filter((t) => t.status === "SUBMITTED").length,
    archived:   allTasks.filter((t) => t.status === "ARCHIVED").length,
  };

  // 批量查询所有 assignment 的指派人用户对象（embed 到响应中，避免前端多次查询）
  const allAssigneeIds = new Set<string>();
  for (const t of tasks) {
    for (const a of t.assignments) {
      for (const id of (a.assigneeUserIds as string[] ?? [])) {
        allAssigneeIds.add(id);
      }
    }
  }
  const assigneeUsers = allAssigneeIds.size > 0
    ? await prisma.user.findMany({
        where:  { id: { in: [...allAssigneeIds] }, deletedAt: null },
        select: { id: true, name: true },
      })
    : [];
  const userMap = new Map(assigneeUsers.map((u) => [u.id, u]));

  const enrichedTasks = tasks.map((t) => ({
    ...t,
    assignments: t.assignments.map((a) => ({
      ...a,
      assigneeUsers: (a.assigneeUserIds as string[] ?? [])
        .map((id) => userMap.get(id))
        .filter(Boolean) as { id: string; name: string }[],
    })),
  }));

  return NextResponse.json({ tasks: enrichedTasks, total, stats });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json();
  const {
    title, description, type, deadline,
    feishuSheetUrl, feishuSpreadsheetToken,
    fieldsSchema,
    // 新格式：二级指派
    assignments: assignmentsInput,
    // 旧格式兼容：纯部门 ID 数组
    departmentIds,
  } = body;

  if (!title?.trim()) return NextResponse.json({ error: "任务标题不能为空" }, { status: 400 });

  // 统一转换为 AssignmentInput[]
  const resolvedAssignments: AssignmentInput[] = (() => {
    if (Array.isArray(assignmentsInput) && assignmentsInput.length > 0) {
      return (assignmentsInput as AssignmentInput[]);
    }
    // 旧格式兼容
    if (Array.isArray(departmentIds)) {
      return (departmentIds as string[]).map((deptId) => ({ deptId }));
    }
    return [];
  })();

  const task = await prisma.task.create({
    data: {
      title:                  title.trim(),
      description:            description?.trim() ?? null,
      type:                   (type ?? "SPECIAL") as TaskType,
      status:                 "PENDING",
      deadline:               deadline ? new Date(deadline) : null,
      feishuSheetUrl:         feishuSheetUrl?.trim() ?? null,
      feishuSpreadsheetToken: feishuSpreadsheetToken?.trim() ?? null,
      fieldsSchema:           fieldsSchema ?? null,
      createdById:            session.user.id,
      assignments: {
        create: resolvedAssignments.map((a) => ({
          departmentId:    a.deptId,
          assigneeUserIds: a.assigneeUserIds ?? [],
          status:          "PENDING_SEND",
        })),
      },
    },
    include: {
      assignments: {
        include: {
          department: { select: { id: true, name: true } },
        },
      },
    },
  });

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.CREATE_TASK,
    resourceType: "task",
    resourceId:   task.id,
    metadata:     { title: task.title, type: task.type, assignmentCount: resolvedAssignments.length },
    ipAddress:    ip(req),
  }).catch(console.error);

  return NextResponse.json({ task }, { status: 201 });
}

