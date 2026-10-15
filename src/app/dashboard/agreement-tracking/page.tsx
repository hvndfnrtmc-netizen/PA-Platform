"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import PageHeaderWithConfig from "@/components/shared/PageHeaderWithConfig";
import {
  TrendingUp, AlertTriangle, CheckCircle2, Clock, FileText,
  Upload, X, ChevronDown, Loader2, Plus, Trash2, Download,
  Eye, RefreshCw, Database, Shield,
} from "lucide-react";
import { fmtTargetValue, KPI_TARGET_MASKED, type KpiActual } from "@/lib/agreement-config";

// ── 类型 ────────────────────────────────────────────────────────────────────

interface DashboardData {
  year:           number;
  overallScore:   number;
  daysToDeadline: number;
  kpis:           KpiActual[];
  qualCompliant:  number;
  qualTotal:      number;
  qualRate:       number;
  allYearTargets: Record<string, Record<number, number>>;
  monthly:        { period: string; revenue: number; vatPaid: number; pitPaid: number }[];
}

interface QualitativeItem {
  id:          string;
  code:        string;
  name:        string;
  articleRef:  string;
  requirement: string;
  status:      string;
  description: string | null;
  evidenceUrls: string[];
  updatedAt:   string;
}

interface AgreementFileItem {
  id:         string;
  name:       string;
  size:       number | null;
  mimeType:   string | null;
  category:   string;
  year:       number | null;
  remark:     string | null;
  uploadedBy: string;
  createdAt:  string;
}

interface MonthlyPayload {
  revenue?:              number;
  vatPaidSuzhou?:        number;
  citPaidSuzhou?:        number;
  pitSuzhou?:            number;
  socialInsuranceCount?: number;
  nationalTalentCount?:  number;
  industryChainCount?:   number;
  inventionPatentApplied?: number;
  [key: string]: number | undefined;
}

// ── 常量 ────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "pending",     label: "待完成",   color: "text-slate-500",  bg: "bg-slate-50",   border: "border-slate-200" },
  { value: "in_progress", label: "进行中",   color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-200"  },
  { value: "compliant",   label: "已达标",   color: "text-emerald-700",bg: "bg-emerald-50", border: "border-emerald-200"},
  { value: "at_risk",     label: "有风险",   color: "text-red-700",    bg: "bg-red-50",     border: "border-red-200"   },
];

const FILE_CATEGORIES = [
  { value: "contract",   label: "协议原件" },
  { value: "supplement", label: "补充协议" },
  { value: "audit",      label: "审计报告" },
  { value: "report",     label: "年度报告" },
  { value: "other",      label: "其他" },
];

const YEARS = [2026, 2027, 2028];

function statusMeta(v: string) {
  return STATUS_OPTIONS.find(s => s.value === v) ?? STATUS_OPTIONS[0];
}

function kpiStatusMeta(status: KpiActual["status"]) {
  if (status === "compliant") return { label: "全额达标", color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200", bar: "bg-emerald-500" };
  if (status === "warning")   return { label: "打折区间", color: "text-amber-700",   bg: "bg-amber-50",   border: "border-amber-200",   bar: "bg-amber-400"  };
  if (status === "risk")      return { label: "危险区间", color: "text-red-700",     bg: "bg-red-50",     border: "border-red-200",     bar: "bg-red-500"    };
  return                             { label: "暂无数据", color: "text-slate-400",   bg: "bg-slate-50",   border: "border-slate-200",   bar: "bg-slate-300"  };
}

function fmtNum(v: number | null, unit: string) {
  if (v === null) return "—";
  if (unit === "亿元") return v.toFixed(2);
  return String(Math.round(v));
}

function fmtSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── 综合评分圆环 ─────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ;
  const color = score >= 90 ? "#10b981" : score >= 70 ? "#f59e0b" : "#ef4444";
  return (
    <svg width={128} height={128} viewBox="0 0 128 128">
      <circle cx={64} cy={64} r={r} fill="none" stroke="#e2e8f0" strokeWidth={10} />
      <circle
        cx={64} cy={64} r={r} fill="none"
        stroke={color} strokeWidth={10}
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        transform="rotate(-90 64 64)"
        style={{ transition: "stroke-dasharray 0.8s ease" }}
      />
      <text x={64} y={60} textAnchor="middle" fontSize={28} fontWeight="bold" fill={color}>{score}</text>
      <text x={64} y={78} textAnchor="middle" fontSize={11} fill="#94a3b8">综合评分</text>
    </svg>
  );
}

