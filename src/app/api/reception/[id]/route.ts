/**
 * GET    /api/reception/[id]   详情（含 todoTasks）
 * PATCH  /api/reception/[id]   更新（todos 变化时自动同步子任务）
 * DELETE /api/reception/[id]   软删除
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { syncTodoTasks } from "@/lib/receptionTodoSync";
import { loadFormatDicts, resolveToRootNames } from "@/lib/receptionFormatUtils";
import { loadHostDicts, resolveHostRootNames } from "@/lib/receptionHostUtils";

type Params = { params: Promise<{ id: string }> };

function ip(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const [reception, dictById, hostDictById] = await Promise.all([
    prisma.reception.findUnique({
      where:   { id, deletedAt: null },
      include: {
        hostUser:  { select: { id: true, name: true, email: true } },
        todoTasks: {
          where:   { deletedAt: null },
          orderBy: [{ category: "asc" }, { sortOrder: "asc" }],
        },
        scheduledNotifications: {
          where:   { status: "PENDING", qstashMessageId: { not: null } },
          orderBy: { scheduledAt: "asc" },
          select:  { id: true, scheduledAt: true, payload: true },
        },
      },
    }),
    loadFormatDicts(),
    loadHostDicts(),
  ]);
  if (!reception) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { scheduledNotifications: _sn, ...receptionRest } = reception;
  const effectiveIds = reception.hostDictIds.length > 0
    ? reception.hostDictIds
    : reception.hostDictId ? [reception.hostDictId] : [];
  const rootNames = resolveHostRootNames(effectiveIds, hostDictById);
  const uniqueNames = [...new Set(rootNames)];
  const hostDisplay = uniqueNames.length > 0
    ? uniqueNames.join(" ")
    : reception.hostName ?? null;
  return NextResponse.json({
    reception: {
      ...receptionRest,
      formatsDisplay: resolveToRootNames(reception.formats as string[], dictById),
      hostDisplay,
      pendingNotifications: reception.scheduledNotifications.map((n) => {
        const p = n.payload as Record<string, unknown>;
        const targetIds = Array.isArray(p?.targetIds) ? (p.targetIds as string[]) : [];
        return { id: n.id, scheduledAt: n.scheduledAt.toISOString(), targetIds };
      }),
    },
  });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.reception.findUnique({ where: { id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  const body = await req.json() as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  const scalarFields = [
    "title", "level", "hostUserId", "hostName", "hostDictId", "dressCode", "background", "address", "navigationAddress", "leaderIntroText",
    "purpose", "status", "formats", "surveyFiles", "meetingMinutes", "todos", "todoList", "remarks", "customData",
  ];
  // String[] 字段单独校验
  if ("meetingPhotos" in body && Array.isArray(body.meetingPhotos)) {
    update.meetingPhotos = (body.meetingPhotos as unknown[]).filter((u): u is string => typeof u === "string");
  }
  if ("leaderIntroImages" in body && Array.isArray(body.leaderIntroImages)) {
    update.leaderIntroImages = (body.leaderIntroImages as unknown[]).filter((u): u is string => typeof u === "string");
  }
  if ("hostDictIds" in body && Array.isArray(body.hostDictIds)) {
    update.hostDictIds = (body.hostDictIds as unknown[]).filter((u): u is string => typeof u === "string");
  }
  const dateFields = ["startTime", "endTime"];

  scalarFields.forEach(f => { if (f in body) update[f] = body[f]; });
  dateFields.forEach(f => {
    if (f in body) update[f] = body[f] ? new Date(body[f] as string) : null;
  });

  if ((update.title as string | undefined)?.trim() === "")
    return NextResponse.json({ error: "会议名称不能为空" }, { status: 400 });

  const reception = await prisma.reception.update({ where: { id }, data: update });

  // todos 变化时同步子任务（捕获异常，不阻断主更新请求）
  if ("todos" in body && Array.isArray(body.todos)) {
    const categories = (body.todos as unknown[]).filter((v): v is string => typeof v === "string");
    try {
      await syncTodoTasks(id, categories);
    } catch (syncErr) {
      // 主更新已成功，sync 失败只记录日志，客户端仍收到 200
      console.error("[PATCH /reception] syncTodoTasks failed:", syncErr);
    }
  }

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.UPDATE_RECEPTION,
    resourceType: "reception",
    resourceId:   id,
    metadata:     { title: reception.title },
    ipAddress:    ip(req),
  }).catch(console.error);

  return NextResponse.json({ reception });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.reception.findUnique({ where: { id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  await prisma.reception.update({ where: { id }, data: { deletedAt: new Date() } });

  writeAuditLog({
    userId:       session.user.id,
    action:       AuditAction.DELETE_RECEPTION,
    resourceType: "reception",
    resourceId:   id,
    metadata:     { title: existing.title },
    isDangerous:  true,
    ipAddress:    ip(req),
  }).catch(console.error);

  return NextResponse.json({ success: true });
}
