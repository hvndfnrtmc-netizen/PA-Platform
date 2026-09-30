"use server";

import { revalidatePath } from "next/cache";
import prisma             from "@/lib/prisma";
import { getSession }     from "@/lib/auth";

// ── 转出申请数据结构 ──────────────────────────────────────────────
export interface TransferOutFormData {
  name?:            string;
  targetCommittee?: string;
  targetBranch?:    string;
  reason?:          string;
}

/**
 * fetchTransferOutInitData — 获取当前用户的转出申请记录
 * - 若已有记录直接返回
 * - 若无记录则从转入台账提取姓名作为初始数据
 */
export async function fetchTransferOutInitData(): Promise<{
  record?: { id: string; name?: string | null; targetCommittee?: string | null; targetBranch?: string | null; reason?: string | null; status: string } | null;
  initName?: string;
  error?: string;
}> {
  const session = await getSession();
  if (!session?.user) return { error: "未登录" };

  // 查是否已有转出申请
  const outRecord = await prisma.partyTransferOutRequest.findUnique({
    where: { userId: session.user.id },
  });
  if (outRecord) {
    return {
      record: {
        id:              outRecord.id,
        name:            outRecord.name,
        targetCommittee: outRecord.targetCommittee,
        targetBranch:    outRecord.targetBranch,
        reason:          outRecord.reason,
        status:          outRecord.status,
      },
    };
  }

  // 从转入台账智能提取姓名
  const inRecord = await prisma.partyTransferRecord.findFirst({
    where:   { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  const info = inRecord?.collectedInfo as Record<string, string> | null;
  const initName = info?.name ?? inRecord?.realName ?? session.user.name ?? "";

  return { record: null, initName: initName ?? "" };
}

/**
 * saveTransferOutDraft — 暂存转出申请草稿
 */
export async function saveTransferOutDraft(data: TransferOutFormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "未登录" };

  await prisma.partyTransferOutRequest.upsert({
    where:  { userId: session.user.id },
    create: { userId: session.user.id, status: "DRAFT", ...data },
    update: { status: "DRAFT", ...data },
  });

  revalidatePath("/dashboard/party-transfer", "page");
  return { ok: true };
}

/**
 * submitTransferOut — 提交转出申请（DRAFT → SUBMITTED）
 */
export async function submitTransferOut(data: TransferOutFormData): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "未登录" };

  if (!data.targetCommittee?.trim()) return { ok: false, error: "请填写接收方党委抬头" };
  if (!data.targetBranch?.trim())    return { ok: false, error: "请填写具体转入党组织名称" };
  if (!data.reason?.trim())          return { ok: false, error: "请填写申请原因" };

  await prisma.partyTransferOutRequest.upsert({
    where:  { userId: session.user.id },
    create: { userId: session.user.id, status: "SUBMITTED", ...data },
    update: { status: "SUBMITTED", ...data },
  });

  revalidatePath("/dashboard/party-transfer", "page");
  return { ok: true };
}

/**
 * nukeAllTransferRecords — 核弹级清库（仅 SUPER_ADMIN 可用）
 * 清空全部转入 + 转出申请记录，用于清除测试脏数据
 */
export async function nukeAllTransferRecords(): Promise<{ ok: boolean; error?: string; deleted?: number }> {
  const session = await getSession();
  if (!session?.user) return { ok: false, error: "未登录" };
  if (session.user.role !== "SUPER_ADMIN") return { ok: false, error: "无权限，仅超级管理员可执行清库" };

  try {
    const [outDel, inDel] = await Promise.all([
      prisma.partyTransferOutRequest.deleteMany({}),
      prisma.partyTransferRecord.deleteMany({}),
    ]);
    revalidatePath("/dashboard/party-transfer", "page");
    return { ok: true, deleted: outDel.count + inDel.count };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * verifyReceiptMonth — OCR 收据月份核验
 * 调用公司大模型视觉接口，从收据图片中提取缴费截止年月，
 * 并与系统当前年月进行比对。
 *
 * 返回值：
 *   passed        — true 时允许进入下一步
 *   detectedMonth — 识别到的 YYYY-MM，null 表示无法识别
 *   currentMonth  — 系统当前年月 YYYY-MM
 *   error         — 技术性错误说明（不是月份不符，而是服务故障）
 */
export async function verifyReceiptMonth(imageUrl: string): Promise<{
  passed:         boolean;
  detectedMonth:  string | null;
  currentMonth:   string;
  error?:         string;
}> {
  const ABP_BASE_URL = process.env.ABP_BASE_URL;
  const ABP_API_KEY  = process.env.ABP_API_KEY;
  const ABP_MODEL    = process.env.ABP_MODEL ?? "gpt-4-vision-preview";

  const now          = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // OCR 服务未配置 → 跳过核验，直接放行
  if (!ABP_BASE_URL || !ABP_API_KEY) {
    return { passed: true, detectedMonth: null, currentMonth, error: "OCR 服务未配置，已跳过自动核验" };
  }

  try {
    const resp = await fetch(`${ABP_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${ABP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ABP_MODEL,
        messages: [
          {
            role:    "system",
            content: "你是一个严谨的图片数据提取机器人。从党费缴费收据图片中提取缴费截止年月，严格按照 YYYY-MM 格式输出，如 2026-02。只输出这一个字符串，不含任何其他文字。如果无法识别，输出 UNKNOWN。",
          },
          {
            role:    "user",
            content: [
              { type: "image_url", image_url: { url: imageUrl } },
              { type: "text",      text:      "请提取该党费收据的缴费截止年月，格式 YYYY-MM：" },
            ],
          },
        ],
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      // 服务暂不可用 → 放行并标注
      return { passed: true, detectedMonth: null, currentMonth, error: "OCR 服务暂时不可用，已跳过自动核验" };
    }

    const data         = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw          = (data.choices?.[0]?.message?.content ?? "").trim();
    const match        = raw.match(/(\d{4}-\d{2})/);
    const detectedMonth = match ? match[1] : null;

    // 无法识别日期 → 放行并提示
    if (!detectedMonth || raw.toUpperCase().includes("UNKNOWN")) {
      return { passed: true, detectedMonth: null, currentMonth, error: "OCR 无法识别收据日期，请确认已交至当月" };
    }

    // 精确比对年月
    const passed = detectedMonth === currentMonth;
    return { passed, detectedMonth, currentMonth };

  } catch {
    return { passed: true, detectedMonth: null, currentMonth, error: "OCR 核验服务异常，已跳过自动核验" };
  }
}
