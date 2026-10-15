/**
 * POST /api/chat  —  PA 智库 Copilot（Edge Runtime）
 *
 * Edge Runtime 无 10s 超时限制，RAG 用 Supabase JS Client 直连 PostgreSQL。
 * 流式输出：SSE 逐字推送。
 *
 * ── 必须在根目录 .env 中配置以下环境变量以打通公司 ABP AI 基建 ──────────────
 *   ABP_LLM_API_KEY  = <公司 ABP 平台下发的 API Key>
 *   ABP_LLM_BASE_URL = <ABP 平台 API Base URL，如 https://abp.company.ai>
 *   ABP_MODEL_NAME   = <ABP 推荐的模型名称，如 qwen2.5-72b-instruct>
 * ────────────────────────────────────────────────────────────────────────────
 */

export const runtime    = "edge";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { getToken }                  from "next-auth/jwt";
import { createClient }              from "@supabase/supabase-js";

// ── 类型 ──────────────────────────────────────────────────────────

interface AssetRow {
  metric_key:        string;
  metric_name:       string;
  value:             string;
  unit:              string | null;
  period:            string;
  period_label:      string;
  category:          string;
  confidence:        number;
  source_feishu_url: string | null;
  source_cell_ref:   string | null;
}

interface AwardRow {
  title:             string;
  awarded_at:        string;
  awarded_by:        string;
  awardee_entity:    string;
  category:          string;
  importance_level:  number;
  description:       string | null;
  source_feishu_url: string | null;
  attachments:       Array<{ type: string; url: string }> | null;
}

interface HistoryMessage {
  role:    "user" | "assistant";
  content: string;
}

// ── Supabase 客户端（service role，Edge 兼容）────────────────────

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未配置");
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

// ── RAG：经营数据检索 ─────────────────────────────────────────────

async function retrieveAssets(question: string): Promise<AssetRow[]> {
  const sb       = getSupabase();
  const keywords = question.match(/[一-龥]{2,6}|[a-zA-Z]{3,}/g) ?? [];

  if (keywords.length === 0) {
    const { data } = await sb
      .from("assets")
      .select("metric_key,metric_name,value,unit,period,period_label,category,confidence,source_feishu_url,source_cell_ref")
      .eq("is_encrypted", false)
      .order("created_at", { ascending: false })
      .limit(8);
    return (data as AssetRow[]) ?? [];
  }

  // 用 ilike 对每个关键词做 OR 检索
  const orFilter = keywords
    .flatMap((kw) => [
      `metric_name.ilike.%${kw}%`,
      `metric_key.ilike.%${kw}%`,
      `period_label.ilike.%${kw}%`,
    ])
    .join(",");

  const { data } = await sb
    .from("assets")
    .select("metric_key,metric_name,value,unit,period,period_label,category,confidence,source_feishu_url,source_cell_ref")
    .eq("is_encrypted", false)
    .or(orFilter)
    .order("confidence", { ascending: false })
    .limit(10);
  return (data as AssetRow[]) ?? [];
}

// ── RAG：资质奖项检索 ─────────────────────────────────────────────

async function retrieveAwards(question: string): Promise<AwardRow[]> {
  const sb       = getSupabase();
  const keywords = question.match(/[一-龥]{2,6}|[a-zA-Z]{3,}|\d{4}/g) ?? [];

  if (keywords.length === 0) {
    const { data } = await sb
      .from("qualifications_awards")
      .select("title,awarded_at,awarded_by,awardee_entity,category,importance_level,description,source_feishu_url,attachments")
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("importance_level", { ascending: false })
      .order("awarded_at_year",  { ascending: false })
      .limit(6);
    return (data as AwardRow[]) ?? [];
  }

  const orFilter = keywords
    .flatMap((kw) => [
      `title.ilike.%${kw}%`,
      `awarded_by.ilike.%${kw}%`,
      `awardee_entity.ilike.%${kw}%`,
      `region_label.ilike.%${kw}%`,
      `awarded_at.ilike.%${kw}%`,
      `description.ilike.%${kw}%`,
    ])
    .join(",");

  const { data } = await sb
    .from("qualifications_awards")
    .select("title,awarded_at,awarded_by,awardee_entity,category,importance_level,description,source_feishu_url,attachments")
    .eq("is_active", true)
    .is("deleted_at", null)
    .or(orFilter)
    .order("importance_level", { ascending: false })
    .order("awarded_at_year",  { ascending: false })
    .limit(8);
  return (data as AwardRow[]) ?? [];
}

// ── System Prompt ─────────────────────────────────────────────────

