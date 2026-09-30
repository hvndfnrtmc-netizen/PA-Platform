"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Upload, FileText, CheckCircle2, Clock, AlertCircle,
  Download, Trash2, Zap, FileEdit, RefreshCw, X, HelpCircle,
} from "lucide-react";

// ── 类型 ──────────────────────────────────────────────────────────

type DocRecord = {
  id: string;
  title: string;
  templateFile: string;
  outputFile: string | null;
  renderStatus: string;
  renderError: string | null;
  placeholderMap: Record<string, { value: string; metricName: string; sourceFeishuUrl: string | null } | null> | null;
  createdAt: string;
  createdBy: { name: string };
};

type PlaceholderStatus = {
  key: string;
  found: boolean;
  value?: string;
  metricName?: string;
};

// ── 常量 ──────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; Icon: typeof CheckCircle2 }> = {
  DONE:      { label: "已完成",  color: "#22c55e", bg: "rgba(34,197,94,0.1)",   Icon: CheckCircle2 },
  RENDERING: { label: "渲染中",  color: "#3b82f6", bg: "rgba(59,130,246,0.1)",  Icon: RefreshCw    },
  PENDING:   { label: "待渲染",  color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  Icon: Clock        },
  FAILED:    { label: "渲染失败", color: "#ef4444", bg: "rgba(239,68,68,0.1)",   Icon: AlertCircle  },
};

// ── 主页面 ────────────────────────────────────────────────────────

