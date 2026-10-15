"use client";

/**
 * /dashboard/assets — DataHub 数据中台月度填报系统
 * 支持按月录入 3 个维度的数据，Tab 与字段可在页面内自助配置
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  Save, CheckCircle, XCircle, Loader2, Plus, Trash2, Database,
  Settings, X, ChevronUp, ChevronDown, GripVertical, Upload,
  File as FileIcon, Eye
} from "lucide-react";

// ── 工具函数 ──────────────────────────────────────────────────────

function getDefaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatFileSize(bytes?: number): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── 固定人才类别（不可配置） ──────────────────────────────────────

const TALENT_LEVELS = [
  { key: "national",    label: "国家级人才" },
  { key: "provincial",  label: "省级领军人才" },
  { key: "municipal",   label: "市级领军人才" },
  { key: "district",    label: "区级领军人才" },
  { key: "gusu",        label: "姑苏紧缺人才" },
] as const;

type TalentLevelKey = (typeof TALENT_LEVELS)[number]["key"];

// ── 默认配置 ──────────────────────────────────────────────────────

const DEFAULT_TABS: TabDef[] = [
  { id: "finance", label: "经营与财务", icon: "💰" },
  { id: "hr",      label: "人才与团队", icon: "👥" },
  { id: "ip",      label: "研发与知识产权", icon: "🔬" },
];

const DEFAULT_FIELDS: Record<string, FieldDef[]> = {
  finance: [
    { key: "revenue",      label: "营业收入",                    unit: "亿元" },
    { key: "suzhou_rev",   label: "其中：境内销售收入确认在苏州",  unit: "亿元" },
    { key: "vat",          label: "增值税_本月实缴苏州",           unit: "万元" },
    { key: "corp_tax",     label: "企业所得税_本月实缴苏州",       unit: "万元" },
    { key: "personal_tax", label: "个人所得税_苏州代扣",           unit: "万元" },
    { key: "rd_expense",   label: "研发投入",                    unit: "万元" },
    { key: "total_profit", label: "利润总额",                    unit: "万元" },
    { key: "net_profit",   label: "净利润",                      unit: "万元" },
  ],
  hr: [
    { key: "social_ins",        label: "苏州高铁新城社保人数", unit: "人" },
    { key: "core_rd",           label: "核心高管及研发人数",   unit: "人" },
    { key: "rd_count",          label: "研发人员人数",         unit: "人" },
    { key: "talent_national",   label: "国家级人才",           unit: "人" },
    { key: "talent_provincial", label: "省级领军人才",         unit: "人" },
    { key: "talent_municipal",  label: "市级领军人才",         unit: "人" },
    { key: "talent_district",   label: "区级领军人才",         unit: "人" },
    { key: "talent_gusu",       label: "姑苏紧缺人才",         unit: "人" },
  ],
  ip: [
    { key: "inv_app",       label: "发明专利申请数_本月新增", unit: "件" },
    { key: "inv_auth",      label: "发明专利授权数_本月新增", unit: "件" },
    { key: "trademark_app", label: "商标申请数_本月新增",     unit: "件" },
    { key: "trademark_reg", label: "商标注册数_本月新增",     unit: "件" },
  ],
};

const CONFIG_VERSION = 2;
const CONFIG_KEY = "pa-data-center-config";

// ── 类型定义 ──────────────────────────────────────────────────────

interface TabDef { id: string; label: string; icon: string }
interface FieldDef { key: string; label: string; unit: string }
interface PageConfig { version: number; tabs: TabDef[]; fields: Record<string, FieldDef[]> }

interface TalentItem { id: string; name: string; category: TalentLevelKey | ""; note: string }

interface IPAttachment {
  id: string;
  name: string;
  url: string;
  type: "image" | "pdf" | "doc" | "other";
  size?: number;
  uploadedAt: string;
}

interface ToastState { type: "success" | "error"; msg: string }

// ── 配置持久化 ────────────────────────────────────────────────────

function loadConfig(): PageConfig {
  if (typeof window === "undefined") {
    return { version: CONFIG_VERSION, tabs: DEFAULT_TABS, fields: DEFAULT_FIELDS };
  }
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { version: CONFIG_VERSION, tabs: DEFAULT_TABS, fields: DEFAULT_FIELDS };
    const parsed = JSON.parse(raw) as Partial<PageConfig>;
    if (parsed.version !== CONFIG_VERSION) {
      return { version: CONFIG_VERSION, tabs: DEFAULT_TABS, fields: DEFAULT_FIELDS };
    }
    return {
      version: CONFIG_VERSION,
      tabs: parsed.tabs?.length ? parsed.tabs : DEFAULT_TABS,
      fields: parsed.fields && Object.keys(parsed.fields).length ? parsed.fields : DEFAULT_FIELDS,
    };
  } catch {
    return { version: CONFIG_VERSION, tabs: DEFAULT_TABS, fields: DEFAULT_FIELDS };
  }
}

function persistConfig(config: Omit<PageConfig, "version">) {
  if (typeof window === "undefined") return;
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ ...config, version: CONFIG_VERSION }));
}

function makeEmptyForms(tabs: TabDef[]): Record<string, Record<string, string>> {
  return tabs.reduce((acc, t) => {
    acc[t.id] = {};
    return acc;
  }, {} as Record<string, Record<string, string>>);
}

// ── 主页面组件 ────────────────────────────────────────────────────

export default function DataCenterPage() {
  const [mounted, setMounted] = useState(false);

  const [config, setConfig] = useState<PageConfig>({
    version: CONFIG_VERSION,
    tabs: DEFAULT_TABS,
    fields: DEFAULT_FIELDS,
  });
  const [configOpen, setConfigOpen] = useState(false);
  const [draftConfig, setDraftConfig] = useState<PageConfig>(config);

  const [period, setPeriod]       = useState<string>(getDefaultMonth);
  const [activeTab, setActiveTab] = useState<string>("finance");
  const [forms, setForms]         = useState<Record<string, Record<string, string>>>(makeEmptyForms(DEFAULT_TABS));
  const [talents, setTalents]     = useState<TalentItem[]>([]);
  const [ipAttachments, setIpAttachments] = useState<{ acceptance: IPAttachment[]; authorization: IPAttachment[] }>({
    acceptance: [], authorization: [],
  });
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState<ToastState | null>(null);

  // 初始化：从 localStorage 读取配置
  useEffect(() => {
    setMounted(true);
    const cfg = loadConfig();
    setConfig(cfg);
    setForms(makeEmptyForms(cfg.tabs));
    if (cfg.tabs.length && !cfg.tabs.find(t => t.id === activeTab)) {
      setActiveTab(cfg.tabs[0].id);
    }
  }, []);

  // activeTab 失效时自动回退到第一个 Tab
  useEffect(() => {
    if (config.tabs.length && !config.tabs.find(t => t.id === activeTab)) {
      setActiveTab(config.tabs[0].id);
    }
  }, [config.tabs, activeTab]);

  const showToast = useCallback((type: "success" | "error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // 人才明细自动统计
  const talentStats = useMemo(() => {
    const stats: Record<string, number> = {};
    TALENT_LEVELS.forEach(l => { stats[l.key] = 0; });
    talents.forEach(t => {
      if (t.category) stats[t.category] = (stats[t.category] ?? 0) + 1;
    });
    return stats;
  }, [talents]);

  // 拉取 (period, tab) 对应的数据
  const fetchData = useCallback(async (p: string, tab: string) => {
    if (!p || !tab) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/agreement/data?period=${encodeURIComponent(p)}&category=${tab}`);
      if (!res.ok) throw new Error("获取数据失败");
      const rows = (await res.json()) as Array<{ payload: Record<string, unknown> }>;
      const payload = (rows[0]?.payload ?? {}) as Record<string, unknown>;

      const fields = config.fields[tab] ?? [];
      const strFields: Record<string, string> = {};
      fields.forEach(f => {
        strFields[f.key] = payload[f.key] != null ? String(payload[f.key]) : "";
      });

      // HR：把人才统计数字自动覆盖为明细计算值
      if (tab === "hr") {
        TALENT_LEVELS.forEach(l => {
          const key = `talent_${l.key}`;
          strFields[key] = String(talentStats[l.key] ?? 0);
        });
      }

      setForms(prev => ({ ...prev, [tab]: strFields }));

      if (tab === "hr") {
        const raw = payload.talents;
        setTalents((Array.isArray(raw) ? raw : []) as TalentItem[]);
      }

      if (tab === "ip") {
        const raw = payload.attachments;
        if (raw && typeof raw === "object") {
          setIpAttachments({
            acceptance: Array.isArray((raw as Record<string, unknown>).acceptance)
              ? ((raw as Record<string, unknown>).acceptance as IPAttachment[])
              : [],
            authorization: Array.isArray((raw as Record<string, unknown>).authorization)
              ? ((raw as Record<string, unknown>).authorization as IPAttachment[])
              : [],
          });
        } else {
          setIpAttachments({ acceptance: [], authorization: [] });
        }
      }
    } catch {
      // 静默失败，表单保持空白
    } finally {
      setLoading(false);
    }
  }, [config.fields]);

  // period 或 activeTab 变化时重新拉取
  useEffect(() => {
    if (mounted) fetchData(period, activeTab);
  }, [period, activeTab, fetchData, mounted]);

  // 切换月份时清空所有表单
  const handlePeriodChange = useCallback((newPeriod: string) => {
    setPeriod(newPeriod);
    setForms(makeEmptyForms(config.tabs));
    setTalents([]);
    setIpAttachments({ acceptance: [], authorization: [] });
  }, [config.tabs]);

  // 更新表单字段
  const setField = useCallback((tab: string, key: string, value: string) => {
    setForms(prev => ({ ...prev, [tab]: { ...prev[tab], [key]: value } }));
  }, []);

  // 保存当前 Tab 数据
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};

      // HR 保存前先把人才统计数字写回表单
      if (activeTab === "hr") {
        TALENT_LEVELS.forEach(l => {
          payload[`talent_${l.key}`] = talentStats[l.key] ?? 0;
        });
      }

      (config.fields[activeTab] ?? []).forEach(f => {
        if (activeTab === "hr" && f.key.startsWith("talent_")) return; // 已自动写入
        const v = forms[activeTab]?.[f.key];
        payload[f.key] = v !== "" && v != null ? parseFloat(v) : null;
      });

      if (activeTab === "hr") {
        payload.talents = talents;
      }

      if (activeTab === "ip") {
        payload.attachments = ipAttachments;
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

      const tabLabel = config.tabs.find(t => t.id === activeTab)?.label ?? activeTab;
      const [y, m] = period.split("-");
      showToast("success", `${y}年${parseInt(m)}月「${tabLabel}」数据已保存`);
    } catch (e) {
      showToast("error", (e as Error).message || "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }, [activeTab, config, forms, talents, talentStats, ipAttachments, period, showToast]);

  // ── 人才列表操作 ────────────────────────────────────────────────

  const addTalent = useCallback(() => {
    setTalents(prev => [...prev, { id: uid(), name: "", category: "", note: "" }]);
  }, []);

  const updateTalent = useCallback((id: string, field: keyof TalentItem, value: string) => {
    setTalents(prev => prev.map(t => (t.id === id ? { ...t, [field]: value } : t)));
  }, []);

  const removeTalent = useCallback((id: string) => {
    setTalents(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── IP 附件上传 ─────────────────────────────────────────────────

  const uploadIPFile = async (file: File, bucket: "acceptance" | "authorization") => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("name", file.name);
    formData.append("category", bucket === "acceptance" ? "ip_acceptance" : "ip_authorization");

    const res = await fetch("/api/agreement/upload", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? "上传失败");
    }
    const data = await res.json() as IPAttachment;
    return data;
  };

  const handleIPUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
    bucket: "acceptance" | "authorization"
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const uploaded = await Promise.all(
        Array.from(files).map(file => uploadIPFile(file, bucket))
      );
      setIpAttachments(prev => ({ ...prev, [bucket]: [...prev[bucket], ...uploaded] }));
      showToast("success", "附件上传成功");
    } catch (err) {
      showToast("error", (err as Error).message || "附件上传失败");
    }
    e.target.value = "";
  };

  const removeIPAttachment = (bucket: "acceptance" | "authorization", id: string) => {
    setIpAttachments(prev => ({ ...prev, [bucket]: prev[bucket].filter(a => a.id !== id) }));
  };

  // ── 配置面板操作 ────────────────────────────────────────────────

  const openConfig = useCallback(() => {
    setDraftConfig(config);
    setConfigOpen(true);
  }, [config]);

  const applyConfig = useCallback((next: PageConfig) => {
    persistConfig(next);
    setConfig(next);
    setForms(prev => {
      const base = makeEmptyForms(next.tabs);
      next.tabs.forEach(t => {
        (next.fields[t.id] ?? []).forEach(f => {
          base[t.id][f.key] = prev[t.id]?.[f.key] ?? "";
        });
      });
      return base;
    });
    if (!next.tabs.find(t => t.id === activeTab)) {
      setActiveTab(next.tabs[0]?.id ?? "");
    }
    setConfigOpen(false);
    showToast("success", "页面配置已保存");
  }, [activeTab, showToast]);

  // ── 辅助变量 ────────────────────────────────────────────────────

  const activeTabInfo = config.tabs.find(t => t.id === activeTab);
  const activeFields = config.fields[activeTab] ?? [];
  const [y, m] = period.split("-");
  const periodLabel = period ? `${y}年${parseInt(m)}月` : "";

  // ── 渲染 ─────────────────────────────────────────────────────────

  if (!mounted) {
    return (
      <div className="p-6 flex items-center justify-center h-64 text-slate-400 text-sm">
        <Loader2 size={18} className="animate-spin mr-2" /> 初始化中…
      </div>
    );
  }

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

        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-medium text-slate-600">数据月份</span>
          <input
            type="month"
            value={period}
            onChange={e => handlePeriodChange(e.target.value)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-800 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
          />
          <button
            type="button"
            onClick={openConfig}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-50 hover:text-blue-600 transition-colors shadow-sm ml-2"
          >
            <Settings size={16} />
            页面配置
          </button>
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
        {config.tabs.map(tab => (
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
        ) : activeTabInfo ? (
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
              {activeFields.map(field => (
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
                      value={forms[activeTab]?.[field.key] ?? ""}
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

            {/* HR Tab：人才统计 + 明细 */}
            {activeTab === "hr" && (
              <div className="mt-8 pt-6 border-t border-slate-100 space-y-6">
                {/* 人才统计 */}
                <div>
                  <h3 className="text-sm font-bold text-slate-700 mb-3">人才分类统计</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                    {TALENT_LEVELS.map(level => (
                      <div
                        key={level.key}
                        className="flex flex-col items-center justify-center p-3 rounded-xl bg-slate-50 border border-slate-100"
                      >
                        <span className="text-xs text-slate-500">{level.label}</span>
                        <span className="text-xl font-bold text-blue-600">{talentStats[level.key] ?? 0}</span>
                        <span className="text-xs text-slate-400">人</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-400 mt-2">统计数字由下方明细自动计算，无需手动填写对应字段。</p>
                </div>

                {/* 人才明细 */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-700">人才明细</h3>
                      <p className="text-xs text-slate-400 mt-0.5">姓名、人才类别、备注</p>
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
                      暂无人才明细，点击「新增条目」添加
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {/* 表头 */}
                      <div className="grid grid-cols-[24px_1fr_1.5fr_1.5fr_36px] gap-2 px-3 text-xs font-semibold text-slate-400 uppercase tracking-wide">
                        <span>#</span>
                        <span>姓名</span>
                        <span>人才类别</span>
                        <span>备注</span>
                        <span />
                      </div>
                      {talents.map((t, i) => (
                        <div
                          key={t.id}
                          className="grid grid-cols-[24px_1fr_1.5fr_1.5fr_36px] gap-2 items-center p-3 rounded-xl bg-slate-50 border border-slate-100"
                        >
                          <span className="text-xs font-bold text-slate-400 text-center">{i + 1}</span>
                          <input
                            placeholder="姓名"
                            value={t.name}
                            onChange={e => updateTalent(t.id, "name", e.target.value)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
                          />
                          <select
                            value={t.category}
                            onChange={e => updateTalent(t.id, "category", e.target.value)}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
                          >
                            <option value="">请选择</option>
                            {TALENT_LEVELS.map(l => (
                              <option key={l.key} value={l.key}>{l.label}</option>
                            ))}
                          </select>
                          <input
                            placeholder="备注"
                            value={t.note}
                            onChange={e => updateTalent(t.id, "note", e.target.value)}
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
              </div>
            )}

            {/* IP Tab：附件上传 */}
            {activeTab === "ip" && (
              <div className="mt-8 pt-6 border-t border-slate-100 space-y-6">
                <IPAttachmentUploader
                  title="发明专利申请受理通知书"
                  description="上传本月新增发明专利的申请受理通知书"
                  files={ipAttachments.acceptance}
                  onUpload={e => handleIPUpload(e, "acceptance")}
                  onRemove={id => removeIPAttachment("acceptance", id)}
                />
                <IPAttachmentUploader
                  title="发明专利授权证书"
                  description="上传本月新增发明专利的授权证书"
                  files={ipAttachments.authorization}
                  onUpload={e => handleIPUpload(e, "authorization")}
                  onRemove={id => removeIPAttachment("authorization", id)}
                />
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
        ) : (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-400">
            <Database size={32} />
            <p className="text-sm">当前没有可录入的分类，请点击右上角「页面配置」添加</p>
          </div>
        )}
      </div>

      {/* 配置面板抽屉 */}
      {configOpen && (
        <ConfigPanel
          draft={draftConfig}
          onChange={setDraftConfig}
          onSave={applyConfig}
          onCancel={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}

// ── IP 附件上传组件 ───────────────────────────────────────────────

function IPAttachmentUploader({
  title,
  description,
  files,
  onUpload,
  onRemove,
}: {
  title: string;
  description: string;
  files: IPAttachment[];
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
        <p className="text-xs text-slate-400 mt-0.5">{description}</p>
      </div>

      <div
        onClick={() => inputRef.current?.click()}
        className="border-2 border-dashed border-slate-300 rounded-xl p-5 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
          onChange={onUpload}
          className="hidden"
        />
        <Upload size={24} className="mx-auto text-slate-400 mb-2" />
        <p className="text-sm text-slate-600">点击上传或拖拽文件到此处</p>
        <p className="text-xs text-slate-400 mt-1">支持 PDF / 图片 / Word，最大 50MB</p>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map(file => (
            <div
              key={file.id}
              className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100"
            >
              <FileIcon size={18} className="text-blue-500 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800 truncate">{file.name}</div>
                {file.size != null && (
                  <div className="text-xs text-slate-500">{formatFileSize(file.size)}</div>
                )}
              </div>
              <div className="flex items-center gap-1">
                {file.type === "image" && (
                  <button
                    type="button"
                    onClick={() => setPreview(file.url)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                    title="预览"
                  >
                    <Eye size={14} />
                  </button>
                )}
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                  title="打开"
                >
                  <FileIcon size={14} />
                </a>
                <button
                  type="button"
                  onClick={() => onRemove(file.id)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="删除"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setPreview(null)}
        >
          <div className="relative max-w-4xl max-h-full">
            <img src={preview} alt="预览" className="max-w-full max-h-full object-contain rounded-lg" />
            <button
              onClick={() => setPreview(null)}
              className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-lg hover:bg-slate-100"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 配置面板组件 ──────────────────────────────────────────────────

function ConfigPanel({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: PageConfig;
  onChange: (next: PageConfig) => void;
  onSave: (next: PageConfig) => void;
  onCancel: () => void;
}) {
  const [activeTabId, setActiveTabId] = useState<string>(draft.tabs[0]?.id ?? "");

  useEffect(() => {
    if (!draft.tabs.find(t => t.id === activeTabId)) {
      setActiveTabId(draft.tabs[0]?.id ?? "");
    }
  }, [draft.tabs, activeTabId]);

  const activeTab = draft.tabs.find(t => t.id === activeTabId);
  const activeFields = draft.fields[activeTabId] ?? [];

  const updateTab = (id: string, patch: Partial<TabDef>) => {
    onChange({
      ...draft,
      tabs: draft.tabs.map(t => (t.id === id ? { ...t, ...patch } : t)),
    });
  };

  const addTab = () => {
    const id = `tab_${uid().slice(0, 6)}`;
    const next: PageConfig = {
      ...draft,
      tabs: [...draft.tabs, { id, label: "新分类", icon: "📊" }],
      fields: { ...draft.fields, [id]: [] },
    };
    onChange(next);
    setActiveTabId(id);
  };

  const removeTab = (id: string) => {
    const nextTabs = draft.tabs.filter(t => t.id !== id);
    const nextFields = { ...draft.fields };
    delete nextFields[id];
    onChange({ ...draft, tabs: nextTabs, fields: nextFields });
  };

  const addField = () => {
    const key = `field_${uid().slice(0, 6)}`;
    onChange({
      ...draft,
      fields: {
        ...draft.fields,
        [activeTabId]: [...activeFields, { key, label: "", unit: "" }],
      },
    });
  };

  const updateField = (key: string, patch: Partial<FieldDef>) => {
    onChange({
      ...draft,
      fields: {
        ...draft.fields,
        [activeTabId]: activeFields.map(f => (f.key === key ? { ...f, ...patch } : f)),
      },
    });
  };

  const removeField = (key: string) => {
    onChange({
      ...draft,
      fields: {
        ...draft.fields,
        [activeTabId]: activeFields.filter(f => f.key !== key),
      },
    });
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= activeFields.length) return;
    const list = [...activeFields];
    [list[idx], list[target]] = [list[target], list[idx]];
    onChange({
      ...draft,
      fields: { ...draft.fields, [activeTabId]: list },
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩 */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* 抽屉 */}
      <div className="relative w-full max-w-xl h-full bg-white shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-800">页面配置</h2>
            <p className="text-xs text-slate-500 mt-0.5">增删 Tab、指标字段，保存后即时生效</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab 管理 */}
        <div className="px-5 py-4 border-b border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">分类 Tab</span>
            <button
              type="button"
              onClick={addTab}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-semibold hover:bg-blue-100 transition-colors"
            >
              <Plus size={13} /> 新增 Tab
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {draft.tabs.map(tab => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-all ${
                  activeTabId === tab.id
                    ? "bg-blue-50 border-blue-200 text-blue-700"
                    : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
                }`}
              >
                <span>{tab.icon}</span>
                <input
                  value={tab.label}
                  onClick={e => e.stopPropagation()}
                  onChange={e => updateTab(tab.id, { label: e.target.value })}
                  className="w-20 bg-transparent focus:outline-none focus:border-b focus:border-blue-400"
                />
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); removeTab(tab.id); }}
                  className="ml-1 p-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="删除该 Tab"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* 字段管理 */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {activeTab ? (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  「{activeTab.label}」指标字段
                </span>
                <button
                  type="button"
                  onClick={addField}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-semibold hover:bg-blue-100 transition-colors"
                >
                  <Plus size={13} /> 新增字段
                </button>
              </div>

              {activeFields.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 rounded-xl bg-slate-50 text-slate-400 text-sm border border-dashed border-slate-200">
                  该分类下暂无字段，点击「新增字段」添加
                </div>
              ) : (
                <div className="space-y-2">
                  {activeFields.map((field, idx) => (
                    <div
                      key={field.key}
                      className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100"
                    >
                      <GripVertical size={16} className="text-slate-300" />
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <input
                          value={field.label}
                          onChange={e => updateField(field.key, { label: e.target.value })}
                          placeholder="指标名称"
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
                        />
                        <input
                          value={field.unit}
                          onChange={e => updateField(field.key, { unit: e.target.value })}
                          placeholder="单位，如：万元、人、件"
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 w-full"
                        />
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveField(idx, -1)}
                          disabled={idx === 0}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 disabled:opacity-30 transition-colors"
                        >
                          <ChevronUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveField(idx, 1)}
                          disabled={idx === activeFields.length - 1}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 disabled:opacity-30 transition-colors"
                        >
                          <ChevronDown size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeField(field.key)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-700 leading-relaxed">
                <strong>提示：</strong>字段的「指标名称」会显示在录入页标签上；「单位」显示在输入框右侧。删除字段不会删除历史数据，但页面不再展示。
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 text-sm">
              请先添加或选择一个 Tab
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 bg-slate-50">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-100 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
          >
            保存配置
          </button>
        </div>
      </div>
    </div>
  );
}
