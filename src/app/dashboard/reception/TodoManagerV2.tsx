"use client";

/**
 * TodoManagerV2 — 接待详情抽屉内的待办管理组件
 *
 * 功能：
 *   - 【从预设导入待办】Dialog：勾选 + 管理预设（新增/编辑/删除模板）
 *   - 待办列表：拖拽排序、行内编辑、子任务、Optimistic UI
 *   - 每条任务独立备注（remark）：只写实例表，绝不回写模板
 *   - 飞书 deeplink 支持
 *
 * DnD 架构（React 19 兼容）：
 *   一级：外层 DndContext + SortableContext，SortableParent 持有 useSortable
 *   二级：每个 SortableParent 内嵌独立 DndContext，SortableChildRow 持有 useSortable
 */

import React, { useState, useEffect, useCallback, useRef, useTransition } from "react";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical, Plus, Pencil, Trash2, X, Check, Link,
  ExternalLink, Link2, MessageSquare, CheckSquare, Square,
  Loader2, Eye, EyeOff, BookOpen, ChevronRight, StickyNote,
} from "lucide-react";
import { AdminSupportOrderModal, type AdminReceptionInfo } from "./AdminSupportOrderModal";

// ═══════════════════════════════════════════════════════════════════════════════
// 类型
// ═══════════════════════════════════════════════════════════════════════════════

export type TodoActionType = "URL" | "FEISHU_DOC" | "FEISHU_CHAT" | "NONE";

interface FeishuTarget { id: string; name: string; feishuId: string; type: string; }

export interface ReceptionTodo {
  id:          string;
  receptionId: string;
  templateId:  string | null;
  title:       string;
  remark:      string | null;
  isCompleted: boolean;
  actionType:  TodoActionType;
  actionValue: string | null;
  parentId:    string | null;
  order:       number;
  children?:   ReceptionTodo[];
}

interface TemplateChild {
  id:                 string;
  title:              string;
  defaultActionType:  TodoActionType;
  defaultActionValue: string | null;
}

