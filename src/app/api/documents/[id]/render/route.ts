/**
 * POST /api/documents/[id]/render
 * 模板模式：用 docxtemplater 替换占位符，生成成稿
 *
 * 修复一：查询所有 assets 作为 renderData，避免检测遗漏导致 key 缺失报错
 * 修复二：自定义 parser，对 renderData 中不存在的 key 保留原占位符而非抛出异常
 * 修复三：直接流式返回二进制 Word 文件，避免 window.open 被弹窗拦截器阻断
 */

import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { detectPlaceholders } from "@/lib/doc-builder";
import { writeAuditLog, AuditAction } from "@/lib/audit";

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "./uploads";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const { id } = await params;
  const doc = await prisma.document.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  if (doc.templateFile === "form-generated")
    return NextResponse.json({ error: "该记录是表单生成模式，不支持渲染" }, { status: 400 });
  if (doc.renderStatus === "RENDERING")
    return NextResponse.json({ error: "正在渲染中，请稍后" }, { status: 409 });

  // 标记渲染中
  await prisma.document.update({ where: { id }, data: { renderStatus: "RENDERING" } });

  try {
    // ── 读取模板 ────────────────────────────────────────────────
    const templatePath = path.join(process.cwd(), UPLOAD_DIR, doc.templateFile);
    const templateBuf  = await readFile(templatePath);

    // ── 修复一：查全量 assets 构建 renderData ──────────────────
    // 不再只依赖上传时检测到的 keys（检测可能因 Word 内部 XML 分段而遗漏）
    // docxtemplater 会自动只替换模板中实际存在的占位符
    const allAssets = await prisma.asset.findMany({
      select: {
        metricKey: true, metricName: true, value: true,
        unit: true, id: true, sourceFeishuUrl: true,
      },
    });

    const assetMap  = new Map(allAssets.map(a => [a.metricKey, a]));
    const renderData: Record<string, string> = {};
    for (const a of allAssets) {
      renderData[a.metricKey] = a.unit ? `${a.value}${a.unit}` : a.value;
    }

    // ── 重新检测占位符（用于 placeholderMap 记录，供历史 UI 展示）──
    const freshKeys  = detectPlaceholders(templateBuf);
    const storedKeys = Object.keys((doc.placeholderMap ?? {}) as Record<string, unknown>);
    const displayKeys = [...new Set([...storedKeys, ...freshKeys])];

    const placeholderMap: Record<string, {
      value: string; assetId: string; metricName: string; sourceFeishuUrl: string | null;
    } | null> = {};
    for (const key of displayKeys) {
      const asset = assetMap.get(key);
      if (asset) {
        const display = asset.unit ? `${asset.value}${asset.unit}` : asset.value;
        placeholderMap[key] = {
          value: display, assetId: asset.id,
          metricName: asset.metricName, sourceFeishuUrl: asset.sourceFeishuUrl,
        };
      } else {
        placeholderMap[key] = null;
      }
    }

    // ── 修复二：自定义 parser，对缺失 key 保留原占位符而非抛出异常 ──
    const zip  = new PizZip(templateBuf);
    const tmpl = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks:    true,
      delimiters:    { start: "{{", end: "}}" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      parser: (tag: string) => ({
        get: (scope: Record<string, string>) => {
          const val = scope[tag];
          // 若资产大盘中无此 key，保留原占位符文本
          return val !== undefined && val !== null ? val : `{{${tag}}}`;
        },
      }),
    });

    tmpl.render(renderData);
    const outBuf = tmpl.getZip().generate({ type: "nodebuffer" }) as Buffer;

    // ── 保存成稿（本地开发有效，Vercel 生产需 Supabase Storage）──
    try {
      const genDir  = path.join(process.cwd(), UPLOAD_DIR, "generated");
      await mkdir(genDir, { recursive: true });
      const outPath = path.join(genDir, `${id}.docx`);
      await writeFile(outPath, outBuf);
      await prisma.document.update({
        where: { id },
        data:  { outputFile: `generated/${id}.docx`, renderStatus: "DONE", placeholderMap, renderError: null },
      });
    } catch (fsErr) {
      console.warn("[render] 落盘失败（Vercel 环境正常）:", fsErr);
      await prisma.document.update({
        where: { id },
        data:  { renderStatus: "DONE", placeholderMap, renderError: null },
      });
    }

    writeAuditLog({
      userId: session.user.id, action: AuditAction.GENERATE_DOCUMENT,
      resourceType: "Document", resourceId: id,
      metadata: { title: doc.title, mode: "template", placeholders: displayKeys.length },
    }).catch(console.error);

    // ── 修复三：直接流式返回二进制，避免 window.open 弹窗拦截 ──
    const filename = encodeURIComponent(`${doc.title}.docx`);
    return new NextResponse(new Uint8Array(outBuf), {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "X-Document-Id":       id,
      },
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.document.update({
      where: { id },
      data:  { renderStatus: "FAILED", renderError: msg },
    });
    return NextResponse.json({ error: `渲染失败: ${msg}` }, { status: 500 });
  }
}
