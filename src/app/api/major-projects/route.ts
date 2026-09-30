/**
 * GET  /api/major-projects           列表（过滤/排序/分页）
 * POST /api/major-projects           新建
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { extractYearFromName } from "@/lib/majorProjectUtils";
import { syncAwardFromProject } from "@/lib/syncAwardFromProject";

function ip(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const q              = sp.get("q")              ?? "";
  const level          = sp.get("level")          ?? ""; // 旧字段（保留兼容）
  const levelDictIds   = sp.getAll("levelDictId");   // 多选级别
  const categoryDictIds = sp.getAll("categoryDictId"); // 多选类别
  const status         = sp.get("status")         ?? ""; // 旧字段（保留兼容）
  const funding        = sp.get("funding")        ?? "";
  const company        = sp.get("company")        ?? ""; // 收款公司主体名称筛选
  const parentId       = sp.get("parentId")       ?? ""; // 树形筛选
  const sort           = sp.get("orderBy") ?? sp.get("sort") ?? "createdAt"; // 支持 orderBy 和 sort
  const order          = sp.get("order")          ?? "desc";
  const page           = Math.max(1, Number(sp.get("page") ?? 1));
  const limit          = Math.min(100, Math.max(1, Number(sp.get("limit") ?? 20)));

  const where: Record<string, unknown> = { deletedAt: null };
  if (q)      where.name   = { contains: q };

  // 新字典外键筛选（优先使用，支持多选 IN 查询）
  if (levelDictIds.length > 0)    where.levelDictId    = { in: levelDictIds };
  else if (level)                 where.level          = level; // 兼容旧字段
  if (categoryDictIds.length > 0) where.categoryDictId = { in: categoryDictIds };
  if (status)                     where.status         = status; // 兼容旧字段

  // 树形筛选：parentId 为 "null" 时查询顶层项目
  // 重要：搜索时（q 有值）必须全库搜索，不能限制 parentId，否则子项目永远搜不到
  if (!q) {
    if (parentId === "null") where.parentId = null;
    else if (parentId)       where.parentId = parentId;
  }

  // 收款公司主体筛选（支持 companyEntityNames 数组或旧 dict value）
  if (company) {
    where.OR = [
      { companyEntityNames: { has: company } },
      { companyEntityDict: { value: company } },
    ];
  }

  // 金额筛选（适配新字段）
  if (funding === "full")    { where.receivedAmount = { gt: 0 }; where.totalAmount = { gt: 0 }; }
  if (funding === "none")    { where.receivedAmount = 0; }
  if (funding === "partial") { where.AND = [{ receivedAmount: { gt: 0 } }, { totalAmount: { not: null } }]; }

  // 固定五级排序（前端 sort/order 参数保留但不再影响主排序逻辑）
  // 规则 1：周重点置顶 → 2：进度降序（中文字符编码特性：进行中 > 未开始 > 已结束）
  // → 3：名称提取年份降序 → 4：申报时间降序 → 5：名称字母序
  const orderByArr = [
    { isWeekFocus:    "desc" as const },
    { progress:       "desc" as const },
    { extractedYear:  "desc" as const },
    { applyDate:      "desc" as const },
    { name:           "asc"  as const },
  ];

  const [projects, total] = await Promise.all([
    prisma.majorProject.findMany({
      where,
      orderBy: orderByArr,
      skip:  (page - 1) * limit,
      take:  limit,
      include: {
        parent: true, // 父项目信息（树形）
        children: { // 子项目（含字典关联，保证子行能正确显示分类/级别等）
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          include: {
            categoryDict: true, companyEntityDict: true, levelDict: true,
          },
        },
        categoryDict: true,
        companyEntityDict: true,
        levelDict: true,
        kpis: { orderBy: { sortOrder: "asc" } }, // 新 KPI 表
        milestones: { orderBy: { type: "asc" } }, // 里程碑
        todos: { orderBy: { sortOrder: "asc" } },
      },
    }),
    prisma.majorProject.count({ where }),
  ]);

  return NextResponse.json({ projects, total, page, limit });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json();
  if (!body.name?.trim())
    return NextResponse.json({ error: "项目名称不能为空" }, { status: 400 });

  const project = await prisma.majorProject.create({
    data: {
      name:                body.name.trim(),
      projectCode:         body.projectCode         ?? null,
      isWeekFocus:         body.isWeekFocus         ?? false,
      remark:              body.remark              ?? null,

      // ──── 新字段（树形与字典外键） ────
      parentId:            body.parentId            ?? null,
      categoryDictId:      body.categoryDictId      ?? null,
      companyEntityDictId: body.companyEntityDictId ?? null,
      levelDictId:         body.levelDictId         ?? null,

      // ──── 新字段（金额与时间） ────
      totalAmount:         body.totalAmount         ?? null,
      receivedAmount:      body.receivedAmount      ?? 0,
      receivedDate:        body.receivedDate        ? new Date(body.receivedDate) : null,

      // ──── 新字段（归属与负责人） ────
      affiliation:         body.affiliation         ?? null,
      progress:            body.progress            ?? "未开始",
      extractedYear:       extractYearFromName(body.name.trim() ?? ""),
      ownerFeishuOpenId:   body.ownerFeishuOpenId   ?? null,

      // ──── 新字段（证明材料与待办） ────
      proofMaterials:      body.proofMaterials      ?? [],
      todoItems:           body.todoItems           ?? null,

      // ──── 旧字段（保留备份，兼容旧前端） ────
      level:               body.level               ?? "",
      status:              body.status              ?? "未开始",
      applyDate:           body.applyDate           ? new Date(body.applyDate)    : null,
      startDate:           body.startDate           ? new Date(body.startDate)    : null,
      midCheckDate:        body.midCheckDate        ? new Date(body.midCheckDate) : null,
      endDate:             body.endDate             ? new Date(body.endDate)      : null,
      totalSubsidy:        body.totalSubsidy        ?? null,
      received:            body.received            ?? 0,
      projectOwner:        body.projectOwner        ?? null,
      projectManager:      body.projectManager      ?? null,
      rdTask:              body.rdTask              ?? null,
      processRecord:       body.processRecord       ?? null,
    },
  });

  writeAuditLog({ userId: session.user.id, action: AuditAction.CREATE_TASK,
    resourceType: "major_project", resourceId: project.id,
    metadata: { name: project.name }, ipAddress: ip(req) }).catch(console.error);

  // 自动同步：若类别为「荣誉资质」，立即写入企业资质与奖项库
  syncAwardFromProject(project.id, session.user.id).catch(e =>
    console.warn("[major-projects] 荣誉资质自动同步失败:", (e as Error).message)
  );

  return NextResponse.json({ project }, { status: 201 });
}
