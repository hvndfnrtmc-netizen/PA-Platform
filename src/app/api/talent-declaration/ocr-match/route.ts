/**
 * POST /api/talent-declaration/ocr-match
 *
 * 接收 Base64 图片，调用 ABP 视觉模型提取人名，
 * 再去数据库模糊匹配真实用户并返回。
 *
 * 请求体: { imageBase64: string; mimeType?: string }
 * 响应体: { names: string[]; matchedUsers: { id, name, feishuOpenId, email }[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { pinyin } from "pinyin-pro";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let body: { imageBase64?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const { imageBase64, mimeType = "image/jpeg" } = body ?? {};
  if (!imageBase64) {
    return NextResponse.json({ error: "缺少图片数据" }, { status: 400 });
  }

  const apiKey  = process.env.ABP_LLM_API_KEY;
  const baseURL = process.env.ABP_LLM_BASE_URL;
  const model   = process.env.ABP_MODEL_NAME ?? "claude-sonnet-4.6";

  let names: string[] = [];

  if (!apiKey || !baseURL) {
    // Mock 降级：ABP 配置未找到时返回测试数据
    console.warn("[OCR] ABP 配置未设置，使用 Mock 数据");
    names = ["张三", "Kaijing Gao"];
  } else {
    try {
      const url = `${baseURL.replace(/\/$/, "")}/v1/chat/completions`;
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 60_000);

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens:  1024,
          temperature: 0,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: '你是一个政务文档信息提取助手。请提取这张图片中出现的所有【人员姓名】。注意：只提取人名，忽略其他无关文字、职位或金额。请严格输出一个 JSON 格式的字符串数组，例如：["张三", "Kaijing Gao"]。不要输出任何其他解释性文字。',
                },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${mimeType};base64,${imageBase64}`,
                  },
                },
              ],
            },
          ],
        }),
        signal: ctrl.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        console.error("[OCR] ABP 返回错误:", res.status, errBody.slice(0, 200));
        // 不崩溃，返回空数组
        names = [];
      } else {
        const json    = await res.json();
        const content = (json.choices?.[0]?.message?.content ?? "[]") as string;
        // 去除可能包裹的 Markdown 代码块格式
        const cleaned = content
          .replace(/```json\s*/gi, "")
          .replace(/```\s*/g, "")
          .trim();
        try {
          const parsed = JSON.parse(cleaned);
          names = Array.isArray(parsed)
            ? parsed.filter((n: unknown): n is string => typeof n === "string")
            : [];
        } catch {
          console.error("[OCR] JSON.parse 失败，原始内容:", content.slice(0, 200));
          names = [];
        }
      }
    } catch (err) {
      const isAbort = (err as Error).name === "AbortError";
      console.error("[OCR] 调用失败:", isAbort ? "60s 超时" : (err as Error).message);
      names = [];
    }
  }

  // 拼音乱序匹配：对每个识别出的名字，中文→拼音数组 AND 查询；英文直接 OR 查询
  const matchedUsersMap = new Map<string, { id: string; name: string; englishName: string | null; feishuOpenId: string | null; email: string | null }>();

  for (const name of names) {
    const isChinese = /[\u4e00-\u9fff]/.test(name);
    let whereCondition: Record<string, unknown>;

    if (isChinese) {
      const pyArray = pinyin(name, { toneType: "none", type: "array" }) as string[];
      whereCondition = {
        AND: pyArray.map(py => ({
          OR: [
            { name:        { contains: py, mode: "insensitive" as const } },
            { englishName: { contains: py, mode: "insensitive" as const } },
            { email:       { contains: py, mode: "insensitive" as const } },
          ],
        })),
      };
    } else {
      whereCondition = {
        OR: [
          { name:        { contains: name, mode: "insensitive" as const } },
          { englishName: { contains: name, mode: "insensitive" as const } },
          { email:       { contains: name, mode: "insensitive" as const } },
        ],
      };
    }

    const found = await prisma.user.findMany({
      where: { deletedAt: null, isActive: true, ...whereCondition },
      select: { id: true, name: true, englishName: true, feishuOpenId: true, email: true },
      take: 10,
    });

    for (const u of found) {
      matchedUsersMap.set(u.id, u);
    }
  }

  const matchedUsers = Array.from(matchedUsersMap.values());

  return NextResponse.json({ names, matchedUsers });
}
