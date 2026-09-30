/**
 * POST /api/major-projects/parse-bitable
 * 解析飞书多维表格 → 返回预览数据（不写库）
 * 支持父子层级智能识别
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { feishuRequest } from "@/lib/feishu";

// ── 类型 ───────────────────────────────────────────────────────────

/** 飞书多维表格附件字段中单个文件的元数据 */
export interface FeishuAttachment {
  file_token: string;
  name: string;
  type: string;    // MIME type（如 "image/png", "application/pdf"）
  size?: number;
}

export interface ParsedProject {
  name: string;
  parentName?: string | null;   // 有值则为子项目（通过字段名匹配的父级名称）
  feishuRecordId?: string | null;   // 飞书原始 record_id，用于精确父子匹配
  feishuParentId?: string | null;   // 飞书原始 parent_record_id（子记录模式）
  categoryDict?: string | null;
  levelDict?: string | null;
  companyEntityDict?: string[] | null;  // 多选：拆分后的收款公司主体数组
  totalAmount?: number | null;
  receivedAmount?: number | null;
  receivedDate?: Date | null;   // 到账时间
  // ── 生命周期时间节点 ──
  applyDate?: Date | null;      // 申报时间 → APPLY 里程碑
  startDate?: Date | null;      // 开始时间 → START 里程碑
  midCheckDate?: Date | null;   // 中期验收时间 → MID_CHECK 里程碑
  endDate?: Date | null;        // 结项时间 → END 里程碑
  // ── 考核指标 ──
  kpis?: Array<{ name: string; content: string | null }>;
  affiliation?: string | null;
  progress?: string | null;
  ownerName?: string | null;
  remark?: string | null;
  projectCode?: string | null;
  isWeekFocus?: boolean;
  proofMaterialFiles?: FeishuAttachment[];  // 飞书附件元数据（含 file_token，待 bulk-import 阶段转存）
}

// ── 字段提取工具（复用 Reception parse-feishu 成熟模式） ──────────

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

function cleanDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && v > 0) return new Date(v);
  if (typeof v === "string" && v.trim()) {
    const d = new Date(v.trim());
    return isNaN(d.getTime()) ? null : d;
  }
  // 飞书有时将日期包装在对象里 { value: timestamp }
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    if (typeof o.value === "number" && o.value > 0) return new Date(o.value);
  }
  return null;
}

function cleanFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  // 飞书数字字段有时会被包装在对象/数组中，先用 extractText 统一展开为字符串
  const raw = typeof v === "number" ? String(v) : extractText(v);
  if (!raw || raw === "/" || raw === "-" || raw === "—") return null;
  // 去除千分位逗号、空格，再解析
  const str = raw.replace(/,/g, "").trim();
  if (!str) return null;
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

function pick(f: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) { if (k in f && f[k] !== undefined && f[k] !== null) return f[k]; }
  return undefined;
}

/**
 * 从飞书关联字段（link field）中提取被引用记录的 record_id。
 *
 * 关联字段格式：[{ record_id: "recXXX", text: "项目名称", ... }]
 * 用于当父子关系通过"关联字段"表达时（而非原生树形视图的 parent_record_id），
 * 将被引用的 record_id 作为 feishuParentId，确保两遍遍历能正确建立层级。
 */
function extractLinkRecordId(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const first = v[0] as Record<string, unknown>;
  if (first && typeof first === "object" && typeof first.record_id === "string" && first.record_id) {
    return first.record_id;
  }
  return null;
}

/** 提取飞书附件字段 → FeishuAttachment[]（含 file_token 供后续下载） */
function extractAttachments(v: unknown): FeishuAttachment[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((item): item is Record<string, unknown> =>
      item !== null && typeof item === "object" && "file_token" in item
    )
    .map(item => ({
      file_token: String(item.file_token),
      name:       String(item.name  ?? "attachment"),
      type:       String(item.type  ?? "application/octet-stream"),
      size:       typeof item.size === "number" ? item.size : undefined,
    }));
}

