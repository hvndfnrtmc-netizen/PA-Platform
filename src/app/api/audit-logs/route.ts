/**
 * GET /api/audit-logs — 审计日志（SUPER_ADMIN only）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { AuditAction } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可查看审计日志" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const action      = searchParams.get("action") as AuditAction | null;
  const dangerous   = searchParams.get("dangerous");
  const take        = Math.min(Number(searchParams.get("take") ?? 30), 100);
  const skip        = Number(searchParams.get("skip") ?? 0);

  const where = {
    ...(action ? { action } : {}),
    ...(dangerous === "true" ? { isDangerous: true } : {}),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      take,
      skip,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total });
}
