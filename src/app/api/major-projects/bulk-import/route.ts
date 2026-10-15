/**
 * POST /api/major-projects/bulk-import
 * 智能 Upsert：以项目名称为唯一标识，两阶段分块处理父子层级，自动匹配/创建字典
 *
 * 修复：使用 prisma.majorProject.upsert() 替代 findFirst + create/update，
 *       彻底避免 Unique constraint failed 错误；导入前在内存中按 name 去重。
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma, MilestoneType } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getAppAccessToken } from "@/lib/feishu";
import type { ParsedProject, FeishuAttachment } from "../parse-bitable/route";
import { extractYearFromName } from "@/lib/majorProjectUtils";
import { syncAwardFromProject } from "@/lib/syncAwardFromProject";

// Vercel Serverless 超时延长：附件下载/上传需要更多时间
export const maxDuration = 300;

// ── 工具：数组分块 ──────────────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

const CHUNK_SIZE = 50;
const TX_OPTIONS = { maxWait: 10000, timeout: 120000 };

// ── 里程碑 & KPI 辅助：在事务中写入生命周期节点和考核指标 ────────

async function upsertMilestonesAndKPIs(
  tx: Prisma.TransactionClient,
  projectId: string,
  proj: ParsedProject,
): Promise<void> {
  // 生命周期里程碑
  type MilestoneInput = { type: MilestoneType; date: Date };
  const milestones: MilestoneInput[] = [];
  if (proj.applyDate)    milestones.push({ type: MilestoneType.APPLY,     date: proj.applyDate });
  if (proj.startDate)    milestones.push({ type: MilestoneType.START,     date: proj.startDate });
  if (proj.midCheckDate) milestones.push({ type: MilestoneType.MID_CHECK, date: proj.midCheckDate });
  if (proj.endDate)      milestones.push({ type: MilestoneType.END,       date: proj.endDate });

  if (milestones.length > 0) {
    await tx.projectMilestone.deleteMany({
      where: { projectId, type: { in: milestones.map(m => m.type) } },
    });
    await tx.projectMilestone.createMany({
      data: milestones.map(m => ({ projectId, type: m.type, date: m.date })),
    });
  }

  // 考核指标 KPI
  if (proj.kpis && proj.kpis.length > 0) {
    const names = proj.kpis.map(k => k.name);
    await tx.projectKPI.deleteMany({ where: { projectId, name: { in: names } } });
    await tx.projectKPI.createMany({
      data: proj.kpis.map((k, i) => ({
        projectId,
        name:      k.name,
        content:   k.content ?? null,
        sortOrder: i,
      })),
    });
  }
}

// ── 附件：Feishu Drive 下载 + Supabase Storage 上传 ─────────────

const BUCKET = "major-project-files";

function getProjectRef(): string {
  // 优先从 SUPABASE_URL 解析，兼容非 Supabase 数据库（如 Neon）
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const m1 = supabaseUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  if (m1) return m1[1];
  const url   = process.env.DATABASE_URL ?? "";
  const match = url.match(/postgres\.([a-z0-9]+):/);
  return match?.[1] ?? "";
}

/** 用飞书 Drive v1 medias 接口下载附件二进制内容（需 app_access_token）*/
async function downloadFeishuFile(fileToken: string): Promise<Buffer> {
  const token = await getAppAccessToken();
  const url   = `https://open.feishu.cn/open-apis/drive/v1/medias/${encodeURIComponent(fileToken)}/download`;
  const res   = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const err = await res.json() as { code?: number; msg?: string };
      throw new Error(`飞书附件下载失败 code=${err.code} msg=${err.msg}`);
    }
    throw new Error(`飞书附件下载失败 HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** 将 Buffer 上传到 Supabase Storage，返回 public URL */
async function uploadToSupabase(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  projectRef: string,
  serviceKey: string,
): Promise<string> {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileId   = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path     = `imports/${fileId}_${safeName}`;

  const supabaseBase = `https://${projectRef}.supabase.co/storage/v1`;

  // 确保 bucket 存在（忽略已存在的冲突）
  await fetch(`${supabaseBase}/bucket`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });

  const uploadRes = await fetch(`${supabaseBase}/object/${BUCKET}/${path}`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": mimeType, "x-upsert": "true" },
    body:    buffer as unknown as BodyInit,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`Supabase 上传失败: ${errText}`);
  }

  return `${supabaseBase}/object/public/${BUCKET}/${path}`;
}

