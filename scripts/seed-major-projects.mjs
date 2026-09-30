/**
 * 一次性种子脚本：将《公司项目一览.xlsx》的 36 行真实数据写入 major_projects 表。
 * 执行：node scripts/seed-major-projects.mjs
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import XLSX from "xlsx";
import * as dotenv from "dotenv";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

// Excel 日期序列号 → JS Date（UTC）
function excelDateToISO(serial) {
  if (!serial || typeof serial !== "number") return null;
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return isNaN(d.getTime()) ? null : d;
}

function cleanStr(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "/" || s === " " ? null : s;
}

function cleanFloat(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

async function main() {
  const filePath = join(__dirname, "../../公司项目一览.xlsx");
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets["数据表"];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  // 清空旧数据（硬删）
  await prisma.majorProject.deleteMany({});
  console.log("已清空旧数据");

  const data = rows.slice(1).filter(r => r[0] && String(r[0]).trim()); // 跳过 header 和空行

  for (const r of data) {
    const [
      name, level, status, applyDateRaw, projectCode,
      isWeekFocusRaw, weekTask, startDateRaw, midCheckDateRaw, endDateRaw,
      totalSubsidyRaw, receivedRaw, projectOwner, projectManager, rdTask,
      inputTargetRaw, inputOwner, revenueTargetRaw, revenueOwner,
      ipTarget, ipOwner, techTarget, techOwner, otherTarget, otherOwner,
      remark, processRecord,
    ] = r;

    await prisma.majorProject.create({
      data: {
        name:           String(name).trim(),
        level:          cleanStr(level) ?? "",
        status:         cleanStr(status) ?? "未开始",
        applyDate:      excelDateToISO(applyDateRaw),
        projectCode:    cleanStr(projectCode),
        isWeekFocus:    String(isWeekFocusRaw).trim() === "是",
        weekTask:       cleanStr(weekTask),
        startDate:      excelDateToISO(startDateRaw),
        midCheckDate:   excelDateToISO(midCheckDateRaw),
        endDate:        excelDateToISO(endDateRaw),
        totalSubsidy:   cleanFloat(totalSubsidyRaw),
        received:       cleanFloat(receivedRaw) ?? 0,
        projectOwner:   cleanStr(projectOwner),
        projectManager: cleanStr(projectManager),
        rdTask:         cleanStr(rdTask),
        inputTarget:    cleanFloat(inputTargetRaw),
        inputOwner:     cleanStr(inputOwner),
        revenueTarget:  cleanFloat(revenueTargetRaw),
        revenueOwner:   cleanStr(revenueOwner),
        ipTarget:       cleanStr(ipTarget),
        ipOwner:        cleanStr(ipOwner),
        techTarget:     cleanStr(techTarget),
        techOwner:      cleanStr(techOwner),
        otherTarget:    cleanStr(otherTarget),
        otherOwner:     cleanStr(otherOwner),
        remark:         cleanStr(remark),
        processRecord:  cleanStr(processRecord),
      },
    });
    console.log("✓", String(name).trim().slice(0, 30));
  }

  console.log(`\n写入完成：${data.length} 条`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
