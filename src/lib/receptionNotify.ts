/**
 * 政府接待飞书通知共享逻辑
 * 被 /api/reception/[id]/notify 和 /api/cron/process-notifications 共同使用
 */

import { getAppAccessToken } from "@/lib/feishu";

export interface NotifyField { label: string; value: string }

// ── 字段分类 ──────────────────────────────────────────────────────────────────

// "会议照片" 已从 SHORT_LABELS 移除，改为折叠面板单独渲染
const SHORT_LABELS = new Set(["接待时间", "接待级别", "状态", "主接待人", "着装要求", "接待形式", "地址"]);
const LONG_LABELS  = new Set(["来访/会议目的", "来访/会议背景", "备注", "待办事项", "调研文件", "会议纪要"]);

// ── 飞书图片上传 ──────────────────────────────────────────────────────────────

export async function uploadImageToFeishu(imageUrl: string, token: string): Promise<string | null> {
  try {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const blob   = await imgRes.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    const ct     = imgRes.headers.get("content-type") ?? "image/jpeg";

    const formData = new FormData();
    formData.append("image_type", "message");
    formData.append("image", new Blob([buffer], { type: ct }), "image.jpg");

    const uploadRes = await fetch("https://open.feishu.cn/open-apis/im/v1/images", {
      method:  "POST",
      headers: { Authorization: `Bearer ${token}` },
      body:    formData,
    });
    const json = await uploadRes.json() as { code: number; data?: { image_key: string } };
    if (json.code !== 0 || !json.data?.image_key) return null;
    return json.data.image_key;
  } catch {
    return null;
  }
}

// ── 卡片构建 ──────────────────────────────────────────────────────────────────

export function buildReceptionCard(
  title: string,
  fields: NotifyField[],
  receptionId: string,
  leaderImageKeys: string[],
  meetingPhotoImageKeys: string[] = [],
): object {
  const APP_URL  = process.env.NEXT_PUBLIC_APP_URL ?? "https://pa-platform-kappa.vercel.app";
  const elements: object[] = [];

  // ── 短字段区（不再包含"会议照片"）
  const shortFields = fields.filter(f => SHORT_LABELS.has(f.label));
  if (shortFields.length > 0) {
    elements.push({
      tag:     "markdown",
      content: shortFields.map(f => `**${f.label}：** ${f.value}`).join("\n"),
    });
  }

  const leaderField = fields.find(f => f.label === "领导介绍");
  const longFields  = fields.filter(f => LONG_LABELS.has(f.label));

  for (const f of longFields) {
    elements.push({ tag: "hr" });

    if (f.label === "待办事项") {
      // 每条待办独立一个 markdown 元素，保证飞书卡片中每行真实换行
      elements.push({ tag: "markdown", content: `**${f.label}**` });
      const todoLines = f.value.split("\n").filter(Boolean);
      for (const line of todoLines) {
        elements.push({ tag: "markdown", content: line });
      }
    } else {
      elements.push({ tag: "markdown", content: `**${f.label}**\n${f.value}` });
    }

    // 领导介绍折叠面板：紧跟"来访/会议背景"之后
    if (f.label === "来访/会议背景" && leaderField) {
      elements.push({ tag: "hr" });
      elements.push(_buildLeaderPanel(leaderField.value, leaderImageKeys));
    }
  }

  // 兜底：背景字段未勾选时，领导介绍插入到长文本区末尾
  const hasBackground = longFields.some(f => f.label === "来访/会议背景");
  if (leaderField && !hasBackground) {
    elements.push({ tag: "hr" });
    elements.push(_buildLeaderPanel(leaderField.value, leaderImageKeys));
  }

  // ── 会议照片折叠面板（仅在字段被勾选且有图片时插入）
  const photoField = fields.find(f => f.label === "会议照片");
  if (photoField) {
    elements.push({ tag: "hr" });
    elements.push(_buildMeetingPhotosPanel(photoField.value, meetingPhotoImageKeys));
  }

  // 其余未分类字段
  const classified = new Set([...shortFields, ...longFields].map(f => f.label));
  if (leaderField)  classified.add("领导介绍");
  if (photoField)   classified.add("会议照片");
  for (const f of fields.filter(f => !classified.has(f.label))) {
    elements.push({ tag: "hr" });
    elements.push({ tag: "markdown", content: `**${f.label}**\n${f.value}` });
  }

  const link = `${APP_URL}/dashboard/reception?id=${receptionId}`;
  elements.push({ tag: "hr" });
  elements.push({ tag: "markdown", content: `👉 **[一键跳转应用平台查看详细信息](${link})**` });

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title:    { content: `📋 ${title}`, tag: "plain_text" },
    },
    body: { elements },
  };
}

