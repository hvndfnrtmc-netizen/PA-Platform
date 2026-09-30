/**
 * 飞书 Open API 工具库
 * 提供：Token 获取、消息卡片推送（fire-and-forget）、通讯录搜索
 */

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://pa-platform-kappa.vercel.app";

// ─── Token 缓存（容器复用时有效，每次冷启动重新获取）───────────────
let _appTokenCache:    { token: string; expiresAt: number } | null = null;
let _tenantTokenCache: { token: string; expiresAt: number } | null = null;

export async function getAppAccessToken(): Promise<string> {
  const now = Date.now();
  if (_appTokenCache && _appTokenCache.expiresAt > now + 60_000)
    return _appTokenCache.token;

  const res  = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal",
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        app_id:     process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET,
      }),
      cache: "no-store",
    }
  );
  const json = await res.json();
  if (json.code !== 0)
    throw new Error(`飞书 app_access_token 失败: code=${json.code} msg=${json.msg}`);

  _appTokenCache = { token: json.app_access_token, expiresAt: now + json.expire * 1000 };
  return json.app_access_token;
}

export async function getTenantAccessToken(): Promise<string> {
  const now = Date.now();
  if (_tenantTokenCache && _tenantTokenCache.expiresAt > now + 60_000)
    return _tenantTokenCache.token;

  const res  = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        app_id:     process.env.FEISHU_APP_ID,
        app_secret: process.env.FEISHU_APP_SECRET,
      }),
      cache: "no-store",
    }
  );
  const json = await res.json();
  if (json.code !== 0)
    throw new Error(`飞书 tenant_access_token 失败: code=${json.code} msg=${json.msg}`);

  _tenantTokenCache = { token: json.tenant_access_token, expiresAt: now + json.expire * 1000 };
  return json.tenant_access_token;
}

/**
 * 强制清除 tenant_access_token 缓存并重新从飞书获取。
 * 仅在检测到 token 过期时调用，避免频繁触发飞书 auth 接口。
 */
export async function refreshTenantAccessToken(): Promise<string> {
  _tenantTokenCache = null;
  return getTenantAccessToken();
}

/**
 * 强制清除 app_access_token 缓存并重新从飞书获取。
 */
export async function refreshAppAccessToken(): Promise<string> {
  _appTokenCache = null;
  return getAppAccessToken();
}

/**
 * 带 Token 过期自动重试的飞书 API 请求封装。
 *
 * - 正常请求时复用已缓存的 token，不增加额外开销。
 * - 当飞书返回 code=99991677（token 过期）时，强制刷新对应 token 并自动重试一次。
 * - 不处理其他错误码，由调用方自行检查 data.code。
 *
 * @param url        完整的飞书 Open API URL
 * @param init       fetch RequestInit（不含 Authorization 头，由本函数注入）
 * @param tokenType  "tenant"（默认，用于大多数 API）或 "app"
 */
export async function feishuRequest(
  url: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
  tokenType: "tenant" | "app" = "tenant",
): Promise<Record<string, unknown>> {
  const getToken  = tokenType === "app" ? getAppAccessToken    : getTenantAccessToken;
  const doRefresh = tokenType === "app" ? refreshAppAccessToken : refreshTenantAccessToken;

  const doFetch = async (token: string): Promise<Record<string, unknown>> => {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
    return res.json() as Promise<Record<string, unknown>>;
  };

  let token = await getToken();
  let data  = await doFetch(token);

  if (data["code"] === 99991677) {
    console.warn(
      `[Feishu] feishuRequest: ${tokenType} token expired (99991677), ` +
      `force refreshing and retrying → ${url}`,
    );
    token = await doRefresh();
    data  = await doFetch(token);
  }

  return data;
}

// ─── 管理员 open_id（从 SystemConfig 读取，5 分钟缓存）────────────

let _adminOpenIdsCache: { id1: string; id2: string; fetchedAt: number } | null = null;

