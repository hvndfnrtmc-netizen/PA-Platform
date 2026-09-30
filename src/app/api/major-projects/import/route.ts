/**
 * POST /api/major-projects/import
 * 解析上传的 Excel/CSV 文件，批量 upsert（按 name 去重）
 *
 * 列顺序（0-indexed）：
 *  0  name          1  level          2  status         3  applyDate
 *  4  projectCode   5  isWeekFocus    6  weekTask(todo)  7  startDate
 *  8  midCheckDate  9  endDate        10 totalSubsidy    11 received
 *  12 projectOwner  13 projectManager 14 rdTask          15 remark
 *  16 processRecord
 *  17 inputContent  18 inputOwner     19 revenueContent  20 revenueOwner
 *  21 ipContent     22 ipOwner        23 techContent     24 techOwner
 *  25 otherContent  26 otherOwner
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import * as XLSX from "xlsx";

function excelDateToDate(serial: unknown): Date | null {
  if (!serial || typeof serial !== "number") return null;
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return isNaN(d.getTime()) ? null : d;
}
function cleanStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "/" || s === " " ? null : s;
}
function cleanFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "缺少 file 字段" }, { status: 400 });

  const buf  = Buffer.from(await file.arrayBuffer());
  const wb   = XLSX.read(buf, { type: "buffer" });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }) as unknown[][];

  if (rows.length < 2)
    return NextResponse.json({ error: "文件没有数据行" }, { status: 400 });

  const dataRows = rows.slice(1).filter(r => r[0] && String(r[0]).trim());
  let upserted = 0;

  for (const r of dataRows) {
    const [
      name, level, status, applyDateRaw, projectCode,
      isWeekFocusRaw, weekTaskRaw, startDateRaw, midCheckDateRaw, endDateRaw,
      totalSubsidyRaw, receivedRaw, projectOwner, projectManager, rdTask,
      remark, processRecord,
      inputContent, inputOwner,
      revenueContent, revenueOwner,
      ipContent, ipOwner,
      techContent, techOwner,
      otherContent, otherOwner,
    ] = r as unknown[];

    const nameStr = String(name).trim();
    if (!nameStr) continue;

    const base = {
      level:          cleanStr(level)          ?? "",
      status:         cleanStr(status)         ?? "未开始",
      applyDate:      excelDateToDate(applyDateRaw),
      projectCode:    cleanStr(projectCode),
      isWeekFocus:    String(isWeekFocusRaw).trim() === "是",
      startDate:      excelDateToDate(startDateRaw),
      midCheckDate:   excelDateToDate(midCheckDateRaw),
      endDate:        excelDateToDate(endDateRaw),
      totalSubsidy:   cleanFloat(totalSubsidyRaw),
      received:       cleanFloat(receivedRaw) ?? 0,
      projectOwner:   cleanStr(projectOwner),
      projectManager: cleanStr(projectManager),
      rdTask:         cleanStr(rdTask),
      remark:         cleanStr(remark),
      processRecord:  cleanStr(processRecord),
      deletedAt:      null,
    };

    const indicators = [
      { name: "项目投入指标（万元）",     content: cleanStr(inputContent)   ?? "", owner: cleanStr(inputOwner)   ?? null, isCustom: false, sortOrder: 0 },
      { name: "项目新增收入指标（万元）", content: cleanStr(revenueContent) ?? "", owner: cleanStr(revenueOwner) ?? null, isCustom: false, sortOrder: 1 },
      { name: "IP考核指标",             content: cleanStr(ipContent)      ?? "", owner: cleanStr(ipOwner)      ?? null, isCustom: false, sortOrder: 2 },
      { name: "技术考核指标",           content: cleanStr(techContent)    ?? "", owner: cleanStr(techOwner)    ?? null, isCustom: false, sortOrder: 3 },
      { name: "其他指标",              content: cleanStr(otherContent)   ?? "", owner: cleanStr(otherOwner)   ?? null, isCustom: false, sortOrder: 4 },
    ];

    const todoContent = cleanStr(weekTaskRaw);
    const todos = todoContent ? [{ content: todoContent, isCompleted: false, sortOrder: 0 }] : [];

    await prisma.$transaction(async (tx) => {
      const existing = await tx.majorProject.findUnique({ where: { name: nameStr } });

      if (existing) {
        // 先显式清空旧关联数据，再写入最新数据
        await tx.projectIndicator.deleteMany({ where: { projectId: existing.id } });
        await tx.projectTodo.deleteMany({ where: { projectId: existing.id } });
        await tx.majorProject.update({
          where: { id: existing.id },
          data: {
            ...base,
            indicators: { create: indicators },
            todos:      { create: todos },
          },
        });
      } else {
        await tx.majorProject.create({
          data: {
            name: nameStr,
            ...base,
            indicators: { create: indicators },
            todos:      { create: todos },
          },
        });
      }
    });

    upserted++;
  }

  return NextResponse.json({ upserted });
}
