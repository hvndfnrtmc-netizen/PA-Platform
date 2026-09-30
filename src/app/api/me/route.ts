/**
 * GET /api/me
 * 返回当前登录用户的基本信息，供客户端组件读取 role 做 UI 守卫。
 */

import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  return NextResponse.json({
    id:   session.user.id,
    name: session.user.name,
    role: session.user.role,
  });
}
