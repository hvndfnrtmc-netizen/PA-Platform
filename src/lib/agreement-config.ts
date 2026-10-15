/**
 * 落地协议核心配置：KPI 目标值、权重与计算逻辑
 * 数据来源：苏州高新区与 瑞启深空 落地协议（2026-2028）
 */

/**
 * 演示脱敏开关：true 时界面上所有 KPI 目标值显示为 "XX"。
 * 内部计算（完成率 / 差距 / 状态）仍使用真实 targets，仅展示层打码。
 */
export const KPI_TARGET_MASKED = true;

/** 展示层专用：脱敏开关打开时返回 "XX"，否则返回原值字符串 */
export function fmtTargetValue(v: string | number): string {
  return KPI_TARGET_MASKED ? "XX" : String(v);
}

export const KPI_KEYS = [
  "REVENUE",
  "TAX_TOTAL",
  "PERSONAL_TAX",
  "SOCIAL_INSURANCE",
  "NATIONAL_TALENT",
  "INVENTION_PATENT",
  "INDUSTRY_CHAIN",
] as const;

export type KpiKey = (typeof KPI_KEYS)[number];

export interface KpiConfig {
  key:     KpiKey;
  label:   string;
  unit:    string;
  weight:  number;
  targets: Record<number, number>;
}

export const KPI_CONFIG: Record<KpiKey, KpiConfig> = {
  REVENUE: {
    key: "REVENUE", label: "营业收入", unit: "亿元", weight: 0.40,
    targets: { 2026: 12, 2027: 18, 2028: 25 },
  },
  TAX_TOTAL: {
    key: "TAX_TOTAL", label: "综合税收", unit: "亿元", weight: 0.20,
    targets: { 2026: 0.7, 2027: 1.0, 2028: 1.5 },
  },
  PERSONAL_TAX: {
    key: "PERSONAL_TAX", label: "个人所得税", unit: "亿元", weight: 0.10,
    targets: { 2026: 0.12, 2027: 0.18, 2028: 0.25 },
  },
  SOCIAL_INSURANCE: {
    key: "SOCIAL_INSURANCE", label: "社保缴纳人数", unit: "人", weight: 0.15,
    targets: { 2026: 380, 2027: 500, 2028: 650 },
  },
  NATIONAL_TALENT: {
    key: "NATIONAL_TALENT", label: "国家级人才计划", unit: "人", weight: 0.05,
    targets: { 2026: 3, 2027: 5, 2028: 8 },
  },
  INVENTION_PATENT: {
    key: "INVENTION_PATENT", label: "发明专利申请", unit: "件", weight: 0.05,
    targets: { 2026: 120, 2027: 180, 2028: 250 },
  },
  INDUSTRY_CHAIN: {
    key: "INDUSTRY_CHAIN", label: "产业链企业", unit: "家", weight: 0.05,
    targets: { 2026: 3, 2027: 5, 2028: 8 },
  },
};

export interface MonthlyPayload {
  // finance
  revenue?:       number;
  vatPaidSuzhou?: number;  // 增值税实缴（元）
  citPaidSuzhou?: number;  // 企业所得税实缴（元）
  pitSuzhou?:     number;  // 个人所得税代扣（元）
  revenueSuzhou?: number;
  vatPayable?:    number;
  citPayable?:    number;
  rdExpense?:     number;
  // hr
  socialInsuranceCount?: number;
  nationalTalentCount?:  number;
  industryChainCount?:   number;
  coreStaffCount?:       number;
  // ip
  inventionPatentApplied?: number;
  inventionPatentGranted?: number;
  utilityPatent?:          number;
  softwareCopyright?:      number;
}

export interface KpiActual {
  key:    KpiKey;
  label:  string;
  unit:   string;
  weight: number;
  actual: number | null;
  target: number;
  pct:    number | null;  // 0-1
  gap90:  number | null;  // 距 90% 全额达标线差距
  status: "compliant" | "warning" | "risk" | "no_data";
}

function parsePay(row: { payload: unknown }): MonthlyPayload {
  if (typeof row.payload === "object" && row.payload !== null)
    return row.payload as MonthlyPayload;
  try { return JSON.parse(String(row.payload)) as MonthlyPayload; }
  catch { return {}; }
}

/**
 * 从月度数据计算某年各 KPI 实际完成值
 */
export function computeKpiActuals(
  year: number,
  financeRows: { period: string; payload: unknown }[],
  hrRows:      { period: string; payload: unknown }[],
  ipRows:      { period: string; payload: unknown }[],
): KpiActual[] {
  const prefix = String(year);
  const fy = financeRows.filter(r => r.period.startsWith(prefix));
  const hy = hrRows.filter(r => r.period.startsWith(prefix));
  const iy = ipRows.filter(r => r.period.startsWith(prefix));

  // Revenue YTD = SUM of monthly revenue
  const revenue = fy.length === 0 ? null
    : fy.reduce((s, r) => s + (parsePay(r).revenue ?? 0), 0);

  // Composite Tax = SUM(vat + cit) / 10000 → 亿元
  const taxTotal = fy.length === 0 ? null
    : fy.reduce((s, r) => {
        const p = parsePay(r);
        return s + ((p.vatPaidSuzhou ?? 0) + (p.citPaidSuzhou ?? 0));
      }, 0) / 10000;

  // Personal Tax = SUM(pit) / 10000 → 亿元
  const personalTax = fy.length === 0 ? null
    : fy.reduce((s, r) => s + (parsePay(r).pitSuzhou ?? 0), 0) / 10000;

  // Point-in-time: use latest month
  const latestHr = hy.sort((a, b) => b.period.localeCompare(a.period))[0];
  const socialInsurance = latestHr ? (parsePay(latestHr).socialInsuranceCount ?? null) : null;
  const nationalTalent  = latestHr ? (parsePay(latestHr).nationalTalentCount  ?? null) : null;
  const industryChain   = latestHr ? (parsePay(latestHr).industryChainCount   ?? null) : null;

  const latestIp = iy.sort((a, b) => b.period.localeCompare(a.period))[0];
  const inventionPatent = latestIp ? (parsePay(latestIp).inventionPatentApplied ?? null) : null;

  const actuals: Record<KpiKey, number | null> = {
    REVENUE:          revenue,
    TAX_TOTAL:        taxTotal,
    PERSONAL_TAX:     personalTax,
    SOCIAL_INSURANCE: socialInsurance,
    NATIONAL_TALENT:  nationalTalent,
    INVENTION_PATENT: inventionPatent,
    INDUSTRY_CHAIN:   industryChain,
  };

  return KPI_KEYS.map(key => {
    const cfg    = KPI_CONFIG[key];
    const target = cfg.targets[year] ?? 0;
    const actual = actuals[key];
    const pct    = actual !== null && target > 0 ? actual / target : null;
    const gap90  = pct !== null ? Math.max(0, target * 0.9 - (actual ?? 0)) : null;
    const status: KpiActual["status"] =
      pct === null ? "no_data" :
      pct >= 0.9   ? "compliant" :
      pct >= 0.7   ? "warning"   : "risk";
    return { key, label: cfg.label, unit: cfg.unit, weight: cfg.weight, actual, target, pct, gap90, status };
  });
}

/**
 * 综合评分 = SUM(min(pct, 1) * weight) * 100，四舍五入到整数
 */
export function computeCompositeScore(actuals: KpiActual[]): number {
  let score = 0;
  for (const a of actuals) {
    if (a.pct !== null) score += Math.min(a.pct, 1) * a.weight;
  }
  return Math.round(score * 100);
}
