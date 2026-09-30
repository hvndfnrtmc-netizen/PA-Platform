/**
 * 飞书多维表格（Bitable）同步服务
 *
 * 所需环境变量：
 *   FEISHU_APP_ID               — 已配置
 *   FEISHU_APP_SECRET           — 已配置
 *   FEISHU_BITABLE_APP_TOKEN    — 多维表格应用 Token（链接 /base/{app_token}）
 *   FEISHU_RECEPTION_TABLE_ID   — 接待管理表的 Table ID（链接 ?table={table_id}）
 *   FEISHU_BASE_DOMAIN          — 可选，默认 feishu.cn（企业自定义域名如 momenta.feishu.cn）
 *   FEISHU_BITABLE_RECORD_BASE_URL — 可选，深层链接前缀（优先级最高）。
 *                                    Wiki 嵌入式 Bitable 请填写：
 *                                    https://momenta.feishu.cn/wiki/{wiki_token}?table={table_id}
 *                                    普通 Base 可不填，自动用 /base/{app_token}?table={table_id} 构造。
 *
 * Bitable 字段名必须与实际表格列名完全一致。
 * 如有差异，通过以下环境变量覆盖默认值：
 *   FEISHU_FIELD_TITLE / FEISHU_FIELD_DATE / FEISHU_FIELD_LEVEL
 *   FEISHU_FIELD_HOST  / FEISHU_FIELD_PURPOSE / FEISHU_FIELD_STATUS
 *   FEISHU_FIELD_FORMAT
 */

import { getTenantAccessToken } from "@/lib/feishu";
import { loadFormatDicts, resolveToRootNames } from "@/lib/receptionFormatUtils";

// ── 配置 ──────────────────────────────────────────────────────────

const APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN  ?? "";
const TABLE_ID  = process.env.FEISHU_RECEPTION_TABLE_ID ?? "";
const DOMAIN    = process.env.FEISHU_BASE_DOMAIN        ?? "feishu.cn";

// Wiki token → Bitable obj_token 解析缓存（容器生命周期内有效）
let _resolvedAppToken: string | null = null;

/**
 * 返回真正的 Bitable app_token。
 * 若 APP_TOKEN 是飞书 Wiki 节点 token（/wiki/{token}），自动通过 wiki API 解析出
 * 实际的 obj_token（Bitable 的真实 app_token）。
 */
