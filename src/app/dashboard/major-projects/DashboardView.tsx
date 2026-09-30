/**
 * 数据大屏视图 - 重大项目可视化仪表盘
 *
 * 复用政府接待模块的设计语言：
 * - KPI 卡片样式 (rounded-2xl p-5 shadow-sm)
 * - Recharts 图表（Donut + 横向 Bar）
 * - pieTip / barTip 自定义悬浮提示
 * - donutLegend 可点击图例
 * - 图表点击穿透筛选（onClick → onFilterChange）
 */

"use client";

import React, { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartTooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  CheckCircle,
  Activity,
  Loader2,
  BarChart2,
} from "lucide-react";

// ── 类型定义 ──────────────────────────────────────────────────────

interface StatData {
  total: number;
  mainProjectCount?: number;
  subProjectCount?: number;
  totalAmount: number;
  totalReceivedAmount: number;
  receivedAmountInRange: number;
  byCategory: { name: string; dictId: string | null; value: number }[];
  byCompanyEntity: { name: string; value: number }[];
  byLevel: { name: string; dictId: string | null; value: number }[];
  byAffiliation: { name: string; value: number }[];
  amountByLevel: { name: string; value: number }[];
}

type TimeRange = "all" | "week" | "month" | "year" | "custom";

export interface DashboardFilterChange {
  levelDictIds?: string[];
  categoryDictIds?: string[];
  companyEntityName?: string;
  view?: "table" | "card" | "kanban";
  page?: number;
}

interface DashboardViewProps {
  onFilterChange: (partial: DashboardFilterChange) => void;
}

// ── 样式常量（与 reception 模块保持一致） ─────────────────────────

// 级别强制排序字典
const LEVEL_ORDER = ["国家级", "省级", "市级", "区级", "板块"];

const LEVEL_COLOR: Record<string, string> = {
  国家级: "#ef4444",
  省级: "#3b82f6",
  市级: "#8b5cf6",
  区级: "#06b6d4",
  板块: "#f59e0b",
};

const CATEGORY_COLOR: Record<string, string> = {
  落地协议: "#ef4444",
  政府项目: "#3b82f6",
};

const AFFILIATION_COLOR: Record<string, string> = {
  公司: "#3b82f6",
  个人: "#22c55e",
};

const CHART_COLORS = [
  "#3b82f6", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#94a3b8",
];

function pickColor(map: Record<string, string>, name: string, idx: number): string {
  return map[name] ?? CHART_COLORS[idx % CHART_COLORS.length];
}

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  all: "全部", week: "本周", month: "本月", year: "本年", custom: "自定义",
};

// ── 主组件 ────────────────────────────────────────────────────────

