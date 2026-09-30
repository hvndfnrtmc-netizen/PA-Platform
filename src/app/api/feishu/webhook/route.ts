/**
 * POST /api/feishu/webhook
 * 飞书事件订阅接收端点
 *
 * 使用 Edge Runtime：无冷启动，毫秒级响应，保证飞书 3 秒 Challenge 验证通过。
 *
 * 飞书 Challenge 验证流程：
 *   飞书 POST → { "type": "url_verification", "challenge": "xxx" }
 *   我们立即回 → { "challenge": "xxx" }
 */

export const runtime = "edge";

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  // ── Challenge 验证（飞书首次绑定 URL 时发送）──────────────────
  if (body.type === "url_verification") {
    return json({ challenge: body.challenge });
  }

  // ── 正常事件：立即返回 200，后台异步处理 ─────────────────────
  // Edge Runtime 不支持 waitUntil，完整的事件消费逻辑
  // 后续可通过 fetch 转发到 Node.js 路由处理。

  return json({ ok: true });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