export async function getAdminOpenIds(): Promise<{ id1: string; id2: string }> {
  if (_adminOpenIdsCache && Date.now() - _adminOpenIdsCache.fetchedAt < 5 * 60 * 1000) {
    return { id1: _adminOpenIdsCache.id1, id2: _adminOpenIdsCache.id2 };
  }
  try {
    const { prisma } = await import("@/lib/prisma");
    const [c1, c2] = await Promise.all([
      prisma.systemConfig.findUnique({ where: { key: "feishu_admin_open_id_1" } }),
      prisma.systemConfig.findUnique({ where: { key: "feishu_admin_open_id_2" } }),
    ]);
    const ids = { id1: c1?.value ?? "", id2: c2?.value ?? "" };
    _adminOpenIdsCache = { ...ids, fetchedAt: Date.now() };
    return ids;
  } catch (err) {
    console.error("[Feishu] getAdminOpenIds 失败:", err);
    return { id1: "", id2: "" };
  }
}

// ─── 消息推送 ──────────────────────────────────────────────────────

async function resolveOpenIdFromEmail(email: string): Promise<string | null> {
  try {
    const token = await getTenantAccessToken();
    const res   = await fetch(
      "https://open.feishu.cn/open-apis/contact/v3/users/batch_get_id?user_id_type=open_id",
      {
        method:  "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({ emails: [email] }),
      }
    );
    const json = await res.json();
    if (json.code !== 0) {
      console.warn("[Feishu] resolveOpenId 失败 code:", json.code, json.msg, "| email:", email);
      return null;
    }
    const hit = (json.data?.user_list ?? []).find(
      (u: { email?: string; open_id?: string }) => u.email === email && u.open_id
    );
    return hit?.open_id ?? null;
  } catch (err) {
    console.error("[Feishu] resolveOpenId 异常:", err);
    return null;
  }
}

/**
 * 向指定飞书用户发送消息卡片。
 *
 * @param receiveId  飞书 open_id（ou_ 开头），推荐始终传 open_id
 * @param card       卡片 JSON 对象
 * @throws           **不再吞异常**，调用方必须 catch 并展示给用户/记录日志
 */
