"use client";

/**
 * /dashboard/assets — DataHub 数据中台月度填报系统
 * 支持按月录入 4 个维度的数据，对接 /api/agreement/data
 */

import { useState, useEffect, useCallback } from "react";
import {
  Save, CheckCircle, XCircle, Loader2, Plus, Trash2, Database,
} from "lucide-react";

// ── 工具函数 ──────────────────────────────────────────────────────

function getDefaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Tab / 字段配置 ────────────────────────────────────────────────

const TABS = [
  { id: "finance", label: "经营与财务",     icon: "💰" },
  { id: "hr",      label: "人才与团队",     icon: "👥" },
  { id: "ip",      label: "研发与知识产权",  icon: "🔬" },
  { id: "chain",   label: "产业链",         icon: "🔗" },
] as const;
type TabId = (typeof TABS)[number]["id"];

interface FieldDef { key: string; label: string; unit: string }

const FIELDS: Record<TabId, FieldDef[]> = {
  finance: [
    { key: "revenue",      label: "营业收入",                    unit: "亿元" },
    { key: "suzhou_rev",   label: "其中：境内销售收入确认在苏州",  unit: "亿元" },
    { key: "vat",          label: "增值税_本月实缴苏州",           unit: "万元" },
    { key: "corp_tax",     label: "企业所得税_本月实缴苏州",       unit: "万元" },
    { key: "personal_tax", label: "个人所得税_苏州代扣",           unit: "万元" },
    { key: "rd_expense",   label: "研发投入",                    unit: "万元" },
  ],
  hr: [
    { key: "social_ins",   label: "苏州高铁新城社保人数",          unit: "人" },
    { key: "core_rd",      label: "核心高管及研发人数",            unit: "人" },
  ],
  ip: [
    { key: "inv_app",      label: "发明专利申请数_本月新增",        unit: "件" },
    { key: "inv_auth",     label: "发明专利授权数_本月新增",        unit: "件" },
  ],
  chain: [
    { key: "partners",     label: "产业链合作企业数",              unit: "家" },
    { key: "investment",   label: "产业链投资金额",                unit: "万元" },
  ],
};

// ── 类型定义 ──────────────────────────────────────────────────────

interface TalentItem { id: string; name: string; category: string; level: string }

interface ToastState { type: "success" | "error"; msg: string }

// ── 主页面组件 ────────────────────────────────────────────────────

