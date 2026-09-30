/**
 * 路由守卫（Next.js 16 proxy.ts 约定，替代 middleware.ts）
 *
 * 保护 /dashboard/* 下的所有路由：
 *   1. 未登录 → 重定向到 /login
 *   2. DEPT_CONTACT 访问 PA 专属页面 → 重定向到 /dashboard/my-tasks
 *   3. 非 SUPER_ADMIN 访问 /dashboard/settings → 重定向到 /dashboard/tasks
 *
 * 角色路由权限矩阵：
 *   路由                   SUPER_ADMIN  PA_SPECIALIST  DEPT_CONTACT
 *   /dashboard/tasks           ✓             ✓              ✗
 *   /dashboard/assets          ✓             ✓              ✗
 *   /dashboard/awards          ✓             ✓          ✓/✗ (由 module_permissions 表控制，中间件放行)
 *   /dashboard/copilot         ✓             ✓          ✓/✗ (同上，预留)
 *   /dashboard/documents       ✓             ✓              ✗
 *   /dashboard/settings        ✓             ✗              ✗
 *   /dashboard/my-tasks        ✗             ✗              ✓
 */

import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// PA 专属路由（DEPT_CONTACT 无任何权限可访问）
// /dashboard/awards 已移出：由 module_permissions 表 + API 动态控制
const PA_ONLY_PREFIXES = [
  "/dashboard/tasks",
  "/dashboard/assets",
  "/dashboard/documents",
  "/dashboard/settings",
];

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;
    const role  = token?.role as string | undefined;

    // ── DEPT_CONTACT 访问 PA 专属路由 → 强制跳回填报工作台 ──────
    if (role === "DEPT_CONTACT") {
      const isPA = PA_ONLY_PREFIXES.some((p) => pathname.startsWith(p));
      if (isPA) {
        return NextResponse.redirect(new URL("/dashboard/my-tasks", req.url));
      }
    }

    // ── 非 SUPER_ADMIN 访问后台设置页 → 跳回任务台 ─────────────
    if (pathname.startsWith("/dashboard/settings") && role !== "SUPER_ADMIN") {
      return NextResponse.redirect(new URL("/dashboard/tasks", req.url));
    }

    // ── PA 角色误访问 my-tasks → 跳到任务台 ────────────────────
    if (
      pathname.startsWith("/dashboard/my-tasks") &&
      role !== "DEPT_CONTACT"
    ) {
      return NextResponse.redirect(new URL("/dashboard/tasks", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ["/dashboard/:path*"],
};
