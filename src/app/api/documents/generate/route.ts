/**
 * POST /api/documents/generate
 * 表单模式：从字段生成政府公文 .docx
 *
 * 修复：直接在响应中返回二进制 Word 文件（Content-Disposition: attachment），
 * 避免前端使用 window.open() 被浏览器弹窗拦截器阻止下载。
 * 同时保留 DB 记录和磁盘文件，供历史记录下载复用。
 */

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { buildGovDoc, GovDocFields } from "@/lib/doc-builder";
import { writeAuditLog, AuditAction } from "@/lib/audit";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json();
  const {
    title, header, subtitle, salutation,
    body: docBody, signer, date, taskId,
  } = body as {
    title: string; header?: string; subtitle?: string;
    salutation?: string; body: string; signer?: string;
    date?: string; taskId?: string;
  };

  if (!title?.trim())   return NextResponse.json({ error: "标题不能为空" }, { status: 400 });
  if (!docBody?.trim()) return NextResponse.json({ error: "正文不能为空" }, { status: 400 });

  // ── 解析占位符，从 assets 大盘取值 ────────────────────────────
  const rawKeys    = [...(docBody.matchAll(/\{\{([^}]+)\}\}/g) ?? [])].map(m => m[1].trim());
  const uniqueKeys = [...new Set(rawKeys)];

  const assetRows = uniqueKeys.length
    ? await prisma.asset.findMany({
        where:  { metricKey: { in: uniqueKeys } },
        select: {
          metricKey: true, metricName: true, value: true,
          unit: true, period: true, id: true, sourceFeishuUrl: true,
        },
      })
    : [];

  const assetMap = new Map(assetRows.map(a => [a.metricKey, a]));
  const placeholderMap: Record<string, {
    value: string; assetId: string; metricName: string; sourceFeishuUrl: string | null;
  } | null> = {};

  let filledBody = docBody;
  for (const key of uniqueKeys) {
    const asset = assetMap.get(key);
    if (asset) {
      const display = asset.unit ? `${asset.value}${asset.unit}` : asset.value;
      filledBody = filledBody.replaceAll(`{{${key}}}`, display);
      placeholderMap[key] = {
        value: display, assetId: asset.id,
        metricName: asset.metricName, sourceFeishuUrl: asset.sourceFeishuUrl,
      };
    } else {
      placeholderMap[key] = null;
    }
  }

  // ── 生成 Word 文档 Buffer ────────────────────────────────────
  const fields: GovDocFields = {
    header:     header?.trim() || undefined,
    mainTitle:  title.trim(),
    subtitle:   subtitle?.trim() || undefined,
    salutation: salutation?.trim() || undefined,
    body:       filledBody,
    signer:     signer?.trim() || undefined,
    date:       date?.trim() || undefined,
  };

  const buf = await buildGovDoc(fields);

  // ── 保存 DB 记录（供历史列表复用）────────────────────────────
  const doc = await prisma.document.create({
    data: {
      title:        title.trim(),
      templateFile: "form-generated",
      renderStatus: "DONE",
      taskId:       taskId ?? null,
      createdById:  session.user.id,
    },
  });

  // 尝试落盘（本地开发有效；Vercel 生产环境 /tmp 外不可写，但下载走二进制流不依赖本地文件）
  try {
    const genDir  = path.join(process.cwd(), UPLOAD_DIR, "generated");
    await mkdir(genDir, { recursive: true });
    const outPath = path.join(genDir, `${doc.id}.docx`);
    await writeFile(outPath, buf);
    await prisma.document.update({
      where: { id: doc.id },
      data:  { outputFile: `generated/${doc.id}.docx`, placeholderMap },
    });
  } catch (fsErr) {
    // 落盘失败不阻断响应（Vercel 无持久化文件系统）
    console.warn("[generate] 落盘失败（Vercel 环境正常）:", fsErr);
    await prisma.document.update({
      where: { id: doc.id },
      data:  { placeholderMap },
    }).catch(() => {});
  }

  writeAuditLog({
    userId: session.user.id, action: AuditAction.GENERATE_DOCUMENT,
    resourceType: "Document", resourceId: doc.id,
    metadata: { title, mode: "form", placeholders: uniqueKeys.length },
  }).catch(console.error);

  // ── 直接流式返回二进制 Word 文件（修复：避免 window.open 弹窗拦截）──
  const filename = encodeURIComponent(`${title.trim()}.docx`);
  return new NextResponse(new Uint8Array(buf), {
    status: 201,
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
      "X-Document-Id":       doc.id,
    },
  });
}