function buildSystemPrompt(assets: AssetRow[], awards: AwardRow[]): string {
  const catLabel: Record<string, string> = {
    AWARD: "政府/行业奖项", QUALIFICATION: "资质认证", HONOR: "荣誉称号",
  };

  const assetBlock = assets.length > 0
    ? assets.map((c, i) =>
        `[经营数据 ${i + 1}]\n` +
        `指标名称: ${c.metric_name}（${c.metric_key}）\n` +
        `数值: ${c.value}${c.unit ? " " + c.unit : ""}\n` +
        `统计口径: ${c.period_label}（${c.period}）\n` +
        `数据类别: ${c.category}\n` +
        `置信度: ${(c.confidence * 100).toFixed(0)}%\n` +
        `飞书原始链接: ${c.source_feishu_url ?? "（无）"}\n` +
        `单元格定位: ${c.source_cell_ref ?? "（无）"}`
      ).join("\n\n")
    : "（本次检索未命中相关经营数据）";

  const awardBlock = awards.length > 0
    ? awards.map((a, i) => {
        let firstUrl: string | null = null;
        try { firstUrl = a.attachments?.find((x) => x.type === "image")?.url ?? null; } catch { /* empty */ }
        return (
          `[资质奖项 ${i + 1}]\n` +
          `奖项名称: ${a.title}\n` +
          `资质主体: ${a.awardee_entity}\n` +
          `授予单位: ${a.awarded_by}\n` +
          `授予时间: ${a.awarded_at}\n` +
          `类别: ${catLabel[a.category] ?? a.category}\n` +
          `重要性: ${"★".repeat(a.importance_level)}（${a.importance_level}/5）\n` +
          (a.description ? `简介: ${a.description}\n` : "") +
          `飞书原始记录: ${a.source_feishu_url ?? "（无）"}\n` +
          `获奖证明图片: ${firstUrl ?? "（无）"}`
        );
      }).join("\n\n")
    : "（本次检索未命中相关资质奖项）";

  return `你是 瑞启深空 PA 部门的智库数据 Copilot，专门帮助政府合作、公共事务团队查询和理解公司核心经营数据及企业资质奖项。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【铁律 - 防幻觉约束，任何情况下不得违反】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. 【数据来源唯一性】只能引用下方「检索结果 Context」中的数据，禁止引用训练时的外部知识或进行推断。

2. 【强制引用溯源】每一句含具体数字或奖项名称的陈述，句末必须附 Markdown 引用链接：
   格式：[引用来源](飞书链接URL)
   若有获奖证明图片链接，同时附：[查看证明](图片URL)
   若数据无飞书链接，回答：「系统未收录该数据的完整溯源链接，请联系 PA 专员核实」

3. 【未知数据声明】若 Context 中找不到，必须回答：「**系统未收录该数据**，请通过飞书联系 PA 部门专员获取。」
   禁止用「大约」「估计」「通常」等模糊措辞。

4. 【禁止越界回答】不得回答与公司经营数据、政企合规无关的问题。
   统一回答：「超出本 Copilot 的服务范围，请咨询相关专业部门。」

5. 【语言规范】全程简体中文，专业术语准确，语气简洁客观。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【检索结果 Context（本次问答的唯一数据来源）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【A 部分：经营数据指标】

${assetBlock}

【B 部分：企业资质与奖项】

${awardBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
以上是本次回答可以使用的全部数据。请严格按上述铁律回答用户问题。`;
}

// ── LLM 流式调用（原生 fetch，Edge 兼容）────────────────────────

async function* streamLLM(
  systemPrompt: string,
  history: HistoryMessage[],
  question: string,
): AsyncGenerator<string> {
  const apiKey  = process.env.ABP_LLM_API_KEY;
  const baseURL = process.env.ABP_LLM_BASE_URL;
  const model   = process.env.ABP_MODEL_NAME;

  if (!apiKey || !baseURL || !model) {
    yield "AI 配置缺失，请联系管理员。";
    return;
  }

  const url  = `${baseURL.replace(/\/$/, "")}/v1/chat/completions`;
  const body = JSON.stringify({
    model,
    stream:      true,
    max_tokens:  4096,
    temperature: 0.3,
    messages: [
      { role: "system", content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user",   content: question },
    ],
  });

  // 最多重试 2 次（应对冷启动连接抖动）
  let res: Response | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body,
      });
      if (r.ok) { res = r; break; }
      console.error(`[LLM] attempt ${attempt} HTTP ${r.status}`);
    } catch (err) {
      console.error(`[LLM] attempt ${attempt} fetch error:`, (err as Error).message);
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 800));
  }

  if (!res?.body) {
    yield "AI 思考时间过长，请稍后重试";
    return;
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let   buf     = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t || t === "data: [DONE]" || !t.startsWith("data: ")) continue;
        try {
          const delta = JSON.parse(t.slice(6))?.choices?.[0]?.delta?.content ?? "";
          if (delta) yield delta;
        } catch { /* ignore malformed SSE */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Route Handler ─────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Edge Runtime 用 getToken 验证 JWT，无需访问数据库
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  if (!token?.userId) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let question: string;
  let history: HistoryMessage[] = [];
  try {
    const body = await req.json();
    question   = String(body.message ?? "").trim();
    if (!question || question.length < 2) throw new Error("invalid");
    if (question.length > 1000) {
      return NextResponse.json({ error: "问题过长，请控制在 1000 字以内" }, { status: 400 });
    }
    history = ((body.history ?? []) as HistoryMessage[]).slice(-6);
  } catch {
    return NextResponse.json({ error: "请求体格式错误：缺少 message 字段" }, { status: 400 });
  }

  // RAG 检索（并行）
  let assets: AssetRow[] = [];
  let awards: AwardRow[] = [];
  try {
    [assets, awards] = await Promise.all([
      retrieveAssets(question),
      retrieveAwards(question),
    ]);
  } catch (err) {
    console.error("[Chat] RAG 检索失败:", err);
  }

  const systemPrompt = buildSystemPrompt(assets, awards);
  const encoder      = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of streamLLM(systemPrompt, history, question)) {
          controller.enqueue(encoder.encode(chunk));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type":       "text/plain; charset=utf-8",
      "Cache-Control":      "no-cache",
      "X-Retrieved-Chunks": String(assets.length),
      "X-Retrieved-Awards": String(awards.length),
    },
  });
}