interface StoredFileItem {
  id: string;
  name: string;
  url: string;
  type: "image" | "pdf" | "doc" | "other";
  size?: number;
  uploadedAt: string;
}

/**
 * 串行处理单个项目的附件列表：下载 → 上传 → 返回 StoredFileItem[]。
 * 单个文件失败不中断整体，只打印警告后跳过。
 */
async function processAttachments(
  attachments: FeishuAttachment[],
  projectRef: string,
  serviceKey: string,
): Promise<StoredFileItem[]> {
  const result: StoredFileItem[] = [];
  for (const att of attachments) {
    try {
      const buffer    = await downloadFeishuFile(att.file_token);
      const publicUrl = await uploadToSupabase(buffer, att.name, att.type, projectRef, serviceKey);

      let fileType: StoredFileItem["type"] = "other";
      if (att.type.startsWith("image/"))    fileType = "image";
      else if (att.type === "application/pdf") fileType = "pdf";
      else if (att.type.includes("word") || att.name.match(/\.(doc|docx)$/i)) fileType = "doc";

      result.push({
        id:         `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name:       att.name,
        url:        publicUrl,
        type:       fileType,
        size:       att.size,
        uploadedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.warn(`[bulk-import] 附件处理失败，已跳过: "${att.name}"`, (e as Error).message);
    }
  }
  return result;
}

// ── 字典缓存（在同一次请求中复用，跨 chunk 共享） ──────────────

type DictMap = Map<string, string>; // value → id

async function loadOrCreateDict(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  category: string,
  value: string | null | undefined,
  cache: DictMap,
): Promise<string | null> {
  if (!value?.trim()) return null;
  const v = value.trim();
  const key = `${category}::${v}`;
  if (cache.has(key)) return cache.get(key)!;

  let entry = await tx.majorProjectDictionary.findFirst({
    where: { category, value: v, isActive: true },
  });
  if (!entry) {
    entry = await tx.majorProjectDictionary.create({
      data: { category, value: v, isActive: true },
    });
  }

  cache.set(key, entry.id);
  return entry.id;
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });
  const userId = session.user.id;

  let body: { projects?: unknown };
  try {
    body = await req.json() as { projects?: unknown };
  } catch {
    return NextResponse.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!Array.isArray(body.projects) || body.projects.length === 0)
    return NextResponse.json({ error: "projects 不能为空" }, { status: 400 });
  if (body.projects.length > 500)
    return NextResponse.json({ error: "单次最多导入 500 条" }, { status: 400 });

  // ── 内存去重：按 name 去重，重复名称保留最后一条 ──────────────
  const raw = body.projects as ParsedProject[];
  const dedupMap = new Map<string, ParsedProject>();
  for (const proj of raw) {
    if (proj.name?.trim()) dedupMap.set(proj.name.trim(), proj);
  }
  const projects = Array.from(dedupMap.values());

  // ── 预查哪些名称已存在，用于统计 created / updated ────────────
  const allNames = projects.map(p => p.name.trim());
  const existingRecords = await prisma.majorProject.findMany({
    where: { name: { in: allNames } },
    select: { name: true },
  });
  const existingNames = new Set(existingRecords.map(e => e.name));

  // ── 附件预处理：在 DB 事务之前完成所有 Feishu 下载 + Supabase 上传 ──
  const proofMaterialsMap = new Map<string, StoredFileItem[]>(); // name → uploaded files
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const projectRef = getProjectRef();

  if (serviceKey && projectRef) {
    for (const proj of projects) {
      if (!proj.proofMaterialFiles?.length) continue;
      const files = await processAttachments(proj.proofMaterialFiles, projectRef, serviceKey);
      if (files.length > 0) proofMaterialsMap.set(proj.name.trim(), files);
    }
  } else {
    console.warn("[bulk-import] 跳过附件处理：SUPABASE_SERVICE_ROLE_KEY 或 projectRef 未配置");
  }

  // 跨 chunk 共享的字典缓存和父项目映射
  const dictCache: DictMap = new Map();
  const parentIdMap = new Map<string, string>();         // projectName → DB id
  const feishuRecordToDbId = new Map<string, string>(); // feishuRecordId → DB id

  let created = 0;
  let updated = 0;
  // 收集需要同步到荣誉资质库的项目 ID（在事务外统一处理）
  const honorSyncIds: string[] = [];

  try {
    // ══════════════════════════════════════════════════════════════════
    // 两遍遍历（Two-Pass）Import — 彻底修复父子层级丢失问题
    //
    // 第一遍：全量无差别入库（先不建层级）
    //   → 所有记录 upsert，不设置 parentId，同时写里程碑 & KPI
    //   → 构建 feishuRecordId → DB id 映射
    //
    // 第二遍：仅用飞书原生 feishuRecordId 精确建层级（严禁名称模糊匹配）
    //   → 只对有 feishuParentId 的记录，通过 feishuRecordId 1 对 1 挂载父项目
    // ══════════════════════════════════════════════════════════════════

    // ── 导入前：强行重置所有项目的父子关系，防止历史脏数据累积 ──────
    await prisma.majorProject.updateMany({ data: { parentId: null } });
    console.log("[bulk-import] 已重置所有项目的 parentId，从白纸开始建树");

    // ── 第一遍：全量 Upsert（不含 parentId） ─────────────────────
    for (const chunk of chunkArray(projects, CHUNK_SIZE)) {
      await prisma.$transaction(async (tx) => {
        for (const proj of chunk) {
          if (!proj.name?.trim()) continue;
          const name = proj.name.trim();

          const categoryDictId = await loadOrCreateDict(tx, "category", proj.categoryDict, dictCache);
          const levelDictId     = await loadOrCreateDict(tx, "level",    proj.levelDict,    dictCache);

          // companyEntityDict 现在是 string[] | null（已在解析层拆分）
          const companyNames: string[] = Array.isArray(proj.companyEntityDict)
            ? proj.companyEntityDict
            : (proj.companyEntityDict ? [proj.companyEntityDict as unknown as string] : []);
          let firstCompanyDictId: string | null = null;
          for (const cName of companyNames) {
            const did = await loadOrCreateDict(tx, "companyEntity", cName, dictCache);
            if (firstCompanyDictId === null) firstCompanyDictId = did;
          }

          const processedFiles = proofMaterialsMap.get(name);
          // 第一遍故意不设 parentId，等第二遍统一建层级
          const fields = {
            projectCode:         proj.projectCode         ?? null,
            isWeekFocus:         proj.isWeekFocus         ?? false,
            remark:              proj.remark              ?? null,
            categoryDictId,
            levelDictId,
            companyEntityDictId: firstCompanyDictId,
            companyEntityNames:  companyNames,
            totalAmount:         proj.totalAmount         ?? null,
            receivedAmount:      proj.receivedAmount      ?? 0,
            receivedDate:        proj.receivedDate        ?? null,
            affiliation:         proj.affiliation         ?? null,
            progress:            proj.progress            ?? "未开始",
            extractedYear:       extractYearFromName(name),
            deletedAt:           null,
            ...(proj.feishuRecordId ? { feishuRecordId: proj.feishuRecordId } : {}),
            ...(proj.applyDate    ? { applyDate:    proj.applyDate    } : {}),
            ...(proj.startDate    ? { startDate:    proj.startDate    } : {}),
            ...(proj.midCheckDate ? { midCheckDate: proj.midCheckDate } : {}),
            ...(proj.endDate      ? { endDate:      proj.endDate      } : {}),
            ...(processedFiles ? { proofMaterials: processedFiles as unknown as Prisma.InputJsonValue } : {}),
          };

          // upsert：优先用 feishuRecordId；否则用 name（@unique 约束）
          let rec;
          if (proj.feishuRecordId) {
            const existing = await tx.majorProject.findUnique({ where: { feishuRecordId: proj.feishuRecordId } });
            if (existing) {
              rec = await tx.majorProject.update({ where: { feishuRecordId: proj.feishuRecordId }, data: fields });
            } else {
              rec = await tx.majorProject.upsert({ where: { name }, update: fields, create: { name, ...fields } });
            }
          } else {
            rec = await tx.majorProject.upsert({ where: { name }, update: fields, create: { name, ...fields } });
          }

          // 写入生命周期里程碑 & 考核指标
          await upsertMilestonesAndKPIs(tx, rec.id, proj);

          // 若有已到账金额和到账时间，自动生成一条明细节点（防重：remark 固定为"飞书导入自动生成"）
          if ((proj.receivedAmount ?? 0) > 0 && proj.receivedDate) {
            const existingPayment = await tx.projectPaymentRecord.findFirst({
              where: { projectId: rec.id, remark: "飞书导入自动生成" },
            });
            if (!existingPayment) {
              await tx.projectPaymentRecord.create({
                data: {
                  projectId:   rec.id,
                  amount:      proj.receivedAmount!,
                  paymentDate: proj.receivedDate,
                  remark:      "飞书导入自动生成",
                },
              });
            } else {
              // 仅更新金额和日期，保持幂等
              await tx.projectPaymentRecord.update({
                where: { id: existingPayment.id },
                data:  { amount: proj.receivedAmount!, paymentDate: proj.receivedDate },
              });
            }
          }

          // 构建双向映射供第二遍使用
          parentIdMap.set(name, rec.id);
          if (proj.feishuRecordId) feishuRecordToDbId.set(proj.feishuRecordId, rec.id);
          if (existingNames.has(name)) updated++; else created++;

          // 若为「荣誉资质」类别，加入同步队列（事务外统一处理）
          if (proj.categoryDict?.trim() === "荣誉资质") {
            honorSyncIds.push(rec.id);
          }
        }
      }, TX_OPTIONS);
    }

    // ── 第二遍：严格基于 feishuRecordId 建立父子层级（禁止名称模糊匹配） ──
    // 只处理携带 feishuParentId 的记录，通过飞书原生 record_id 1 对 1 精确挂载
    const projectsWithParent = projects.filter(p => !!p.feishuParentId);

    for (const chunk of chunkArray(projectsWithParent, CHUNK_SIZE)) {
      await prisma.$transaction(async (tx) => {
        for (const proj of chunk) {
          if (!proj.name?.trim() || !proj.feishuParentId) continue;
          const name = proj.name.trim();

          // 诊断日志：输出关键项目的父 ID 信息，帮助确认飞书是否返回了 parent_record_id
          if (name.includes("创新联合体")) {
            console.log(`【层级诊断】${name} 的 feishuParentId 是:`, proj.feishuParentId);
          }

          // 严格：只使用 feishuParentId → feishuRecordId 精确匹配，禁止名称兜底
          let resolvedParentId: string | null = feishuRecordToDbId.get(proj.feishuParentId) ?? null;
          if (!resolvedParentId) {
            // 内存 map 中没有（跨 chunk 情况），直接查库
            const parentRec = await tx.majorProject.findFirst({
              where: { feishuRecordId: proj.feishuParentId },
              select: { id: true },
            });
            resolvedParentId = parentRec?.id ?? null;
          }

          if (!resolvedParentId) {
            console.warn(`[bulk-import] 未找到父项目 feishuRecordId="${proj.feishuParentId}"，子项目"${name}"保持顶层`);
            continue;
          }

          // 仅更新 parentId，其余字段第一遍已写入
          if (proj.feishuRecordId) {
            await tx.majorProject.update({
              where: { feishuRecordId: proj.feishuRecordId },
              data: { parentId: resolvedParentId },
            });
          } else {
            await tx.majorProject.update({
              where: { name },
              data: { parentId: resolvedParentId },
            });
          }
        }
      }, TX_OPTIONS);
    }

    // ── 自动同步「荣誉资质」到企业资质与奖项库 ──────────────────────
    for (const projectId of honorSyncIds) {
      await syncAwardFromProject(projectId, userId).catch(e =>
        console.warn(`[bulk-import] 荣誉资质同步失败 projectId=${projectId}:`, (e as Error).message)
      );
    }

    return NextResponse.json({
      success: true,
      created,
      updated,
      total: created + updated,
    }, { status: 201 });

  } catch (e) {
    console.error("[bulk-import] 失败:", e);
    return NextResponse.json(
      { error: `导入失败：${(e as Error).message}` },
      { status: 500 }
    );
  }
}