function _buildLeaderPanel(rawValue: string, imageKeys: string[]): object {
  const panelElements: object[] = [];
  const introText = rawValue.replace(/（附 \d+ 张图片）/g, "").trim();
  if (introText) panelElements.push({ tag: "markdown", content: introText });
  for (const key of imageKeys) {
    panelElements.push({
      tag:     "img",
      img_key: key,
      alt:     { tag: "plain_text", content: "领导介绍图片" },
      mode:    "fit_horizontal",
      preview: true,
    });
  }
  if (panelElements.length === 0) {
    panelElements.push({ tag: "markdown", content: rawValue || "（暂无内容）" });
  }
  return {
    tag:      "collapsible_panel",
    expanded: false,
    header:   {
      title:          { tag: "markdown", content: "**领导介绍（点击展开）**" },
      vertical_align: "center",
    },
    elements: panelElements,
  };
}

function _buildMeetingPhotosPanel(rawValue: string, imageKeys: string[]): object {
  // rawValue 形如 "共 N 张"，用于标题
  const countMatch = rawValue.match(/\d+/);
  const count      = countMatch ? countMatch[0] : imageKeys.length.toString();

  const panelElements: object[] = [];

  if (imageKeys.length > 0) {
    for (const key of imageKeys) {
      panelElements.push({
        tag:     "img",
        img_key: key,
        alt:     { tag: "plain_text", content: "会议照片" },
        mode:    "fit_horizontal",
        preview: true,
      });
    }
  } else {
    // 图片转换全部失败的降级文案
    panelElements.push({
      tag:     "markdown",
      content: `共 ${count} 张会议照片（图片加载失败，请前往平台查看）`,
    });
  }

  return {
    tag:      "collapsible_panel",
    expanded: false,
    header:   {
      title:          { tag: "markdown", content: `**🖼️ 会议照片（点击展开，共 ${count} 张）**` },
      vertical_align: "center",
    },
    elements: panelElements,
  };
}

// ── 发送到单个目标 ────────────────────────────────────────────────────────────

export async function sendCardToTarget(targetId: string, card: object): Promise<void> {
  const id     = targetId.trim();
  const idType = id.startsWith("oc_") ? "chat_id" : "open_id";
  const token  = await getAppAccessToken();
  const res    = await fetch(
    `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${idType}`,
    {
      method:  "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ receive_id: id, msg_type: "interactive", content: JSON.stringify(card) }),
    }
  );
  const json = await res.json() as { code: number; msg: string };
  if (json.code !== 0) {
    const hint = json.code === 230002
      ? `机器人不在目标（${id}）中，请先将应用机器人加入该群或添加为好友`
      : json.msg;
    throw new Error(`[Feishu] 发送失败 target=${id} code=${json.code}：${hint}`);
  }
}

// ── 批量图片上传（并发，失败降级）────────────────────────────────────────────

export async function resolveLeaderImageKeys(rawImages: string[]): Promise<string[]> {
  if (rawImages.length === 0) return [];
  const token   = await getAppAccessToken();
  const results = await Promise.allSettled(rawImages.map(url => uploadImageToFeishu(url, token)));
  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value);
}

export async function resolveMeetingPhotoImageKeys(rawImages: string[]): Promise<string[]> {
  if (rawImages.length === 0) return [];
  const token   = await getAppAccessToken();
  const results = await Promise.allSettled(rawImages.map(url => uploadImageToFeishu(url, token)));
  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value);
}

// ── 完整发送流程（供 notify route 和 cron route 共用）────────────────────────

export interface SendNotifyPayload {
  receptionId:        string;
  receptionTitle:     string;
  fields:             NotifyField[];
  targetIds:          string[];
  leaderIntroImages?: string[];
  meetingPhotoUrls?:  string[];  // 会议照片原始 URL 列表
}

export async function executeNotify(payload: SendNotifyPayload): Promise<{ sent: number; failed: number; errors: string[] }> {
  // 并发转换两种图片（互不阻塞）
  const [leaderImageKeys, meetingPhotoImageKeys] = await Promise.all([
    resolveLeaderImageKeys(payload.leaderIntroImages ?? []),
    resolveMeetingPhotoImageKeys(payload.meetingPhotoUrls ?? []),
  ]);

  const card = buildReceptionCard(
    payload.receptionTitle,
    payload.fields,
    payload.receptionId,
    leaderImageKeys,
    meetingPhotoImageKeys,
  );
  const results = await Promise.allSettled(payload.targetIds.map(tid => sendCardToTarget(tid, card)));
  const failed  = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  return {
    sent:   results.length - failed.length,
    failed: failed.length,
    errors: failed.map(r => r.reason instanceof Error ? r.reason.message : String(r.reason)),
  };
}
