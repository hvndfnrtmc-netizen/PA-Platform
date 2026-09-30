/**
 * POST /api/reception/parse-feishu
 * 读取飞书多维表格中的接待记录，解析后返回给前端预览（不写库）。
 * Body: { appToken: string, tableId: string, isWiki?: boolean }
 * Response: { records: ParsedReception[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { feishuRequest } from "@/lib/feishu";

export interface ParsedReception {
  title:           string;
  startTime:       string | null;
  endTime:         string | null;
  level:           string;
  hostName:        string;
  formats:         string[];
  dressCode:       string;
  background:      string;
  purpose:         string;
  status:          string;
  feishuRecordId:  string | null;  // 飞书 record_id，用于 upsert 去重
  _rawFields:      Record<string, unknown>; // 保留原始字段供调试
}

// ── 飞书字段解析工具（与 import-bitable 同一套） ───────────────

function extractText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) {
    if (v.length === 0) return "";
    const first = v[0] as Record<string, unknown>;
    if (first && typeof first === "object" && "name" in first && !("type" in first)) {
      return v.map(s => String((s as Record<string, unknown>).name ?? "")).filter(Boolean).join("、");
    }
    return v.map((s: unknown) => {
      if (typeof s === "string") return s;
      if (s && typeof s === "object") {
        const o = s as Record<string, unknown>;
        if ("text" in o) return String(o.text ?? "");
        if ("name" in o) return String(o.name ?? "");
      }
      return "";
    }).join("").trim();
  }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if ("text" in o) return String(o.text ?? "").trim();
    if ("name" in o) return String(o.name ?? "").trim();
  }
  return String(v).trim();
}

function cleanStr(v: unknown): string {
  const s = extractText(v);
  return s === "/" ? "" : s;
}

function toISOStr(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "number") return new Date(v).toISOString();
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function extractMultiSelect(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) {
    return v.map(item => {
      if (typeof item === "string") return item;
      const o = item as Record<string, unknown>;
      return String(o.text ?? o.name ?? "").trim();
    }).filter(Boolean);
  }
  // 单选对象
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const t = String(o.text ?? o.name ?? "").trim();
    return t ? [t] : [];
  }
  // 逗号/顿号分隔字符串
  const s = String(v).trim();
  return s ? s.split(/[,，、]/).map(x => x.trim()).filter(Boolean) : [];
}

async function resolveWikiToken(wikiToken: string): Promise<string> {
  const json = await feishuRequest(
    `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${wikiToken}`,
  ) as { code: number; msg: string; data?: { node?: { obj_token?: string } } };
  if (json.code !== 0) throw new Error(`飞书 Wiki API 错误 (${json.code}): ${json.msg}`);
  const token = json.data?.node?.obj_token;
  if (!token) throw new Error("Wiki 节点未返回 obj_token");
  return token;
}

// ── 字段名映射（宽松多候选） ──────────────────────────────────

function pick(f: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) { if (k in f) return f[k]; }
  return undefined;
}

function mapRecord(f: Record<string, unknown>, recordId?: string, isFirst?: boolean): ParsedReception {
  // 调试：打印第一条记录的原始字段，方便排查新表格的列名与数据结构
  if (isFirst) {
    console.log("[parse-feishu] 第一条记录原始字段:", JSON.stringify(f, null, 2));
  }
  return {
    // 实际列名 "会议名称/来访人员" 优先，再兜底旧候选
    title:      cleanStr(pick(f,
      "会议名称/来访人员", "会议名称", "来访人员",
      "来访单位", "来访代表", "接待名称", "标题", "名称",
    )) || "（未命名）",
    // 实际列名 "日期" 优先
    startTime:  toISOStr(pick(f, "日期", "开始时间", "接待时间", "开始日期", "时间")),
    endTime:    toISOStr(pick(f, "结束时间", "结束日期")),
    level:      cleanStr(pick(f, "级别", "行政级别", "政府级别")),
    // 实际列名 "主接待" 优先
    hostName:   cleanStr(pick(f,
      "主接待", "接待人", "接待负责人", "主要接待人", "接待人员",
    )),
    // "形式" / "接待形式" / "接待方式" / "接待类型" / "活动形式" 均兼容
    formats:    extractMultiSelect(pick(f, "形式", "接待形式", "接待方式", "接待类型", "活动形式")),
    // 着装要求：新增字段，兼容多种列名
    dressCode:  cleanStr(pick(f, "着装要求", "着装标准", "着装")) || "司服",
    // 实际列名 "背景" 优先
    background: cleanStr(pick(f, "背景", "来访背景", "来访背景说明")),
    // 来访目的：兼容"考察目的"等别名
    purpose:    cleanStr(pick(f, "来访目的", "考察目的", "目的", "接待目的", "来访/会议目的")),
    status:     cleanStr(pick(f, "状态", "接待状态")) || "正常",
    feishuRecordId: recordId ?? null,
    _rawFields: f,
  };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role === "DEPT_CONTACT")
    return NextResponse.json({ error: "权限不足" }, { status: 403 });

  const body = await req.json() as { appToken?: string; tableId?: string; isWiki?: boolean };
  let { appToken } = body;
  const { tableId, isWiki } = body;

  if (!appToken?.trim() || !tableId?.trim())
    return NextResponse.json({ error: "appToken 和 tableId 不能为空" }, { status: 400 });

  appToken = appToken.trim();
  const cleanTableId = tableId.trim();

  if (isWiki) {
    try { appToken = await resolveWikiToken(appToken); }
    catch (e: unknown) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  }

  let allItems: Array<{ recordId: string; fields: Record<string, unknown> }> = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${cleanTableId}/records`);
    url.searchParams.set("page_size", "200");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const json = await feishuRequest(url.toString()) as {
      code: number; msg: string;
      data?: { items?: { record_id?: string; fields: Record<string, unknown> }[]; page_token?: string; has_more?: boolean };
    };
    if (json.code !== 0)
      return NextResponse.json({ error: `飞书 API 错误 (${json.code}): ${json.msg}` }, { status: 502 });

    allItems = allItems.concat(
      (json.data?.items ?? []).map(i => ({ recordId: i.record_id ?? "", fields: i.fields }))
    );
    pageToken  = json.data?.has_more ? json.data.page_token : undefined;
  } while (pageToken);

  const records: ParsedReception[] = allItems.map(({ recordId, fields }, idx) => mapRecord(fields, recordId, idx === 0));
  return NextResponse.json({ records, total: records.length });
}