export async function sendCard(receiveId: string | null | undefined, card: object): Promise<void> {
  if (!receiveId?.trim()) {
    throw new Error("sendCard 失败：receiveId 为空，请确认飞书 open_id 已正确配置");
  }
  if (!process.env.FEISHU_APP_ID) {
    throw new Error("sendCard 失败：环境变量 FEISHU_APP_ID 未配置");
  }

  const isEmail = receiveId.includes("@");
  let finalId   = receiveId.trim();
  let idType    = "open_id";

  if (isEmail) {
    const resolved = await resolveOpenIdFromEmail(finalId);
    if (resolved) {
      finalId = resolved;
    } else {
      idType = "email";
      console.warn("[Feishu] sendCard: 邮箱转 open_id 失败，降级 email 模式 | email:", finalId);
    }
  }

  const token = await getAppAccessToken();
  const bodyStr = JSON.stringify({
    receive_id: finalId,
    msg_type:   "interactive",
    content:    JSON.stringify(card),
  });

  console.log("[Feishu] sendCard →", idType, finalId, "| card schema:", (card as {schema?: string}).schema ?? "v1");

  const res = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${idType}`,
    {
      method:  "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization:  `Bearer ${token}`,
      },
      body: bodyStr,
    }
  );

  const json = await res.json() as { code: number; msg: string; data?: unknown };
  console.log("[Feishu] sendCard ← HTTP", res.status, "| code:", json.code, "| msg:", json.msg);

  if (json.code !== 0) {
    throw new Error(
      `[Feishu] sendCard 飞书 API 返回错误 code=${json.code} msg=${json.msg} | idType=${idType} id=${finalId}`
    );
  }
}

/**
 * 向飞书群聊发送交互卡片（receive_id_type=chat_id）。
 * @param chatId  飞书群聊 ID（oc_ 开头），从环境变量 FEISHU_RECEPTION_NOTIFY_CHAT_ID 获取
 * @param card    卡片 JSON 对象
 */
export async function sendCardToChat(chatId: string, card: object): Promise<void> {
  if (!chatId?.trim()) throw new Error("sendCardToChat 失败：chatId 为空");
  if (!process.env.FEISHU_APP_ID) throw new Error("sendCardToChat 失败：FEISHU_APP_ID 未配置");

  const token = await getAppAccessToken();
  const res   = await fetch(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=chat_id",
    {
      method:  "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ receive_id: chatId, msg_type: "interactive", content: JSON.stringify(card) }),
    }
  );
  const json = await res.json() as { code: number; msg: string };
  if (json.code !== 0) {
    const hint = json.code === 230002
      ? `机器人不在群聊中，请先将飞书应用机器人拉入群 ${chatId}`
      : json.msg;
    throw new Error(`[Feishu] sendCardToChat 失败 code=${json.code}：${hint}`);
  }
}

/** @deprecated 使用 sendCard 替代，此函数保留作内部兼容 */
async function _legacySendCard(receiveId: string | null | undefined, card: object): Promise<void> {
  if (!receiveId?.trim()) {
    console.warn("[Feishu] _legacySendCard 跳过：receiveId 为空");
    return;
  }
  if (!process.env.FEISHU_APP_ID) {
    console.warn("[Feishu] FEISHU_APP_ID 未配置，跳过推送");
    return;
  }

  const isEmail = receiveId.includes("@");
  let finalId   = receiveId.trim();
  let idType    = "open_id";

  if (isEmail) {
    const resolved = await resolveOpenIdFromEmail(finalId);
    if (resolved) {
      finalId = resolved;
      idType  = "open_id";
    } else {
      idType = "email";
    }
  }

  try {
    const token = await getAppAccessToken();
    const res   = await fetch(
      `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${idType}`,
      {
        method:  "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization:  `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: finalId,
          msg_type:   "interactive",
          content:    JSON.stringify(card),
        }),
      }
    );
    const json = await res.json();
    if (json.code !== 0)
      console.error("[Feishu] _legacySendCard 失败:", json.code, json.msg, "| idType:", idType, "| id:", finalId);
  } catch (err) {
    console.error("[Feishu] _legacySendCard 异常:", err);
  }
}

// ─── 文本消息（用于 PA 通知）────────────────────────────────────────

/**
 * 向飞书用户发送纯文本消息（用于 PA 审核通知等简单提醒）
 * @throws 失败时抛出，不吞异常
 */
export async function sendTextMessage(receiveId: string, text: string): Promise<void> {
  if (!receiveId?.trim()) throw new Error("sendTextMessage: receiveId 为空");
  if (!process.env.FEISHU_APP_ID) throw new Error("sendTextMessage: FEISHU_APP_ID 未配置");

  const token = await getAppAccessToken();
  const res   = await fetch(
    "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id",
    {
      method:  "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        receive_id: receiveId.trim(),
        msg_type:   "text",
        content:    JSON.stringify({ text }),
      }),
    }
  );
  const json = await res.json() as { code: number; msg: string };
  console.log("[Feishu] sendTextMessage ← code:", json.code, "msg:", json.msg, "| to:", receiveId);
  if (json.code !== 0) {
    throw new Error(`sendTextMessage 飞书 API 错误 code=${json.code} msg=${json.msg}`);
  }
}

// ─── 通讯录搜索 ────────────────────────────────────────────────────

export interface FeishuUser {
  open_id:          string;
  user_id:          string;
  name:             string;
  en_name:          string;
  email:            string;
  enterprise_email: string;
  avatar_url:       string;
  department_ids:   string[];
}

