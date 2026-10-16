"use client";

/**
 * /dashboard/agreement-tracking/dashboard
 * 落地协议沉浸式 BI 数据大屏 — 3-6-3 经典 BI 布局
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartTooltip, ResponsiveContainer, ReferenceLine,
  BarChart as RechartsBarChart, Cell,
} from "recharts";
import { fmtTargetValue, KPI_TARGET_MASKED, type KpiActual } from "@/lib/agreement-config";

// ── 类型 ──────────────────────────────────────────────────────────

interface DashboardData {
  year:           number;
  overallScore:   number;
  daysToDeadline: number;
  kpis:           KpiActual[];
  qualCompliant:  number;
  qualTotal:      number;
  qualRate:       number;
  allYearTargets: Record<string, Record<number, number>>;
  monthly:        MonthlyPoint[];
}

interface MonthlyPoint {
  period:            string;
  revenue:           number;
  localContribution: number;
}

// ── 辅助函数 ──────────────────────────────────────────────────────

function kpiColor(status: KpiActual["status"]): string {
  if (status === "compliant") return "#10b981";
  if (status === "warning")   return "#f59e0b";
  if (status === "risk")      return "#ef4444";
  return "#94a3b8";
}

/**
 * 根据选中的 KPI，从月度数据中提取该 KPI 的月度值
 */
function buildTrendData(
  kpiKey:  string,
  monthly: MonthlyPoint[],
  year:    number,
): { month: string; increment: number; cumulative: number }[] {
  const months = Array.from({ length: 12 }, (_, i) =>
    `${year}-${String(i + 1).padStart(2, "0")}`,
  );

  const getVal = (period: string): number => {
    switch (kpiKey) {
      case "REVENUE":
        return monthly.find(m => m.period === period)?.revenue ?? 0;
      case "LOCAL_CONTRIBUTION":
        return monthly.find(m => m.period === period)?.localContribution ?? 0;
      default:
        return 0;
    }
  };

  let cum = 0;
  const result = months.map((p, i) => {
    const v = getVal(p);
    cum += v;
    return { month: `${i + 1}月`, increment: v, cumulative: cum };
  });

  // 只返回有数据的月份（去除尾部全零）
  const lastNonZero = result.map((d, i) => (d.increment > 0 ? i : -1)).filter(i => i >= 0).pop() ?? -1;
  return lastNonZero >= 0 ? result.slice(0, lastNonZero + 1) : [];
}

// ── 子组件 ────────────────────────────────────────────────────────

function LargeRing({ score }: { score: number }) {
  const r = 54;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color = score >= 90 ? "#10b981" : score >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={136} height={136} viewBox="0 0 136 136">
      <circle cx={68} cy={68} r={r} fill="none" stroke="#e2e8f0" strokeWidth={11} />
      <circle
        cx={68} cy={68} r={r} fill="none"
        stroke={color} strokeWidth={11}
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 68 68)"
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x={68} y={63} textAnchor="middle" fontSize={30} fontWeight="bold" fill={color}>{score}</text>
      <text x={68} y={82} textAnchor="middle" fontSize={11} fill="#94a3b8">综合履约评分</text>
    </svg>
  );
}