/** 解析单条飞书完整 record（含 record_id / parent_record_id）→ ParsedProject */
function mapRecord(
  f: Record<string, unknown>,
  recordId?: string,
  parentRecordId?: string,
): ParsedProject {
  const name = cleanStr(pick(f,
    "项目名称", "名称", "子项目名称", "立项名称", "项目", "title",
  ));

  // 父级项目识别（三种模式，优先级从高到低）：
  // 1. 原生树形视图：parent_record_id 在 record 级别（通过 parentRecordId 参数传入）
  // 2. 关联字段（link field）：fields["父记录"] = [{ record_id: "recXXX", text: "已结束" }]
  //    → 从数组元素中提取 record_id 作为 feishuParentId
  // 3. 文本匹配：fields["父记录"] = "已结束"（纯文本，仅用于 parentName 名称查找）
  const parentFieldValue = pick(f,
    "父记录", "父级项目", "主项目", "上级项目", "归属主项目", "所属项目", "父项目",
  );
  const parentName = cleanStr(parentFieldValue) || null;
  // 关联字段模式：从字段值中提取被引用记录的 record_id 用作精确父 ID
  const feishuParentIdFromField = extractLinkRecordId(parentFieldValue);
  // 合并：原生 parent_record_id 优先，其次关联字段里的 record_id
  const resolvedFeishuParentId = parentRecordId || feishuParentIdFromField || null;

  // 子项目名称为空时用兜底（任何父引用存在即视为子项目）
  const isChild = !!(parentRecordId || feishuParentIdFromField);
  const fallbackName = name || (isChild ? `（子项-${recordId?.slice(-6) ?? "未知"}）` : "（未命名）");
  if (!name && !isChild) return { name: "（未命名）" };

  const category = cleanStr(pick(f,
    "项目类别", "类别", "申报类别", "项目类型", "类型", "project_category",
  )) || null;

  const level = cleanStr(pick(f,
    "项目级别", "级别", "项目等级", "申报级别", "项目层级", "等级",
  )) || null;

  const companyEntityRaw = cleanStr(pick(f,
    "收款公司主体", "公司主体", "收款主体", "主体", "法人主体", "收款单位", "公司",
  ));
  // 按顿号、逗号、分号拆分为多个公司主体
  const companyEntity = companyEntityRaw
    ? companyEntityRaw.split(/[、,，;；]+/).map(s => s.trim()).filter(Boolean)
    : null;

  const totalAmount = cleanFloat(pick(f,
    "总金额（万元）", "总金额(万元)", "总金额",
    "补贴总额（万元）", "补贴总额(万元)",
    "金额（万元）", "金额(万元)",
    "总额", "立项金额", "补贴金额",
  ));

  const receivedAmount = cleanFloat(pick(f,
    "已到账金额（万元）", "已到账金额(万元)", "已到账金额",
    "已到账（万元）", "已到账(万元)", "已到账",
    "到账金额", "实际到账",
  ));

  const receivedDate = cleanDate(pick(f,
    "到账时间", "到账日期", "收款时间", "收款日期",
  ));

  // ── 生命周期时间节点 ────────────────────────────────────────────
  const applyDate = cleanDate(pick(f,
    "申报时间", "立项时间", "申报日期", "申请时间", "立项日期", "项目申报时间",
  ));
  const startDate = cleanDate(pick(f,
    "开始时间", "项目开始时间", "开始日期", "启动时间", "立项开始时间",
  ));
  const midCheckDate = cleanDate(pick(f,
    "中期验收时间", "中期时间", "中检时间", "中期考核时间", "中期验收日期",
  ));
  const endDate = cleanDate(pick(f,
    "结项时间", "结项日期", "结题时间", "结束时间", "项目结项时间",
  ));

  // ── 考核指标（KPI）────────────────────────────────────────────
  const kpiCandidates: Array<{ name: string; keys: string[] }> = [
    { name: "项目投入指标",     keys: ["①项目投入指标（万元）", "①项目投入指标(万元)", "项目投入指标 (万元)", "项目投入指标（万元）", "项目投入指标(万元)", "项目投入指标", "投入指标（万元）", "投入指标"] },
    { name: "项目新增收入指标", keys: ["②项目新增收入指标（万元）", "②项目新增收入指标(万元)", "项目新增收入指标 (万元)", "项目新增收入指标（万元）", "项目新增收入指标(万元)", "项目新增收入指标", "新增收入指标（万元）", "新增收入指标", "收入指标"] },
    { name: "IP考核指标",       keys: ["③IP考核指标", "IP考核指标【@负责人】", "IP考核指标", "ip考核指标", "IP指标", "知识产权指标"] },
    { name: "技术考核指标",     keys: ["④技术考核指标", "技术考核指标【@负责人】", "技术考核指标", "技术指标"] },
    { name: "其他指标",         keys: ["⑤其他指标", "其他指标【@负责人】", "其他考核指标", "其他指标"] },
    { name: "研发投入指标",     keys: ["研发投入指标（万元）", "研发投入指标(万元)", "研发投入指标", "研发投入"] },
    { name: "专利考核指标",     keys: ["专利考核指标", "专利指标", "发明专利指标"] },
  ];
  const kpis: Array<{ name: string; content: string | null }> = [];
  for (const kpi of kpiCandidates) {
    const raw = pick(f, ...kpi.keys);
    if (raw !== undefined && raw !== null) {
      const content = cleanStr(raw);
      if (content) kpis.push({ name: kpi.name, content });
    }
  }

  const affiliation = cleanStr(pick(f,
    "归属", "归属类型", "归属单位", "所属公司", "归属公司", "所属单位", "归属公司/个人",
  )) || null;

  // 项目进度（单选标签，飞书返回 { text, id } 对象或数组，cleanStr 已能正确提取纯文本）
  const progress = cleanStr(pick(f, "项目进度", "进度", "项目状态")) || null;

  const ownerName = cleanStr(pick(f,
    "项目负责人", "负责人", "项目经理", "责任人",
  )) || null;

  const remark = cleanStr(pick(f,
    "备注", "备注说明", "remark",
  )) || null;

  const projectCode = cleanStr(pick(f,
    "立项编号", "项目编号", "编号", "项目代码", "项目号", "立项号", "项目代号",
  )) || null;

  const weekFocusRaw = cleanStr(pick(f, "周重点", "本周重点"));
  const isWeekFocus = weekFocusRaw === "是" || weekFocusRaw === "true" || weekFocusRaw === "1";

  const proofMaterialFiles = extractAttachments(pick(f,
    "证明材料", "附件", "材料附件", "证明文件",
  ));

  return {
    name: fallbackName,
    parentName,
    feishuRecordId: recordId           || null,
    feishuParentId: resolvedFeishuParentId,
    categoryDict: category, levelDict: level,
    companyEntityDict: companyEntity,
    totalAmount, receivedAmount, receivedDate,
    applyDate, startDate, midCheckDate, endDate,
    ...(kpis.length > 0 ? { kpis } : {}),
    affiliation, progress, ownerName, remark,
    projectCode, isWeekFocus,
    ...(proofMaterialFiles.length > 0 ? { proofMaterialFiles } : {}),
  };
}