interface Template {
  id:                 string;
  category:           string;
  title:              string;
  isActive:           boolean;
  defaultActionType:  TodoActionType;
  defaultActionValue: string | null;
  children:           TemplateChild[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// 工具
// ═══════════════════════════════════════════════════════════════════════════════

function actionHref(type: TodoActionType, value: string | null): string {
  if (!value) return "#";
  if (type === "FEISHU_CHAT")
    return `https://applink.feishu.cn/client/chat/open?openId=${encodeURIComponent(value)}`;
  return value;
}

const ACTION_ICON: Record<TodoActionType, React.ReactNode> = {
  URL:         <ExternalLink size={10} />,
  FEISHU_DOC:  <Link2 size={10} />,
  FEISHU_CHAT: <MessageSquare size={10} />,
  NONE:        null,
};

const ACTION_LABEL: Record<TodoActionType, string> = {
  URL: "网址", FEISHU_DOC: "飞书文档", FEISHU_CHAT: "飞书聊天", NONE: "无",
};

function applyPatch(list: ReceptionTodo[], id: string, patch: Partial<ReceptionTodo>): ReceptionTodo[] {
  return list.map(t => {
    if (t.id === id) return { ...t, ...patch };
    if (t.children?.length) return { ...t, children: applyPatch(t.children, id, patch) };
    return t;
  });
}

function removeNode(list: ReceptionTodo[], id: string): ReceptionTodo[] {
  return list
    .filter(t => t.id !== id)
    .map(t => t.children?.length ? { ...t, children: removeNode(t.children, id) } : t);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 链接配置浮层
// ═══════════════════════════════════════════════════════════════════════════════

function LinkPopover({ current, currentType, onSave, onClear, onClose }: {
  current?:     string | null;
  currentType?: TodoActionType;
  onSave:  (type: TodoActionType, value: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [type,   setType]   = useState<TodoActionType>(currentType ?? "URL");
  const [target, setTarget] = useState(current ?? "");
  const [feishuTargets, setFeishuTargets] = useState<FeishuTarget[]>([]);

  useEffect(() => {
    fetch("/api/admin/feishu-targets?module=reception")
      .then(r => r.json())
      .then((d: { targets?: FeishuTarget[] }) => setFeishuTargets(d.targets ?? []))
      .catch(() => {});
  }, []);

  const PH: Record<TodoActionType, string> = {
    URL: "https://...", FEISHU_DOC: "https://momenta.feishu.cn/...",
    FEISHU_CHAT: "飞书用户 openId（ou_xxxxxxxx）", NONE: "",
  };

  return (
    <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 9999, background: "white", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: 14, minWidth: 280, width: 300 }}
      onMouseDown={e => e.stopPropagation()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#1e293b" }}>配置跳转按钮</span>
        <button type="button" onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", color: "#94a3b8", display: "flex" }}><X size={13} /></button>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {(["URL", "FEISHU_DOC", "FEISHU_CHAT"] as TodoActionType[]).map(t => (
          <button key={t} type="button" onClick={() => { setType(t); setTarget(""); }}
            style={{ flex: 1, padding: "4px 2px", fontSize: 10, borderRadius: 6, cursor: "pointer", fontWeight: type === t ? 600 : 400, border: `1px solid ${type === t ? "#2563eb" : "#e2e8f0"}`, background: type === t ? "rgba(37,99,235,0.08)" : "white", color: type === t ? "#2563eb" : "#64748b" }}>
            {ACTION_LABEL[t]}
          </button>
        ))}
      </div>
      {type === "FEISHU_CHAT" ? (
        <select
          value={target}
          onChange={e => setTarget(e.target.value)}
          style={{ boxSizing: "border-box", width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", marginBottom: 10, background: "white", color: "#374151" }}>
          <option value="" disabled>
            {feishuTargets.length === 0 ? "暂无配置，请前往超级后台添加" : "请下拉选择要通知的人员或群聊…"}
          </option>
          {feishuTargets.filter(t => t.type === "GROUP").length > 0 && (
            <optgroup label="👥 群聊">
              {feishuTargets.filter(t => t.type === "GROUP").map(t => (
                <option key={t.feishuId} value={t.feishuId}>{t.name}</option>
              ))}
            </optgroup>
          )}
          {feishuTargets.filter(t => t.type === "USER").length > 0 && (
            <optgroup label="👤 个人">
              {feishuTargets.filter(t => t.type === "USER").map(t => (
                <option key={t.feishuId} value={t.feishuId}>{t.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      ) : (
        <input autoFocus value={target} onChange={e => setTarget(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && target.trim()) onSave(type, target.trim()); if (e.key === "Escape") onClose(); }}
          placeholder={PH[type]}
          style={{ boxSizing: "border-box", width: "100%", padding: "6px 10px", fontSize: 12, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none", marginBottom: 10 }} />
      )}
      <div style={{ display: "flex", gap: 6 }}>
        <button type="button" disabled={!target.trim()} onClick={() => target.trim() && onSave(type, target.trim())}
          style={{ flex: 1, padding: "5px 0", fontSize: 12, fontWeight: 600, color: "white", border: "none", borderRadius: 7, cursor: target.trim() ? "pointer" : "not-allowed", background: target.trim() ? "#2563eb" : "#93c5fd" }}>保存</button>
        {current && (
          <button type="button" onClick={onClear}
            style={{ padding: "5px 10px", fontSize: 12, color: "#ef4444", background: "white", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 7, cursor: "pointer" }}>清除</button>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 「从预设导入待办」Dialog（含模板管理：编辑/删除/新增）
// ═══════════════════════════════════════════════════════════════════════════════

function ImportDialog({ receptionId, importedTplIds, onDone, onClose }: {
  receptionId:    string;
  importedTplIds: Set<string>;
  onDone:         (todos: ReceptionTodo[]) => void;
  onClose:        () => void;
}) {
  const [templates,   setTemplates]   = useState<Template[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState<Set<string>>(new Set());
  const [working,     setWorking]     = useState(false);
  const [error,       setError]       = useState("");
  const [tplToast,    setTplToast]    = useState<{ ok: boolean; msg: string } | null>(null);
  // 编辑状态
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editTitle,   setEditTitle]   = useState("");
  const [editSaving,  setEditSaving]  = useState(false);
  // 链接配置状态
  const [linkEditId,    setLinkEditId]    = useState<string | null>(null);
  const [linkEditType,  setLinkEditType]  = useState<TodoActionType>("URL");
  const [linkEditValue, setLinkEditValue] = useState("");
  const [linkSaving,    setLinkSaving]    = useState(false);
  // 飞书通知目标（reception 模块）
  const [feishuTargets, setFeishuTargets] = useState<FeishuTarget[]>([]);
  useEffect(() => {
    fetch("/api/admin/feishu-targets?module=reception")
      .then(r => r.json())
      .then((d: { targets?: FeishuTarget[] }) => setFeishuTargets(d.targets ?? []))
      .catch(() => {});
  }, []);
  // 新增预设
  const [showAddRoot,     setShowAddRoot]     = useState(false);
  const [addRootTitle,    setAddRootTitle]    = useState("");
  const [showAddChild,    setShowAddChild]    = useState<string | null>(null); // parentId
  const [addChildTitle,   setAddChildTitle]   = useState("");
  const [addSaving,       setAddSaving]       = useState(false);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      // 只拉 isActive=true 的模板：软删后重开弹窗不会复活已删项
      const res  = await fetch("/api/reception/todo-templates?cache=" + Date.now());
      const data = await res.json() as { templates?: Template[] };
      setTemplates(data.templates ?? []);
    } catch { setError("加载模板失败"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);

  function toggle(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const available = templates.filter(t => t.isActive && !importedTplIds.has(t.id));
  const allSel    = available.length > 0 && available.every(t => selected.has(t.id));
  const someSel   = available.some(t => selected.has(t.id)) && !allSel;

  function toggleAll() { setSelected(allSel ? new Set() : new Set(available.map(t => t.id))); }

  // ── 删除模板（乐观更新：成功后直接从本地 state 过滤，无需重拉）
  async function handleDelete(tpl: Template) {
    if (!window.confirm(`删除预设「${tpl.title}」？\n\n此操作不影响已导入的历史记录，仅从预设库中移除，后续新接待将不再显示该选项。`)) return;
    const res = await fetch(`/api/reception/todo-templates/${tpl.id}`, { method: "DELETE" });
    if (res.ok) {
      setTemplates(prev => prev
        .filter(t => t.id !== tpl.id)
        .map(t => ({ ...t, children: t.children.filter(c => c.id !== tpl.id) }))
      );
      const sel = new Set(selected);
      sel.delete(tpl.id);
      setSelected(sel);
      setTplToast({ ok: true, msg: `预设「${tpl.title}」已删除` });
      setTimeout(() => setTplToast(null), 2500);
    } else {
      const d = await res.json() as { error?: string };
      setTplToast({ ok: false, msg: d.error ?? "删除失败，请重试" });
      setTimeout(() => setTplToast(null), 3000);
    }
  }

  // ── 保存编辑
  async function handleEditSave(id: string) {
    if (!editTitle.trim()) return;
    setEditSaving(true);
    const res = await fetch(`/api/reception/todo-templates/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: editTitle.trim() }),
    });
    setEditSaving(false);
    if (res.ok) { setEditingId(null); await loadTemplates(); }
    else { const d = await res.json() as { error?: string }; window.alert(d.error ?? "保存失败"); }
  }

  // ── 保存链接配置到模板
  function openLinkEdit(id: string, currentType: TodoActionType, currentValue: string | null) {
    setLinkEditId(id);
    setLinkEditType(currentType !== "NONE" ? currentType : "URL");
    setLinkEditValue(currentValue ?? "");
    setEditingId(null);
  }
  async function handleLinkSave(id: string) {
    if (!linkEditValue.trim()) return;
    setLinkSaving(true);
    const res = await fetch(`/api/reception/todo-templates/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultActionType: linkEditType, defaultActionValue: linkEditValue.trim() }),
    });
    setLinkSaving(false);
    if (res.ok) {
      setLinkEditId(null);
      await loadTemplates();
      setTplToast({ ok: true, msg: "跳转链接已保存" });
      setTimeout(() => setTplToast(null), 2000);
    } else {
      const d = await res.json() as { error?: string };
      window.alert(d.error ?? "保存失败");
    }
  }
  async function handleLinkClear(id: string) {
    setLinkSaving(true);
    const res = await fetch(`/api/reception/todo-templates/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaultActionType: "NONE", defaultActionValue: null }),
    });
    setLinkSaving(false);
    if (res.ok) {
      setLinkEditId(null);
      await loadTemplates();
      setTplToast({ ok: true, msg: "跳转链接已清除" });
      setTimeout(() => setTplToast(null), 2000);
    }
  }

  // ── 新增大类
  async function handleAddRoot() {
    if (!addRootTitle.trim()) return;
    setAddSaving(true);
    const res = await fetch("/api/reception/todo-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: addRootTitle.trim(), category: addRootTitle.trim() }),
    });
    setAddSaving(false);
    if (res.ok) { setShowAddRoot(false); setAddRootTitle(""); await loadTemplates(); }
    else { const d = await res.json() as { error?: string }; window.alert(d.error ?? "新增失败"); }
  }

  // ── 新增子任务
  async function handleAddChild(parentId: string, parentCategory: string) {
    if (!addChildTitle.trim()) return;
    setAddSaving(true);
    const res = await fetch("/api/reception/todo-templates", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: addChildTitle.trim(), category: parentCategory, parentId }),
    });
    setAddSaving(false);
    if (res.ok) { setShowAddChild(null); setAddChildTitle(""); await loadTemplates(); }
    else { const d = await res.json() as { error?: string }; window.alert(d.error ?? "新增失败"); }
  }

  // ── 批量导入
  async function handleImport() {
    if (selected.size === 0) return;
    setWorking(true); setError("");
    try {
      const res  = await fetch(`/api/reception/${receptionId}/todos`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateIds: [...selected] }),
      });
      const data = await res.json() as { todos?: ReceptionTodo[]; error?: string };
      if (!res.ok) { setError(data.error ?? "导入失败"); return; }
      onDone(data.todos ?? []);
      onClose();
    } finally { setWorking(false); }
  }

  const iStyle: React.CSSProperties = { boxSizing: "border-box", width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #2563eb", borderRadius: 6, outline: "none" };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 580, maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 56px rgba(0,0,0,0.22)" }}>

        {/* 标题栏 */}
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#2563eb,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <BookOpen size={18} style={{ color: "white" }} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: 0 }}>从预设导入待办</h3>
            <p style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 0" }}>勾选导入 · 也可在此管理预设库（增删改不影响历史记录）</p>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8", padding: 4, display: "flex" }}><X size={18} /></button>
        </div>

        {/* 全选栏 */}
        {!loading && templates.length > 0 && (
          <div onClick={toggleAll} style={{ padding: "8px 22px", borderBottom: "1px solid #f8fafc", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", background: "#fafafa" }}>
            <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: allSel || someSel ? "none" : "1.5px solid #cbd5e1", background: allSel ? "#2563eb" : someSel ? "#93c5fd" : "transparent" }}>
              {(allSel || someSel) && <Check size={10} style={{ color: "white" }} />}
            </div>
            <span style={{ fontSize: 12, color: "#64748b" }}>全选 / 取消全选</span>
            <span style={{ fontSize: 12, color: "#2563eb", fontWeight: 600, marginLeft: "auto" }}>已选 {selected.size} 个</span>
          </div>
        )}

        {/* 模板列表 */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><Loader2 size={20} className="animate-spin" style={{ color: "#2563eb" }} /></div>
          ) : error ? (
            <div style={{ padding: 24, color: "#ef4444", fontSize: 13, textAlign: "center" }}>{error}</div>
          ) : (
            <>
              {templates.map(tpl => {
                const imported = importedTplIds.has(tpl.id);
                const inactive = !tpl.isActive;
                const sel      = selected.has(tpl.id);
                const isEditingThis = editingId === tpl.id;
                return (
                  <div key={tpl.id} style={{ borderBottom: "1px solid #f8fafc", opacity: inactive ? 0.45 : 1 }}>
                    {/* 大类行 */}
                    <div
                      onClick={() => !imported && !inactive && !isEditingThis && toggle(tpl.id)}
                      style={{ padding: "10px 22px", cursor: imported || inactive || isEditingThis ? "default" : "pointer", background: sel ? "rgba(37,99,235,0.04)" : undefined, display: "flex", alignItems: "center", gap: 10 }}
                      onMouseEnter={e => { const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-tpl-icons]"); if (ic) ic.style.opacity = "1"; }}
                      onMouseLeave={e => { const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-tpl-icons]"); if (ic) ic.style.opacity = "0"; }}
                    >
                      {/* checkbox */}
                      <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: sel || imported ? "none" : "1.5px solid #cbd5e1", background: sel ? "#2563eb" : imported ? "#94a3b8" : "transparent" }}
                        onClick={e => { e.stopPropagation(); if (!imported && !inactive) toggle(tpl.id); }}>
                        {(sel || imported) && <Check size={10} style={{ color: "white" }} />}
                      </div>

                      {/* 标题（可编辑） */}
                      {isEditingThis ? (
                        <input autoFocus value={editTitle} onChange={e => setEditTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") void handleEditSave(tpl.id); if (e.key === "Escape") setEditingId(null); }}
                          onClick={e => e.stopPropagation()}
                          style={{ ...iStyle, flex: 1 }} />
                      ) : (
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: inactive ? "#94a3b8" : "#1e293b" }}>
                          {tpl.title}
                          {inactive && <span style={{ marginLeft: 6, fontSize: 10, color: "#94a3b8", background: "#f1f5f9", padding: "1px 5px", borderRadius: 4 }}>已停用</span>}
                        </span>
                      )}

                      {imported && <span style={{ fontSize: 11, color: "#94a3b8", background: "#f1f5f9", padding: "2px 7px", borderRadius: 5, flexShrink: 0 }}>已导入</span>}

                      {/* 管理操作图标（hover 显示） */}
                      <div data-tpl-icons="" style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, opacity: 0, transition: "opacity 0.12s" }} onClick={e => e.stopPropagation()}>
                        {isEditingThis ? (
                          <>
                            <button type="button" disabled={editSaving} onClick={() => void handleEditSave(tpl.id)}
                              style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 4px", color: "#2563eb", display: "flex" }}>
                              {editSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                            </button>
                            <button type="button" onClick={() => setEditingId(null)}
                              style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 4px", color: "#94a3b8", display: "flex" }}><X size={12} /></button>
                          </>
                        ) : (
                          <>
                            <button type="button" title="添加子任务" onClick={() => { setShowAddChild(tpl.id); setAddChildTitle(""); setShowAddRoot(false); setLinkEditId(null); }}
                              style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 4px", color: "#22c55e", display: "flex" }}><Plus size={12} /></button>
                            <button type="button" title="重命名" onClick={() => { setEditingId(tpl.id); setEditTitle(tpl.title); setShowAddChild(null); setLinkEditId(null); }}
                              style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 4px", color: "#64748b", display: "flex" }}><Pencil size={12} /></button>
                            <button type="button" title="配置跳转链接" onClick={() => openLinkEdit(tpl.id, tpl.defaultActionType, tpl.defaultActionValue)}
                              style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 4px", display: "flex", color: (tpl.defaultActionType !== "NONE" && tpl.defaultActionValue) ? "#2563eb" : "#94a3b8" }}><Link size={12} /></button>
                            {tpl.isActive && (
                              <button type="button" title="停用此预设" onClick={() => void handleDelete(tpl)}
                                style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 4px", color: "#ef4444", display: "flex" }}><Trash2 size={12} /></button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* 父模板链接内联编辑器 */}
                    {linkEditId === tpl.id && (
                      <div style={{ paddingLeft: 48, paddingRight: 22, paddingBottom: 10 }} onClick={e => e.stopPropagation()}>
                        <div style={{ background: "#f8fafc", borderRadius: 8, padding: "10px 12px", border: "1px solid #e2e8f0" }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#475569", marginBottom: 6 }}>配置跳转链接</div>
                          <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                            {(["URL", "FEISHU_DOC", "FEISHU_CHAT"] as TodoActionType[]).map(t => (
                              <button key={t} type="button" onClick={() => { setLinkEditType(t); setLinkEditValue(""); }}
                                style={{ flex: 1, padding: "3px 2px", fontSize: 10, borderRadius: 5, cursor: "pointer", fontWeight: linkEditType === t ? 600 : 400, border: `1px solid ${linkEditType === t ? "#2563eb" : "#e2e8f0"}`, background: linkEditType === t ? "rgba(37,99,235,0.08)" : "white", color: linkEditType === t ? "#2563eb" : "#64748b" }}>
                                {ACTION_LABEL[t]}
                              </button>
                            ))}
                          </div>
                          {linkEditType === "FEISHU_CHAT" ? (
                            <select
                              value={linkEditValue}
                              onChange={e => setLinkEditValue(e.target.value)}
                              style={{ boxSizing: "border-box", width: "100%", padding: "5px 8px", fontSize: 11, border: "1px solid #e2e8f0", borderRadius: 6, outline: "none", marginBottom: 8, background: "white", color: "#374151" }}>
                              <option value="" disabled>
                                {feishuTargets.length === 0 ? "暂无配置，请前往超级后台添加" : "请下拉选择要通知的人员或群聊…"}
                              </option>
                              {feishuTargets.filter(t => t.type === "GROUP").length > 0 && (
                                <optgroup label="👥 群聊">
                                  {feishuTargets.filter(t => t.type === "GROUP").map(t => (
                                    <option key={t.feishuId} value={t.feishuId}>{t.name}</option>
                                  ))}
                                </optgroup>
                              )}
                              {feishuTargets.filter(t => t.type === "USER").length > 0 && (
                                <optgroup label="👤 个人">
                                  {feishuTargets.filter(t => t.type === "USER").map(t => (
                                    <option key={t.feishuId} value={t.feishuId}>{t.name}</option>
                                  ))}
                                </optgroup>
                              )}
                            </select>
                          ) : (
                            <input autoFocus value={linkEditValue} onChange={e => setLinkEditValue(e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter" && linkEditValue.trim()) void handleLinkSave(tpl.id); if (e.key === "Escape") setLinkEditId(null); }}
                              placeholder={linkEditType === "FEISHU_DOC" ? "https://momenta.feishu.cn/..." : "https://..."}
                              style={{ boxSizing: "border-box", width: "100%", padding: "5px 8px", fontSize: 11, border: "1px solid #e2e8f0", borderRadius: 6, outline: "none", marginBottom: 8 }} />
                          )}
                          <div style={{ display: "flex", gap: 6 }}>
                            <button type="button" disabled={linkSaving || !linkEditValue.trim()} onClick={() => void handleLinkSave(tpl.id)}
                              style={{ flex: 1, padding: "4px 0", fontSize: 11, fontWeight: 600, color: "white", border: "none", borderRadius: 5, cursor: linkEditValue.trim() && !linkSaving ? "pointer" : "not-allowed", background: linkEditValue.trim() ? "#2563eb" : "#93c5fd" }}>
                              {linkSaving ? <Loader2 size={10} className="animate-spin" style={{ display: "inline" }} /> : "保存"}
                            </button>
                            {tpl.defaultActionType !== "NONE" && tpl.defaultActionValue && (
                              <button type="button" onClick={() => void handleLinkClear(tpl.id)}
                                style={{ padding: "4px 10px", fontSize: 11, color: "#ef4444", background: "white", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, cursor: "pointer" }}>清除</button>
                            )}
                            <button type="button" onClick={() => setLinkEditId(null)}
                              style={{ padding: "4px 10px", fontSize: 11, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 5, cursor: "pointer" }}>取消</button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 子任务预览 + 管理 */}
                    {tpl.children.length > 0 && (
                      <div style={{ paddingLeft: 48, paddingBottom: 8, paddingRight: 22 }}>
                        {tpl.children.map(c => {
                          const isEditingChild = editingId === c.id;
                          const isLinkEditChild = linkEditId === c.id;
                          return (
                            <div key={c.id}>
                            <div
                              style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}
                              onMouseEnter={e => { const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-child-icons]"); if (ic) ic.style.opacity = "1"; }}
                              onMouseLeave={e => { const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-child-icons]"); if (ic) ic.style.opacity = "0"; }}
                            >
                              <ChevronRight size={10} style={{ color: "#cbd5e1", flexShrink: 0 }} />
                              {isEditingChild ? (
                                <input autoFocus value={editTitle} onChange={e => setEditTitle(e.target.value)}
                                  onKeyDown={e => { if (e.key === "Enter") void handleEditSave(c.id); if (e.key === "Escape") setEditingId(null); }}
                                  style={{ ...iStyle, flex: 1 }} />
                              ) : (
                                <span style={{ flex: 1, fontSize: 11, color: "#475569" }}>{c.title}</span>
                              )}
                              <div data-child-icons="" style={{ display: "flex", gap: 1, opacity: 0, transition: "opacity 0.12s", flexShrink: 0 }}>
                                {isEditingChild ? (
                                  <>
                                    <button type="button" disabled={editSaving} onClick={() => void handleEditSave(c.id)}
                                      style={{ border: "none", background: "none", cursor: "pointer", padding: "1px 3px", color: "#2563eb", display: "flex" }}>
                                      {editSaving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                                    </button>
                                    <button type="button" onClick={() => setEditingId(null)}
                                      style={{ border: "none", background: "none", cursor: "pointer", padding: "1px 3px", color: "#94a3b8", display: "flex" }}><X size={11} /></button>
                                  </>
                                ) : (
                                  <>
                                    <button type="button" title="重命名" onClick={() => { setEditingId(c.id); setEditTitle(c.title); setLinkEditId(null); }}
                                      style={{ border: "none", background: "none", cursor: "pointer", padding: "1px 3px", color: "#94a3b8", display: "flex" }}><Pencil size={11} /></button>
                                    <button type="button" title="配置跳转链接" onClick={() => openLinkEdit(c.id, c.defaultActionType, c.defaultActionValue)}
                                      style={{ border: "none", background: "none", cursor: "pointer", padding: "1px 3px", display: "flex", color: (c.defaultActionType !== "NONE" && c.defaultActionValue) ? "#2563eb" : "#94a3b8" }}><Link size={11} /></button>
                                    <button type="button" title="删除子任务" onClick={() => void handleDelete(c as unknown as Template)}
                                      style={{ border: "none", background: "none", cursor: "pointer", padding: "1px 3px", color: "#ef4444", display: "flex" }}><Trash2 size={11} /></button>
                                  </>
                                )}
                              </div>
                            </div>
                            {/* 子模板链接内联编辑器 */}
                            {isLinkEditChild && (
                              <div style={{ paddingLeft: 16, paddingBottom: 8 }} onClick={e => e.stopPropagation()}>
                                <div style={{ background: "#f8fafc", borderRadius: 8, padding: "8px 10px", border: "1px solid #e2e8f0" }}>
                                  <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                                    {(["URL", "FEISHU_DOC", "FEISHU_CHAT"] as TodoActionType[]).map(t => (
                                      <button key={t} type="button" onClick={() => { setLinkEditType(t); setLinkEditValue(""); }}
                                        style={{ flex: 1, padding: "2px 2px", fontSize: 10, borderRadius: 4, cursor: "pointer", fontWeight: linkEditType === t ? 600 : 400, border: `1px solid ${linkEditType === t ? "#2563eb" : "#e2e8f0"}`, background: linkEditType === t ? "rgba(37,99,235,0.08)" : "white", color: linkEditType === t ? "#2563eb" : "#64748b" }}>
                                        {ACTION_LABEL[t]}
                                      </button>
                                    ))}
                                  </div>
                                  {linkEditType === "FEISHU_CHAT" ? (
                                    <select
                                      value={linkEditValue}
                                      onChange={e => setLinkEditValue(e.target.value)}
                                      style={{ boxSizing: "border-box", width: "100%", padding: "4px 7px", fontSize: 11, border: "1px solid #e2e8f0", borderRadius: 5, outline: "none", marginBottom: 6, background: "white", color: "#374151" }}>
                                      <option value="" disabled>
                                        {feishuTargets.length === 0 ? "暂无配置，请前往超级后台添加" : "请下拉选择要通知的人员或群聊…"}
                                      </option>
                                      {feishuTargets.filter(t => t.type === "GROUP").length > 0 && (
                                        <optgroup label="👥 群聊">
                                          {feishuTargets.filter(t => t.type === "GROUP").map(t => (
                                            <option key={t.feishuId} value={t.feishuId}>{t.name}</option>
                                          ))}
                                        </optgroup>
                                      )}
                                      {feishuTargets.filter(t => t.type === "USER").length > 0 && (
                                        <optgroup label="👤 个人">
                                          {feishuTargets.filter(t => t.type === "USER").map(t => (
                                            <option key={t.feishuId} value={t.feishuId}>{t.name}</option>
                                          ))}
                                        </optgroup>
                                      )}
                                    </select>
                                  ) : (
                                    <input autoFocus value={linkEditValue} onChange={e => setLinkEditValue(e.target.value)}
                                      onKeyDown={e => { if (e.key === "Enter" && linkEditValue.trim()) void handleLinkSave(c.id); if (e.key === "Escape") setLinkEditId(null); }}
                                      placeholder="链接地址…"
                                      style={{ boxSizing: "border-box", width: "100%", padding: "4px 7px", fontSize: 11, border: "1px solid #e2e8f0", borderRadius: 5, outline: "none", marginBottom: 6 }} />
                                  )}
                                  <div style={{ display: "flex", gap: 5 }}>
                                    <button type="button" disabled={linkSaving || !linkEditValue.trim()} onClick={() => void handleLinkSave(c.id)}
                                      style={{ flex: 1, padding: "3px 0", fontSize: 11, fontWeight: 600, color: "white", border: "none", borderRadius: 4, cursor: "pointer", background: linkEditValue.trim() ? "#2563eb" : "#93c5fd" }}>
                                      {linkSaving ? <Loader2 size={10} className="animate-spin" style={{ display: "inline" }} /> : "保存"}
                                    </button>
                                    {c.defaultActionType !== "NONE" && c.defaultActionValue && (
                                      <button type="button" onClick={() => void handleLinkClear(c.id)}
                                        style={{ padding: "3px 8px", fontSize: 11, color: "#ef4444", background: "white", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, cursor: "pointer" }}>清除</button>
                                    )}
                                    <button type="button" onClick={() => setLinkEditId(null)}
                                      style={{ padding: "3px 8px", fontSize: 11, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 4, cursor: "pointer" }}>取消</button>
                                  </div>
                                </div>
                              </div>
                            )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* 新增子任务输入框（当前大类展开时） */}
                    {showAddChild === tpl.id && (
                      <div style={{ paddingLeft: 48, paddingRight: 22, paddingBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
                        <ChevronRight size={10} style={{ color: "#22c55e", flexShrink: 0 }} />
                        <input autoFocus value={addChildTitle} onChange={e => setAddChildTitle(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") void handleAddChild(tpl.id, tpl.category); if (e.key === "Escape") { setShowAddChild(null); setAddChildTitle(""); } }}
                          placeholder="输入子任务名称，回车确认…"
                          style={{ ...iStyle, flex: 1 }} />
                        <button type="button" disabled={addSaving || !addChildTitle.trim()} onClick={() => void handleAddChild(tpl.id, tpl.category)}
                          style={{ fontSize: 11, color: "white", background: addChildTitle.trim() ? "#2563eb" : "#93c5fd", border: "none", borderRadius: 5, padding: "3px 8px", cursor: "pointer", flexShrink: 0 }}>
                          {addSaving ? <Loader2 size={10} className="animate-spin" /> : "添加"}
                        </button>
                        <button type="button" onClick={() => { setShowAddChild(null); setAddChildTitle(""); }}
                          style={{ fontSize: 11, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 5, padding: "3px 7px", cursor: "pointer", flexShrink: 0 }}>取消</button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* 新增大类 */}
              {showAddRoot ? (
                <div style={{ padding: "10px 22px", display: "flex", gap: 8, alignItems: "center", borderBottom: "1px solid #f8fafc" }}>
                  <input autoFocus value={addRootTitle} onChange={e => setAddRootTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") void handleAddRoot(); if (e.key === "Escape") { setShowAddRoot(false); setAddRootTitle(""); } }}
                    placeholder="输入新预设大类名称，回车确认…"
                    style={{ ...iStyle, flex: 1 }} />
                  <button type="button" disabled={addSaving || !addRootTitle.trim()} onClick={() => void handleAddRoot()}
                    style={{ fontSize: 12, color: "white", background: addRootTitle.trim() ? "#2563eb" : "#93c5fd", border: "none", borderRadius: 7, padding: "5px 12px", cursor: "pointer", flexShrink: 0 }}>
                    {addSaving ? <Loader2 size={12} className="animate-spin" /> : "确认"}
                  </button>
                  <button type="button" onClick={() => { setShowAddRoot(false); setAddRootTitle(""); }}
                    style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 7, padding: "5px 10px", cursor: "pointer", flexShrink: 0 }}>取消</button>
                </div>
              ) : (
                <div onClick={() => { setShowAddRoot(true); setShowAddChild(null); }}
                  style={{ padding: "10px 22px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", color: "#2563eb", fontSize: 12, fontWeight: 600 }}>
                  <Plus size={13} />新增预设大类
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部操作栏 */}
        <div style={{ padding: "12px 22px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10 }}>
          {error
            ? <span style={{ fontSize: 12, color: "#ef4444", flex: 1 }}>{error}</span>
            : <span style={{ fontSize: 12, color: "#94a3b8", flex: 1 }}>选中的大类将连同子任务一起导入</span>
          }
          <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: 9, border: "1px solid #e2e8f0", background: "white", fontSize: 13, color: "#64748b", cursor: "pointer" }}>取消</button>
          <button onClick={() => void handleImport()} disabled={working || selected.size === 0}
            style={{ padding: "8px 20px", borderRadius: 9, border: "none", fontSize: 13, fontWeight: 600, color: "white", display: "flex", alignItems: "center", gap: 5, cursor: working || selected.size === 0 ? "not-allowed" : "pointer", background: working || selected.size === 0 ? "#93c5fd" : "linear-gradient(135deg,#2563eb,#1d4ed8)" }}>
            {working ? <><Loader2 size={13} className="animate-spin" />导入中…</> : `确认导入 ${selected.size} 个大类`}
          </button>
        </div>
      </div>

      {/* 弹窗内 Toast */}
      {tplToast && (
        <div style={{ position: "fixed", bottom: 28, left: "50%", transform: "translateX(-50%)", zIndex: 9999, padding: "10px 18px", borderRadius: 10, background: tplToast.ok ? "#16a34a" : "#dc2626", color: "white", fontSize: 13, fontWeight: 500, boxShadow: "0 6px 24px rgba(0,0,0,0.2)", pointerEvents: "none" }}>
          {tplToast.msg}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 子任务行（在子 DndContext 内使用 useSortable）
// ═══════════════════════════════════════════════════════════════════════════════

function isAdminSupportTodo(title: string): boolean {
  const t = title.toLowerCase();
  return t.includes("行政支持") || t.includes("admin支持");
}

interface ChildCb {
  pendingIds:       Set<string>;
  onToggle:         (id: string, current: boolean) => void;
  onEdit:           (id: string, title: string) => void;
  onDelete:         (id: string) => void;
  onRemark:         (id: string, remark: string | null) => void;
  onAdminDispatch?: () => void;
}

const ACTION_BUTTON_LABEL: Record<TodoActionType, string> = {
  URL: "去办理", FEISHU_DOC: "查看文档", FEISHU_CHAT: "飞书沟通", NONE: "",
};

function SortableChildRow({ todo, cb }: { todo: ReceptionTodo; cb: ChildCb }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id });

  const [editing,      setEditing]      = useState(false);
  const [editContent,  setEditContent]  = useState(todo.title);
  const [showRemark,   setShowRemark]   = useState(false);
  const [remarkDraft,  setRemarkDraft]  = useState(todo.remark ?? "");

  const isPending = cb.pendingIds.has(todo.id);
  const hasAction = todo.actionType !== "NONE" && !!todo.actionValue;

  function saveRemark() {
    cb.onRemark(todo.id, remarkDraft.trim() || null);
    setShowRemark(false);
  }

  return (
    <div ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 5, padding: "3px 0", position: "relative" }}
        onMouseEnter={e => { const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]"); if (el) el.style.opacity = "1"; }}
        onMouseLeave={e => { const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]"); if (el) el.style.opacity = "0"; }}>

        <span {...attributes} {...listeners} style={{ display: "flex", alignItems: "center", color: "#d1d5db", cursor: "grab", paddingTop: 3, flexShrink: 0 }}>
          <GripVertical size={10} />
        </span>

        <button type="button" onClick={() => cb.onToggle(todo.id, todo.isCompleted)} disabled={isPending}
          style={{ border: "none", background: "transparent", cursor: isPending ? "not-allowed" : "pointer", padding: "1px 0", display: "flex", alignItems: "center", flexShrink: 0, marginTop: 2 }}>
          {isPending ? <Loader2 size={12} className="animate-spin" style={{ color: "#2563eb" }} />
            : todo.isCompleted ? <CheckSquare size={12} style={{ color: "#2563eb" }} />
            : <Square size={12} style={{ color: "#cbd5e1" }} />}
        </button>

        {editing ? (
          <input autoFocus value={editContent} onChange={e => setEditContent(e.target.value)}
            onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); cb.onEdit(todo.id, editContent); setEditing(false); } if (e.key === "Escape") { setEditing(false); setEditContent(todo.title); } }}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, fontSize: 12, padding: "1px 6px", border: "1px solid #2563eb", borderRadius: 5, outline: "none", boxSizing: "border-box" }} />
        ) : (
          <span style={{ flex: 1, fontSize: 12, color: todo.isCompleted ? "#94a3b8" : "#1e293b", textDecoration: todo.isCompleted ? "line-through" : "none", lineHeight: 1.5, paddingTop: 2 }}>
            {todo.title}
          </span>
        )}

        {hasAction && !editing && (
          <a href={actionHref(todo.actionType, todo.actionValue)} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 5, border: "1px solid rgba(37,99,235,0.3)", color: "#2563eb", background: "rgba(37,99,235,0.06)", flexShrink: 0, textDecoration: "none", marginTop: 1, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap" }}>
            {ACTION_ICON[todo.actionType]}
            {ACTION_BUTTON_LABEL[todo.actionType]}
          </a>
        )}

        {isAdminSupportTodo(todo.title) && !editing && cb.onAdminDispatch && (
          <button type="button" onClick={e => { e.stopPropagation(); cb.onAdminDispatch!(); }}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 5, border: "1px solid rgba(245,158,11,0.4)", color: "#b45309", background: "rgba(245,158,11,0.08)", flexShrink: 0, cursor: "pointer", marginTop: 1, fontSize: 11, fontWeight: 500, whiteSpace: "nowrap" }}>
            🛎️ 派发行政工单
          </button>
        )}

        {/* hover 操作 */}
        <div data-icons="" style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, opacity: 0, transition: "opacity 0.12s", position: "relative" }} onClick={e => e.stopPropagation()}>
          {editing ? (
            <>
              <button type="button" onMouseDown={() => { cb.onEdit(todo.id, editContent); setEditing(false); }} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#2563eb" }}><Check size={11} /></button>
              <button type="button" onMouseDown={() => { setEditing(false); setEditContent(todo.title); }} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#94a3b8" }}><X size={11} /></button>
            </>
          ) : (
            <>
              <button type="button" title="编辑" onClick={() => { setEditing(true); setEditContent(todo.title); setShowRemark(false); }} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#64748b" }}><Pencil size={11} /></button>
              <button type="button" title="备注" onClick={() => { setShowRemark(s => !s); setRemarkDraft(todo.remark ?? ""); }} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: todo.remark ? "#f59e0b" : "#94a3b8" }}><StickyNote size={11} /></button>
              <button type="button" title="删除" onClick={() => cb.onDelete(todo.id)} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#ef4444" }}><Trash2 size={11} /></button>
            </>
          )}
        </div>
      </div>

      {/* 备注行 */}
      {todo.remark && !showRemark && (
        <div style={{ paddingLeft: 36, paddingBottom: 2 }}>
          <span style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>{todo.remark}</span>
        </div>
      )}
      {showRemark && (
        <div style={{ paddingLeft: 36, paddingRight: 4, paddingBottom: 6 }}>
          <textarea value={remarkDraft} onChange={e => setRemarkDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") { setShowRemark(false); } }}
            placeholder="添加备注…"
            rows={2}
            style={{ boxSizing: "border-box", width: "100%", fontSize: 11, padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 7, outline: "none", resize: "none", color: "#475569", background: "#fafafa" }} />
          <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
            <button type="button" onClick={saveRemark}
              style={{ fontSize: 11, color: "white", background: "#2563eb", border: "none", borderRadius: 5, padding: "3px 10px", cursor: "pointer" }}>保存</button>
            <button type="button" onClick={() => setShowRemark(false)}
              style={{ fontSize: 11, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>取消</button>
            {todo.remark && (
              <button type="button" onClick={() => { cb.onRemark(todo.id, null); setShowRemark(false); }}
                style={{ fontSize: 11, color: "#ef4444", background: "white", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", marginLeft: "auto" }}>清除备注</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 一级任务块（自身 useSortable，内嵌独立 DndContext 处理子任务拖拽）
// ═══════════════════════════════════════════════════════════════════════════════

interface ParentCb extends ChildCb {
  onAddChild:     (parentId: string) => void;
  onChildReorder: (items: { id: string; order: number }[]) => void;
}


interface ParentBlockProps {
  todo:          ReceptionTodo;
  hideCompleted: boolean;
  addingChildOf: string | null;
  newChildTitle: string;
  onChildTitleChange: (v: string) => void;
  onChildConfirm:     (parentId: string, title: string) => void;
  onChildCancel:      () => void;
  cb:            ParentCb;
}

function SortableParent({
  todo, hideCompleted, addingChildOf, newChildTitle,
  onChildTitleChange, onChildConfirm, onChildCancel, cb,
}: ParentBlockProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: todo.id });

  const childSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const [editing,       setEditing]       = useState(false);
  const [editContent,   setEditContent]   = useState(todo.title);
  const [showRemark,    setShowRemark]    = useState(false);
  const [remarkDraft,   setRemarkDraft]   = useState(todo.remark ?? "");
  const [localChildren, setLocalChildren] = useState<ReceptionTodo[]>(todo.children ?? []);
  useEffect(() => setLocalChildren(todo.children ?? []), [todo.children]);

  const isPending  = cb.pendingIds.has(todo.id);
  const hasAction  = todo.actionType !== "NONE" && !!todo.actionValue;
  const addingHere = addingChildOf === todo.id;

  function handleChildDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oi = localChildren.findIndex(t => t.id === active.id);
    const ni = localChildren.findIndex(t => t.id === over.id);
    if (oi === -1 || ni === -1) return;
    const reordered = arrayMove(localChildren, oi, ni);
    setLocalChildren(reordered);
    cb.onChildReorder(reordered.map((t, i) => ({ id: t.id, order: (i + 1) * 10 })));
  }

  function saveRemark() {
    cb.onRemark(todo.id, remarkDraft.trim() || null);
    setShowRemark(false);
  }

  const visibleChildren = hideCompleted ? localChildren.filter(c => !c.isCompleted) : localChildren;

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1, marginBottom: 12 }}>
      {/* ── 一级行 */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 5, padding: "5px 0", position: "relative" }}
        onMouseEnter={e => { const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]"); if (el) el.style.opacity = "1"; }}
        onMouseLeave={e => { const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]"); if (el) el.style.opacity = "0"; }}>

        <span {...attributes} {...listeners} style={{ display: "flex", alignItems: "center", color: "#d1d5db", cursor: "grab", paddingTop: 3, flexShrink: 0 }}>
          <GripVertical size={12} />
        </span>

        <button type="button" onClick={() => cb.onToggle(todo.id, todo.isCompleted)} disabled={isPending}
          style={{ border: "none", background: "transparent", cursor: isPending ? "not-allowed" : "pointer", padding: "1px 0", display: "flex", alignItems: "center", flexShrink: 0, marginTop: 2 }}>
          {isPending ? <Loader2 size={14} className="animate-spin" style={{ color: "#2563eb" }} />
            : todo.isCompleted ? <CheckSquare size={14} style={{ color: "#2563eb" }} />
            : <Square size={14} style={{ color: "#cbd5e1" }} />}
        </button>

        {editing ? (
          <input autoFocus value={editContent} onChange={e => setEditContent(e.target.value)}
            onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); cb.onEdit(todo.id, editContent); setEditing(false); } if (e.key === "Escape") { setEditing(false); setEditContent(todo.title); } }}
            onClick={e => e.stopPropagation()}
            style={{ flex: 1, fontSize: 13, padding: "1px 6px", border: "1px solid #2563eb", borderRadius: 5, outline: "none", boxSizing: "border-box" }} />
        ) : (
          <span style={{ flex: 1, fontSize: 13, color: todo.isCompleted ? "#94a3b8" : "#1e293b", textDecoration: todo.isCompleted ? "line-through" : "none", lineHeight: 1.5, paddingTop: 2, fontWeight: 500 }}>
            {todo.title}
          </span>
        )}

        {hasAction && !editing && (
          <a href={actionHref(todo.actionType, todo.actionValue)} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 6, border: "1px solid rgba(37,99,235,0.3)", color: "#2563eb", background: "rgba(37,99,235,0.06)", flexShrink: 0, textDecoration: "none", marginTop: 1, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
            {ACTION_ICON[todo.actionType]}
            {ACTION_BUTTON_LABEL[todo.actionType]}
          </a>
        )}

        {isAdminSupportTodo(todo.title) && !editing && cb.onAdminDispatch && (
          <button type="button" onClick={e => { e.stopPropagation(); cb.onAdminDispatch!(); }}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: 6, border: "1px solid rgba(245,158,11,0.4)", color: "#b45309", background: "rgba(245,158,11,0.08)", flexShrink: 0, cursor: "pointer", marginTop: 1, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
            🛎️ 派发行政工单
          </button>
        )}

        <div data-icons="" style={{ display: "flex", alignItems: "center", gap: 1, flexShrink: 0, opacity: 0, transition: "opacity 0.12s", position: "relative" }} onClick={e => e.stopPropagation()}>
          {editing ? (
            <>
              <button type="button" onMouseDown={() => { cb.onEdit(todo.id, editContent); setEditing(false); }} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#2563eb" }}><Check size={11} /></button>
              <button type="button" onMouseDown={() => { setEditing(false); setEditContent(todo.title); }} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#94a3b8" }}><X size={11} /></button>
            </>
          ) : (
            <>
              <button type="button" title="添加子任务" onClick={() => cb.onAddChild(todo.id)} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#22c55e" }}><Plus size={11} /></button>
              <button type="button" title="编辑" onClick={() => { setEditing(true); setEditContent(todo.title); setShowRemark(false); }} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#64748b" }}><Pencil size={11} /></button>
              <button type="button" title="备注" onClick={() => { setShowRemark(s => !s); setRemarkDraft(todo.remark ?? ""); }} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: todo.remark ? "#f59e0b" : "#94a3b8" }}><StickyNote size={11} /></button>
              <button type="button" title="删除" onClick={() => cb.onDelete(todo.id)} style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", display: "flex", color: "#ef4444" }}><Trash2 size={11} /></button>
            </>
          )}
        </div>
      </div>

      {/* 备注行 */}
      {todo.remark && !showRemark && (
        <div style={{ paddingLeft: 38, paddingBottom: 2 }}>
          <span style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>{todo.remark}</span>
        </div>
      )}
      {showRemark && (
        <div style={{ paddingLeft: 38, paddingRight: 4, paddingBottom: 6 }}>
          <textarea value={remarkDraft} onChange={e => setRemarkDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") setShowRemark(false); }}
            placeholder="添加备注…" rows={2}
            style={{ boxSizing: "border-box", width: "100%", fontSize: 11, padding: "5px 8px", border: "1px solid #e2e8f0", borderRadius: 7, outline: "none", resize: "none", color: "#475569", background: "#fafafa" }} />
          <div style={{ display: "flex", gap: 5, marginTop: 4 }}>
            <button type="button" onClick={saveRemark} style={{ fontSize: 11, color: "white", background: "#2563eb", border: "none", borderRadius: 5, padding: "3px 10px", cursor: "pointer" }}>保存</button>
            <button type="button" onClick={() => setShowRemark(false)} style={{ fontSize: 11, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 5, padding: "3px 8px", cursor: "pointer" }}>取消</button>
            {todo.remark && (
              <button type="button" onClick={() => { cb.onRemark(todo.id, null); setShowRemark(false); }}
                style={{ fontSize: 11, color: "#ef4444", background: "white", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 5, padding: "3px 8px", cursor: "pointer", marginLeft: "auto" }}>清除备注</button>
            )}
          </div>
        </div>
      )}

      {/* 子任务区（独立 DndContext） */}
      {(localChildren.length > 0 || addingHere) && (
        <div style={{ marginLeft: 22, paddingLeft: 8, borderLeft: "2px solid #f1f5f9", marginTop: 2 }}>
          {localChildren.length > 0 && (
            <DndContext sensors={childSensors} collisionDetection={closestCenter} onDragEnd={handleChildDragEnd}>
              <SortableContext items={localChildren.map(c => c.id)} strategy={verticalListSortingStrategy}>
                {visibleChildren.map(child => (
                  <SortableChildRow key={child.id} todo={child} cb={cb} />
                ))}
              </SortableContext>
            </DndContext>
          )}
          {addingHere && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 0" }}>
              <ChevronRight size={10} style={{ color: "#94a3b8", flexShrink: 0 }} />
              <input autoFocus value={newChildTitle} onChange={e => onChildTitleChange(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newChildTitle.trim()) onChildConfirm(todo.id, newChildTitle); if (e.key === "Escape") onChildCancel(); }}
                placeholder="输入子任务内容，回车确认…"
                style={{ flex: 1, fontSize: 12, padding: "4px 8px", border: "1px solid #2563eb", borderRadius: 6, outline: "none" }} />
              <button type="button" onClick={onChildCancel} style={{ fontSize: 11, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 5, padding: "3px 7px", cursor: "pointer" }}>取消</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════════════════════

export function TodoManagerV2({
  receptionId,
  reception,
}: {
  receptionId: string;
  reception?:  AdminReceptionInfo;
}) {
  const [todos,           setTodos]           = useState<ReceptionTodo[]>([]);
  const [listLoading,     setListLoading]     = useState(true);
  const [pendingIds,      setPendingIds]      = useState<Set<string>>(new Set());
  const [hideCompleted,   setHideCompleted]   = useState(false);
  const [showImport,      setShowImport]      = useState(false);
  const [addingChildOf,   setAddingChildOf]   = useState<string | null>(null);
  const [showAdminModal,  setShowAdminModal]  = useState(false);
  const [newChildTitle, setNewChildTitle] = useState("");
  const [newRootTitle,  setNewRootTitle]  = useState("");
  const [showNewRoot,   setShowNewRoot]   = useState(false);
  const [, startTrans]                    = useTransition();
  const reorderTimer                      = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTodos = useCallback(async () => {
    setListLoading(true);
    try {
      const res  = await fetch(`/api/reception/${receptionId}/todos`);
      const data = await res.json() as { todos?: ReceptionTodo[] };
      setTodos(data.todos ?? []);
    } finally { setListLoading(false); }
  }, [receptionId]);

  useEffect(() => { void loadTodos(); }, [loadTodos]);

  // ── 完成状态切换（Optimistic）
  function toggleTodo(id: string, current: boolean) {
    setPendingIds(p => new Set(p).add(id));
    setTodos(prev => applyPatch(prev, id, { isCompleted: !current }));
    startTrans(() => {
      fetch(`/api/reception/${receptionId}/todos/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted: !current }),
      })
        .then(r => { if (!r.ok) setTodos(prev => applyPatch(prev, id, { isCompleted: current })); })
        .catch(() => setTodos(prev => applyPatch(prev, id, { isCompleted: current })))
        .finally(() => setPendingIds(p => { const n = new Set(p); n.delete(id); return n; }));
    });
  }

  // ── 编辑标题
  function editTodo(id: string, title: string) {
    setTodos(prev => applyPatch(prev, id, { title }));
    fetch(`/api/reception/${receptionId}/todos/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch(() => void loadTodos());
  }

  // ── 删除（支持级联删除父任务及其子任务）
  function deleteTodo(id: string) {
    const all      = [...todos, ...todos.flatMap(t => t.children ?? [])];
    const target   = all.find(t => t.id === id);
    const children = target?.children ?? [];
    const hasKids  = children.length > 0;

    const msg = hasKids
      ? `确认删除「${target?.title ?? ""}」及其 ${children.length} 个子任务？`
      : "确认删除这条待办？";
    if (!window.confirm(msg)) return;

    setTodos(prev => removeNode(prev, id));

    const doDelete = async () => {
      for (const child of children) {
        await fetch(`/api/reception/${receptionId}/todos/${child.id}`, { method: "DELETE" });
      }
      await fetch(`/api/reception/${receptionId}/todos/${id}`, { method: "DELETE" });
    };
    doDelete().catch(() => void loadTodos());
  }

  // ── 备注（只写实例表）
  function saveRemark(id: string, remark: string | null) {
    setTodos(prev => applyPatch(prev, id, { remark }));
    fetch(`/api/reception/${receptionId}/todos/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remark }),
    }).catch(() => void loadTodos());
  }

  // ── 新增
  async function addRootTodo(title: string) {
    if (!title.trim()) return;
    const res  = await fetch(`/api/reception/${receptionId}/todos`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    const data = await res.json() as { todos?: ReceptionTodo[] };
    if (data.todos) setTodos(data.todos);
    setNewRootTitle(""); setShowNewRoot(false);
  }
  async function addChildTodo(parentId: string, title: string) {
    if (!title.trim()) return;
    const res  = await fetch(`/api/reception/${receptionId}/todos`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), parentId }),
    });
    const data = await res.json() as { todos?: ReceptionTodo[] };
    if (data.todos) setTodos(data.todos);
    setAddingChildOf(null); setNewChildTitle("");
  }

  // ── 拖拽排序
  const rootSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  function scheduleReorder(items: { id: string; order: number }[]) {
    if (reorderTimer.current) clearTimeout(reorderTimer.current);
    reorderTimer.current = setTimeout(() => {
      void fetch(`/api/reception/${receptionId}/todos/reorder`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
    }, 500);
  }
  function handleRootDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oi = todos.findIndex(t => t.id === active.id);
    const ni = todos.findIndex(t => t.id === over.id);
    if (oi === -1 || ni === -1) return;
    const reordered = arrayMove(todos, oi, ni);
    setTodos(reordered);
    scheduleReorder(reordered.map((t, i) => ({ id: t.id, order: (i + 1) * 10 })));
  }

  // ── 统计
  const allFlat = todos.flatMap(t => [t, ...(t.children ?? [])]);
  const total   = allFlat.length;
  const done    = allFlat.filter(t => t.isCompleted).length;
  const importedTplIds = new Set<string>(allFlat.map(t => t.templateId).filter((id): id is string => id !== null));
  const visibleTodos   = hideCompleted ? todos.filter(t => !t.isCompleted || (t.children ?? []).some(c => !c.isCompleted)) : todos;

  const cb: ParentCb = {
    pendingIds,
    onToggle:         toggleTodo,
    onEdit:           editTodo,
    onDelete:         deleteTodo,
    onAddChild:       (id) => { setAddingChildOf(id); setNewChildTitle(""); },
    onRemark:         saveRemark,
    onChildReorder:   scheduleReorder,
    ...(reception ? { onAdminDispatch: () => setShowAdminModal(true) } : {}),
  };

  return (
    <div>
      {/* 顶部控制区（永远可见） */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => setShowImport(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 9, background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "white", border: "none", fontSize: 12, fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 8px rgba(37,99,235,0.25)", flexShrink: 0 }}>
          <BookOpen size={14} />从预设导入待办
        </button>
        {total > 0 && <span style={{ fontSize: 12, color: "#94a3b8" }}>{done}/{total} 已完成</span>}
        <button type="button" onClick={() => setHideCompleted(v => !v)}
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 7, border: "1px solid #e2e8f0", background: "white", fontSize: 11, color: "#64748b", cursor: "pointer", marginLeft: "auto", flexShrink: 0 }}>
          {hideCompleted ? <><Eye size={11} />显示已完成</> : <><EyeOff size={11} />隐藏已完成</>}
        </button>
      </div>

      {/* 进度条 */}
      {total > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1, height: 3, borderRadius: 3, background: "#f1f5f9", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 3, background: "#2563eb", width: `${Math.round(done / total * 100)}%`, transition: "width 0.3s" }} />
          </div>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{Math.round(done / total * 100)}%</span>
        </div>
      )}

      {/* 列表区 */}
      {listLoading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: "20px 0" }}>
          <Loader2 size={18} className="animate-spin" style={{ color: "#94a3b8" }} />
        </div>
      ) : (
        <>
          {todos.length === 0 && (
            <div style={{ padding: "12px 0 8px", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
              点击上方按钮从预设导入待办，或在下方手动新增
            </div>
          )}

          <DndContext sensors={rootSensors} collisionDetection={closestCenter} onDragEnd={handleRootDragEnd}>
            <SortableContext items={todos.map(t => t.id)} strategy={verticalListSortingStrategy}>
              {visibleTodos.map(todo => (
                <SortableParent key={todo.id} todo={todo}
                  hideCompleted={hideCompleted}
                  addingChildOf={addingChildOf}
                  newChildTitle={newChildTitle}
                  onChildTitleChange={setNewChildTitle}
                  onChildConfirm={(parentId, title) => void addChildTodo(parentId, title)}
                  onChildCancel={() => { setAddingChildOf(null); setNewChildTitle(""); }}
                  cb={cb}
                />
              ))}
            </SortableContext>
          </DndContext>

          {showNewRoot ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <input autoFocus value={newRootTitle} onChange={e => setNewRootTitle(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newRootTitle.trim()) void addRootTodo(newRootTitle); if (e.key === "Escape") { setShowNewRoot(false); setNewRootTitle(""); } }}
                placeholder="输入任务名称，回车确认…"
                style={{ flex: 1, fontSize: 12, padding: "6px 10px", border: "1px solid #2563eb", borderRadius: 8, outline: "none" }} />
              <button type="button" onClick={() => { setShowNewRoot(false); setNewRootTitle(""); }}
                style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 6, padding: "5px 10px", cursor: "pointer" }}>取消</button>
            </div>
          ) : (
            <button type="button" onClick={() => setShowNewRoot(true)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", border: "1px dashed #e2e8f0", borderRadius: 8, background: "transparent", fontSize: 11, color: "#94a3b8", cursor: "pointer", marginTop: 6, width: "100%", justifyContent: "center" }}>
              <Plus size={12} />手动新增任务
            </button>
          )}
        </>
      )}

      {showImport && (
        <ImportDialog receptionId={receptionId} importedTplIds={importedTplIds}
          onDone={newTodos => setTodos(newTodos)}
          onClose={() => setShowImport(false)} />
      )}

      {showAdminModal && reception && (
        <AdminSupportOrderModal
          reception={reception}
          onClose={() => setShowAdminModal(false)}
        />
      )}
    </div>
  );
}