// ── 数据录入弹层 ──────────────────────────────────────────────────────────────

function DataEntryModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"finance" | "hr" | "ip">("finance");
  const [period, setPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [payload, setPayload] = useState<MonthlyPayload>({});
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  function setField(key: string, val: string) {
    const num = val === "" ? undefined : parseFloat(val);
    setPayload(prev => ({ ...prev, [key]: num }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch("/api/agreement/data", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ period, category: activeTab, payload }),
      });
      if (res.ok) {
        setToast("保存成功");
        setTimeout(() => { setToast(""); onSaved(); }, 1200);
      } else {
        const d = await res.json() as { error?: string };
        setToast(d.error ?? "保存失败");
        setTimeout(() => setToast(""), 3000);
      }
    } finally { setSaving(false); }
  }

  const FINANCE_FIELDS: { key: keyof MonthlyPayload; label: string; unit: string; hint?: string }[] = [
    { key: "revenue",       label: "营业收入",       unit: "亿元", hint: "苏州主体当月营业收入" },
    { key: "vatPaidSuzhou", label: "增值税实缴",     unit: "元",   hint: "当月实际缴纳增值税（元）" },
    { key: "citPaidSuzhou", label: "企业所得税实缴", unit: "元",   hint: "当月实际缴纳企业所得税（元）" },
    { key: "pitSuzhou",     label: "个人所得税代扣", unit: "元",   hint: "当月代扣代缴个税（元）" },
  ];
  const HR_FIELDS: { key: keyof MonthlyPayload; label: string; unit: string; hint?: string }[] = [
    { key: "socialInsuranceCount", label: "社保缴纳人数",     unit: "人", hint: "月末在册社保人数" },
    { key: "nationalTalentCount",  label: "国家级人才计划",   unit: "人", hint: "已申报/认定人数（累计）" },
    { key: "industryChainCount",   label: "产业链引培企业",   unit: "家", hint: "已落户苏州企业数（累计）" },
    { key: "coreStaffCount",       label: "核心岗位劳动关系", unit: "人", hint: "与苏州法人签署劳动合同人数" },
  ];
  const IP_FIELDS: { key: keyof MonthlyPayload; label: string; unit: string; hint?: string }[] = [
    { key: "inventionPatentApplied", label: "发明专利申请量", unit: "件", hint: "累计已申请件数" },
  ];

  const CURRENT_FIELDS = activeTab === "finance" ? FINANCE_FIELDS : activeTab === "hr" ? HR_FIELDS : IP_FIELDS;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: "90vh" }}>
        {/* header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-800">月度数据录入</h2>
            <p className="text-xs text-slate-400 mt-0.5">录入后 KPI 实时更新</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* period */}
        <div className="px-6 pt-4">
          <label className="text-xs font-medium text-slate-500 block mb-1.5">录入月份</label>
          <input
            type="month"
            value={period}
            onChange={e => setPeriod(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-sm bg-slate-50 border border-slate-200 text-slate-800 outline-none focus:ring-2 focus:ring-blue-200"
          />
        </div>

        {/* tabs */}
        <div className="px-6 pt-4 flex gap-2">
          {(["finance", "hr", "ip"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                activeTab === tab
                  ? "bg-blue-50 border-blue-200 text-blue-700"
                  : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {tab === "finance" ? "财税" : tab === "hr" ? "人才社保" : "知识产权"}
            </button>
          ))}
        </div>

        {/* fields */}
        <div className="px-6 py-4 flex flex-col gap-3 overflow-y-auto flex-1">
          {CURRENT_FIELDS.map(f => (
            <div key={f.key}>
              <label className="text-xs font-medium text-slate-500 mb-1 block">
                {f.label} <span className="text-slate-300">（{f.unit}）</span>
              </label>
              <input
                type="number"
                step="any"
                value={payload[f.key] ?? ""}
                onChange={e => setField(f.key as string, e.target.value)}
                placeholder={f.hint}
                className="w-full px-3 py-2 rounded-lg text-sm bg-slate-50 border border-slate-200 text-slate-800 outline-none focus:ring-2 focus:ring-blue-200"
              />
            </div>
          ))}
        </div>

        {/* footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
          {toast ? (
            <span className={`text-xs font-medium ${toast.includes("成功") ? "text-emerald-600" : "text-red-500"}`}>{toast}</span>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : null}
              保存数据
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── KPI 追踪 Tab（单行卡片 + 联动详情面板）─────────────────────────────────

function KpiTab({
  kpis,
  year,
  allYearTargets,
}: {
  kpis:            KpiActual[];
  year:            number;
  allYearTargets:  Record<string, Record<number, number>>;
}) {
  const [activeKpi, setActiveKpi] = useState<string>(() => kpis[0]?.key ?? "");

  const currentKpi = kpis.find(k => k.key === activeKpi) ?? kpis[0] ?? null;

  return (
    <>
      {/* KPI 卡片网格（单行极简） */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mb-6">
        {kpis.map(kpi => {
          const meta     = kpiStatusMeta(kpi.status);
          const pctDisp  = kpi.pct !== null ? Math.min(kpi.pct * 100, 100) : 0;
          const isActive = kpi.key === activeKpi;

          return (
            <div
              key={kpi.key}
              onClick={() => setActiveKpi(kpi.key)}
              className={`bg-white rounded-xl shadow-sm border p-3 cursor-pointer transition-all ${
                isActive
                  ? "border-blue-500 bg-blue-50/50 shadow-md"
                  : "border-slate-100 hover:shadow-md"
              }`}
            >
              {/* 指标名称 + 状态标签 */}
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-semibold text-slate-800 leading-tight mr-1">{kpi.label}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium border shrink-0 ${meta.bg} ${meta.color} ${meta.border}`}>
                  {meta.label}
                </span>
              </div>

              {/* 当前值 / 目标值 */}
              <div className="mb-2">
                <span className="text-lg font-bold text-slate-800">
                  {kpi.actual !== null ? fmtNum(kpi.actual, kpi.unit) : "---"}
                </span>
                <span className="text-xs text-slate-500 ml-1">
                  {kpi.unit} / {fmtTargetValue(kpi.target)}
                </span>
              </div>

              {/* 超细进度条 */}
              <div className="h-1 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${meta.bar}`}
                  style={{ width: kpi.actual !== null ? `${pctDisp}%` : "0%" }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* 五年阶梯对赌详情面板（联动） */}
      {currentKpi && (
        <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-5">
          {/* 面板 Header */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <span className="font-semibold text-slate-800 text-sm">{currentKpi.label} · 五年阶梯对赌</span>
              <span className="ml-2 text-xs text-slate-500">
                五年合计目标：{
                  fmtTargetValue(
                    currentKpi.unit === "亿元"
                      ? Object.values(allYearTargets[currentKpi.key] ?? {}).reduce((a, b) => a + b, 0).toFixed(2)
                      : String(Math.round(Object.values(allYearTargets[currentKpi.key] ?? {}).reduce((a, b) => a + b, 0)))
                  )
                }{currentKpi.unit}
              </span>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${kpiStatusMeta(currentKpi.status).bg} ${kpiStatusMeta(currentKpi.status).color} ${kpiStatusMeta(currentKpi.status).border}`}>
              {year}年：{kpiStatusMeta(currentKpi.status).label}
            </span>
          </div>

          {/* 年度列表 */}
          <div className="flex flex-col gap-3">
            {YEARS.map(y => {
              const target    = allYearTargets[currentKpi.key]?.[y] ?? 0;
              const isCurrent = y === year;
              const actual    = isCurrent ? currentKpi.actual : null;
              const rawPct    = isCurrent && currentKpi.pct !== null ? currentKpi.pct * 100 : 0;
              const pct       = Number.isFinite(rawPct) ? Math.min(rawPct, 100) : 0;
              const rowMeta   = isCurrent ? kpiStatusMeta(currentKpi.status) : kpiStatusMeta("no_data");
              const gap       = isCurrent && currentKpi.gap90 !== null && currentKpi.gap90 > 0 ? currentKpi.gap90 : null;

              return (
                <div key={y} className="bg-white rounded-lg p-4 shadow-sm flex flex-col gap-2">
                  {/* 行顶部 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-700">{y}年</span>
                      {isCurrent ? (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-600 border border-blue-200">当前年度</span>
                      ) : (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-400 border border-slate-200">未开始</span>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">
                      实际 <strong className={isCurrent ? rowMeta.color : "text-slate-400"}>
                        {actual !== null ? fmtNum(actual, currentKpi.unit) : "---"}
                      </strong>
                      {" / 目标 "}
                      <strong className="text-slate-700">{fmtTargetValue(target)}{currentKpi.unit}</strong>
                    </span>
                  </div>

                  {/* 进度条 */}
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${rowMeta.bar}`}
                      style={{ width: isCurrent ? `${pct}%` : "0%" }}
                    />
                  </div>

                  {/* 当前年度差距提示 */}
                  {isCurrent && gap !== null && (
                    <p className="text-xs text-amber-600 bg-amber-50 px-2 py-1.5 rounded border border-amber-100">
                      💡 还需 +{KPI_TARGET_MASKED ? "XX" : fmtNum(gap, currentKpi.unit)}{currentKpi.unit} 才能解锁100%全额补贴
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ── 质性义务 Tab ──────────────────────────────────────────────────────────────

function QualitativeTab({
  items,
  onUpdate,
  onSeedSuccess,
}: {
  items:          QualitativeItem[];
  onUpdate:       (id: string, patch: Partial<QualitativeItem>) => void;
  onSeedSuccess:  () => void;
}) {
  const [editing,   setEditing]   = useState<string | null>(null);
  const [draft,     setDraft]     = useState<{ status: string; description: string }>({ status: "", description: "" });
  const [saving,    setSaving]    = useState(false);
  const [seeding,   setSeeding]   = useState(false);
  const [seedToast, setSeedToast] = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleSeed() {
    setSeeding(true);
    setSeedToast(null);
    try {
      const res  = await fetch("/api/agreement/seed", { method: "POST" });
      const data = await res.json() as { ok?: boolean; message?: string; error?: string };
      if (res.ok && data.ok) {
        setSeedToast({ ok: true, msg: data.message ?? "12 项质性义务初始化成功！" });
        setTimeout(() => { setSeedToast(null); onSeedSuccess(); }, 1500);
      } else {
        setSeedToast({ ok: false, msg: data.error ?? "初始化失败，请重试" });
      }
    } catch (e) {
      setSeedToast({ ok: false, msg: (e as Error).message ?? "网络错误" });
    } finally {
      setSeeding(false);
    }
  }

  function startEdit(item: QualitativeItem) {
    setEditing(item.id);
    setDraft({ status: item.status, description: item.description ?? "" });
  }

  async function saveEdit(id: string) {
    setSaving(true);
    try {
      const res = await fetch(`/api/agreement/qualitative/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(draft),
      });
      if (res.ok) {
        const updated = await res.json() as QualitativeItem;
        onUpdate(id, updated);
        setEditing(null);
      }
    } finally { setSaving(false); }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Shield size={40} className="text-slate-200 mb-4" />
        <p className="text-slate-400 text-sm mb-4">质性义务数据尚未初始化</p>
        {seedToast && (
          <p className={`text-xs mb-3 px-4 py-2 rounded-lg border ${seedToast.ok ? "text-emerald-700 bg-emerald-50 border-emerald-200" : "text-red-600 bg-red-50 border-red-200"}`}>
            {seedToast.msg}
          </p>
        )}
        <button
          onClick={handleSeed}
          disabled={seeding}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {seeding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {seeding ? "初始化中..." : "一键初始化 12 项义务"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {items.map(item => {
        const sm      = statusMeta(item.status);
        const isEdit  = editing === item.id;

        return (
          <div key={item.id} className="bg-white rounded-xl border border-slate-100 shadow-sm p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-sm font-semibold text-slate-800">{item.name}</span>
                  <span className="text-xs text-slate-400">{item.articleRef}</span>
                  {!isEdit && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${sm.bg} ${sm.color} ${sm.border}`}>
                      {sm.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">{item.requirement}</p>
                {item.description && !isEdit && (
                  <p className="text-xs text-slate-600 mt-2 bg-slate-50 px-3 py-2 rounded-lg border border-slate-100">
                    {item.description}
                  </p>
                )}
              </div>

              {!isEdit && (
                <button
                  onClick={() => startEdit(item)}
                  className="shrink-0 px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition-colors"
                >
                  编辑
                </button>
              )}
            </div>

            {isEdit && (
              <div className="mt-4 flex flex-col gap-3 pt-3 border-t border-slate-100">
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1.5 block">履约状态</label>
                  <div className="flex flex-wrap gap-2">
                    {STATUS_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setDraft(d => ({ ...d, status: opt.value }))}
                        className={`px-3 py-1.5 text-xs rounded-lg border font-medium transition-colors ${
                          draft.status === opt.value ? `${opt.bg} ${opt.color} ${opt.border}` : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-500 mb-1.5 block">备注说明</label>
                  <textarea
                    value={draft.description}
                    onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                    rows={2}
                    placeholder="可填写履约进展、风险说明等..."
                    className="w-full px-3 py-2 rounded-lg text-sm bg-slate-50 border border-slate-200 text-slate-800 outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditing(null)} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 transition-colors">
                    取消
                  </button>
                  <button
                    onClick={() => saveEdit(item.id)}
                    disabled={saving}
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
                  >
                    {saving ? <Loader2 size={11} className="animate-spin" /> : null}保存
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 协议文件 Tab ──────────────────────────────────────────────────────────────

function FilesTab() {
  const [files, setFiles]         = useState<AgreementFileItem[]>([]);
  const [loading, setLoading]     = useState(true);
  const [catFilter, setCatFilter] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState<{ name: string; category: string; year: string; remark: string } | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = catFilter !== "all" ? `?category=${catFilter}` : "";
      const res = await fetch(`/api/agreement/files${q}`);
      if (res.ok) setFiles(await res.json() as AgreementFileItem[]);
    } finally { setLoading(false); }
  }, [catFilter]);

  useEffect(() => { void load(); }, [load]);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPendingFile(f);
    setUploadForm({ name: f.name, category: "other", year: String(new Date().getFullYear()), remark: "" });
    e.target.value = "";
  }

  async function doUpload() {
    if (!pendingFile || !uploadForm) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file",     pendingFile);
      fd.append("name",     uploadForm.name);
      fd.append("category", uploadForm.category);
      if (uploadForm.year)   fd.append("year",   uploadForm.year);
      if (uploadForm.remark) fd.append("remark", uploadForm.remark);

      const res = await fetch("/api/agreement/upload", { method: "POST", body: fd });
      if (res.ok) {
        setUploadForm(null);
        setPendingFile(null);
        await load();
      }
    } finally { setUploading(false); }
  }

  async function deleteFile(id: string) {
    if (!confirm("确定删除该文件？此操作不可恢复。")) return;
    await fetch(`/api/agreement/files/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div>
      {/* toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-2 flex-wrap">
          {[{ value: "all", label: "全部" }, ...FILE_CATEGORIES].map(opt => (
            <button
              key={opt.value}
              onClick={() => setCatFilter(opt.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                catFilter === opt.value ? "bg-blue-50 border-blue-200 text-blue-700" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
        >
          <Upload size={13} /> 上传文件
        </button>
        <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" onChange={handleFileChange} />
      </div>

      {/* upload form */}
      {uploadForm && pendingFile && (
        <div className="mb-4 bg-blue-50 rounded-xl p-4 border border-blue-100">
          <p className="text-xs font-semibold text-blue-700 mb-3">待上传：{pendingFile.name}</p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">文件名称</label>
              <input
                className="w-full px-3 py-1.5 rounded-lg text-xs bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-blue-200"
                value={uploadForm.name}
                onChange={e => setUploadForm(f => f ? { ...f, name: e.target.value } : null)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">分类</label>
              <select
                className="w-full px-3 py-1.5 rounded-lg text-xs bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-blue-200"
                value={uploadForm.category}
                onChange={e => setUploadForm(f => f ? { ...f, category: e.target.value } : null)}
              >
                {FILE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">年份</label>
              <input
                type="number" min="2020" max="2035"
                className="w-full px-3 py-1.5 rounded-lg text-xs bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-blue-200"
                value={uploadForm.year}
                onChange={e => setUploadForm(f => f ? { ...f, year: e.target.value } : null)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">备注</label>
              <input
                className="w-full px-3 py-1.5 rounded-lg text-xs bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-blue-200"
                value={uploadForm.remark}
                onChange={e => setUploadForm(f => f ? { ...f, remark: e.target.value } : null)}
                placeholder="可选"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setUploadForm(null); setPendingFile(null); }} className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-white transition-colors">取消</button>
            <button
              onClick={doUpload}
              disabled={uploading}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              确认上传
            </button>
          </div>
        </div>
      )}

      {/* file list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
          <Loader2 size={18} className="animate-spin mr-2" /> 加载中...
        </div>
      ) : files.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText size={36} className="text-slate-200 mb-3" />
          <p className="text-slate-400 text-sm">暂无协议文件，点击「上传文件」添加</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {files.map(f => {
            const catLabel = FILE_CATEGORIES.find(c => c.value === f.category)?.label ?? f.category;
            return (
              <div key={f.id} className="bg-white rounded-xl border border-slate-100 shadow-sm px-4 py-3.5 flex items-center gap-4">
                <FileText size={20} className="text-slate-300 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{f.name}</p>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs text-slate-400">{catLabel}</span>
                    {f.year && <span className="text-xs text-slate-400">{f.year}年</span>}
                    {f.size && <span className="text-xs text-slate-400">{fmtSize(f.size)}</span>}
                    {f.remark && <span className="text-xs text-slate-500 italic">{f.remark}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`/api/agreement/files/${f.id}/view`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    title="预览"
                  >
                    <Eye size={14} />
                  </a>
                  <a
                    href={`/api/agreement/files/${f.id}/view?download=1`}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                    title="下载"
                  >
                    <Download size={14} />
                  </a>
                  <button
                    onClick={() => deleteFile(f.id)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 主页面 ─────────────────────────────────────────────────────────────────────

export default function AgreementTrackingPage() {
  const [year,       setYear]       = useState(new Date().getFullYear());
  const [dashboard,  setDashboard]  = useState<DashboardData | null>(null);
  const [qualItems,  setQualItems]  = useState<QualitativeItem[]>([]);
  const [activeTab,  setActiveTab]  = useState<"kpi" | "qualitative" | "files">("kpi");
  const [loading,    setLoading]    = useState(true);
  const [showEntry,  setShowEntry]  = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, qualRes] = await Promise.all([
        fetch(`/api/agreement/dashboard?year=${year}`),
        fetch("/api/agreement/qualitative"),
      ]);
      if (dashRes.ok)  setDashboard(await dashRes.json() as DashboardData);
      if (qualRes.ok)  setQualItems(await qualRes.json() as QualitativeItem[]);
    } finally { setLoading(false); }
  }, [year, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadDashboard(); }, [loadDashboard]);

  function onQualUpdate(id: string, patch: Partial<QualitativeItem>) {
    setQualItems(prev => prev.map(q => q.id === id ? { ...q, ...patch } : q));
    void loadDashboard();
  }

  const [detailZone, setDetailZone] = useState<"full" | "discount" | "risk" | null>(null);

  const fullKpis     = dashboard?.kpis.filter(k => k.status === "compliant") ?? [];
  const discountKpis = dashboard?.kpis.filter(k => k.status === "warning")   ?? [];
  const riskKpis     = dashboard?.kpis.filter(k => k.status === "risk")      ?? [];

  const kpiStatusCount = {
    compliant: fullKpis.length,
    warning:   discountKpis.length,
    risk:      riskKpis.length,
    no_data:   dashboard?.kpis.filter(k => k.status === "no_data").length ?? 0,
  };

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <PageHeaderWithConfig
        pageId="agreement-tracking"
        defaultTitle="落地协议追踪与对赌管理"
        defaultDescription="协议核心 KPI 动态追踪、红绿灯预警及履约凭证管理"
      />

      <div className="p-6">
        {/* ── Hero 区 ── */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-slate-500">考核年度</span>
              <div className="flex gap-1.5">
                {YEARS.map(y => (
                  <button
                    key={y}
                    onClick={() => setYear(y)}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                      year === y ? "bg-blue-600 text-white" : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    {y}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Link
                href="/dashboard/agreement-tracking/dashboard"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
              >
                📊 数据大屏
              </Link>
              <button
                onClick={() => setRefreshKey(k => k + 1)}
                className="p-2 rounded-lg text-slate-400 hover:bg-slate-100 transition-colors"
                title="刷新"
              >
                <RefreshCw size={15} />
              </button>
              <Link
                href="/dashboard/assets"
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                <Database size={14} /> 数据录入
              </Link>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
            </div>
          ) : (
            <div className="flex items-center gap-8 flex-wrap">
              {/* 评分圆环 */}
              <div className="shrink-0">
                <ScoreRing score={dashboard?.overallScore ?? 0} />
              </div>

              {/* 状态统计 */}
              <div className="flex-1 grid grid-cols-2 gap-3" style={{ minWidth: 280 }}>
                <div
                  className="p-4 rounded-xl bg-emerald-50 border border-emerald-100 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                  onClick={() => fullKpis.length > 0 && setDetailZone("full")}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    <span className="text-xs font-medium text-emerald-700">全额达标</span>
                  </div>
                  <span className="text-2xl font-bold text-emerald-700">{kpiStatusCount.compliant}</span>
                  <span className="text-xs text-emerald-500 ml-1">/ 7 项</span>
                </div>
                <div
                  className="p-4 rounded-xl bg-amber-50 border border-amber-100 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                  onClick={() => discountKpis.length > 0 && setDetailZone("discount")}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle size={14} className="text-amber-500" />
                    <span className="text-xs font-medium text-amber-700">打折区间</span>
                  </div>
                  <span className="text-2xl font-bold text-amber-700">{kpiStatusCount.warning}</span>
                  <span className="text-xs text-amber-500 ml-1">/ 7 项</span>
                </div>
                <div
                  className="p-4 rounded-xl bg-red-50 border border-red-100 cursor-pointer hover:shadow-md hover:-translate-y-0.5 transition-all duration-200"
                  onClick={() => riskKpis.length > 0 && setDetailZone("risk")}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <TrendingUp size={14} className="text-red-500" />
                    <span className="text-xs font-medium text-red-700">危险区间</span>
                  </div>
                  <span className="text-2xl font-bold text-red-700">{kpiStatusCount.risk}</span>
                  <span className="text-xs text-red-500 ml-1">/ 7 项</span>
                </div>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 mb-1">
                    <Clock size={14} className="text-slate-400" />
                    <span className="text-xs font-medium text-slate-500">年末截止</span>
                  </div>
                  <span className="text-2xl font-bold text-slate-700">{dashboard?.daysToDeadline ?? 0}</span>
                  <span className="text-xs text-slate-400 ml-1">天</span>
                </div>
              </div>

              {/* 质性义务小结 */}
              <div className="shrink-0 p-4 rounded-xl bg-slate-50 border border-slate-200 text-center" style={{ minWidth: 120 }}>
                <Shield size={20} className="text-slate-400 mx-auto mb-1" />
                <div className="text-2xl font-bold text-slate-700">{dashboard?.qualRate ?? 0}%</div>
                <div className="text-xs text-slate-400 mt-0.5">质性履约</div>
                <div className="text-xs text-slate-400">{dashboard?.qualCompliant}/{dashboard?.qualTotal} 达标</div>
              </div>
            </div>
          )}

          {/* 拨付规则说明 */}
          <div className="mt-4 px-4 py-2.5 bg-slate-50 rounded-xl border border-slate-100">
            <p className="text-xs text-slate-500">
              <span className="font-medium text-slate-600">补贴拨付规则：</span>
              完成率 ≥90% → 全额拨付；70%-90% → 按比例打折；＜70% → 当年零拨付
            </p>
          </div>
        </div>

        {/* ── Tab 导航 ── */}
        <div className="flex gap-3 mb-5">
          {(["kpi", "qualitative", "files"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-5 py-2 rounded-xl text-sm font-medium transition-colors border ${
                activeTab === tab
                  ? "bg-white border-blue-200 text-blue-700 shadow-sm"
                  : "bg-transparent border-transparent text-slate-500 hover:bg-white hover:border-slate-200"
              }`}
            >
              {tab === "kpi" ? "KPI 追踪" : tab === "qualitative" ? "质性义务" : "协议文件"}
            </button>
          ))}
        </div>

        {/* ── Tab 内容 ── */}
        {activeTab === "kpi" && !loading && dashboard && (
          <KpiTab kpis={dashboard.kpis} year={year} allYearTargets={dashboard.allYearTargets} />
        )}
        {activeTab === "qualitative" && (
          <QualitativeTab items={qualItems} onUpdate={onQualUpdate} onSeedSuccess={loadDashboard} />
        )}
        {activeTab === "files" && <FilesTab />}
      </div>

      {/* ── 数据录入弹层 ── */}
      {showEntry && (
        <DataEntryModal
          onClose={() => setShowEntry(false)}
          onSaved={() => {
            setShowEntry(false);
            setRefreshKey(k => k + 1);
          }}
        />
      )}

      {/* ── 区间明细右侧抽屉 ── */}
      {detailZone !== null && (
        <>
          {/* 背景遮罩 */}
          <div
            className="fixed inset-0 z-40 bg-black/30"
            onClick={() => setDetailZone(null)}
          />
          {/* 抽屉面板 */}
          <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white shadow-2xl flex flex-col">
            {/* 头部 */}
            <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div>
                {detailZone === "full" && (
                  <h2 className="text-base font-semibold text-emerald-700">全额达标指标明细 (≥90%)</h2>
                )}
                {detailZone === "discount" && (
                  <h2 className="text-base font-semibold text-amber-700">打折区间指标明细 (70%-90%)</h2>
                )}
                {detailZone === "risk" && (
                  <h2 className="text-base font-semibold text-red-700">危险区间指标明细 (&lt;70%)</h2>
                )}
                <p className="text-xs text-slate-400 mt-0.5">
                  共 {(detailZone === "full" ? fullKpis : detailZone === "discount" ? discountKpis : riskKpis).length} 项指标
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailZone(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {(detailZone === "full" ? fullKpis : detailZone === "discount" ? discountKpis : riskKpis).map(kpi => {
                const rawPct   = kpi.pct !== null && Number.isFinite(kpi.pct) ? kpi.pct * 100 : 0;
                const progress = Math.min(rawPct, 100);
                const meta     = kpiStatusMeta(kpi.status);
                return (
                  <div key={kpi.key} className="mb-4 p-4 border rounded-lg bg-slate-50 relative">
                    <div className="font-bold text-slate-800 mb-2">{kpi.label}</div>
                    <div className="flex justify-between text-sm mb-1">
                      <span>
                        实际：{kpi.actual !== null ? fmtNum(kpi.actual, kpi.unit) : 0}{kpi.unit}
                        {" / 目标："}{fmtTargetValue(kpi.target)}{kpi.unit}
                      </span>
                      <span className="font-bold">{rawPct.toFixed(1)}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${meta.bar}`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                    {detailZone === "risk" && (
                      <div className="mt-3 text-xs text-red-600 bg-red-100/50 p-2 rounded">
                        ⚠️ 严重落后于时间进度，请重点关注。
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
