/**
 * GET  /api/awards  — 列表查询（分页 + 关键词过滤）
 * POST /api/awards  — 新增奖项
 *
 * 鉴权：
 *   GET  → 需要 VIEW 或 EDIT 权限
 *   POST → 需要 EDIT 权限
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { checkModulePermission, getModulePermLevel } from "@/lib/module-auth";
import { Prisma } from "@prisma/client";

const MODULE = "awards";

// ──────────────────────────────────────────────
// 公共鉴权工具
// ──────────────────────────────────────────────

async function requireSession(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return { session: null, error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  }
  return { session, error: null };
}

function getIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

// ──────────────────────────────────────────────
// GET /api/awards
// ──────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (!session) return error!;

  const { role, departmentId } = session.user;

  const permLevel = await getModulePermLevel({ userRole: role, departmentId, moduleKey: MODULE });
  if (!permLevel) {
    return NextResponse.json({ error: "无查看权限" }, { status: 403 });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  // 全量拉取：不设硬编码上限，由前端处理分页与展示
  // 若调用方主动传 take 参数则尊重（最大 2000），否则全部返回
  const takeParm = url.searchParams.get("take");
  const take     = takeParm ? Math.min(parseInt(takeParm), 2000) : undefined;
  const skip     = take ? parseInt(url.searchParams.get("skip") ?? "0") : undefined;

  const where: Prisma.QualificationAwardWhereInput = {
    isActive: true,
    deletedAt: null,
    ...(q
      ? {
          OR: [
            { title:         { contains: q } },
            { awardedBy:     { contains: q } },
            { awardeeEntity: { contains: q } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.qualificationAward.findMany({
      where,
      orderBy: [{ awardedAtYear: "desc" }, { createdAt: "desc" }],
      ...(take !== undefined ? { take, skip: skip ?? 0 } : {}),
    }),
    prisma.qualificationAward.count({ where }),
  ]);

  // 将 DB 字段 category 映射为前端字段 level
  const mappedItems = items.map(item => ({ ...item, level: item.category }));

  return NextResponse.json({
    items: mappedItems,
    total,
    canEdit: permLevel === "EDIT",
    canView: true,
    isAdmin: role === "SUPER_ADMIN" || role === "PA_SPECIALIST",
  });
}

// ──────────────────────────────────────────────
// POST /api/awards
// ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (!session) return error!;

  const { id: userId, role, departmentId } = session.user;

  const canEdit = await checkModulePermission({
    userRole: role,
    departmentId,
    moduleKey: MODULE,
    required: "EDIT",
  });
  if (!canEdit) {
    return NextResponse.json({ error: "无编辑权限：你的部门未被授予资质奖项模块的编辑权" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  // 字段校验：仅奖项名称必填
  if (!body.title || typeof body.title !== "string" || !String(body.title).trim()) {
    return NextResponse.json({ error: "字段 title 不能为空" }, { status: 400 });
  }

  // 从 awardedAt 字符串提取年份
  const yearMatch = String(body.awardedAt ?? "").match(/\d{4}/);
  const awardedAtYear = yearMatch ? parseInt(yearMatch[0]) : 0;

  const record = await prisma.qualificationAward.create({
    data: {
      awardedAt:       String(body.awardedAt || ""),
      awardedAtYear,
      awardedBy:       String(body.awardedBy || ""),
      awardeeEntity:   String(body.awardeeEntity || ""),
      title:           String(body.title),
      category:        String(body.level || body.category || "国家级"),
      description:     body.description ? String(body.description) : null,
      attachments:     Array.isArray(body.attachments)
                         ? (body.attachments as Prisma.InputJsonValue)
                         : [],
      sourceProjectId: body.sourceProjectId ? String(body.sourceProjectId) : null,
      createdById:     userId,
    },
  });

  await writeAuditLog({
    userId,
    action: AuditAction.CREATE_AWARD,
    resourceType: "qualification_award",
    resourceId: record.id,
    metadata: { title: record.title, awardeeEntity: record.awardeeEntity, awardedAt: record.awardedAt },
    ipAddress: getIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json(record, { status: 201 });
}

// ──────────────────────────────────────────────
// DELETE /api/awards  — 批量软删除
// ──────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (!session) return error!;

  const { id: userId, role, departmentId } = session.user;

  const canEdit = await checkModulePermission({
    userRole: role,
    departmentId,
    moduleKey: MODULE,
    required: "EDIT",
  });
  if (!canEdit) {
    return NextResponse.json({ error: "无编辑权限" }, { status: 403 });
  }

  let body: { ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids 不能为空" }, { status: 400 });
  }

  const validIds = ids.filter((id): id is string => typeof id === "string");

  await prisma.qualificationAward.updateMany({
    where: { id: { in: validIds }, deletedAt: null },
    data: { deletedAt: new Date(), isActive: false },
  });

  await writeAuditLog({
    userId,
    action: AuditAction.DELETE_AWARD,
    resourceType: "qualification_award",
    resourceId: validIds[0] ?? "",
    metadata: { ids: validIds, count: validIds.length },
    ipAddress: getIp(req),
    userAgent: req.headers.get("user-agent") ?? undefined,
    isDangerous: true,
  });

  return NextResponse.json({ success: true, deleted: validIds.length });
}