export function DashboardView({ onFilterChange }: DashboardViewProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StatData | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  async function loadStats() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ timeRange });
      if (timeRange === "custom") {
        if (startDate) params.set("startDate", startDate);
        if (endDate) params.set("endDate", endDate);
      }
      const res = await fetch(`/api/major-projects/statistics?${params}`);
      if (!res.ok) throw new Error("统计数据加载失败");
      setData(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange, startDate, endDate]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24" style={{ color: "#94a3b8" }}>
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  if (!data) return null;

  const fundingPct = data.totalAmount > 0
    ? Math.min(100, Math.round((data.totalReceivedAmount / data.totalAmount) * 100))
    : 0;
  const rangePct = data.totalAmount > 0
    ? Math.min(100, Math.round((data.receivedAmountInRange / data.totalAmount) * 100))
    : 0;

  // 项目总数堆叠条
  const mainCount = data.mainProjectCount ?? 0;
  const subCount  = data.subProjectCount  ?? 0;
  const mainRatio = data.total > 0 ? Math.round((mainCount / data.total) * 100) : 0;
  const subRatio  = 100 - mainRatio;

  // 级别数据强制按 LEVEL_ORDER 排序
  const sortedByLevel = [...data.byLevel].sort((a, b) => {
    const ai = LEVEL_ORDER.indexOf(a.name);
    const bi = LEVEL_ORDER.indexOf(b.name);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // ── 复用 reception 的 Tooltip 风格 ─────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pieTip = (({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const { name, value } = payload[0] as { name: string; value: number };
    const tot = data.total > 0 ? data.total : 1;
    return (
      <div className="bg-white rounded-xl shadow-lg px-3 py-2 text-xs" style={{ border: "1px solid #e2e8f0" }}>
        <span className="font-semibold text-slate-700">{name}</span>
        <span className="text-slate-500 ml-2">{value} 个</span>
        <span className="text-slate-400 ml-1">({((value / tot) * 100).toFixed(0)}%)</span>
      </div>
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const barTip = (({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white rounded-xl shadow-lg px-3 py-2.5 text-xs" style={{ border: "1px solid #e2e8f0", minWidth: 130 }}>
        <p className="font-semibold text-slate-700 mb-1 truncate max-w-[180px]">{String(label)}</p>
        {(payload as Array<{ name: string; value: number; fill: string }>).map((e, i) => (
          <p key={i} className="flex justify-between gap-4">
            <span style={{ color: e.fill }}>{e.name}</span>
            <span className="font-semibold text-slate-700">{e.value}</span>
          </p>
        ))}
      </div>
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  // ── 复用 reception 的 donutLegend 风格 ─────────────────────────

  function donutLegend(
    chartData: { name: string; value: number }[],
    colorFn: (n: string, i: number) => string,
    onClick: (name: string) => void,
  ) {
    return (
      <div className="flex-1 space-y-1.5 overflow-y-auto" style={{ maxHeight: 160 }}>
        {chartData.map((e, i) => (
          <button
            key={e.name}
            onClick={() => onClick(e.name)}
            className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-all hover:bg-slate-50"
          >
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: colorFn(e.name, i) }}
            />
            <span className="text-xs text-slate-600 flex-1">{e.name}</span>
            <span
              className="text-xs font-bold tabular-nums"
              style={{ color: colorFn(e.name, i) }}
            >
              {e.value}
            </span>
          </button>
        ))}
      </div>
    );
  }

  // ── 卡片表头 helper（与 reception 保持一致） ─────────────────────

  function cardHdr(
    iconBg: string,
    iconColor: string,
    icon: React.ReactNode,
    title: string,
    sub?: string,
  ) {
    return (
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-0.5">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center"
            style={{ background: iconBg }}
          >
            <span style={{ color: iconColor }}>{icon}</span>
          </div>
          <span className="text-sm font-bold text-slate-800">{title}</span>
        </div>
        {sub && <p className="text-xs text-slate-400 pl-8">{sub}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5 px-6 py-5" style={{ overflowY: "auto" }}>

      {/* ── 时间范围选择器 ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-slate-500 mr-1">资金到账时间筛选：</span>
        {(["week", "month", "year", "all"] as TimeRange[]).map((r) => (
          <button
            key={r}
            onClick={() => { setTimeRange(r); setStartDate(""); setEndDate(""); }}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={
              timeRange === r
                ? { background: "#2563eb", color: "white", border: "1px solid #2563eb" }
                : { background: "white", color: "#64748b", border: "1px solid #e2e8f0" }
            }
          >
            {TIME_RANGE_LABELS[r]}
          </button>
        ))}
        <button
          onClick={() => setTimeRange("custom")}
          className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
          style={
            timeRange === "custom"
              ? { background: "#2563eb", color: "white", border: "1px solid #2563eb" }
              : { background: "white", color: "#64748b", border: "1px solid #e2e8f0" }
          }
        >
          自定义
        </button>
        {timeRange === "custom" && (
          <>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs focus:outline-none"
              style={{ border: "1px solid #e2e8f0", background: "white" }}
            />
            <span className="text-gray-400 text-xs">至</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="px-3 py-1.5 rounded-lg text-xs focus:outline-none"
              style={{ border: "1px solid #e2e8f0", background: "white" }}
            />
          </>
        )}
      </div>

      {/* ── KPI 卡片区 ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">

        {/* 卡片 1：项目总数（堆叠条形图） */}
        <div
          className="rounded-2xl p-5"
          style={{ background: "#eff6ff", border: "1px solid #3b82f622" }}
        >
          <div className="flex items-start gap-3 mb-3">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "#3b82f615" }}
            >
              <TrendingUp size={22} color="#3b82f6" />
            </div>
            <div>
              <p className="text-xs text-gray-500">项目总数</p>
              <p className="text-2xl font-bold" style={{ color: "#3b82f6" }}>
                {data.total}
                <span className="text-sm font-normal ml-1">个</span>
              </p>
            </div>
          </div>
          {/* 堆叠条形图 */}
          <div className="flex w-full h-3 rounded-full overflow-hidden bg-gray-100">
            <div
              style={{ width: `${mainRatio}%`, background: "#3b82f6", transition: "width 0.5s" }}
              title={`主项目: ${mainCount}`}
            />
            <div
              style={{ width: `${subRatio}%`, background: "#bfdbfe", transition: "width 0.5s" }}
              title={`子项目: ${subCount}`}
            />
          </div>
          <div className="flex justify-between text-xs text-slate-500 mt-1.5">
            <span>主项目 {mainCount} 个 ({mainRatio}%)</span>
            <span>子项目 {subCount} 个</span>
          </div>
        </div>

        {/* 卡片 2+3（合并）：总金额 + 已到账进度条 */}
        <div
          className="md:col-span-2 rounded-2xl p-5"
          style={{ background: "#ecfdf5", border: "1px solid #10b98122" }}
        >
          <div className="flex items-start gap-3 mb-4">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "#10b98115" }}
            >
              <DollarSign size={22} color="#10b981" />
            </div>
            <div className="flex-1 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 mb-0.5">项目总预期金额</p>
                <p className="text-2xl font-bold" style={{ color: "#8b5cf6" }}>
                  {data.totalAmount.toLocaleString()}
                  <span className="text-sm font-normal ml-1">万</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-0.5">历史累计已到账</p>
                <p className="text-2xl font-bold" style={{ color: "#10b981" }}>
                  {data.totalReceivedAmount.toLocaleString()}
                  <span className="text-sm font-normal ml-1">万</span>
                </p>
              </div>
            </div>
          </div>
          {/* 资金进度条 */}
          <div className="relative w-full h-4 bg-slate-100 rounded-full overflow-hidden">
            <div
              style={{
                position: "absolute", left: 0, top: 0, height: "100%",
                width: `${fundingPct}%`, background: "linear-gradient(90deg,#10b981,#34d399)",
                borderRadius: "inherit", transition: "width 0.6s ease",
              }}
            />
            {fundingPct > 10 && (
              <span style={{
                position: "absolute", right: `${100 - fundingPct + 1}%`, top: "50%",
                transform: "translateY(-50%)", fontSize: 10, fontWeight: 700,
                color: "white", whiteSpace: "nowrap",
              }}>
                {fundingPct}%
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">整体资金完成率 {fundingPct}%</p>
        </div>

        {/* 卡片 4：时段到账金额 */}
        <div
          className="rounded-2xl p-5 flex items-start gap-4"
          style={{ background: "#fff7ed", border: "1px solid #f59e0b22" }}
        >
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "#f59e0b15" }}
          >
            <Activity size={22} color="#f59e0b" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 mb-1">
              {timeRange === "all" ? "全部期间" : TIME_RANGE_LABELS[timeRange]}到账
            </p>
            <p className="text-2xl font-bold" style={{ color: "#f59e0b" }}>
              {data.receivedAmountInRange.toLocaleString()}
              <span className="text-sm font-normal ml-1">万</span>
            </p>
            <div className="mt-1.5 w-full bg-gray-100 rounded-full overflow-hidden" style={{ height: 4 }}>
              <div
                style={{ height: "100%", width: `${rangePct}%`, background: "#f59e0b", transition: "width 0.5s" }}
              />
            </div>
            <p className="text-xs text-gray-400 mt-0.5">占总目标 {rangePct}%</p>
          </div>
        </div>
      </div>

      {/* ── 四大维度图表 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {/* 图表 1：项目类别分布（Donut） */}
        <div className="bg-white rounded-2xl p-5" style={{ border: "1px solid #e2e8f0" }}>
          {cardHdr("#3b82f615", "#3b82f6", <BarChart2 size={13} />, "项目类别分布", "点击图例可跳转至表格筛选")}
          {data.byCategory.length > 0 ? (
            <div className="flex items-center gap-3">
              <ResponsiveContainer width="52%" height={160}>
                <PieChart>
                  <Pie
                    data={data.byCategory}
                    cx="50%" cy="50%"
                    innerRadius={38} outerRadius={60}
                    dataKey="value" paddingAngle={3}
                    style={{ cursor: "pointer" }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(d: any) => {
                      if (d.dictId) onFilterChange({ categoryDictIds: [d.dictId], view: "table", page: 1 });
                      else onFilterChange({ view: "table", page: 1 });
                    }}
                  >
                    {data.byCategory.map((e, i) => (
                      <Cell key={i} fill={pickColor(CATEGORY_COLOR, e.name, i)} stroke="none" />
                    ))}
                  </Pie>
                  <RechartTooltip content={pieTip} />
                </PieChart>
              </ResponsiveContainer>
              {donutLegend(
                data.byCategory,
                (n, i) => pickColor(CATEGORY_COLOR, n, i),
                (name) => {
                  const item = data.byCategory.find((e) => e.name === name);
                  if (item?.dictId) onFilterChange({ categoryDictIds: [item.dictId], view: "table", page: 1 });
                  else onFilterChange({ view: "table", page: 1 });
                },
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">暂无数据</p>
          )}
        </div>

        {/* 图表 2：收款公司主体分布（Donut 环形图） */}
        <div className="bg-white rounded-2xl p-5" style={{ border: "1px solid #e2e8f0" }}>
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-0.5">
              <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "#8b5cf615" }}>
                <span style={{ color: "#8b5cf6" }}><BarChart2 size={13} /></span>
              </div>
              <span className="text-sm font-bold text-slate-800">收款公司主体分布</span>
            </div>
            <p className="text-xs text-slate-400 pl-8 font-normal">点击图块→跳转表格筛选</p>
          </div>
          {data.byCompanyEntity.length > 0 ? (() => {
            const chartData = [...data.byCompanyEntity].sort((a, b) => b.value - a.value);
            return (
              <div className="flex items-start gap-3">
                <ResponsiveContainer width="52%" height={160}>
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%" cy="50%"
                      innerRadius={38} outerRadius={60}
                      dataKey="value" paddingAngle={3}
                      style={{ cursor: "pointer" }}
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      onClick={(d: any) => {
                        if (d.name) {
                          onFilterChange({ companyEntityName: d.name, view: "table", page: 1 });
                        } else {
                          onFilterChange({ view: "table", page: 1 });
                        }
                      }}
                    >
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="none" cursor="pointer" />
                      ))}
                    </Pie>
                    <RechartTooltip content={pieTip} />
                  </PieChart>
                </ResponsiveContainer>
                {/* 自定义侧边图例 */}
                <div className="flex-1 space-y-1.5 overflow-y-auto" style={{ maxHeight: 160 }}>
                  {chartData.map((e, i) => (
                    <button
                      key={e.name}
                      onClick={() => {
                        onFilterChange({ companyEntityName: e.name, view: "table", page: 1 });
                      }}
                      className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-all hover:bg-slate-50"
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                      />
                      <span
                        className="text-xs text-slate-600 flex-1 truncate"
                        style={{ maxWidth: 120 }}
                        title={e.name}
                      >{e.name}</span>
                      <span
                        className="text-xs font-bold tabular-nums flex-shrink-0"
                        style={{ color: CHART_COLORS[i % CHART_COLORS.length] }}
                      >{e.value}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })() : (
            <p className="text-sm text-gray-400 py-8 text-center">暂无数据</p>
          )}
        </div>

        {/* 图表 3：项目级别分布（Donut，强制 LEVEL_ORDER 排序） */}
        <div className="bg-white rounded-2xl p-5" style={{ border: "1px solid #e2e8f0" }}>
          {cardHdr("#06b6d415", "#06b6d4", <BarChart2 size={13} />, "项目级别分布", "点击可跳转至表格筛选")}
          {sortedByLevel.length > 0 ? (
            <div className="flex items-center gap-3">
              <ResponsiveContainer width="52%" height={160}>
                <PieChart>
                  <Pie
                    data={sortedByLevel}
                    cx="50%" cy="50%"
                    innerRadius={38} outerRadius={60}
                    dataKey="value" paddingAngle={3}
                    style={{ cursor: "pointer" }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(d: any) => {
                      if (d.dictId) onFilterChange({ levelDictIds: [d.dictId], view: "table", page: 1 });
                      else onFilterChange({ view: "table", page: 1 });
                    }}
                  >
                    {sortedByLevel.map((e, i) => (
                      <Cell key={i} fill={pickColor(LEVEL_COLOR, e.name, i)} stroke="none" />
                    ))}
                  </Pie>
                  <RechartTooltip content={pieTip} />
                </PieChart>
              </ResponsiveContainer>
              {donutLegend(
                sortedByLevel,
                (n, i) => pickColor(LEVEL_COLOR, n, i),
                (name) => {
                  const item = sortedByLevel.find((e) => e.name === name);
                  if (item?.dictId) onFilterChange({ levelDictIds: [item.dictId], view: "table", page: 1 });
                  else onFilterChange({ view: "table", page: 1 });
                },
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">暂无数据</p>
          )}
        </div>

        {/* 图表 4：归属分布（Donut） */}
        <div className="bg-white rounded-2xl p-5" style={{ border: "1px solid #e2e8f0" }}>
          {cardHdr("#22c55e15", "#22c55e", <BarChart2 size={13} />, "归属分布", "公司 vs 个人")}
          {data.byAffiliation.length > 0 ? (
            <div className="flex items-center gap-3">
              <ResponsiveContainer width="52%" height={160}>
                <PieChart>
                  <Pie
                    data={data.byAffiliation}
                    cx="50%" cy="50%"
                    innerRadius={38} outerRadius={60}
                    dataKey="value" paddingAngle={3}
                    style={{ cursor: "pointer" }}
                    onClick={() => onFilterChange({ view: "table", page: 1 })}
                  >
                    {data.byAffiliation.map((e, i) => (
                      <Cell key={i} fill={pickColor(AFFILIATION_COLOR, e.name, i)} stroke="none" />
                    ))}
                  </Pie>
                  <RechartTooltip content={pieTip} />
                </PieChart>
              </ResponsiveContainer>
              {donutLegend(
                data.byAffiliation,
                (n, i) => pickColor(AFFILIATION_COLOR, n, i),
                () => onFilterChange({ view: "table", page: 1 }),
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">暂无数据</p>
          )}
        </div>
      </div>

      {/* ── 各级别金额统计（柱状图，按 LEVEL_ORDER 排序） ── */}
      {data.amountByLevel.length > 0 && (
        <div className="bg-white rounded-2xl p-5" style={{ border: "1px solid #e2e8f0" }}>
          {cardHdr("#f59e0b15", "#f59e0b", <DollarSign size={13} />, "各级别金额统计（万元）")}
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={[...data.amountByLevel].sort((a, b) => {
                const ai = LEVEL_ORDER.indexOf(a.name); const bi = LEVEL_ORDER.indexOf(b.name);
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
              })}
              margin={{ left: 8, right: 16, top: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: "#94a3b8" }}
                axisLine={false} tickLine={false}
              />
              <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <RechartTooltip content={barTip} />
              <Bar
                dataKey="value" name="金额(万)"
                radius={[4, 4, 0, 0]}
                style={{ cursor: "pointer" }}
                onClick={() => onFilterChange({ view: "table", page: 1 })}
              >
                {data.amountByLevel.map((e, i) => (
                  <Cell key={i} fill={pickColor(LEVEL_COLOR, e.name, i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
