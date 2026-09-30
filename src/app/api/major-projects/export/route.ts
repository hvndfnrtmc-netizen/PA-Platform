/**
 * GET /api/major-projects/export
 * 导出重大项目为 Excel 文件（全字段版）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import * as XLSX from "xlsx";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const q              = searchParams.get("q")              || "";
  const levelDictId    = searchParams.getAll("levelDictId");
  const categoryDictId = searchParams.getAll("categoryDictId");
  const parentId       = searchParams.get("parentId")       || "";
  const company        = searchParams.get("company")        || "";

  try {
    // 构建查询条件（与列表页一致）
    const where: Record<string, unknown> = { deletedAt: null };

    if (q) {
      where.OR = [
        { name: { contains: q } },
        { projectCode: { contains: q } },
      ];
    }

    if (levelDictId.length > 0)    where.levelDictId    = { in: levelDictId };
    if (categoryDictId.length > 0) where.categoryDictId = { in: categoryDictId };
    if (parentId === "null") where.parentId = null;
    else if (parentId)       where.parentId = parentId;
    if (company) {
      where.OR = [
        { companyEntityNames: { has: company } },
        { companyEntityDict: { value: company } },
      ];
    }

    // 查询全量数据（含所有关联）
    const projects = await prisma.majorProject.findMany({
      where,
      include: {
        parent:           { select: { name: true } },
        children:         { where: { deletedAt: null }, select: { name: true } },
        categoryDict:     true,
        companyEntityDict:true,
        levelDict:        true,
        kpis:             { orderBy: { sortOrder: "asc" } },
        milestones:       { orderBy: { type: "asc" } },
        todos:            { orderBy: { sortOrder: "asc" } },
        paymentRecords:   { orderBy: { paymentDate: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    function safe(v: unknown): string {
      if (v === null || v === undefined) return "";
      const s = String(v).trim();
      return s === "null" || s === "undefined" ? "" : s;
    }

    function fmtDate(d: Date | string | null | undefined): string {
      if (!d) return "";
      return new Date(d).toISOString().slice(0, 10);
    }

    // 扁平化数据
    const rows = projects.map((p) => {
      // 收款公司主体（优先多选名称数组，降级旧单选）
      const companyNames =
        p.companyEntityNames && p.companyEntityNames.length > 0
          ? p.companyEntityNames.join("、")
          : safe(p.companyEntityDict?.value);

      // 证明材料文件名
      let proofMaterialsStr = "";
      if (Array.isArray(p.proofMaterials) && p.proofMaterials.length > 0) {
        proofMaterialsStr = (p.proofMaterials as Array<{ name?: string }>)
          .map((f) => f?.name ?? "")
          .filter(Boolean)
          .join(", ");
      }

      // 子项目列表
      const subProjectsStr = p.children.length > 0
        ? p.children.map((c) => c.name).join("、")
        : "";

      // 待办事项概览
      const todoTotal     = p.todos.length;
      const todoDone      = p.todos.filter((t) => t.isCompleted).length;
      const todoInProgress = todoTotal - todoDone;
      const todoOverview  = todoTotal > 0
        ? `共 ${todoTotal} 项，已完成 ${todoDone} 项，进行中 ${todoInProgress} 项`
        : "";

      // 待办详细列表
      const todoDetail = p.todos.length > 0
        ? p.todos.map((t, i) =>
            `${i + 1}. ${t.content ?? ""}(${t.isCompleted ? "已完成" : "进行中"})`
          ).join(" | ")
        : "";

      // 到账记录详情
      const paymentDetail = p.paymentRecords.length > 0
        ? p.paymentRecords.map((r, i) =>
            `${i + 1}. ${fmtDate(r.paymentDate)} ${r.amount}万${r.remark ? `（${r.remark}）` : ""}`
          ).join(" | ")
        : "";

      // 实时计算已到账（来自 paymentRecords）
      const computedReceived = p.paymentRecords.reduce((s, r) => s + r.amount, 0);
      const totalAmt  = p.totalAmount ?? 0;
      const pendingAmt = Math.round((totalAmt - computedReceived) * 100) / 100;

      return {
        "项目名称":          p.name,
        "父项目名称":        safe(p.parent?.name),
        "项目编号":          safe(p.projectCode),
        "项目类别":          safe(p.categoryDict?.value),
        "项目级别":          safe(p.levelDict?.value),
        "收款公司主体":      companyNames,
        "归属":              safe(p.affiliation),
        "项目进度":          safe(p.progress),
        "是否周重点":        p.isWeekFocus ? "是" : "否",
        "总金额_万":         totalAmt,
        "已到账金额_万":     computedReceived,
        "待到账金额_万":     pendingAmt,
        "到账时间":          fmtDate(p.receivedDate),
        "申报时间":          fmtDate(p.applyDate),
        "创建时间":          fmtDate(p.createdAt),
        "证明材料":          proofMaterialsStr,
        "子项目列表":        subProjectsStr,
        "待办事项概览":      todoOverview,
        "待办详细列表":      todoDetail,
        "到账记录详情":      paymentDetail,
        "KPI总数":           p.kpis.length,
        "里程碑总数":        p.milestones.length,
        "备注":              safe(p.remark),
      };
    });

    // 生成 Excel
    const worksheet  = XLSX.utils.json_to_sheet(rows);
    const workbook   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "重大项目");

    // 设置列宽
    worksheet["!cols"] = [
      { wch: 30 }, // 项目名称
      { wch: 20 }, // 父项目名称
      { wch: 14 }, // 项目编号
      { wch: 14 }, // 项目类别
      { wch: 10 }, // 项目级别
      { wch: 24 }, // 收款公司主体
      { wch: 8  }, // 归属
      { wch: 8  }, // 项目进度
      { wch: 8  }, // 是否周重点
      { wch: 12 }, // 总金额_万
      { wch: 12 }, // 已到账金额_万
      { wch: 12 }, // 待到账金额_万
      { wch: 12 }, // 到账时间
      { wch: 12 }, // 申报时间
      { wch: 12 }, // 创建时间
      { wch: 30 }, // 证明材料
      { wch: 30 }, // 子项目列表
      { wch: 30 }, // 待办事项概览
      { wch: 60 }, // 待办详细列表
      { wch: 60 }, // 到账记录详情
      { wch: 8  }, // KPI总数
      { wch: 8  }, // 里程碑总数
      { wch: 30 }, // 备注
    ];

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="major-projects-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "导出失败" }, { status: 500 });
  }
}
