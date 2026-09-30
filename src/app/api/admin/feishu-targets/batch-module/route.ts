/**
 * POST /api/admin/feishu-targets/batch-module
 *
 * 全量覆写模式：将指定 moduleName 的成员列表替换为 targetIds 所指定的集合。
 *
 * Body: { moduleName: string; targetIds: string[] }
 *
 * 流程（事务保证原子性）：
 *   1. 找到当前所有包含 moduleName 的记录 → 从其 modules 数组中移除
 *   2. 对 targetIds 中的每条记录 → 若尚未含该标签则追加
 *
 * 仅 SUPER_ADMIN 可调用。
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json() as {
    moduleName?: string;
    targetIds?:  string[];
  };

  const { moduleName, targetIds = [] } = body;

  if (!moduleName?.trim())
    return NextResponse.json({ error: "moduleName 不能为空" }, { status: 400 });

  let changed = 0;

  try {
    await prisma.$transaction(async (tx) => {
      // ── Step 1: 移除所有当前含该模块标签的记录 ─────────────────────
      const current = await tx.feishuNotificationTarget.findMany({
        where:  { modules: { has: moduleName } },
        select: { id: true, modules: true },
      });

      for (const t of current) {
        await tx.feishuNotificationTarget.update({
          where: { id: t.id },
          data:  { modules: t.modules.filter(m => m !== moduleName) },
        });
        changed++;
      }

      // ── Step 2: 为新的 targetIds 集合追加该模块标签 ─────────────────
      if (targetIds.length > 0) {
        const toAdd = await tx.feishuNotificationTarget.findMany({
          where:  { id: { in: targetIds } },
          select: { id: true, modules: true },
        });

        for (const t of toAdd) {
          if (!t.modules.includes(moduleName)) {
            await tx.feishuNotificationTarget.update({
              where: { id: t.id },
              data:  { modules: [...t.modules, moduleName] },
            });
            changed++;
          }
        }
      }
    });

    return NextResponse.json({ ok: true, changed, count: targetIds.length });
  } catch (err: unknown) {
    console.error("[batch-module] 事务失败:", err);
    const msg = err instanceof Error ? err.message : "数据库事务失败";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
