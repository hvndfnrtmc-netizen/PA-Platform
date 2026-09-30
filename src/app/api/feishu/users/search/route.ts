/**
 * GET /api/feishu/users/search?q=<keyword>
 *
 * 调用飞书通讯录搜索接口，返回匹配员工列表。
 * 需要飞书应用开通 contact:user.search:readonly 权限。
 * 仅 SUPER_ADMIN / PA_SPECIALIST 可调用。
 * API 失败时以 HTTP 500 将飞书错误码透传给前端，方便调试。
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchFeishuUsers } from "@/lib/feishu";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (q.trim().length < 1)
    return NextResponse.json({ users: [] });

  try {
    const users = await searchFeishuUsers(q.trim());
    return NextResponse.json({ users });
  } catch (err) {
    const message = (err as Error).message ?? "搜索失败";
    console.error("[Feishu Search] 最终错误:", message);
    // 将飞书具体错误 + 诊断信息透传给前端
    return NextResponse.json(
      {
        error: message,
        users: [],
        _debug: {
          app_id_prefix: process.env.FEISHU_APP_ID?.slice(0, 8) ?? "NOT_SET",
          hint: "查看 Vercel Functions 日志可获取完整 token 信息",
        },
      },
      { status: 500 }
    );
  }
}
