/**
 * 落地协议核心配置：KPI 目标值、权重与计算逻辑
 * 数据来源：苏州高新区与 瑞启深空 落地协议（2026-2030）
 */

/**
 * 演示脱敏开关：true 时界面上所有 KPI 目标值显示为 "XX"。
 * 内部计算（完成率 / 差距 / 状态）仍使用真实 targets，仅展示层打码。
 */
export const KPI_TARGET_MASKED = false;

/** 展示层专用：脱敏开关打开时返回 "XX"，否则返回原值字符串 */
export function fmtTargetValue(v: string | number): string {
  return KPI_TARGET_MASKED ? "XX" : String(v);
}

export const KPI_KEYS = [
  "REVENUE",
  "LOCAL_CONTRIBUTION",
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
    key: "REVENUE", label: "营业收入", unit: "万元", weight: 0.60,
    targets: { 2026: 2000, 2027: 8000, 2028: 40000, 2029: 100000, 2030: 200000 },
  },
  LOCAL_CONTRIBUTION: {
    key: "LOCAL_CONTRIBUTION", label: "地方贡献", unit: "万元", weight: 0.40,
    targets: { 2026: 30, 2027: 100, 2028: 600, 2029: 3000, 2030: 10000 },
  },
};

export interface MonthlyPayload {
  // finance
  revenue?:       number; // 万元（统一口径）
  // 地方贡献来源：优先读取 assets 页保存的 万元 字段；次读取 agreement 弹窗保存的 元 字段
  vat?:           number; // 增值税实缴（万元）
  corp_tax?:      number; // 企业所得税实缴（万元）
  vatPaidSuzhou?: number; // 增值税实缴（元）
  citPaidSuzhou?: number; // 企业所得税实缴（元）
  pitSuzhou?:     number; // 个人所得税代扣（元）
  revenueSuzhou?: number;
  vatPayable?:    number;
  citPayable?:    number;
  rdExpense?:     number;
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
): KpiActual[] {
  const prefix = String(year);
  const fy = financeRows.filter(r => r.period.startsWith(prefix));

  // 营业收入 YTD = SUM of monthly revenue（万元）
  const revenue = fy.length === 0 ? null
    : fy.reduce((s, r) => s + (parsePay(r).revenue ?? 0), 0);

  // 地方贡献 YTD（万元）：优先使用 assets 页保存的 万元 字段，否则使用 agreement 弹窗保存的 元 字段
  const localContribution = fy.length === 0 ? null
    : fy.reduce((s, r) => {
        const p = parsePay(r);
        const inYuan = (p.vatPaidSuzhou ?? 0) + (p.citPaidSuzhou ?? 0);
        const inWan = (p.vat ?? 0) + (p.corp_tax ?? 0);
        // 万元字段有值时优先采用；否则将 元 字段除以 10000 转为万元
        return s + (inWan > 0 || (p.vat != null || p.corp_tax != null) ? inWan : inYuan / 10000);
      }, 0);

  const actuals: Record<KpiKey, number | null> = {
    REVENUE:           revenue,
    LOCAL_CONTRIBUTION: localContribution,
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