export async function searchFeishuUsers(query: string): Promise<FeishuUser[]> {
  if (!process.env.FEISHU_APP_ID || !query.trim()) return [];

  const tenantToken = await getTenantAccessToken();
  console.log(
    `[Feishu Search] app=${process.env.FEISHU_APP_ID.slice(0, 8)} | ` +
    `token=${tenantToken ? tenantToken.slice(0, 10) + "…(len=" + tenantToken.length + ")" : "NULL"} | ` +
    `query="${query}"`
  );

  const res = await fetch(
    "https://open.feishu.cn/open-apis/contact/v3/users/search?user_id_type=open_id",
    {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${tenantToken}`,
      },
      cache: "no-store",
      body:  JSON.stringify({ query: query.trim(), page_size: 30 }),
    }
  );
  const json = await res.json();
  console.log(
    `[Feishu Search] response → code=${json.code} msg="${json.msg}" ` +
    `items=${json.data?.items?.length ?? 0}`
  );

  if (json.code !== 0) {
    let hint = "";
    if (json.code === 99991663) {
      hint =
        "\n\n排查步骤：\n" +
        "1. 飞书开发者后台 → 应用 → 权限管理 → 确认 contact:user:readonly 和 contact:user.search:readonly 已开通\n" +
        "2. 飞书管理后台（admin.feishu.cn）→ 应用管理 → 找到本应用 → 通讯录权限范围 → 改为「全员」\n" +
        "3. 以上改动后需重新发布应用版本\n" +
        "4. 也可访问 /api/feishu/debug 获取完整诊断信息";
    }
    throw new Error(`飞书 API 报错: ${json.code} - ${json.msg ?? "未知错误"}${hint}`);
  }

  const items = (json.data?.items ?? []) as Array<{
    open_id:           string;
    user_id:           string;
    name:              string;
    en_name?:          string;
    email?:            string;
    enterprise_email?: string;
    avatar?:           { avatar_origin?: string };
    department_ids?:   string[];
  }>;

  const safeQ    = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re       = new RegExp(safeQ, "i");
  const filtered = items.filter((u) =>
    re.test(u.name             ?? "") ||
    re.test(u.en_name          ?? "") ||
    re.test(u.email            ?? "") ||
    re.test(u.enterprise_email ?? "")
  );

  return filtered.map((r) => ({
    open_id:          r.open_id,
    user_id:          r.user_id,
    name:             r.name,
    en_name:          r.en_name          ?? r.name,
    email:            r.email            ?? "",
    enterprise_email: r.enterprise_email ?? "",
    avatar_url:       r.avatar?.avatar_origin ?? "",
    department_ids:   r.department_ids   ?? [],
  }));
}

// ─── 截止提醒卡片（cron 使用，保持不变）──────────────────────────

export function buildDeadlineReminderCard(p: {
  taskTitle:      string;
  deadline:       string;
  feishuSheetUrl: string | null;
  deptName:       string;
}) {
  const deadlineText = new Date(p.deadline).toLocaleString("zh-CN");
  return {
    config: { wide_screen_mode: true, enable_forward: false },
    header: {
      title:    { tag: "plain_text", content: "⏰ 填报任务即将截止" },
      template: "orange",
    },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: `**${p.taskTitle}**` } },
      { tag: "hr" },
      {
        tag:    "div",
        fields: [
          { is_short: true, text: { tag: "lark_md", content: `**所属部门**\n${p.deptName}` } },
          { is_short: true, text: { tag: "lark_md", content: `**截止时间**\n⚠️ ${deadlineText}` } },
        ],
      },
      {
        tag:      "note",
        elements: [{ tag: "lark_md", content: "距截止时间不足 24 小时，请尽快完成数据录入并点击「标记已提交」。" }],
      },
      {
        tag:     "action",
        actions: [{
          tag:  "button",
          text: { tag: "plain_text", content: "立即前往填报" },
          url:  p.feishuSheetUrl ?? `${APP_URL}/dashboard/my-tasks`,
          type: "danger",
        }],
      },
    ],
  };
}

// ─── 卡片模板 ID（飞书 Card Builder 发布后的 Template ID）──────────
// 在飞书 Card Builder 中修改卡片 UI 并重新发布后自动生效，无需改代码。

const CARD_TEMPLATES = {
  INVITE:   "AAqt8tDnS6n4e",  // 填报协作邀请通知（蓝色）
  REJECT:   "AAqt8GJ3yJMtS",  // 填报修改与补充通知（红色）
  COMPLETE: "AAqt8JQi5x5q7",  // 顺利完结感谢卡片（绿色）
  REMINDER: "AAqtyQCSi7Wif",  // DDL 12h 催办提醒
} as const;

export type FeishuCardType = keyof typeof CARD_TEMPLATES;

// ─── 群成员抓取（Deep Sync 用）────────────────────────────────────

export interface FeishuChatMember {
  member_id:   string;  // open_id (ou_xxx)
  name:        string;
  tenant_key?: string;
}

interface ChatMembersResponse {
  code: number;
  msg:  string;
  data?: {
    items?:      FeishuChatMember[];
    page_token?: string;
    has_more?:   boolean;
  };
}

/**
 * 分页抓取飞书群聊内所有成员（自动处理 page_token）。
 * 需要飞书应用已开通 im:chat:members:readonly 权限。
 *
 * @param chatId  群聊 ID（oc_ 开头）
 * @returns       成员列表 { member_id: "ou_xxx", name: "张三" }[]
 */
export async function getFeishuChatMembers(chatId: string): Promise<FeishuChatMember[]> {
  const members: FeishuChatMember[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `https://open.feishu.cn/open-apis/im/v1/chats/${chatId}/members`,
    );
    url.searchParams.set("member_id_type", "open_id");
    url.searchParams.set("page_size", "100");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const json = (await feishuRequest(url.toString(), {}, "tenant")) as unknown as ChatMembersResponse;

    if (json.code !== 0) {
      console.error(`[Feishu] getFeishuChatMembers 失败 chatId=${chatId} code=${json.code} msg=${json.msg}`);
      break;
    }

    for (const item of json.data?.items ?? []) {
      if (item.member_id) members.push(item);
    }

    pageToken = (json.data?.has_more && json.data.page_token) ? json.data.page_token : undefined;
  } while (pageToken);

  return members;
}

