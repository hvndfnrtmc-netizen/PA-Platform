/**
 * GET /api/cron/backup-major-projects
 * 自动备份重大项目数据（每周定时触发）
 *
 * Vercel Cron 配置在 vercel.json：
 * {
 *   "crons": [{
 *     "path": "/api/cron/backup-major-projects",
 *     "schedule": "0 2 * * 1"
 *   }]
 * }
 *
 * schedule: "0 2 * * 1" 表示每周一凌晨 2:00 UTC 执行
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import * as XLSX from "xlsx";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  // Vercel Cron 请求会携带 Authorization header
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 查询所有未删除的项目
    const projects = await prisma.majorProject.findMany({
      where: { deletedAt: null },
      include: {
        categoryDict: true,
        companyEntityDict: true,
        levelDict: true,
        kpis: { orderBy: { sortOrder: "asc" } },
        milestones: { orderBy: { type: "asc" } },
        todos: { orderBy: { sortOrder: "asc" } },
        paymentRecords: { orderBy: { paymentDate: "asc" } },
      },
      orderBy: { createdAt: "desc" },
    });

    // 扁平化数据
    const rows = projects.map((p) => ({
      ID: p.id,
      项目名称: p.name,
      项目编号: p.projectCode ?? "",
      项目类别: p.categoryDict?.value ?? "",
      收款公司主体: p.companyEntityDict?.value ?? "",
      项目级别: p.levelDict?.value ?? "",
      总金额_万: p.totalAmount ?? 0,
      已到账_万: p.receivedAmount,
      到账时间: p.receivedDate ? new Date(p.receivedDate).toISOString().slice(0, 10) : "",
      归属: p.affiliation ?? "",
      负责人飞书OpenID: p.ownerFeishuOpenId ?? "",
      周重点: p.isWeekFocus ? "是" : "否",
      待办事项: p.todoItems ?? "",
      沟通群组: p.communicationGroups ?? "",
      备注: p.remark ?? "",
      创建时间: new Date(p.createdAt).toISOString(),
      更新时间: new Date(p.updatedAt).toISOString(),
      KPI总数: p.kpis.length,
      里程碑总数: p.milestones.length,
      待办总数: p.todos.length,
      到账记录数: p.paymentRecords.length,
    }));

    // 生成 Excel
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "重大项目备份");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

    // TODO: 上传到云存储或飞书云盘
    // 目前仅记录日志，实际生产需要将 buffer 上传到持久化存储
    logger.info("Backup complete", { projectCount: projects.length, fileSizeBytes: buffer.byteLength });

    // 可选：集成飞书云盘 API 上传文件
    // const uploadResult = await uploadToFeishuDrive(buffer, `重大项目备份-${new Date().toISOString().slice(0, 10)}.xlsx`);

    return NextResponse.json({
      success: true,
      count: projects.length,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    logger.error("Backup failed", e);
    return NextResponse.json({ error: "备份失败" }, { status: 500 });
  }
}