function MiniRing({
  pct, color, label, active, onClick,
}: {
  pct:    number | null;
  color:  string;
  label:  string;
  active: boolean;
  onClick: () => void;
}) {
  const r = 21;
  const circ = 2 * Math.PI * r;
  const filled = pct !== null ? (Math.min(pct * 100, 100) / 100) * circ : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-2 py-2 rounded-xl transition-all ${
        active
          ? "bg-blue-50 ring-2 ring-blue-200 shadow-sm"
          : "hover:bg-slate-50"
      }`}
    >
      <svg width={52} height={52} viewBox="0 0 52 52">
        <circle cx={26} cy={26} r={r} fill="none" stroke="#e2e8f0" strokeWidth={5} />
        {pct !== null && (
          <circle
            cx={26} cy={26} r={r} fill="none"
            stroke={color} strokeWidth={5}
            strokeDasharray={`${filled} ${circ}`}
            strokeLinecap="round"
            transform="rotate(-90 26 26)"
            style={{ transition: "stroke-dasharray 0.8s ease" }}
          />
        )}
        <text x={26} y={30} textAnchor="middle" fontSize={9.5} fontWeight="bold" fill={color}>
          {pct !== null ? `${Math.round(pct * 100)}%` : "—"}
        </text>
      </svg>
      <span
        className="text-[10px] font-medium text-slate-600 text-center leading-tight"
        style={{ maxWidth: 54 }}
      >
        {label}
      </span>
    </button>
  );
}

function RealtimeClock() {
  const [time, setTime] = useState(
    () => new Date().toLocaleTimeString("zh-CN", { hour12: false }),
  );
  useEffect(() => {
    const id = setInterval(
      () => setTime(new Date().toLocaleTimeString("zh-CN", { hour12: false })),
      1000,
    );
    return () => clearInterval(id);
  }, []);
  return <span className="text-sm font-mono text-slate-400">{time}</span>;
}

function YearEndPrediction({ kpi, year }: { kpi: KpiActual; year: number }) {
  if (kpi.actual === null) {
    return (
      <p className="text-xs text-slate-400 text-center py-3">暂无数据，录入后自动预测</p>
    );
  }

  const curYear = new Date().getFullYear();
  const effectiveMonth = year === curYear ? new Date().getMonth() + 1 : 12;
  const prediction = effectiveMonth > 0 ? (kpi.actual / effectiveMonth) * 12 : kpi.actual;
  const isOptimistic = prediction >= kpi.target;
  const diff = Math.abs(prediction - kpi.target);

  return (
    <div
      className={`rounded-xl p-3 ${
        isOptimistic
          ? "bg-emerald-50 border border-emerald-100"
          : "bg-red-50 border border-red-100"
      }`}
    >
      <p
        className="text-xs font-bold mb-1.5"
        style={{ color: isOptimistic ? "#059669" : "#dc2626" }}
      >
        {isOptimistic ? "🟢 乐观估算：达标无忧" : "🔴 悲观估算：可能无法拿满补贴"}
      </p>
      <p className="text-xs text-slate-600 mb-1">
        年底预测值：
        <strong className="text-slate-800">
          {prediction.toFixed(2)} {kpi.unit}
        </strong>
      </p>
      <p className="text-xs text-slate-500">
        {isOptimistic
          ? `预计超出目标 ${KPI_TARGET_MASKED ? "XX" : diff.toFixed(2)} ${kpi.unit}`
          : `差额 ${KPI_TARGET_MASKED ? "XX" : diff.toFixed(2)} ${kpi.unit}，建议加速推进`}
      </p>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────

const YEARS_LIST = [2026, 2027, 2028, 2029, 2030];

const MILESTONES = [
  { year: 2026, label: "起步发展期" },
  { year: 2027, label: "规模扩张期" },
  { year: 2028, label: "高速发展期" },
  { year: 2029, label: "上市冲刺期" },
  { year: 2030, label: "目标达产期" },
];

export default function BiDashboard() {
  const [year, setYear]         = useState(() => new Date().getFullYear());
  const [data, setData]         = useState<DashboardData | null>(null);
  const [activeKpi, setActiveKpi] = useState("REVENUE");
  const [loading, setLoading]   = useState(true);

  const loadAll = useCallback(async (y: number) => {
    setLoading(true);
    try {
      const dashRes = await fetch(`/api/agreement/dashboard?year=${y}`);
      if (dashRes.ok) setData(await dashRes.json() as DashboardData);
    } catch { /* 静默失败 */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadAll(year); }, [year, loadAll]);

  const activeKpiData = data?.kpis.find(k => k.key === activeKpi) ?? null;

  const trendData = data
    ? buildTrendData(activeKpi, data.monthly, year)
    : [];

  const fiveYearData = YEARS_LIST.map((y, i) => ({
    year: String(y),
    // 脱敏模式下用线性占位高度（仅保持柱状图观感，不泄露真实目标值），tooltip 显示 XX
    target: KPI_TARGET_MASKED ? (i + 2) * 10 : (data?.allYearTargets[activeKpi]?.[y] ?? 0),
  }));

  const compliant = data?.kpis.filter(k => k.status === "compliant").length ?? 0;
  const warning   = data?.kpis.filter(k => k.status === "warning").length   ?? 0;
  const risk      = data?.kpis.filter(k => k.status === "risk").length       ?? 0;
  const noData    = data?.kpis.filter(k => k.status === "no_data").length    ?? 0;

  // ── JSX ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col bg-slate-50/50 min-h-screen">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-slate-200 shrink-0 gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/agreement-tracking"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft size={14} /> 返回
          </Link>
          <div>
            <h1 className="text-sm font-bold text-slate-800">落地协议 BI 数据大屏</h1>
            <p className="text-xs text-slate-400">瑞启深空（苏州）科技 · 实时监控 · {year}年度</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex gap-1">
            {YEARS_LIST.map(y => (
              <button
                key={y}
                type="button"
                onClick={() => setYear(y)}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                  year === y ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                {y}
              </button>
            ))}
          </div>
          <RealtimeClock />
          <button
            type="button"
            onClick={() => void loadAll(year)}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
            title="刷新数据"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── 3-6-3 Grid ── */}
      <div className="grid grid-cols-12 gap-4 p-4 flex-1 overflow-auto">

        {/* ═══ 左栏 col-span-3 ═══════════════════════════════════ */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-4">

          {/* 综合健康度 */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4 text-center">
              综合履约健康度
            </h3>
            <div className="flex justify-center mb-4">
              <LargeRing score={data?.overallScore ?? 0} />
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5 p-2 rounded-lg bg-emerald-50 border border-emerald-100">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-emerald-700 font-medium">全额拨付 {compliant}</span>
              </div>
              <div className="flex items-center gap-1.5 p-2 rounded-lg bg-amber-50 border border-amber-100">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <span className="text-amber-700 font-medium">按比例拨付 {warning}</span>
              </div>
              <div className="flex items-center gap-1.5 p-2 rounded-lg bg-red-50 border border-red-100">
                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                <span className="text-red-700 font-medium">取消支持 {risk}</span>
              </div>
              <div className="flex items-center gap-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="w-2 h-2 rounded-full bg-slate-400 shrink-0" />
                <span className="text-slate-500 font-medium">待录入 {noData}</span>
              </div>
            </div>
          </div>

          {/* 倒计时 + 里程碑 */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex-1">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">考核倒计时</h3>
            <div className="text-center mb-5">
              <div className="text-4xl font-bold text-blue-600 leading-none">
                {data?.daysToDeadline ?? "—"}
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                距 {year} 年末考核截止剩余天数
              </p>
            </div>

            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">协议里程碑</h3>
            <div className="relative pl-5">
              <div className="absolute left-2 top-2 bottom-2 w-px bg-slate-100" />
              {MILESTONES.map(m => {
                const isPast    = m.year < year;
                const isCurrent = m.year === year;
                return (
                  <div key={m.year} className="relative mb-3 last:mb-0 flex items-center gap-2">
                    <div
                      className={`absolute -left-3.5 w-3 h-3 rounded-full border-2 border-white ring-1 shrink-0 ${
                        isCurrent ? "bg-blue-500 ring-blue-300" :
                        isPast    ? "bg-emerald-400 ring-emerald-200" :
                                    "bg-slate-200 ring-slate-100"
                      }`}
                    />
                    <span
                      className={`text-xs ${
                        isCurrent ? "font-bold text-blue-700" :
                        isPast    ? "text-slate-400 line-through" :
                                    "text-slate-500"
                      }`}
                    >
                      <span className="font-mono">{m.year}</span> · {m.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ═══ 中栏 col-span-6 ═══════════════════════════════════ */}
        <div className="col-span-12 lg:col-span-6 flex flex-col gap-4">

          {/* 2 个 KPI 微型圆环联动控制台 */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-4">
              KPI 完成率一览 · 点击切换趋势图
            </h3>
            <div className="flex items-start justify-around flex-wrap gap-2">
              {(data?.kpis ?? []).map(kpi => (
                <MiniRing
                  key={kpi.key}
                  pct={kpi.pct}
                  color={kpiColor(kpi.status)}
                  label={kpi.label}
                  active={activeKpi === kpi.key}
                  onClick={() => setActiveKpi(kpi.key)}
                />
              ))}
            </div>
          </div>

          {/* 动态趋势图 */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 flex-1">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-sm font-bold text-slate-700">
                {activeKpiData?.label ?? "—"} · 月度趋势与预测
              </h3>
              {activeKpiData && (
                <span className="text-xs text-slate-400 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-100">
                  {year}年目标：
                  <strong className="text-slate-700">
                    {fmtTargetValue(activeKpiData.target)} {activeKpiData.unit}
                  </strong>
                </span>
              )}
            </div>

            {trendData.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-sm gap-2">
                <span className="text-2xl">📊</span>
                暂无月度数据，请先前往数据中台录入
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={trendData} margin={{ top: 5, right: 25, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#94a3b8" }} />
                  <YAxis
                    yAxisId="bar"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                  />
                  <YAxis
                    yAxisId="line"
                    orientation="right"
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                  />
                  <RechartTooltip
                    contentStyle={{
                      borderRadius: 12, border: "none",
                      boxShadow: "0 4px 20px rgba(0,0,0,0.1)", fontSize: 12,
                    }}
                    formatter={(v: unknown, name: unknown) => [
                      `${typeof v === "number" ? v.toFixed(2) : v} ${activeKpiData?.unit ?? ""}`,
                      String(name ?? ""),
                    ]}
                  />
                  <Bar
                    yAxisId="bar"
                    dataKey="increment"
                    name="月增量"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    opacity={0.85}
                  />
                  <Line
                    yAxisId="line"
                    type="monotone"
                    dataKey="cumulative"
                    name="年度累计"
                    stroke="#8b5cf6"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: "#8b5cf6" }}
                  />
                  {/* 目标参考线：脱敏模式下隐藏（线高与标注都会泄露真实目标值） */}
                  {activeKpiData && !KPI_TARGET_MASKED && (
                    <ReferenceLine
                      yAxisId="line"
                      y={activeKpiData.target}
                      stroke="#ef4444"
                      strokeDasharray="5 5"
                      strokeWidth={1.5}
                      label={{
                        value: `目标 ${activeKpiData.target}`,
                        position: "insideTopRight",
                        fontSize: 10,
                        fill: "#ef4444",
                      }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* ═══ 右栏 col-span-3 ═══════════════════════════════════ */}
        <div className="col-span-12 lg:col-span-3 flex flex-col gap-4">

          {/* KPI 完成进度详情 */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">KPI 进度详情</h3>
            <div className="flex flex-col gap-2">
              {(data?.kpis ?? []).map(kpi => {
                const pct   = kpi.pct !== null ? Math.min(kpi.pct * 100, 100) : 0;
                const color = kpiColor(kpi.status);
                const isActive = activeKpi === kpi.key;
                return (
                  <div
                    key={kpi.key}
                    onClick={() => setActiveKpi(kpi.key)}
                    className={`cursor-pointer rounded-xl px-3 py-2 transition-all ${
                      isActive ? "bg-blue-50 ring-1 ring-blue-100" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-medium text-slate-700 truncate mr-2">
                        {kpi.label}
                      </span>
                      <span
                        className="text-xs font-bold whitespace-nowrap shrink-0"
                        style={{ color }}
                      >
                        {kpi.actual !== null
                          ? kpi.actual % 1 === 0
                            ? String(kpi.actual)
                            : kpi.actual.toFixed(2)
                          : "—"}
                        <span className="font-normal text-slate-400"> / {fmtTargetValue(kpi.target)} {kpi.unit}</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{ width: `${pct}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 五年对赌沙盘 */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              {activeKpiData?.label ?? "—"} · 五年目标阶梯
            </h3>
            <ResponsiveContainer width="100%" height={120}>
              <RechartsBarChart
                data={fiveYearData}
                margin={{ top: 0, right: 5, left: -25, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="year" tick={{ fontSize: 10, fill: "#94a3b8" }} />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} />
                <RechartTooltip
                  contentStyle={{
                    borderRadius: 8, border: "none",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.1)", fontSize: 11,
                  }}
                  formatter={(v: unknown) => [
                    `${fmtTargetValue(typeof v === "number" ? v : String(v))} ${activeKpiData?.unit ?? ""}`, "年度目标",
                  ]}
                />
                <Bar dataKey="target" name="年度目标" radius={[3, 3, 0, 0]}>
                  {fiveYearData.map((entry) => (
                    <Cell
                      key={entry.year}
                      fill={entry.year === String(year) ? "#3b82f6" : "#cbd5e1"}
                    />
                  ))}
                </Bar>
              </RechartsBarChart>
            </ResponsiveContainer>
          </div>

          {/* 年底达成预测 */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">
              年底达成预测 · {activeKpiData?.label ?? "—"}
            </h3>
            {activeKpiData ? (
              <YearEndPrediction kpi={activeKpiData} year={year} />
            ) : (
              <p className="text-xs text-slate-400 text-center py-4">
                点击 KPI 圆环选择指标
              </p>
            )}

            {/* 质性义务小结 */}
            {data && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                  质性义务履约
                </h3>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">达标率</span>
                  <span className="font-bold text-slate-700">{data.qualRate}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-1.5">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-700"
                    style={{ width: `${data.qualRate}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {data.qualCompliant} / {data.qualTotal} 项已达标
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
