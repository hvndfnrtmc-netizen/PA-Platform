/**
 * LLM 服务封装 — 对接公司内部 ABP（AI 网关）平台
 *
 * 使用原生 fetch 直接调用 OpenAI 兼容接口。
 * 含重试（最多 2 次）+ 50 秒显式超时，应对 Vercel 冷启动连接抖动。
 */

export interface ChatHistoryMessage {
  role: "user" | "assistant";
  content: string;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ── 流式生成 ──────────────────────────────────────────────────────

export async function* streamChat(
  systemPrompt: string,
  history: ChatHistoryMessage[],
  question: string,
): AsyncGenerator<string> {
  const apiKey  = process.env.ABP_LLM_API_KEY;
  const baseURL = process.env.ABP_LLM_BASE_URL;
  const model   = process.env.ABP_MODEL_NAME;

  if (!apiKey || !baseURL || !model) {
    console.error("[LLM] 配置缺失", { hasKey: !!apiKey, hasURL: !!baseURL, hasModel: !!model });
    yield "[ERROR] 配置缺失，请联系管理员检查环境变量。";
    return;
  }

  const url = `${baseURL.replace(/\/$/, "")}/v1/chat/completions`;
  const requestBody = JSON.stringify({
    model,
    stream:      true,
    max_tokens:  4096,
    temperature: 0.3,
    messages: [
      { role: "system" as const, content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: h.content })),
      { role: "user"   as const, content: question },
    ],
  });

  // 最多尝试 2 次，冷连接失败后立即重试
  let res: Response | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 50_000);

    try {
      const r = await fetch(url, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body:   requestBody,
        signal: ctrl.signal,
      });
      clearTimeout(timer);

      if (r.ok) {
        res = r;
        break;
      }

      const errBody = await r.text().catch(() => "");
      console.error(`[LLM] attempt ${attempt}: HTTP ${r.status}`, errBody.slice(0, 300));

      if (attempt < 2) await sleep(800);
    } catch (err) {
      clearTimeout(timer);
      const isAbort = (err as Error).name === "AbortError";
      console.error(`[LLM] attempt ${attempt}: fetch 失败`, isAbort ? "50s 超时" : (err as Error).message);

      if (attempt < 2) await sleep(800);
    }
  }

  if (!res || !res.body) {
    yield "[ERROR] AI 思考时间过长，请稍后重试";
    return;
  }

  // 解析 SSE（text/event-stream）
  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let   buffer  = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const text = json.choices?.[0]?.delta?.content ?? "";
          if (text) yield text;
        } catch {
          // 忽略格式异常的 SSE 行
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── 非流式单次生成（测试用）────────────────────────────────────────

export async function generateResponse(prompt: string): Promise<string> {
  const apiKey  = process.env.ABP_LLM_API_KEY;
  const baseURL = process.env.ABP_LLM_BASE_URL;
  const model   = process.env.ABP_MODEL_NAME;

  if (!apiKey || !baseURL || !model) throw new Error("ABP 配置缺失");

  const url = `${baseURL.replace(/\/$/, "")}/v1/chat/completions`;
  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body:    JSON.stringify({ model, messages: [{ role: "user", content: prompt }], max_tokens: 2048, temperature: 0.7 }),
  });

  if (!res.ok) throw new Error(`ABP 网关返回 ${res.status}`);
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? "(无回复)";
}
