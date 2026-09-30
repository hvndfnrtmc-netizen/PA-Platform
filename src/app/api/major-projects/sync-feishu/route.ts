/**
 * POST /api/major-projects/sync-feishu
 *
 * 将选中的重大项目单向同步到飞书多维表格。
 * 附件（proofMaterials）会从 Supabase URL 下载后上传到飞书，转换为真实的飞书 file_token。
 *
 * Body:   { ids: string[] }   最多 50 条
 * Response:
 *   200 { synced: number, failed: number, warnings?: string[], errors?: Array<{id,name,error}> }
 *   400 ids 格式错误或超限
 *   401/403 未登录 / 权限不足
 */

import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getTenantAccessToken } from "@/lib/feishu";
import {
  createMajorProjectBitableRecord,
  updateMajorProjectBitableRecord,
  type MajorProjectSyncData,
} from "@/lib/feishu-bitable";

// Prisma typed payload for query with dict includes
const _projectInclude = {
  levelDict:        true,
  categoryDict:     true,
  companyEntityDict:true,
  children:         { where: { deletedAt: null as null }, select: { name: true } },
} as const satisfies Prisma.MajorProjectInclude;
type ProjectFull = Prisma.MajorProjectGetPayload<{ include: typeof _projectInclude }>;

// ── 附件上传工具 ──────────────────────────────────────────────────

interface StoredFileItem {
  id?: string;
  name?: string;
  url?: string;
  type?: string;
  size?: number;
  uploadedAt?: string;
}

/**
 * 下载文件并上传到飞书 Drive，返回 file_token。
 * 失败时返回 null（跳过该附件，不中断整体同步）。
 */
async function uploadToFeishu(
  fileUrl:   string,
  fileName:  string,
  mimeType:  string,
  tableId:   string,
  token:     string,
): Promise<string | null> {
  try {
    const dlRes = await fetch(fileUrl);
    if (!dlRes.ok) throw new Error(`下载失败 HTTP ${dlRes.status}`);
    const buffer = Buffer.from(await dlRes.arrayBuffer());

    const form = new FormData();
    form.append("file_name",    fileName  || "attachment");
    form.append("parent_type",  "bitable_file");
    form.append("parent_node",  tableId);
    form.append("size",         String(buffer.byteLength));
    form.append("file", new Blob([buffer], { type: mimeType || "application/octet-stream" }), fileName || "attachment");

    const upRes = await fetch("https://open.feishu.cn/open-apis/drive/v1/medias/upload_all", {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
      body:    form,
    });
    const upJson = await upRes.json() as { code: number; msg: string; data?: { file_token?: string } };
    if (upJson.code !== 0) throw new Error(`飞书上传失败 code=${upJson.code} msg=${upJson.msg}`);
    return upJson.data?.file_token ?? null;
  } catch (e) {
    console.error(`[sync-feishu] 附件上传失败 (${fileName}):`, e);
    return null;
  }
}

/**
 * 简单并发控制：分批运行异步任务，每批 concurrency 个并行。
 */
async function runConcurrent<T>(
  tasks:       (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency).map(t => t());
    results.push(...(await Promise.all(batch)));
  }
  return results;
}

// ── 主处理逻辑 ────────────────────────────────────────────────────

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

  // 拉取项目全量数据
  const projects = (await prisma.majorProject.findMany({
    where:   { id: { in: ids }, deletedAt: null },
    include: _projectInclude,
  })) as ProjectFull[];

  const tableId = process.env.FEISHU_MAJOR_PROJECT_TABLE_ID ?? "";
  const token   = await getTenantAccessToken();

  let synced  = 0;
  const warnings: string[] = [];
  const errors: Array<{ id: string; name: string; error: string }> = [];

  for (const project of projects) {
    try {
      // ── 附件预处理：下载 Supabase URL → 上传飞书 → 获取 file_token ──
      const rawMaterials = Array.isArray(project.proofMaterials)
        ? (project.proofMaterials as StoredFileItem[])
        : [];

      const attachmentTasks = rawMaterials
        .filter(f => f.url)
        .map(f => async () => {
          const ft = await uploadToFeishu(
            f.url!,
            f.name ?? "attachment",
            f.type ?? "application/octet-stream",
            tableId,
            token,
          );
          if (!ft) warnings.push(`项目「${project.name}」的附件「${f.name ?? "attachment"}」上传失败，已跳过`);
          return ft ? { file_token: ft } : null;
        });

      const uploadResults = tableId
        ? await runConcurrent(attachmentTasks, 3)
        : [];
      const feishuAttachments = uploadResults.filter((r): r is { file_token: string } => r !== null);

      // ── 组装同步数据 ──
      const syncData: MajorProjectSyncData = {
        name:               project.name,
        projectCode:        project.projectCode,
        levelDict:          project.levelDict,
        categoryDict:       project.categoryDict,
        companyEntityDict:  project.companyEntityDict,
        companyEntityNames: project.companyEntityNames,
        totalAmount:        project.totalAmount,
        receivedAmount:     project.receivedAmount,
        receivedDate:       project.receivedDate,
        affiliation:        project.affiliation,
        progress:           project.progress,
        remark:             project.remark,
        isWeekFocus:        project.isWeekFocus,
      };

      let recordId = project.feishuRecordId ?? null;

      if (recordId) {
        // 尝试更新；若行已被删除则降级为创建
        try {
          await updateMajorProjectBitableRecord(recordId, syncData, feishuAttachments);
        } catch (updateErr) {
          const msg = updateErr instanceof Error ? updateErr.message : String(updateErr);
          if (msg.includes("1254043") || msg.toLowerCase().includes("recordidnotfound")) {
            console.warn(`[sync-feishu] record_id ${recordId} 不存在，降级为创建`);
            const result = await createMajorProjectBitableRecord(syncData, feishuAttachments);
            if (result) recordId = result.recordId;
          } else {
            throw updateErr;
          }
        }
      } else {
        const result = await createMajorProjectBitableRecord(syncData, feishuAttachments);
        if (result) recordId = result.recordId;
      }

      // ── 回写 feishuRecordId ──
      if (recordId && recordId !== project.feishuRecordId) {
        const url = `https://${process.env.FEISHU_BASE_DOMAIN ?? "feishu.cn"}/base/${process.env.FEISHU_MAJOR_PROJECT_APP_TOKEN ?? ""}?table=${tableId}&record=${recordId}`;
        await prisma.majorProject.update({
          where: { id: project.id },
          data:  { feishuRecordId: recordId, feishuBitableUrl: url },
        });
      }

      synced++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[sync-feishu] 项目 ${project.id}（${project.name}）失败:`, msg);
      errors.push({ id: project.id, name: project.name, error: msg });
    }
  }

  return NextResponse.json({
    synced,
    failed: errors.length,
    ...(warnings.length > 0 && { warnings }),
    ...(errors.length  > 0 && { errors }),
  });
}