export default function DataCenterPage() {
  const [period, setPeriod]       = useState<string>(getDefaultMonth);
  const [activeTab, setActiveTab] = useState<TabId>("finance");
  const [forms, setForms]         = useState<Record<TabId, Record<string, string>>>({
    finance: {}, hr: {}, ip: {}, chain: {},
  });
  const [talents, setTalents]     = useState<TalentItem[]>([]);
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState<ToastState | null>(null);

  const showToast = useCallback((type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 拉取 (period, tab) 对应的数据
  const fetchData = useCallback(async (p: string, tab: TabId) => {
    if (!p) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/agreement/data?period=${encodeURIComponent(p)}&category=${tab}`);
      if (!res.ok) throw new Error("获取数据失败");
      const rows = (await res.json()) as Array<{ payload: Record<string, unknown> }>;
      const payload = (rows[0]?.payload ?? {}) as Record<string, unknown>;

      const strFields: Record<string, string> = {};
      FIELDS[tab].forEach(f => {
        strFields[f.key] = payload[f.key] != null ? String(payload[f.key]) : "";
      });
      setForms(prev => ({ ...prev, [tab]: strFields }));

      if (tab === "hr") {
        const raw = payload.talents;
        setTalents(Array.isArray(raw) ? (raw as TalentItem[]) : []);
      }
    } catch {
      // 静默失败，表单保持空白
    } finally {
      setLoading(false);
    }
  }, []);

  // period 或 activeTab 变化时重新拉取
  useEffect(() => {
    fetchData(period, activeTab);
  }, [period, activeTab, fetchData]);

  // 切换月份时清空所有表单
  const handlePeriodChange = useCallback((newPeriod: string) => {
    setPeriod(newPeriod);
    setForms({ finance: {}, hr: {}, ip: {}, chain: {} });
    setTalents([]);
  }, []);

  // 更新表单字段
  const setField = useCallback((tab: TabId, key: string, value: string) => {
    setForms(prev => ({ ...prev, [tab]: { ...prev[tab], [key]: value } }));
  }, []);

  // 保存当前 Tab 数据
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};

      FIELDS[activeTab].forEach(f => {
        const v = forms[activeTab][f.key];
        payload[f.key] = v !== "" && v != null ? parseFloat(v) : null;
      });

      if (activeTab === "hr") {
        payload.talents = talents;
      }

      const res = await fetch("/api/agreement/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, category: activeTab, payload }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? "保存失败");
      }

      const tabLabel = TABS.find(t => t.id === activeTab)?.label ?? activeTab;
      const [y, m] = period.split("-");
      showToast("success", `${y}年${parseInt(m)}月「${tabLabel}」数据已保存`);
    } catch (e) {
      showToast("error", (e as Error).message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }, [activeTab, forms, talents, period, showToast]);

  // ── 人才列表操作 ────────────────────────────────────────────────

  const addTalent = useCallback(() => {
    setTalents(prev => [...prev, { id: uid(), name: "", category: "", level: "" }]);
  }, []);

  const updateTalent = useCallback((id: string, field: keyof TalentItem, value: string) => {
    setTalents(prev => prev.map(t => (t.id === id ? { ...t, [field]: value } : t)));
  }, []);

  const removeTalent = useCallback((id: string) => {
    setTalents(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── 辅助变量 ────────────────────────────────────────────────────

  const activeTabInfo = TABS.find(t => t.id === activeTab)!;
  const [y, m] = period.split("-");
  const periodLabel = period ? `${y}年${parseInt(m)}月` : "";

  // ── 渲染 ─────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-5">
      {/* 页头 */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0">
            <Database size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">数据中台</h1>
            <p className="text-sm text-slate-500">多维度月度数据录入与管理</p>
          </div>
        </div>

        {/* 月份选择器 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-medium text-slate-600">数据月份</span>
          <input
            type="month"
            value={period}
            onChange={e => handlePeriodChange(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-800 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          />
        </div>
      </div>

      {/* Toast 通知 */}
      {toast && (
        <div
          className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium border ${
            toast.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
              : "bg-red-50 border-red-200 text-red-700"
          }`}
        >
          {toast.type === "success"
            ? <CheckCircle size={16} className="flex-shrink-0" />
            : <XCircle size={16} className="flex-shrink-0" />}
          {toast.msg}
        </div>
      )}

      {/* Tab 导航 */}
      <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
              activeTab === tab.id
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* 表单主卡片 */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        {loading ? (
          <div className="flex items-center justify-center h-48 gap-2 text-slate-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">加载中...</span>
          </div>
        ) : (
          <>
            {/* 卡片标题 */}
            <div className="mb-6 pb-4 border-b border-slate-100">
              <h2 className="text-base font-bold text-slate-800">
                {activeTabInfo.icon} {activeTabInfo.label}数据录入
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                {periodLabel} · 填写后点击底部按钮保存，未填写字段将存为空值
              </p>
            </div>

            {/* 字段 Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {FIELDS[activeTab].map(field => (
                <div key={field.key} className="space-y-1.5">
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {field.label}
                  </label>
                  <div className="relative flex items-center">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="请输入数值"
                      value={forms[activeTab][field.key] ?? ""}
                      onChange={e => setField(activeTab, field.key, e.target.value)}
                      className="w-full pl-3 pr-14 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-800 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
                    />
                    <span className="absolute right-3 text-xs font-medium text-slate-400 pointer-events-none">
                      {field.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* HR Tab：国家级人才申报动态列表 */}
            {activeTab === "hr" && (
              <div className="mt-8 pt-6 border-t border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-slate-700">国家级人才申报记录</h3>
                    <p className="text-xs text-slate-400 mt-0.5">事件型数据，支持多行录入</p>
                  </div>
                  <button
                    type="button"
                    onClick={addTalent}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-semibold hover:bg-blue-100 transition-colors"
                  >
                    <Plus size={13} />
                    新增条目
                  </button>
                </div>

                {talents.length === 0 ? (
                  <div className="flex items-center justify-center py-10 rounded-xl bg-slate-50 text-slate-400 text-sm border border-dashed border-slate-200">
                    暂无申报记录，点击「新增条目」添加
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* 表头 */}
                    <div className="grid grid-cols-[24px_1fr_2fr_1fr_36px] gap-2 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                      <span>#</span>
                      <span>姓名</span>
                      <span>申报类型</span>
                      <span>层级</span>
                      <span />
                    </div>
                    {talents.map((t, i) => (
                      <div
                        key={t.id}
                        className="grid grid-cols-[24px_1fr_2fr_1fr_36px] gap-2 items-center p-3 rounded-xl bg-slate-50 border border-slate-100"
                      >
                        <span className="text-xs font-bold text-slate-400 text-center">{i + 1}</span>
                        <input
                          placeholder="姓名"
                          value={t.name}
                          onChange={e => updateTalent(t.id, "name", e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
                        />
                        <input
                          placeholder="如：院士、国家级高层次人才"
                          value={t.category}
                          onChange={e => updateTalent(t.id, "category", e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
                        />
                        <input
                          placeholder="国家/省级/市级"
                          value={t.level}
                          onChange={e => updateTalent(t.id, "level", e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
                        />
                        <button
                          type="button"
                          onClick={() => removeTalent(t.id)}
                          className="flex items-center justify-center p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 保存按钮 */}
            <div className="mt-8 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                数据将保存至 <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{period}</code> 月份的 <code className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{activeTab}</code> 分类
              </p>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                保存本月数据
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
