"use client";

import { useState, useEffect, useCallback } from "react";
import { Settings, ExternalLink, Plus, Trash2, X } from "lucide-react";

interface QuickLink { name: string; url: string }

interface PageConfig {
  title:       string;
  description: string;
  links:       QuickLink[];
}

interface PageHeaderWithConfigProps {
  pageId:             string;
  defaultTitle:       string;
  defaultDescription: string;
  /** 渐变背景色 CSS string，默认蓝紫渐变（仅 variant="dark" 时生效） */
  gradient?: string;
  /** 额外渲染在右侧的按钮区 */
  rightSlot?: React.ReactNode;
  /** 是否允许编辑（默认 true，DEPT_CONTACT 应传 false） */
  canEdit?: boolean;
  /** "dark"（默认）= 深色渐变背景白字；"light" = 白底深色字，齿轮图标内联于标题旁 */
  variant?: "dark" | "light";
  /** 可选：在页面配置弹窗中额外渲染"权限分配" Tab 的内容 */
  permissionsContent?: React.ReactNode;
}

// ── 配置弹窗 ────────────────────────────────────────────────────────

function PageConfigModal({
  config,
  pageId,
  onClose,
  onSaved,
  permissionsContent,
}: {
  config:              PageConfig;
  pageId:              string;
  onClose:             () => void;
  onSaved:             (cfg: PageConfig) => void;
  permissionsContent?: React.ReactNode;
}) {
  type Tab = "basics" | "links" | "permissions";
  const [activeTab, setActiveTab] = useState<Tab>("basics");
  const [draft,     setDraft]     = useState<PageConfig>(() => JSON.parse(JSON.stringify(config)) as PageConfig);
  const [saving,    setSaving]    = useState(false);
  const [errMsg,    setErrMsg]    = useState("");

  function setMeta(k: "title" | "description", v: string) {
    setDraft(d => ({ ...d, [k]: v }));
  }
  function setLink(idx: number, k: keyof QuickLink, v: string) {
    setDraft(d => {
      const links = [...d.links];
      links[idx] = { ...links[idx], [k]: v };
      return { ...d, links };
    });
  }
  function addLink()             { setDraft(d => ({ ...d, links: [...d.links, { name: "", url: "" }] })); }
  function removeLink(idx: number) { setDraft(d => ({ ...d, links: d.links.filter((_, i) => i !== idx) })); }

  async function handleSave() {
    setSaving(true); setErrMsg("");
    try {
      const payload: PageConfig = { ...draft, links: draft.links.filter(l => l.name.trim() || l.url.trim()) };
      const res = await fetch(`/api/page-config?pageId=${encodeURIComponent(pageId)}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "保存失败");
      onSaved(payload);
      onClose();
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col" style={{ width: "min(560px,95vw)", maxHeight: "80vh" }}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h3 className="text-base font-bold text-slate-900">页面配置</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={16} style={{ color: "#64748b" }} /></button>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-0 px-6 pt-3" style={{ borderBottom: "1px solid #f1f5f9" }}>
          {([
            { key: "basics" as Tab,      label: "基础设置" },
            { key: "links"  as Tab,      label: "快捷链接" },
            ...(permissionsContent ? [{ key: "permissions" as Tab, label: "权限分配" }] : []),
          ]).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className="px-4 py-2.5 text-sm font-medium relative"
              style={{ color: activeTab === tab.key ? "#2563eb" : "#64748b" }}
            >
              {tab.label}
              {activeTab === tab.key && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: "#2563eb" }} />
              )}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {activeTab === "basics" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">页面名称</label>
                <input value={draft.title} onChange={e => setMeta("title", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  style={{ border: "1px solid #e2e8f0" }} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">标语 / 备注</label>
                <input value={draft.description} onChange={e => setMeta("description", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  style={{ border: "1px solid #e2e8f0" }} />
              </div>
            </>
          )}
          {activeTab === "links" && (
            <div className="space-y-3">
              {draft.links.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={link.name} onChange={e => setLink(i, "name", e.target.value)}
                    placeholder="链接名称" className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ border: "1px solid #e2e8f0" }} />
                  <input value={link.url} onChange={e => setLink(i, "url", e.target.value)}
                    placeholder="https://..." className="flex-[2] px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ border: "1px solid #e2e8f0" }} />
                  <button onClick={() => removeLink(i)} className="p-1.5 rounded-lg hover:bg-red-50"><Trash2 size={14} style={{ color: "#ef4444" }} /></button>
                </div>
              ))}
              <button onClick={addLink} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-blue-600 hover:bg-blue-50 transition-colors">
                <Plus size={14} />添加快捷链接
              </button>
            </div>
          )}
          {activeTab === "permissions" && permissionsContent && (
            permissionsContent
          )}
        </div>

        {/* 操作栏 */}
        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: "1px solid #f1f5f9" }}>
          {activeTab === "permissions" ? (
            <>
              <p className="text-xs text-slate-400">所有权限变更实时生效</p>
              <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">关闭</button>
            </>
          ) : (
            <>
              {errMsg && <p className="text-xs text-red-500">{errMsg}</p>}
              {!errMsg && <span />}
              <div className="flex gap-2">
                <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">取消</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)" }}>
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ──────────────────────────────────────────────────────────

export default function PageHeaderWithConfig({
  pageId,
  defaultTitle,
  defaultDescription,
  gradient = "linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #312e81 100%)",
  rightSlot,
  canEdit = true,
  variant = "dark",
  permissionsContent,
}: PageHeaderWithConfigProps) {
  const [config,     setConfig]     = useState<PageConfig>({ title: defaultTitle, description: defaultDescription, links: [] });
  const [showModal,  setShowModal]  = useState(false);
  const [loaded,     setLoaded]     = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`/api/page-config?pageId=${encodeURIComponent(pageId)}`);
      if (res.ok) {
        const d = await res.json() as PageConfig;
        setConfig({ title: d.title || defaultTitle, description: d.description ?? defaultDescription, links: d.links ?? [] });
      }
    } catch { /* silent */ }
    finally { setLoaded(true); }
  }, [pageId, defaultTitle, defaultDescription]);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const isLight = variant === "light";
  const visibleLinks = config.links.filter(l => l.url);

  // ── Light variant ──────────────────────────────────────────────
  if (isLight) {
    return (
      <>
        <div
          className="px-8 pt-6 pb-5 flex-shrink-0"
          style={{ background: "white", borderBottom: "1px solid #f1f5f9" }}
        >
          <div className="flex items-center justify-between gap-4">
            {/* 左侧：标题 + 副标题 + 齿轮 */}
            <div className={`transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{config.title}</h1>
                {canEdit && (
                  <button
                    onClick={() => setShowModal(true)}
                    className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-slate-100 transition-colors"
                    title="配置页面标题与链接"
                  >
                    <Settings size={14} style={{ color: "#94a3b8" }} />
                  </button>
                )}
              </div>
              <p className="text-sm mt-0.5 text-gray-500">{config.description}</p>
              {/* 快捷链接（有则显示） */}
              {visibleLinks.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap mt-2.5">
                  {visibleLinks.map((link, i) => (
                    <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors"
                      style={{ color: "#475569", border: "1px solid #e2e8f0", background: "#f8fafc" }}
                    >
                      <ExternalLink size={10} />{link.name}
                    </a>
                  ))}
                </div>
              )}
            </div>

            {/* 右侧：业务按钮 */}
            {rightSlot && (
              <div className="flex-shrink-0 flex items-center">
                {rightSlot}
              </div>
            )}
          </div>
        </div>

        {showModal && (
          <PageConfigModal
            config={config}
            pageId={pageId}
            onClose={() => setShowModal(false)}
            onSaved={(saved) => setConfig(saved)}
            permissionsContent={permissionsContent}
          />
        )}
      </>
    );
  }

  // ── Dark variant (原有样式，保持不变) ─────────────────────────
  return (
    <>
      <div className="px-8 pt-7 pb-5 flex-shrink-0" style={{ background: gradient }}>
        {/* 标题行 */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className={`transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}>
            <h1 className="text-2xl font-bold text-white tracking-tight">{config.title}</h1>
            <p className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>{config.description}</p>
          </div>
          {rightSlot && <div className="flex-shrink-0">{rightSlot}</div>}
        </div>

        {/* 快捷链接行 */}
        <div className="flex items-center gap-2 flex-wrap">
          {visibleLinks.map((link, i) => (
            <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all font-medium backdrop-blur-sm whitespace-nowrap text-xs"
              style={{ color: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.08)" }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
            >
              <ExternalLink size={10} />
              {link.name}
            </a>
          ))}
          {canEdit && (
            <button onClick={() => setShowModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all whitespace-nowrap text-xs backdrop-blur-sm"
              style={{ color: "rgba(255,255,255,0.35)", border: "1px dashed rgba(255,255,255,0.2)", background: "transparent" }}
              onMouseEnter={e => { e.currentTarget.style.color = "rgba(255,255,255,0.7)"; }}
              onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.35)"; }}
            >
              <Settings size={10} /> 配置链接
            </button>
          )}
        </div>
      </div>

      {showModal && (
        <PageConfigModal
          config={config}
          pageId={pageId}
          onClose={() => setShowModal(false)}
          onSaved={(saved) => setConfig(saved)}
        />
      )}
    </>
  );
}