async function getResolvedAppToken(): Promise<string> {
  if (_resolvedAppToken) return _resolvedAppToken;
  try {
    const token = await getTenantAccessToken();
    const res   = await fetch(
      `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${APP_TOKEN}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    const json  = await res.json() as { code: number; data?: { node?: { obj_token?: string } } };
    if (json.code === 0 && json.data?.node?.obj_token) {
      _resolvedAppToken = json.data.node.obj_token;
      console.log("[Bitable] Wiki token resolved →", _resolvedAppToken);
      return _resolvedAppToken;
    }
  } catch {
    // 解析失败时直接用原始 APP_TOKEN
  }
  _resolvedAppToken = APP_TOKEN;
  return _resolvedAppToken;
}

// 字段名映射（必须与飞书表格列名完全一致）
const FIELD = {
  TITLE:      process.env.FEISHU_FIELD_TITLE      ?? "会议名称/来访人员",
  DATE:       process.env.FEISHU_FIELD_DATE        ?? "日期",
  LEVEL:      process.env.FEISHU_FIELD_LEVEL       ?? "级别",
  HOST:       process.env.FEISHU_FIELD_HOST        ?? "主接待",
  PURPOSE:    process.env.FEISHU_FIELD_PURPOSE     ?? "来访/会议目的",
  STATUS:     process.env.FEISHU_FIELD_STATUS      ?? "状态",
  FORMAT:     process.env.FEISHU_FIELD_FORMAT      ?? "形式",
  BACKGROUND: process.env.FEISHU_FIELD_BACKGROUND  ?? "来访/会议背景",
  DRESS_CODE: process.env.FEISHU_FIELD_DRESS_CODE  ?? "着装要求",
} as const;

const BITABLE_API = "https://open.feishu.cn/open-apis/bitable/v1";

// ── 数据类型 ──────────────────────────────────────────────────────

/** Reception 中用于同步的最小字段集 */
export interface ReceptionSyncData {
  title:      string;
  startTime:  Date | string;
  level:      string;
  hostName:   string | null;
  hostUser?:  { name: string } | null;
  dressCode:  string | null;
  purpose:    string;
  status:     string;
  formats:    unknown; // Prisma Json — 实际为 string[]
  background: string | null;
}

// ── 内部工具 ──────────────────────────────────────────────────────

function isConfigured(): boolean {
  return Boolean(APP_TOKEN && TABLE_ID && process.env.FEISHU_APP_ID);
}

/**
 * 飞书 Bitable 日期/日期时间字段要求传入 UTC 毫秒时间戳。
 * 直接返回完整时间戳（含时分秒），飞书会按表格字段的格式设置决定如何显示。
 * 若飞书字段类型为「日期」（只显示到天），建议在飞书多维表格中将该字段改为「日期时间」。
 */
function toFeishuDateTs(dateInput: Date | string): number {
  return new Date(dateInput).getTime();
}

/**
 * 将 Reception 数据转换为 Bitable fields 对象。
 *
 * 飞书字段类型规范：
 *   文本   → string
 *   日期   → 当天 CST 00:00:00 对应的 UTC ms 时间戳 (number)
 *   单选   → string（选项值，需与飞书表格选项完全一致）
 *   多选   → string[]（选项值数组）
 *
 * formats 存储格式为 ReceptionDictionary.id 数组，需先通过字典解析为中文名称。
 * 本函数为异步，调用方须 await。
 */
async function receptionToFields(r: ReceptionSyncData): Promise<Record<string, unknown>> {
  const host = r.hostUser?.name ?? r.hostName ?? "";

  // ── formats: UUID[] → 中文名称[]，再拼接为字符串（飞书文本字段）
  let formatStr = "";
  const rawFormats = r.formats;
  if (Array.isArray(rawFormats) && rawFormats.length > 0) {
    const ids = (rawFormats as unknown[]).filter((f): f is string => typeof f === "string" && f.length > 0);
    if (ids.length > 0) {
      // 判断是 UUID 还是已经是中文名（兼容历史数据迁移期间的纯字符串存储）
      const looksLikeId = /^[a-z0-9]{20,}$/i.test(ids[0]);
      if (looksLikeId) {
        const dictById = await loadFormatDicts();
        const names    = resolveToRootNames(ids, dictById);
        formatStr = names.join("、");
      } else {
        // 已经是中文名，直接拼接
        formatStr = ids.join("、");
      }
    }
  }

  const dateTs = toFeishuDateTs(r.startTime);

  const raw: Record<string, unknown> = {
    [FIELD.TITLE]:      r.title,
    [FIELD.DATE]:       dateTs,
    [FIELD.LEVEL]:      r.level      || undefined,
    [FIELD.HOST]:       host         || undefined,
    [FIELD.PURPOSE]:    r.purpose    || undefined,
    [FIELD.STATUS]:     r.status     || undefined,
    [FIELD.BACKGROUND]: r.background || undefined,
    [FIELD.DRESS_CODE]: r.dressCode  || undefined,
  };

  if (formatStr) raw[FIELD.FORMAT] = formatStr;

  // 去掉值为 undefined 的 key，避免飞书 API 报字段校验错误
  const fields = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined),
  );

  // ── Debug 日志：打印将要发送的完整 payload
  console.log("【飞书同步 payload fields】:", JSON.stringify(fields, null, 2));

  return fields;
}

/** 生成飞书多维表格行深层链接（优先使用 FEISHU_BITABLE_RECORD_BASE_URL）*/
function buildBitableUrl(recordId: string): string {
  const baseUrl = (process.env.FEISHU_BITABLE_RECORD_BASE_URL ?? "").replace(/[?&]record=[^&]*/g, "").replace(/&$/, "");
  if (baseUrl) return `${baseUrl}&record=${recordId}`;
  return `https://${DOMAIN}/base/${APP_TOKEN}?table=${TABLE_ID}&record=${recordId}`;
}

// ── 公开 API ──────────────────────────────────────────────────────

/**
 * 在飞书多维表格中创建一行记录。
 *
 * @returns 成功时返回 { recordId, url }；环境变量未配置时返回 null（跳过同步）。
 * @throws  飞书 API 返回非 0 code 时抛出 Error（由调用方 catch 处理）。
 */
export async function createBitableRecord(
  data: ReceptionSyncData,
): Promise<{ recordId: string; url: string } | null> {
  if (!isConfigured()) {
    console.warn(
      "[Bitable] FEISHU_BITABLE_APP_TOKEN 或 FEISHU_RECEPTION_TABLE_ID 未配置，跳过同步",
    );
    return null;
  }

  const [token, realToken, fields] = await Promise.all([
    getTenantAccessToken(),
    getResolvedAppToken(),
    receptionToFields(data),
  ]);

  const res = await fetch(
    `${BITABLE_API}/apps/${realToken}/tables/${TABLE_ID}/records`,
    {
      method:  "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ fields }),
    },
  );

  const json = await res.json() as {
    code:  number;
    msg:   string;
    data?: { record?: { record_id?: string } };
  };

  if (json.code !== 0) {
    throw new Error(
      `[Bitable] createRecord 失败 code=${json.code} msg=${json.msg}。请检查飞书表格是否包含以下完全一致的列名：${Object.keys(fields).join(", ")}`,
    );
  }

  const recordId = json.data?.record?.record_id ?? "";
  if (!recordId) {
    throw new Error("[Bitable] createRecord 返回的 record_id 为空");
  }

  console.log("[Bitable] 创建成功 record_id:", recordId);
  return { recordId, url: buildBitableUrl(recordId) };
}

// ── 重大项目 Bitable 同步 ──────────────────────────────────────────

const MAJOR_PROJECT_APP_TOKEN = process.env.FEISHU_MAJOR_PROJECT_APP_TOKEN ?? "";
const MAJOR_PROJECT_TABLE_ID  = process.env.FEISHU_MAJOR_PROJECT_TABLE_ID  ?? "";

let _resolvedMajorProjectAppToken: string | null = null;

async function getResolvedMajorProjectAppToken(): Promise<string> {
  if (_resolvedMajorProjectAppToken) return _resolvedMajorProjectAppToken;
  try {
    const token = await getTenantAccessToken();
    const res   = await fetch(
      `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${MAJOR_PROJECT_APP_TOKEN}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    const json = await res.json() as { code: number; data?: { node?: { obj_token?: string } } };
    if (json.code === 0 && json.data?.node?.obj_token) {
      _resolvedMajorProjectAppToken = json.data.node.obj_token;
      return _resolvedMajorProjectAppToken;
    }
  } catch {
    // fall through
  }
  _resolvedMajorProjectAppToken = MAJOR_PROJECT_APP_TOKEN;
  return _resolvedMajorProjectAppToken;
}

/** 飞书多维表格字段名（与实际列名一致，可通过环境变量覆盖） */
const MP_FIELD = {
  NAME:          process.env.FEISHU_MP_FIELD_NAME          ?? "项目名称",
  CODE:          process.env.FEISHU_MP_FIELD_CODE          ?? "立项编号",
  LEVEL:         process.env.FEISHU_MP_FIELD_LEVEL         ?? "项目级别",
  CATEGORY:      process.env.FEISHU_MP_FIELD_CATEGORY      ?? "项目类别",
  COMPANY:       process.env.FEISHU_MP_FIELD_COMPANY       ?? "公司主体",            // 已修正：收款公司主体 → 公司主体
  TOTAL_AMOUNT:  process.env.FEISHU_MP_FIELD_TOTAL_AMOUNT  ?? "总金额（万元）",
  RECEIVED:      process.env.FEISHU_MP_FIELD_RECEIVED      ?? "已到账金额（万元）",
  RECEIVED_DATE: process.env.FEISHU_MP_FIELD_RECEIVED_DATE ?? "到账时间",
  AFFILIATION:   process.env.FEISHU_MP_FIELD_AFFILIATION   ?? "归属公司/个人",        // 已修正：归属 → 归属公司/个人
  PROGRESS:      process.env.FEISHU_MP_FIELD_PROGRESS      ?? "项目进度",
  REMARK:        process.env.FEISHU_MP_FIELD_REMARK        ?? "备注",
  PROOF:         process.env.FEISHU_MP_FIELD_PROOF         ?? "证明材料",
  WEEK_FOCUS:    process.env.FEISHU_MP_FIELD_WEEK_FOCUS    ?? "周重点",
} as const;

export interface MajorProjectSyncData {
  name:              string;
  projectCode?:      string | null;
  levelDict?:        { value: string } | null;
  categoryDict?:     { value: string } | null;
  companyEntityNames?: string[];
  companyEntityDict?: { value: string } | null;
  totalAmount?:      number | null;
  receivedAmount?:   number;
  receivedDate?:     Date | null;
  affiliation?:      string | null;
  progress?:         string | null;
  remark?:           string | null;
  isWeekFocus?:      boolean;
}

function isMajorProjectConfigured(): boolean {
  return Boolean(MAJOR_PROJECT_APP_TOKEN && MAJOR_PROJECT_TABLE_ID && process.env.FEISHU_APP_ID);
}

/**
 * 将字符串转换为飞书多选字段所需的 string[] 格式。
 * 支持斜杠、顿号、逗号、分号分隔的复合值拆分。
 * 若值为空则返回 undefined（此 key 将被整体剔除）。
 */
function toMultiSelect(value: string | null | undefined): string[] | undefined {
  if (!value) return undefined;
  const parts = value.split(/[/、,，;；]+/).map(s => s.trim()).filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

function majorProjectToFields(
  data:        MajorProjectSyncData,
  attachments: { file_token: string }[],
): Record<string, unknown> {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 【安全测试模式】仅同步 3 个绝对安全字段，验证接口通畅后再逐步放开。
  // 若下面 3 个字段同步成功，说明接口完全正常，其余字段是表头名称问题。
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const raw: Record<string, unknown> = {
    [MP_FIELD.NAME]:     data.name,
    [MP_FIELD.CATEGORY]: data.categoryDict?.value || undefined,
    [MP_FIELD.LEVEL]:    data.levelDict?.value    || undefined,

    // ── 以下字段待表头名称逐一确认后再开放 ──────────────────────
    // [MP_FIELD.CODE]:          data.projectCode  || undefined,
    // [MP_FIELD.COMPANY]:       (data.companyEntityNames?.filter(Boolean).length
    //                             ? data.companyEntityNames.filter(Boolean)
    //                             : toMultiSelect(data.companyEntityDict?.value ?? null)),
    // [MP_FIELD.TOTAL_AMOUNT]:  data.totalAmount  ?? undefined,   // 需确认括号：（万）vs（万元），中英文括号
    // [MP_FIELD.RECEIVED]:      data.receivedAmount ?? undefined,
    // [MP_FIELD.RECEIVED_DATE]: data.receivedDate ? new Date(data.receivedDate).getTime() : undefined,
    // [MP_FIELD.AFFILIATION]:   toMultiSelect(data.affiliation ?? null),
    // [MP_FIELD.PROGRESS]:      data.progress    || undefined,
    // [MP_FIELD.REMARK]:        data.remark      || undefined,
    // [MP_FIELD.WEEK_FOCUS]:    data.isWeekFocus ? "是" : undefined,
  };

  // 附件暂时也不同步，避免干扰主流程测试
  // if (attachments.length > 0) {
  //   raw[MP_FIELD.PROOF] = attachments;
  // }

  // 剔除所有空值（undefined / null / ""）防止飞书报字段校验错误
  return Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined && v !== null && v !== "")
  );
}

/** 生成重大项目飞书行深层链接 */
function buildMajorProjectBitableUrl(recordId: string): string {
  const baseUrl = (process.env.FEISHU_MP_BITABLE_RECORD_BASE_URL ?? "").replace(/[?&]record=[^&]*/g, "").replace(/&$/, "");
  if (baseUrl) return `${baseUrl}&record=${recordId}`;
  return `https://${DOMAIN}/base/${MAJOR_PROJECT_APP_TOKEN}?table=${MAJOR_PROJECT_TABLE_ID}&record=${recordId}`;
}

/**
 * 在重大项目飞书多维表格中创建一行。
 * @returns { recordId, url } 或 null（环境变量未配置时）
 */
export async function createMajorProjectBitableRecord(
  data:        MajorProjectSyncData,
  attachments: { file_token: string }[] = [],
): Promise<{ recordId: string; url: string } | null> {
  if (!isMajorProjectConfigured()) {
    console.warn("[MajorProject Bitable] FEISHU_MAJOR_PROJECT_APP_TOKEN 或 TABLE_ID 未配置，跳过同步");
    return null;
  }

  const [token, realToken] = await Promise.all([
    getTenantAccessToken(),
    getResolvedMajorProjectAppToken(),
  ]);
  const fields = majorProjectToFields(data, attachments);

  console.log("[MajorProject Sync] Payload:", JSON.stringify(fields, null, 2));

  const res = await fetch(
    `${BITABLE_API}/apps/${realToken}/tables/${MAJOR_PROJECT_TABLE_ID}/records`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ fields }),
    },
  );
  const json = await res.json() as { code: number; msg: string; data?: { record?: { record_id?: string } } };
  if (json.code !== 0) {
    const sentKeys = Object.keys(fields).join(", ");
    throw new Error(`[MajorProject Bitable] createRecord 失败 code=${json.code} msg=${json.msg} | 发送的字段名: [${sentKeys}]`);
  }

  const recordId = json.data?.record?.record_id ?? "";
  if (!recordId) throw new Error("[MajorProject Bitable] createRecord 返回的 record_id 为空");
  return { recordId, url: buildMajorProjectBitableUrl(recordId) };
}

/**
 * 更新重大项目飞书多维表格中已有行。
 */
export async function updateMajorProjectBitableRecord(
  recordId:    string,
  data:        MajorProjectSyncData,
  attachments: { file_token: string }[] = [],
): Promise<void> {
  if (!isMajorProjectConfigured()) {
    console.warn("[MajorProject Bitable] 环境变量未配置，跳过同步");
    return;
  }

  const [token, realToken] = await Promise.all([
    getTenantAccessToken(),
    getResolvedMajorProjectAppToken(),
  ]);
  const fields = majorProjectToFields(data, attachments);

  const res = await fetch(
    `${BITABLE_API}/apps/${realToken}/tables/${MAJOR_PROJECT_TABLE_ID}/records/${recordId}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ fields }),
    },
  );
  const json = await res.json() as { code: number; msg: string };
  if (json.code !== 0) {
    const sentKeys = Object.keys(fields).join(", ");
    throw new Error(`[MajorProject Bitable] updateRecord 失败 code=${json.code} msg=${json.msg} | 发送的字段名: [${sentKeys}]`);
  }
  console.log("[MajorProject Bitable] 更新成功 record_id:", recordId);
}

/**
 * 更新飞书多维表格中已有行。
 *
 * @throws 飞书 API 返回非 0 code 时抛出 Error。
 */
export async function updateBitableRecord(
  recordId: string,
  data:      ReceptionSyncData,
): Promise<void> {
  if (!isConfigured()) {
    console.warn("[Bitable] 环境变量未配置，跳过同步");
    return;
  }

  const [token, realToken, fields] = await Promise.all([
    getTenantAccessToken(),
    getResolvedAppToken(),
    receptionToFields(data),
  ]);

  const res = await fetch(
    `${BITABLE_API}/apps/${realToken}/tables/${TABLE_ID}/records/${recordId}`,
    {
      method:  "PUT",
      headers: {
        Authorization:  `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({ fields }),
    },
  );

  const json = await res.json() as { code: number; msg: string };

  if (json.code !== 0) {
    throw new Error(
      `[Bitable] updateRecord 失败 code=${json.code} msg=${json.msg}。请检查飞书表格是否包含以下完全一致的列名：${Object.keys(fields).join(", ")}`,
    );
  }

  console.log("[Bitable] 更新成功 record_id:", recordId);
}
