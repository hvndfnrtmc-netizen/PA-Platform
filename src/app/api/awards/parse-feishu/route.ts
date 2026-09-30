/**
 * POST /api/awards/parse-feishu
 * 读取飞书多维表格中的荣誉资质记录，解析后返回前端预览（不写库）。
 * Body: { appToken: string, tableId: string, isWiki?: boolean }
 * Response: { records: ParsedAward[], total: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTenantAccessToken } from "@/lib/feishu";
import { getToken } from "next-auth/jwt";

export interface ParsedAward {
  title:          string;
  awardedAt:      string;
  awardedBy:      string;
  awardeeEntity:  string;
  category:       string;
  importanceLevel: number;
  regionLabel:    string;
  description:    string;
}

// ── 飞书字段解析工具 ──────────────────────────────────────────────

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

/** 毫秒时间戳 → YYYY 年份字符串；文本型直接提取 4 位年份 */
function toYearStr(v: unknown): string {
  if (!v) return "";
  if (typeof v === "number") return String(new Date(v).getFullYear());
  const s = String(v).trim();
  const m = s.match(/(\d{4})/);
  return m ? m[1] : s;
}

function normalizeCategory(raw: string): string {
  const v = raw.trim().toUpperCase();
  if (v === "QUALIFICATION" || raw.includes("资质") || raw.includes("认证")) return "QUALIFICATION";
  if (v === "HONOR"         || raw.includes("荣誉"))                          return "HONOR";
  return "AWARD";
}

function pick(f: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) { if (k in f) return f[k]; }
  return undefined;
}

function mapRecord(f: Record<string, unknown>): ParsedAward {
  const rawCat = cleanStr(pick(f, "类别", "类型", "分类", "category"));
  const rawLvl = cleanStr(pick(f, "重要性", "等级", "星级", "含金量", "重要等级", "importanceLevel"));

  return {
    title: cleanStr(pick(f,
      "奖项名称", "名称", "称号", "认证名", "资质名称",
      "奖项/资质全称", "title", "荣誉名称",
    )) || "（未命名）",

    awardedAt: toYearStr(pick(f,
      "得奖时间", "获奖时间", "获奖年份", "颁发时间", "时间", "年份",
      "日期", "awardedAt",
    )),

    awardedBy: cleanStr(pick(f,
      "颁发单位", "授予单位", "颁奖机构", "机构", "颁发机构",
      "授予机构", "awardedBy",
    )),

    awardeeEntity: cleanStr(pick(f,
      "获奖主体", "主体", "公司", "单位名称", "获奖单位",
      "awardeeEntity",
    )),

    category:        rawCat ? normalizeCategory(rawCat) : "AWARD",
    importanceLevel: Number(rawLvl) || 3,
    regionLabel:     cleanStr(pick(f, "地区", "省市", "区域", "regionLabel")),
    description:     cleanStr(pick(f, "备注", "描述", "说明", "description")),
  };
}

async function resolveWikiToken(wikiToken: string, accessToken: string): Promise<string> {
  const res  = await fetch(
    `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${wikiToken}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const json = await res.json() as { code: number; msg: string; data?: { node?: { obj_token?: string } } };
  if (json.code !== 0) throw new Error(`飞书 Wiki API 错误 (${json.code}): ${json.msg}`);
  const token = json.data?.node?.obj_token;
  if (!token) throw new Error("Wiki 节点未返回 obj_token");
  return token;
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

  // 优先用当前用户的飞书 token（可访问用户有权限的任意 Bitable）
  // 回退到 tenant_access_token（仅能访问已授权给应用的 Bitable）
  const jwt = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const accessToken = (jwt?.feishuAccessToken as string | undefined)
    ?? await getTenantAccessToken();

  if (isWiki) {
    try { appToken = await resolveWikiToken(appToken, accessToken); }
    catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  }

  let allRecords: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${cleanTableId}/records`,
    );
    url.searchParams.set("page_size", "200");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res  = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    const json = await res.json() as {
      code: number; msg: string;
      data?: { items?: { fields: Record<string, unknown> }[]; page_token?: string; has_more?: boolean };
    };
    if (json.code !== 0)
      return NextResponse.json({ error: `飞书 API 错误 (${json.code}): ${json.msg}` }, { status: 502 });

    allRecords = allRecords.concat((json.data?.items ?? []).map(i => i.fields));
    pageToken  = json.data?.has_more ? json.data.page_token : undefined;
  } while (pageToken);

  const records: ParsedAward[] = allRecords.map(f => mapRecord(f));
  return NextResponse.json({ records, total: records.length });
}