export default function DocumentsPage() {
  const [tab, setTab] = useState<"form" | "template">("form");
  const [docs, setDocs] = useState<DocRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchDocs = useCallback(async () => {
    const res = await fetch("/api/documents");
    if (res.ok) {
      const data = await res.json();
      setDocs(data.documents ?? []);
    }
  }, []);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这条记录及其文件吗？")) return;
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    fetchDocs();
  };

  const handleDownload = (id: string) => {
    window.open(`/api/documents/${id}/download`, "_blank");
  };

  return (
    <div className="flex-1 overflow-auto bg-slate-50 animate-fade-in">
      {/* 顶栏 */}
      <div className="px-8 pt-8 pb-0">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">公文一键生成器</h1>
        <p className="text-sm text-slate-500 mt-0.5 mb-4">
          表单填写或上传模板，自动套用政府公文规范格式，一键生成可下载的 .docx 文件
        </p>

        {/* Tab 切换 */}
        <div className="flex gap-1 p-1 rounded-xl w-fit mb-6" style={{ background: "#f1f5f9" }}>
          {(["form", "template"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all"
              style={
                tab === t
                  ? { background: "white", color: "#1e293b", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                  : { color: "#64748b" }
              }
            >
              {t === "form" ? <><FileEdit size={14} />新建公文</> : <><Upload size={14} />从模板渲染</>}
            </button>
          ))}
        </div>
      </div>

      <div className="px-8 pb-8 space-y-6">
        {tab === "form"
          ? <FormTab onDone={fetchDocs} />
          : <TemplateTab onDone={fetchDocs} />
        }

        {/* 生成记录 */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-700">生成记录</h2>
            <button
              onClick={fetchDocs}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              <RefreshCw size={12} /> 刷新
            </button>
          </div>

          {docs.length === 0 ? (
            <div
              className="bg-white rounded-2xl px-6 py-10 text-center shadow-sm"
              style={{ border: "1px solid #e2e8f0" }}
            >
              <FileText size={32} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm text-slate-400">暂无生成记录</p>
            </div>
          ) : (
            <div
              className="bg-white rounded-2xl overflow-hidden shadow-sm"
              style={{ border: "1px solid #e2e8f0" }}
            >
              {docs.map((doc, i) => {
                const st = STATUS_CFG[doc.renderStatus] ?? STATUS_CFG.PENDING;
                const Icon = st.Icon;
                const isTemplate = !doc.outputFile && doc.renderStatus === "PENDING";
                return (
                  <div
                    key={doc.id}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors group"
                    style={{ borderBottom: i < docs.length - 1 ? "1px solid #f1f5f9" : "none" }}
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ background: isTemplate ? "rgba(245,158,11,0.1)" : st.bg }}
                    >
                      <Icon size={18} style={{ color: isTemplate ? "#f59e0b" : st.color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{doc.title}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {isTemplate ? "模板（待渲染）" : doc.templateFile === "form-generated" ? "表单新建" : "模板渲染"}
                        {" · "}
                        {new Date(doc.createdAt).toLocaleDateString("zh-CN")}
                        {" · "}
                        {doc.createdBy?.name}
                      </p>
                      {doc.placeholderMap && (
                        <PlaceholderBadges map={doc.placeholderMap} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ background: isTemplate ? "rgba(245,158,11,0.1)" : st.bg, color: isTemplate ? "#f59e0b" : st.color }}
                      >
                        {isTemplate ? "待渲染" : st.label}
                      </span>
                      {doc.renderStatus === "DONE" && doc.outputFile && (
                        <button
                          onClick={() => handleDownload(doc.id)}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: "#f0fdf4", color: "#16a34a" }}
                        >
                          <Download size={12} /> 下载
                        </button>
                      )}
                      {loading ? null : (
                        <button
                          onClick={() => handleDelete(doc.id)}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          style={{ background: "#fef2f2", color: "#dc2626" }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 占位符溯源标签 ────────────────────────────────────────────────

function PlaceholderBadges({ map }: { map: Record<string, { value: string; metricName: string } | null> }) {
  const entries = Object.entries(map).slice(0, 4);
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {entries.map(([key, val]) => (
        <span
          key={key}
          className="text-xs px-1.5 py-0.5 rounded font-mono"
          style={
            val
              ? { background: "rgba(34,197,94,0.08)", color: "#15803d" }
              : { background: "rgba(239,68,68,0.08)", color: "#dc2626" }
          }
          title={val ? `${val.metricName}: ${val.value}` : "未在数据大盘中找到"}
        >
          {val ? "✓" : "✗"} {key}
        </span>
      ))}
      {Object.keys(map).length > 4 && (
        <span className="text-xs text-slate-400 px-1.5 py-0.5">
          +{Object.keys(map).length - 4} 个
        </span>
      )}
    </div>
  );
}

// ── Tab 1：表单新建 ───────────────────────────────────────────────

function FormTab({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    title: "", header: "", subtitle: "", salutation: "",
    body: "", signer: "", date: "",
  });
  const [placeholders, setPlaceholders] = useState<PlaceholderStatus[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // 实时解析正文中的占位符
  useEffect(() => {
    const keys = [...new Set([...(form.body.matchAll(/\{\{([^}]+)\}\}/g) ?? [])].map(m => m[1].trim()))];
    if (keys.length === 0) { setPlaceholders([]); return; }

    fetch(`/api/assets?take=50&q=`)
      .then(r => r.json())
      .then((data: { assets: { metricKey: string; metricName: string; value: string; unit: string | null }[] }) => {
        const map = new Map(data.assets?.map((a) => [a.metricKey, a]) ?? []);
        setPlaceholders(keys.map(k => {
          const a = map.get(k);
          return a
            ? { key: k, found: true,  value: a.unit ? `${a.value}${a.unit}` : a.value, metricName: a.metricName }
            : { key: k, found: false };
        }));
      })
      .catch(() => setPlaceholders(keys.map(k => ({ key: k, found: false }))));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.body]);

  const handleSubmit = async () => {
    setError("");
    if (!form.title.trim()) { setError("标题不能为空"); return; }
    if (!form.body.trim())  { setError("正文不能为空"); return; }

    setSubmitting(true);
    try {
      const res = await fetch("/api/documents/generate", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          title:      form.title,
          header:     form.header || undefined,
          subtitle:   form.subtitle || undefined,
          salutation: form.salutation || undefined,
          body:       form.body,
          signer:     form.signer || undefined,
          date:       form.date || undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "生成失败");
        return;
      }
      // 直接用 Blob 触发下载（避免 window.open 被弹窗拦截器阻断）
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${form.title}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onDone();
      setForm({ title: "", header: "", subtitle: "", salutation: "", body: "", signer: "", date: "" });
    } finally {
      setSubmitting(false);
    }
  };

  const field = (key: keyof typeof form, label: string, placeholder: string, required = false) => (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm rounded-lg border outline-none transition-colors focus:ring-2"
        style={{ borderColor: "#e2e8f0", background: "#fff" }}
      />
    </div>
  );

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
      <div className="flex items-center gap-2 mb-5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}
        >
          <FileEdit size={15} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">表单新建公文</p>
          <p className="text-xs text-slate-400">正文中可用 <code className="bg-slate-100 px-1 rounded">{"{{metric_key}}"}</code> 自动引用数据大盘</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          {field("title", "文件标题", "如：2025年Q1核心指标上报情况", true)}
        </div>
        <div className="col-span-2">
          {field("header", "公文抬头（红头）", "如：魔门塔(苏州)科技有限公司，留空则不显示红头")}
        </div>
        {field("subtitle", "副标题", "选填，如：征求意见稿")}
        {field("salutation", "称呼", "选填，如：苏州市人民政府：")}

        {/* 正文 */}
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">
            正文<span className="text-red-500 ml-0.5">*</span>
            <span className="font-normal text-slate-400 ml-2">以「一、」开头自动设黑体，「（一）」开头设楷体</span>
          </label>
          <textarea
            value={form.body}
            onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
            placeholder={"一、基本情况\n截至2025年一季度，公司持续推进研发创新与市场布局，各项核心指标稳步增长。\n\n（一）研发专利\n累计专利总数{{2025_Q1_total_patents}}件。\n\n二、财务情况\n本季度营收{{2025_Q1_total_revenue}}万元，同比持续增长。"}
            rows={10}
            className="w-full px-3 py-2 text-sm rounded-lg border outline-none resize-y transition-colors focus:ring-2 font-mono"
            style={{ borderColor: "#e2e8f0", background: "#fff", lineHeight: "1.6" }}
          />

          {/* 占位符状态提示 */}
          {placeholders.length > 0 && (
            <div className="mt-2 p-3 rounded-lg" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              <p className="text-xs font-semibold text-slate-500 mb-1.5">检测到的占位符</p>
              <div className="flex flex-wrap gap-1.5">
                {placeholders.map(p => (
                  <span
                    key={p.key}
                    className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                    style={
                      p.found
                        ? { background: "rgba(34,197,94,0.1)", color: "#15803d" }
                        : { background: "rgba(239,68,68,0.1)", color: "#dc2626" }
                    }
                    title={p.found ? `${p.metricName}: ${p.value}` : "数据大盘中未找到此指标键名"}
                  >
                    {p.found ? <CheckCircle2 size={10} /> : <X size={10} />}
                    <code>{p.key}</code>
                    {p.found && <span className="opacity-60">→ {p.value}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {field("signer", "落款署名", "如：公共事务部")}
        {field("date", "成文日期", `如：${new Date().getFullYear()}年${new Date().getMonth()+1}月${new Date().getDate()}日`)}
      </div>

      {error && (
        <div className="mt-4 px-4 py-2.5 rounded-lg text-sm" style={{ background: "#fef2f2", color: "#dc2626" }}>
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
        style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}
      >
        {submitting ? <><RefreshCw size={15} className="animate-spin" /> 生成中...</> : <><Zap size={15} /> 生成 Word 文档并下载</>}
      </button>
    </div>
  );
}

// ── Tab 2：模板上传+渲染 ──────────────────────────────────────────

function TemplateTab({ onDone }: { onDone: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<DocRecord | null>(null);
  const [detectedKeys, setDetectedKeys] = useState<string[]>([]);
  const [assetPreview, setAssetPreview] = useState<Record<string, { value: string; found: boolean }>>({});
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭帮助气泡
  useEffect(() => {
    if (!showHelp) return;
    const handler = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) {
        setShowHelp(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHelp]);

  const uploadFile = async (file: File) => {
    if (!file.name.endsWith(".docx")) {
      setError("仅支持 .docx 格式文件");
      return;
    }
    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", titleInput.trim() || file.name.replace(".docx", ""));
      const res = await fetch("/api/documents/upload", { method: "POST", body: form });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "上传失败"); return; }
      const data = await res.json();
      setUploadedDoc(data.document);
      setDetectedKeys(data.detectedPlaceholders ?? []);

      // 预览资产匹配情况
      if (data.detectedPlaceholders?.length) {
        const assetsRes = await fetch(`/api/assets?take=100`);
        if (assetsRes.ok) {
          const { assets } = await assetsRes.json();
          const map = new Map((assets as { metricKey: string; value: string; unit: string | null }[]).map(a => [a.metricKey, a]));
          const preview: Record<string, { value: string; found: boolean }> = {};
          for (const k of data.detectedPlaceholders) {
            const a = map.get(k);
            preview[k] = a
              ? { value: a.unit ? `${a.value}${a.unit}` : a.value, found: true }
              : { value: "", found: false };
          }
          setAssetPreview(preview);
        }
      }
      onDone();
    } finally {
      setUploading(false);
    }
  };

  const handleRender = async () => {
    if (!uploadedDoc) return;
    setError("");
    setRendering(true);
    try {
      const res = await fetch(`/api/documents/${uploadedDoc.id}/render`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "渲染失败");
        return;
      }
      // 直接用 Blob 触发下载（避免 window.open 被弹窗拦截器阻断）
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `${uploadedDoc.title}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      onDone();
      setUploadedDoc(null);
      setDetectedKeys([]);
      setAssetPreview({});
      setTitleInput("");
    } finally {
      setRendering(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
      <div className="flex items-center gap-2 mb-5">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
        >
          <Upload size={15} className="text-white" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">从模板渲染</p>
          <p className="text-xs text-slate-400 flex items-center gap-1 flex-wrap">
            上传含 <code className="bg-slate-100 px-1 rounded">{"{{metric_key}}"}</code> 占位符的 Word 模板，系统自动填入数据大盘数值
            <span ref={helpRef} className="relative inline-flex items-center">
              <button
                onClick={() => setShowHelp(v => !v)}
                className="inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors"
                style={{ color: "#94a3b8", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#64748b")}
                onMouseLeave={e => (e.currentTarget.style.color = "#94a3b8")}
                aria-label="占位符使用说明"
              >
                <HelpCircle size={14} />
              </button>

              {showHelp && (
                <div
                  className="absolute z-50 rounded-2xl shadow-xl"
                  style={{
                    top: "calc(100% + 8px)",
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "360px",
                    background: "#fff",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
                  }}
                >
                  {/* 小三角 */}
                  <div
                    style={{
                      position: "absolute",
                      top: "-6px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: 12, height: 6,
                      overflow: "hidden",
                    }}
                  >
                    <div style={{
                      width: 10, height: 10,
                      background: "#fff",
                      border: "1px solid #e2e8f0",
                      transform: "rotate(45deg) translate(1px, 1px)",
                    }} />
                  </div>

                  <div className="p-4">
                    {/* 标题 */}
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-slate-800">占位符使用说明</p>
                      <button
                        onClick={() => setShowHelp(false)}
                        className="text-slate-400 hover:text-slate-600 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </div>

                    {/* 说明正文 */}
                    <p className="text-xs text-slate-600 leading-relaxed mb-3">
                      请在本地 Word 模板中，将需要自动替换的数据位置，替换为对应的英文变量名，并用双大括号包裹，格式为{" "}
                      <code className="bg-slate-100 px-1 py-0.5 rounded font-mono">{"{{变量名}}"}</code>。
                      系统在生成文档时，会自动将其替换为数据大盘中的最新真实数值。
                    </p>
                    <p className="text-xs font-medium text-amber-600 mb-3 flex items-center gap-1">
                      <span>⚠</span> 括号必须是英文半角符号
                    </p>

                    {/* 分隔线 */}
                    <div style={{ borderTop: "1px solid #f1f5f9", marginBottom: "12px" }} />

                    {/* 举例说明 */}
                    <p className="text-xs font-semibold text-slate-700 mb-2">举例说明（以企业财务状况为例）</p>
                    <p className="text-xs text-slate-500 mb-1.5">假设数据大盘中有以下指标：</p>
                    <div
                      className="rounded-lg px-3 py-2 mb-3 text-xs space-y-1"
                      style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">本月营业收入</span>
                        <span className="text-slate-300">·</span>
                        <code className="font-mono text-blue-600">revenue_month</code>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500">本月净利润</span>
                        <span className="text-slate-300">·</span>
                        <code className="font-mono text-blue-600">net_profit</code>
                      </div>
                    </div>

                    <p className="text-xs text-slate-500 mb-1.5">您在 Word 模板中应这样写：</p>
                    <div
                      className="rounded-lg px-3 py-2 mb-3 text-xs leading-relaxed"
                      style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af" }}
                    >
                      截止本月末，我公司本月实现营业收入{" "}
                      <code className="font-mono font-semibold">{"{{revenue_month}}"}</code>{" "}
                      万元，实现净利润{" "}
                      <code className="font-mono font-semibold">{"{{net_profit}}"}</code>{" "}
                      万元，财务状况良好。
                    </div>

                    <p className="text-xs text-slate-500 mb-1.5">系统渲染后生成的最终 Word 内容将变为：</p>
                    <div
                      className="rounded-lg px-3 py-2 text-xs leading-relaxed"
                      style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#15803d" }}
                    >
                      截止本月末，我公司本月实现营业收入{" "}
                      <strong>520.5</strong>{" "}
                      万元，实现净利润{" "}
                      <strong>68.2</strong>{" "}
                      万元，财务状况良好。
                    </div>
                  </div>
                </div>
              )}
            </span>
          </p>
        </div>
      </div>

      {!uploadedDoc ? (
        <>
          {/* 模板名称 */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">模板名称</label>
            <input
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              placeholder="留空则使用文件名"
              className="w-full px-3 py-2 text-sm rounded-lg border outline-none"
              style={{ borderColor: "#e2e8f0" }}
            />
          </div>

          {/* 拖拽上传区 */}
          <div
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className="rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-12 gap-3 cursor-pointer transition-colors"
            style={{ borderColor: dragging ? "#2563eb" : "#cbd5e1", background: dragging ? "#eff6ff" : "#fafafa" }}
          >
            {uploading
              ? <><RefreshCw size={24} className="text-blue-400 animate-spin" /><p className="text-sm text-slate-400">上传中...</p></>
              : <><Upload size={24} className="text-slate-400" /><p className="text-sm text-slate-500 font-medium">拖拽 .docx 模板到此处，或点击选择文件</p><p className="text-xs text-slate-400">模板中的 {"{{metric_key}}"} 将自动从数据大盘填入</p></>
            }
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".docx"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
          />
        </>
      ) : (
        <>
          {/* 占位符预览 */}
          <div className="rounded-xl p-4 mb-4" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-slate-700">
                <FileText size={14} className="inline mr-1.5 text-blue-500" />
                {uploadedDoc.title}
              </p>
              <button
                onClick={() => { setUploadedDoc(null); setDetectedKeys([]); setAssetPreview({}); }}
                className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
              >
                <X size={12} /> 重新上传
              </button>
            </div>

            {detectedKeys.length === 0 ? (
              <p className="text-xs text-slate-400">未检测到 {"{{...}}"} 占位符，将直接复制模板内容生成</p>
            ) : (
              <>
                <p className="text-xs text-slate-500 mb-2">
                  检测到 <span className="font-semibold text-slate-700">{detectedKeys.length}</span> 个占位符
                  （<span style={{ color: "#16a34a" }}>✓ {Object.values(assetPreview).filter(v => v.found).length} 匹配</span>
                  {" / "}
                  <span style={{ color: "#dc2626" }}>✗ {Object.values(assetPreview).filter(v => !v.found).length} 未找到</span>）
                </p>
                <div className="flex flex-col gap-1.5">
                  {detectedKeys.map(key => {
                    const p = assetPreview[key];
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs"
                        style={
                          p?.found
                            ? { background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.2)" }
                            : { background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)" }
                        }
                      >
                        <code className="font-mono" style={{ color: p?.found ? "#15803d" : "#dc2626" }}>
                          {"{{"}{key}{"}}"}
                        </code>
                        <span style={{ color: p?.found ? "#15803d" : "#9ca3af" }}>
                          {p?.found ? `→ ${p.value}` : "未在数据大盘中找到"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleRender}
            disabled={rendering}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95 disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)" }}
          >
            {rendering
              ? <><RefreshCw size={15} className="animate-spin" /> 渲染中...</>
              : <><Zap size={15} /> 一键渲染并下载</>}
          </button>
        </>
      )}

      {error && (
        <div className="mt-4 px-4 py-2.5 rounded-lg text-sm" style={{ background: "#fef2f2", color: "#dc2626" }}>
          {error}
        </div>
      )}
    </div>
  );
}