/** Wiki token → 真实 bitable app_token（带 token 过期自动重试）*/
async function resolveWikiToken(wikiToken: string): Promise<string> {
  const json = await feishuRequest(
    `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${wikiToken}`,
    {},
    "app",
  ) as { code: number; msg: string; data?: { node?: { obj_token?: string; obj_type?: string } } };
  if (json.code !== 0) throw new Error(`飞书 Wiki API 错误 (${json.code}): ${json.msg}`);
  const node = json.data?.node;
  if (!node?.obj_token) throw new Error("Wiki 节点未返回 obj_token，请确认节点类型为多维表格");
  if (node.obj_type && node.obj_type !== "bitable")
    throw new Error(`Wiki 节点类型为 "${node.obj_type}"，非多维表格`);
  return node.obj_token;
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
  if (isWiki) {
    try { appToken = await resolveWikiToken(appToken); }
    catch (e: unknown) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  }

  // 分页拉取所有记录（feishuRequest 自动处理 token 过期重试）
  // 保留完整 record 对象，以获取 record_id 和 parent_record_id
  // 类型需同时覆盖 parent_record_id（飞书子记录标准字段）和 parent_id（部分表格版本字段）
  let allItems: { record_id?: string; parent_record_id?: string; parent_id?: string; fields: Record<string, unknown> }[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${cleanTableId}/records`
    );
    url.searchParams.set("page_size", "500");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const json = await feishuRequest(url.toString(), {}, "app") as {
      code: number; msg: string;
      data?: {
        items?: { record_id?: string; parent_record_id?: string; parent_id?: string; fields: Record<string, unknown> }[];
        page_token?: string;
        has_more?: boolean;
      };
    };
    if (json.code !== 0)
      return NextResponse.json({ error: `飞书 API 错误 (${json.code}): ${json.msg}` }, { status: 502 });

    allItems = allItems.concat(json.data?.items ?? []);
    pageToken = json.data?.has_more ? json.data.page_token : undefined;
  } while (pageToken);

  if (allItems.length === 0)
    return NextResponse.json({ records: [], total: 0 });

  // ── 诊断日志：输出前 3 条原始飞书记录，方便在 Vercel 日志中确认字段结构 ──
  // 重点关注：record_id、parent_record_id、parent_id 是否存在；
  // 字段中是否有"父记录"/"父级项目"等关联字段，以及其值的格式
  console.log(
    "[parse-bitable] 原始飞书记录样本（前3条，用于诊断父子层级字段）:",
    JSON.stringify(
      allItems.slice(0, 3).map(item => ({
        record_id:        item.record_id,
        parent_record_id: item.parent_record_id,
        parent_id:        (item as Record<string, unknown>).parent_id,
        // 只输出可能与父子层级相关的字段，避免日志过长
        fields_keys:      Object.keys(item.fields),
        parent_field_raw: item.fields["父记录"] ?? item.fields["父级项目"] ?? item.fields["主项目"] ?? item.fields["上级项目"] ?? null,
      })),
      null, 2
    )
  );

  // 解析并过滤无效条目（传入完整 record 信息）
  // 飞书原生子记录的父 ID 字段可能是 parent_record_id 或 parent_id，两者都要检测
  const records = allItems
    .map(item => mapRecord(item.fields, item.record_id, item.parent_record_id || item.parent_id))
    .filter(r => r.name && r.name !== "（未命名）");

  // 统计父子关系（同时考虑 feishuParentId 的原生子记录和 parentName 的字段关联子记录）
  const parentCount = records.filter(r => !r.parentName && !r.feishuParentId).length;
  const childCount = records.filter(r => !!r.parentName || !!r.feishuParentId).length;

  return NextResponse.json({
    records,
    total: records.length,
    parentCount,
    childCount,
  });
}
