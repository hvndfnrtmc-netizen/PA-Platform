/**
 * POST /api/users/batch
 *
 * 批量创建系统用户（SUPER_ADMIN only）。
 *
 * Body: {
 *   users:        [{ name: string; feishuId: string; email: string }];
 *   role:         string;   // UserRole，默认 DEPT_CONTACT
 *   departmentId: string | null;
 * }
 *
 * 按 feishuOpenId 和 email 双重去重，已存在则计入 skipped。
 * 返回: { created: number; skipped: number }
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { UserRole } from "@prisma/client";

function ip(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

interface UserInput {
  name:     string;
  feishuId: string;
  email:    string;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可批量创建用户" }, { status: 403 });

  const body = await req.json() as {
    users?:        UserInput[];
    role?:         string;
    departmentId?: string | null;
  };

  const { users = [], role = "DEPT_CONTACT", departmentId = null } = body;

  if (!Array.isArray(users) || users.length === 0)
    return NextResponse.json({ error: "users 列表不能为空" }, { status: 400 });

  let created = 0;
  let skipped = 0;

  for (const u of users) {
    const name     = u.name?.trim();
    const feishuId = u.feishuId?.trim();
    const email    = u.email?.trim().toLowerCase();

    if (!name || !feishuId || !email) { skipped++; continue; }

    // 双重去重：feishuOpenId 或 email 已存在则跳过
    const [byFeishu, byEmail] = await Promise.all([
      feishuId ? prisma.user.findUnique({ where: { feishuOpenId: feishuId }, select: { id: true } }) : null,
      email    ? prisma.user.findUnique({ where: { email },                  select: { id: true } }) : null,
    ]);

    if (byFeishu ?? byEmail) { skipped++; continue; }

    try {
      const newUser = await prisma.user.create({
        data: {
          name,
          email,
          role:         (role ?? "DEPT_CONTACT") as UserRole,
          departmentId: departmentId ?? null,
          feishuOpenId: feishuId,
        },
        select: { id: true, name: true, email: true, role: true },
      });
      created++;

      writeAuditLog({
        userId:       session.user.id,
        action:       AuditAction.CREATE_USER,
        resourceType: "user",
        resourceId:   newUser.id,
        metadata:     { name: newUser.name, email: newUser.email, role: newUser.role, batchImport: true },
        ipAddress:    ip(req),
      }).catch(console.error);
    } catch {
      // 意外冲突（并发等）也归入 skipped
      skipped++;
    }
  }

  return NextResponse.json({ created, skipped });
}