/** 格式化截止时间为 "YYYY-MM-DD HH:mm" */
function formatDeadline(iso: string | null | undefined): string {
  if (!iso) return "（未设置）";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 统一卡片发送入口（Template ID 机制）
 *
 * 飞书官方文档：使用 msg_type=interactive + content 为模板 JSON 字符串
 * 卡片 UI 由飞书 Card Builder 管理，后端只传变量，样式热更新无需改代码。
 */
export async function sendTaskCard(params: {
  type:            FeishuCardType;
  receiveId:       string;
  user_name:       string;
  project_name:    string;
  deadline?:       string | null;
  feedback_notes?: string;       // REJECT 专用
  fillUrl?:        string | null;
}): Promise<void> {
  const { id1, id2 } = await getAdminOpenIds();
  const taskUrl = `${APP_URL}/dashboard/my-tasks`;

  // 模板变量：所有卡片共用同一套变量 key，Card Builder 端决定哪张卡片用哪些
  // 飞书 Url 类型变量必须传 map，不能传平铺字符串
  const urlMap = { url: taskUrl, android_url: taskUrl, ios_url: taskUrl, pc_url: taskUrl };

  const templateVariable: Record<string, unknown> = {
    user_name:    params.user_name,
    project_name: params.project_name,
    deadline:     formatDeadline(params.deadline),
    task_url:     urlMap,
  };
  if (id1) templateVariable.contact_id1 = { id: id1 };
  if (id2) templateVariable.contact_id2 = { id: id2 };

  if (params.type === "REJECT" && params.feedback_notes) {
    templateVariable.feedback_notes = params.feedback_notes;
  }

  const templatePayload = {
    type: "template",
    data: {
      template_id:       CARD_TEMPLATES[params.type],
      template_variable: templateVariable,
    },
  };

  await sendCard(params.receiveId, templatePayload);
}

/** 格式化截止时间为 "YYYY-MM-DD HH:mm" */
