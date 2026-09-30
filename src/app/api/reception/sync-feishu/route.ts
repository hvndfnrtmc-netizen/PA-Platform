/**
 * POST /api/reception/sync-feishu
 *
 * 手动触发接待记录到飞书多维表格的单向同步。
 * 精准白名单字段：日期 / 会议名称 / 级别 / 主接待 / 形式 / 背景 / 来访目的 / 状态
 *
 * Body: { ids: string[] }  —— 最多 50 条
 * Response:
 *   200 { synced: number, failed: number, errors?: Array<{id,title,error}> }
 *   400 ids 格式错误或超限
 *   401/403 未登录 / 权限不足
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { createBitableRecord, updateBitableRecord } from "@/lib/feishu-bitable";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json() as { ids?: unknown };
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];

  if (ids.length === 0)
    return NextResponse.json({ error: "ids 不能为空" }, { status: 400 });
  if (ids.length > 50)
    return NextResponse.json({ error: "单次最多同步 50 条" }, { status: 400 });

  // 查询记录，带 hostUser 用于姓名回退
  const receptions = await prisma.reception.findMany({
    where:   { id: { in: ids }, deletedAt: null },
    include: { hostUser: { select: { name: true } } },
  });

  let synced = 0;
  const errors: Array<{ id: string; title: string; error: string }> = [];

  for (const r of receptions) {
    // ── 精准白名单字段映射 ──────────────────────────────────────────
    const syncData = {
      title:      r.title,
      startTime:  r.startTime,
      level:      r.level,
      hostName:   r.hostName,
      hostUser:   r.hostUser,
      dressCode:  r.dressCode,
      purpose:    r.purpose,
      status:     r.status,
      formats:    r.formats,
      background: r.background,
    };

    try {
      if (r.feishuRecordId) {
        // 尝试更新；若行已不存在则自动降级为创建
        try {
          await updateBitableRecord(r.feishuRecordId, syncData);
        } catch (updateErr) {
          const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
          if (msg.includes("1254043") || msg.toLowerCase().includes("recordidnotfound")) {
            // 飞书行已被删除，重新创建并回写新 record_id
            console.warn(`[Bitable Sync] record_id ${r.feishuRecordId} 不存在，降级为创建`);
            const result = await createBitableRecord(syncData);
            if (result) {
              await prisma.reception.update({
                where: { id: r.id },
                data:  { feishuRecordId: result.recordId, feishuBitableUrl: result.url },
              });
            }
          } else {
            throw updateErr; // 其他错误继续抛出
          }
        }
      } else {
        // 首次同步 → 创建行，并将 record_id 回写数据库
        const result = await createBitableRecord(syncData);
        if (result) {
          await prisma.reception.update({
            where: { id: r.id },
            data:  { feishuRecordId: result.recordId, feishuBitableUrl: result.url },
          });
        }
      }
      synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Bitable Sync] 记录 ${r.id}（${r.title}）失败:`, msg);
      errors.push({ id: r.id, title: r.title, error: msg });
    }
  }

  return NextResponse.json({
    synced,
    failed: errors.length,
    ...(errors.length > 0 && { errors }),
  });
}
