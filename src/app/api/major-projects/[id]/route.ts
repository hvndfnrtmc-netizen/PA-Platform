/**
 * GET    /api/major-projects/[id]   详情（含 indicators + todos）
 * PATCH  /api/major-projects/[id]   更新基本信息 + 全量覆盖 indicators/todos
 * DELETE /api/major-projects/[id]   软删除
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { extractYearFromName } from "@/lib/majorProjectUtils";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const project = await prisma.majorProject.findUnique({
    where: { id, deletedAt: null },
    include: {
      parent: true,
      children: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      categoryDict: true,
      companyEntityDict: true,
      levelDict: true,
      indicators: { orderBy: { sortOrder: "asc" } }, // 旧表（保留）
      kpis: { orderBy: { sortOrder: "asc" } }, // 新 KPI 表
      milestones: { orderBy: { type: "asc" } }, // 里程碑
      todos: { orderBy: { sortOrder: "asc" } },
      paymentRecords: { orderBy: { paymentDate: "asc" } }, // 到账记录
    },
  });
  if (!project) return NextResponse.json({ error: "项目不存在" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const body = await req.json();

  const existing = await prisma.majorProject.findUnique({ where: { id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "项目不存在" }, { status: 404 });

  // ── 基本字段 ─────────────────────────────────────────────────
  const update: Record<string, unknown> = {};

  // 新字段
  const newScalarFields = [
    "name", "projectCode", "isWeekFocus", "isAmountAutoSum", "remark",
    "parentId", "categoryDictId", "companyEntityDictId", "companyEntityNames",
    "levelDictId",
    "totalAmount", "receivedAmount", "affiliation", "progress", "ownerFeishuOpenId",
    "proofMaterials", "todoItems", "communicationGroups",
  ];
  const newDateFields = ["receivedDate"];

  // 旧字段（保留兼容）
  const oldScalarFields = [
    "level", "status", "totalSubsidy", "received",
    "projectOwner", "projectManager", "rdTask", "processRecord",
  ];
  const oldDateFields = ["applyDate", "startDate", "midCheckDate", "endDate"];

  [...newScalarFields, ...oldScalarFields].forEach(f => {
    if (f in body) update[f] = body[f];
  });

  // 当名称被更新时，同步重算缓存的年份
  if ("name" in body && typeof body.name === "string" && body.name) {
    update.extractedYear = extractYearFromName(body.name);
  }

  [...newDateFields, ...oldDateFields].forEach(f => {
    if (f in body) update[f] = body[f] ? new Date(body[f] as string) : null;
  });

  // ── indicators / todos / kpis / milestones / paymentRecords 是否随本次请求传入 ─────
  const hasIndicators = Array.isArray(body.indicators); // 旧表（兼容）
  const hasKpis       = Array.isArray(body.kpis);       // 新 KPI 表
  const hasMilestones = Array.isArray(body.milestones);
  const hasTodos      = Array.isArray(body.todos);
  const hasPaymentRecords = Array.isArray(body.paymentRecords); // 到账记录

  interface IndicatorInput {
    name: string; content?: string | null; owner?: string | null;
    isCustom?: boolean; sortOrder?: number;
  }
  interface KpiInput {
    name: string; content?: string | null; ownerFeishuOpenId?: string | null;
    isCustom?: boolean; sortOrder?: number;
  }
  interface MilestoneInput {
    type: string; startDate?: string | null; endDate?: string | null;
    date?: string | null; status?: string; notes?: string | null;
    attachments?: Array<Record<string, unknown>>;
    kpis?: Array<Record<string, unknown>>;
    hasDefense?: boolean; defenseDetails?: Record<string, unknown> | null;
  }
  interface TodoInput {
    content: string; isCompleted?: boolean; sortOrder?: number;
  }
  interface PaymentRecordInput {
    amount: number; paymentDate: string; remark?: string;
  }

  try { console.log("[PATCH major-project] payload keys:", Object.keys(body)); } catch {}

  await prisma.$transaction(async (tx) => {
    await tx.majorProject.update({ where: { id }, data: update });

    // 旧 indicators 表（保留兼容）
    if (hasIndicators) {
      await tx.projectIndicator.deleteMany({ where: { projectId: id } });
      const rows = (body.indicators as IndicatorInput[])
        .filter(ind => ind.name?.trim())
        .map((ind, i) => ({
          projectId: id,
          name:      ind.name.trim(),
          content:   ind.content?.trim() || null,
          owner:     ind.owner?.trim()   || null,
          isCustom:  ind.isCustom ?? false,
          sortOrder: ind.sortOrder ?? i,
        }));
      if (rows.length) await tx.projectIndicator.createMany({ data: rows });
    }

    // 新 KPI 表
    if (hasKpis) {
      await tx.projectKPI.deleteMany({ where: { projectId: id } });
      const rows = (body.kpis as KpiInput[])
        .filter(kpi => kpi.name?.trim())
        .map((kpi, i) => ({
          projectId:         id,
          name:              kpi.name.trim(),
          content:           kpi.content?.trim() || null,
          ownerFeishuOpenId: kpi.ownerFeishuOpenId?.trim() || null,
          isCustom:          kpi.isCustom ?? false,
          sortOrder:         kpi.sortOrder ?? i,
        }));
      if (rows.length) await tx.projectKPI.createMany({ data: rows });
    }

    // 里程碑表
    if (hasMilestones) {
      await tx.projectMilestone.deleteMany({ where: { projectId: id } });
      const rows = (body.milestones as MilestoneInput[])
        .filter(m => m.type)
        .map(m => ({
          projectId:   id,
          type:        m.type as "APPLY" | "START" | "MID_CHECK" | "END",
          startDate:   m.startDate ? new Date(m.startDate) : null,
          endDate:     m.endDate   ? new Date(m.endDate)   : null,
          date:        m.date      ? new Date(m.date)      : null,
          status:      (m.status as "PENDING" | "DONE") ?? "PENDING",
          notes:       m.notes?.trim() || null,
          attachments: (m.attachments ?? []) as Array<Record<string, unknown>>,
          kpis:        (m.kpis ?? []) as Array<Record<string, unknown>>,
          hasDefense:  m.hasDefense ?? false,
          defenseDetails: m.defenseDetails ?? null,
        }));
      if (rows.length) await tx.projectMilestone.createMany({ data: rows as never[] });
    }

    // 待办事项表
    if (hasTodos) {
      await tx.projectTodo.deleteMany({ where: { projectId: id } });
      const rows = (body.todos as TodoInput[])
        .filter(t => t.content?.trim())
        .map((t, i) => ({
          projectId:   id,
          content:     t.content.trim(),
          isCompleted: t.isCompleted ?? false,
          sortOrder:   t.sortOrder ?? i,
        }));
      if (rows.length) await tx.projectTodo.createMany({ data: rows });
    }

    // 到账记录表
    if (hasPaymentRecords) {
      await tx.projectPaymentRecord.deleteMany({ where: { projectId: id } });
      const rows = (body.paymentRecords as PaymentRecordInput[])
        .filter(r => r.amount > 0 && r.paymentDate)
        .map(r => ({
          projectId:   id,
          amount:      Number(r.amount),
          paymentDate: new Date(r.paymentDate),
          remark:      r.remark?.trim() || null,
        }));
      if (rows.length) await tx.projectPaymentRecord.createMany({ data: rows });
    }
  }).catch((err: unknown) => {
    console.error("[PATCH major-project] transaction error:", err);
    throw err;
  });

  const project = await prisma.majorProject.findUnique({
    where: { id },
    include: {
      parent: true,
      children: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      categoryDict: true,
      companyEntityDict: true,
      levelDict: true,
      indicators: { orderBy: { sortOrder: "asc" } }, // 旧表
      kpis:       { orderBy: { sortOrder: "asc" } }, // 新 KPI 表
      milestones: { orderBy: { type: "asc" } },      // 里程碑
      todos:      { orderBy: { sortOrder: "asc" } },
      paymentRecords: { orderBy: { paymentDate: "asc" } }, // 到账记录
    },
  });
  return NextResponse.json({ project });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  await prisma.majorProject.update({
    where: { id, deletedAt: null },
    data:  { deletedAt: new Date() },
  });
  return NextResponse.json({ success: true });
}
