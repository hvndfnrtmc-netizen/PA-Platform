/**
 * GET  /api/users  — 用户列表（SUPER_ADMIN only）
 * POST /api/users  — 创建用户（SUPER_ADMIN only）
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { writeAuditLog, AuditAction } from "@/lib/audit";
import { UserRole } from "@prisma/client";
import { pinyin } from "pinyin-pro";

function ip(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    undefined
  );
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  // 非 SUPER_ADMIN 只能查询 departmentId 过滤（用于级联选择器），其余操作仍需管理员权限
  const isAdmin = session.user.role === "SUPER_ADMIN" || session.user.role === "PA_SPECIALIST";
  const { searchParams } = new URL(req.url);
  const departmentId = searchParams.get("departmentId");

  // 非管理员只能按 departmentId 查（为级联选择器服务），不允许无条件拉全量
  if (!isAdmin && !departmentId) {
    return NextResponse.json({ error: "权限不足" }, { status: 403 });
  }

  const q    = searchParams.get("q") ?? "";
  console.log("🔍 [Search Triggered] 收到关键字:", q);
  const role = searchParams.get("role") as UserRole | null;
  const take = Math.min(Number(searchParams.get("take") ?? 50), 200);
  const skip = Number(searchParams.get("skip") ?? 0);

  // 中文转拼音乱序匹配：若 keyword 含中文则拆成拼音数组做 AND 查询
  const hasChinese = q ? /[\u4e00-\u9fff]/.test(q) : false;
  let searchCondition: Record<string, unknown> = {};

  if (q) {
    if (hasChinese) {
      // 拆成无音调拼音数组，如 "高凯敬" → ["gao","kai","jing"]
      const pyArray = pinyin(q, { toneType: "none", type: "array" }) as string[];
      searchCondition = {
        AND: pyArray.map(py => ({
          OR: [
            { name:        { contains: py, mode: "insensitive" as const } },
            { englishName: { contains: py, mode: "insensitive" as const } },
            { email:       { contains: py, mode: "insensitive" as const } },
          ],
        })),
      };
    } else {
      searchCondition = {
        OR: [
          { name:        { contains: q, mode: "insensitive" as const } },
          { englishName: { contains: q, mode: "insensitive" as const } },
          { email:       { contains: q, mode: "insensitive" as const } },
        ],
      };
    }
  }

  const where = {
    deletedAt: null,
    isActive: true,
    ...searchCondition,
    ...(role ? { role } : {}),
    ...(departmentId ? { departmentId } : {}),
  };

  try {
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          name: true,
          englishName: true,
          email: true,
          role: true,
          isActive: true,
          departmentId: true,
          feishuUserId: true,
          feishuOpenId: true,
          department: { select: { id: true, name: true, code: true } },
          lastLoginAt: true,
          createdAt: true,
          hasPartyModuleAccess: true,
        },
        orderBy: [{ role: "asc" }, { createdAt: "desc" }],
        take,
        skip,
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json({ users, total });
  } catch (err) {
    console.error("❌ [Search Failed] 数据库或执行报错:", err);
    return NextResponse.json(
      { error: "数据库查询失败，请重启开发服务器后重试", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "仅超级管理员可创建用户" }, { status: 403 });

  const body = await req.json();
  const { name, email, role, departmentId, feishuOpenId } = body;

  if (!name?.trim())  return NextResponse.json({ error: "姓名不能为空" }, { status: 400 });
  if (!email?.trim()) return NextResponse.json({ error: "邮箱不能为空" }, { status: 400 });

  const existing = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (existing) return NextResponse.json({ error: "该邮箱已存在" }, { status: 409 });

  if (feishuOpenId?.trim()) {
    const conflict = await prisma.user.findUnique({ where: { feishuOpenId: feishuOpenId.trim() } });
    if (conflict) {
      return NextResponse.json({ error: `该飞书 open_id 已被「${conflict.name}」使用` }, { status: 409 });
    }
  }

  const user = await prisma.user.create({
    data: {
      name:         name.trim(),
      email:        email.trim().toLowerCase(),
      role:         (role ?? "DEPT_CONTACT") as UserRole,
      departmentId: departmentId ?? null,
      feishuOpenId: feishuOpenId?.trim() || null,
    },
    select: {
      id: true, name: true, email: true, role: true, departmentId: true,
      feishuOpenId: true, createdAt: true,
      department: { select: { id: true, name: true } },
    },
  });

  writeAuditLog({
    userId: session.user.id,
    action: AuditAction.CREATE_USER,
    resourceType: "user",
    resourceId: user.id,
    metadata: { name: user.name, email: user.email, role: user.role },
    ipAddress: ip(req),
  }).catch(console.error);

  return NextResponse.json({ user }, { status: 201 });
}
