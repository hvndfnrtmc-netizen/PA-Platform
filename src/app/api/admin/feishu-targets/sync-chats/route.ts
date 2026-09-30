/**
 * POST /api/admin/feishu-targets/sync-chats
 *
 * 拉取机器人所在的全部飞书群聊，批量 Upsert 到 FeishuNotificationTarget 表。
 * - 仅 SUPER_ADMIN 可调用
 * - 自动处理飞书分页（page_token）
 * - 群改名后自动同步新名称
 * - 错误码 230007 → 明确提示开通 im:chat:readonly 权限
 */

import { NextResponse } from "next/server";
import { feishuRequest } from "@/lib/feishu";
import prisma from "@/lib/prisma";
import { getSession } from "@/lib/auth";

interface FeishuChat {
  chat_id: string;
  name:    string;
}

interface ChatsResponse {
  code: number;
  msg:  string;
  data?: {
    items?:      FeishuChat[];
    page_token?: string;
    has_more?:   boolean;
  };
}

export async function POST() {
  const session = await getSession();
  if (!session?.user)
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN")
    return NextResponse.json({ error: "权限不足，仅超级管理员可同步群聊" }, { status: 403 });

  // ── 分页拉取所有机器人所在群聊 ─────────────────────────────────
  const allChats: FeishuChat[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL("https://open.feishu.cn/open-apis/im/v1/chats");
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const json = await feishuRequest(url.toString(), {}, "tenant") as unknown as ChatsResponse;

    // 权限不足
    if (json.code === 230007 || json.code === 230001) {
      return NextResponse.json(
        { error: "请去飞书开发者后台开通「获取群组信息」(im:chat:readonly) 权限，并发布新版本后重试" },
        { status: 403 },
      );
    }
    if (json.code !== 0) {
      return NextResponse.json(
        { error: `飞书 API 错误 (${json.code}): ${json.msg}` },
        { status: 502 },
      );
    }

    for (const item of json.data?.items ?? []) {
      if (item.chat_id && item.name) allChats.push(item);
    }

    pageToken = json.data?.has_more ? json.data.page_token : undefined;
  } while (pageToken);

  if (allChats.length === 0) {
    return NextResponse.json({ synced: 0, message: "机器人当前未加入任何群聊" });
  }

  // ── 批量 Upsert ────────────────────────────────────────────────
  let synced = 0;
  for (const chat of allChats) {
    await prisma.feishuNotificationTarget.upsert({
      where:  { feishuId: chat.chat_id },
      update: { name: chat.name },
      create: { feishuId: chat.chat_id, name: chat.name, type: "GROUP" },
    });
    synced++;
  }

  return NextResponse.json({ synced, message: `成功同步 ${synced} 个群聊` });
}
