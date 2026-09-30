/**
 * POST /api/tasks/parse-template
 *
 * 上传 Word/Excel 文件或云端链接，自动提取需要填报的字段列表。
 *
 * 接受方式：
 *   - multipart/form-data: file=<docx|xlsx>
 *   - application/json:    { cloudUrl: string }
 *
 * 响应：
 *   { fields: FieldDef[], extractedText?: string, source: "llm"|"regex"|"manual" }
 */

import { NextRequest, NextResponse } from "next/server";
import PizZip from "pizzip";
import * as XLSX from "xlsx";
import { generateResponse } from "@/lib/llm";
import { getSession } from "@/lib/auth";

// ── 字段定义类型 ──────────────────────────────────────────────────

export interface FieldDef {
  fieldKey:  string;
  label:     string;
  unit:      string;
  required:  boolean;
  fieldType: "text" | "number" | "date";
  hint:      string;
  deptCode:  string;
}

// ── 文本提取 ──────────────────────────────────────────────────────

function extractTextFromDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer);
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000); // 限制长度，避免超出 token
}

function extractTextFromXlsx(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames.slice(0, 3)) {
    const sheet = workbook.Sheets[sheetName];
    const rows  = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "" });
    lines.push(`[工作表: ${sheetName}]`);
    for (const row of rows.slice(0, 50)) {
      const cells = (row as string[]).filter((c) => c !== "");
      if (cells.length > 0) lines.push(cells.join(" | "));
    }
  }

  return lines.join("\n").slice(0, 8000);
}

// ── LLM 字段提取 ──────────────────────────────────────────────────

const EXTRACT_PROMPT = (text: string) => `
你是一个表单字段提取专家。请分析以下文档内容，识别所有需要用户填报的字段。

文档内容：
\`\`\`
${text}
\`\`\`

请返回一个 JSON 数组，每个元素代表一个需要填报的字段，严格按照以下格式：
[
  {
    "fieldKey": "snake_case英文命名，唯一，如 total_patents",
    "label": "字段的中文名称，如 累计专利总数",
    "unit": "单位，如 km、万元、人、件（无单位留空字符串）",
    "required": true,
    "fieldType": "number（数值/金额/数量）或 text（文字/名称）或 date（日期/时间）",
    "hint": "简短的填报说明（可选，无说明留空字符串）",
    "deptCode": "对应填报部门代码（无则留空，如 FINANCE/RD/HR/OPERATION/LEGAL）"
  }
]

规则：
1. 只返回 JSON 数组，不要有任何其他文字和 markdown 代码块标记
2. fieldKey 必须是唯一的英文小写+下划线命名
3. 数值类（金额、数量、里程、面积等）使用 fieldType: "number"
4. 日期类（时间、年份、季度、有效期）使用 fieldType: "date"
5. 识别不到任何字段时返回 []
6. 不要包含标题、说明文字等非填报字段
`.trim();

function safeParseFields(raw: string): FieldDef[] {
  // 先尝试直接 parse
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeFields(parsed);
  } catch {}
  // 从文本中提取 JSON 数组
  const m = raw.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (Array.isArray(parsed)) return normalizeFields(parsed);
    } catch {}
  }
  return [];
}

function normalizeFields(arr: unknown[]): FieldDef[] {
  return arr
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item, idx) => ({
      fieldKey:  String(item.fieldKey  ?? `field_${idx + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      label:     String(item.label     ?? `字段${idx + 1}`),
      unit:      String(item.unit      ?? ""),
      required:  Boolean(item.required ?? true),
      fieldType: (["text","number","date"].includes(String(item.fieldType)) ? item.fieldType : "text") as FieldDef["fieldType"],
      hint:      String(item.hint      ?? ""),
      deptCode:  String(item.deptCode  ?? ""),
    }));
}

// ── 正则兜底（LLM 不可用时）────────────────────────────────────

function extractFieldsByRegex(text: string): FieldDef[] {
  const fields: FieldDef[] = [];
  // 匹配「中文标签 + 数字/空格/下划线 + 单位」模式
  const patterns = [
    /([^：:\n]{2,12})[:：]\s*(?:_{2,}|\[.*?\]|（.*?）|\s{3,})/g,
    /填写([^，。\n]{2,15})/g,
    /请填[报写]([^，。\n]{2,15})/g,
  ];
  const seen = new Set<string>();
  for (const pat of patterns) {
    for (const m of text.matchAll(pat)) {
      const label = m[1].trim();
      if (label && !seen.has(label)) {
        seen.add(label);
        fields.push({
          fieldKey:  `field_${fields.length + 1}`,
          label,
          unit:      "",
          required:  true,
          fieldType: /里程|金额|收入|专利|人数|数量|总数|面积/.test(label) ? "number" : "text",
          hint:      "",
          deptCode:  "",
        });
      }
    }
  }
  return fields.slice(0, 20);
}

// ── Route Handler ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const contentType = req.headers.get("content-type") ?? "";

  // ── 云端链接模式：直接返回空字段列表，提示手动添加 ─────────────
  if (contentType.includes("application/json")) {
    const { cloudUrl } = await req.json() as { cloudUrl?: string };
    if (cloudUrl) {
      // 用 LLM 根据 URL 推断可能需要的字段（URL 包含文档名称时有效）
      try {
        const prompt = `根据以下文档链接（无法直接访问），根据 URL 中的文件名、路径等信息推断该文档可能需要填报哪些字段。
URL: ${cloudUrl}
请返回 JSON 字段数组（格式同表单解析），如果无法推断请返回 []。`;
        const raw  = await generateResponse(prompt);
        const fields = safeParseFields(raw);
        if (fields.length > 0) {
          return NextResponse.json({ fields, source: "llm" });
        }
      } catch {/* ignore */}
      // 无法推断时返回一个空字段，提示用户手动添加
      return NextResponse.json({
        fields: [],
        source: "manual",
        message: "云端链接无法自动解析，请手动添加字段",
      });
    }
  }

  // ── 文件上传模式 ──────────────────────────────────────────────
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "请上传文件或提供云端链接" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "未收到文件" }, { status: 400 });

  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "文件大小不能超过 10MB" }, { status: 400 });

  const buf  = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  let extractedText = "";
  try {
    if (name.endsWith(".docx")) {
      extractedText = extractTextFromDocx(buf);
    } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      extractedText = extractTextFromXlsx(buf);
    } else {
      return NextResponse.json({ error: "仅支持 .docx 或 .xlsx/.xls 格式" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: `文件解析失败：${err instanceof Error ? err.message : "格式异常"}` },
      { status: 422 }
    );
  }

  if (!extractedText.trim()) {
    return NextResponse.json({ fields: [], source: "empty", message: "文件内容为空，请检查文件" });
  }

  // 尝试 LLM 提取
  let fields: FieldDef[] = [];
  let source: string = "regex";
  try {
    const raw = await generateResponse(EXTRACT_PROMPT(extractedText));
    fields = safeParseFields(raw);
    source = "llm";
  } catch (err) {
    console.warn("[parse-template] LLM 调用失败，降级到正则提取:", err instanceof Error ? err.message : err);
    fields = extractFieldsByRegex(extractedText);
    source = "regex";
  }

  return NextResponse.json({ fields, extractedText: extractedText.slice(0, 500), source });
}
