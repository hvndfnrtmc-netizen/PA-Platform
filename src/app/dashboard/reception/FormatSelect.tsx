"use client";

/**
 * 接待形式层级下拉选择组件（两级，仅 format 分类）
 *
 * 架构约束（不可违反）：
 *  A. 勾选事件 → 只调 onChange(next)，绝不触发 onDictChanged / API 请求
 *  B. 字典管理事件 → 只在 +/Edit/Delete 的 API 调用成功后调 onDictChanged
 *  C. 纯受控组件：不维护"已选"的内部副本，完全信任父组件传入的 value prop
 */

import React, { useState, useEffect, useRef } from "react";
import { X, ChevronDown, Check, Plus, Pencil, Trash2, Loader2 } from "lucide-react";

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface DictNode {
  id:        string;
  value:     string;
  parentId:  string | null;
  isDefault: boolean;
  sortOrder: number;
  children:  DictNode[];
}

// ── 工具函数（页面层也会 import）─────────────────────────────────────────────

export function buildByIdMap(tree: DictNode[]): Map<string, DictNode> {
  const map = new Map<string, DictNode>();
  const walk = (nodes: DictNode[]) => {
    for (const n of nodes) { map.set(n.id, n); walk(n.children); }
  };
  walk(tree);
  return map;
}

export function resolveFormatDisplay(ids: string[], byId: Map<string, DictNode>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const n = byId.get(id);
    if (!n) continue;
    const rootName = n.parentId ? (byId.get(n.parentId)?.value ?? n.value) : n.value;
    if (!seen.has(rootName)) { seen.add(rootName); out.push(rootName); }
  }
  return out;
}

// ── 内部工具 ─────────────────────────────────────────────────────────────────

/** chip 渲染：必须基于全量 byId（含已停用项），不能仅用活跃树 */
function resolveChips(ids: string[], byId: Map<string, DictNode>) {
  return ids.map((id) => {
    const n          = byId.get(id);
    const parentNode = n?.parentId ? byId.get(n.parentId) : null;
    return {
      id,
      label:       n?.value       ?? `(${id.slice(0, 6)}…)`,
      parentLabel: parentNode?.value ?? null,
      missing:     !n,
    };
  });
}

function filterTree(nodes: DictNode[], q: string): DictNode[] {
  if (!q) return nodes;
  const lq = q.toLowerCase();
  return nodes.flatMap((n) => {
    const selfMatch  = n.value.toLowerCase().includes(lq);
    const childMatch = n.children.filter((c) => c.value.toLowerCase().includes(lq));
    if (!selfMatch && childMatch.length === 0) return [];
    return [{ ...n, children: selfMatch ? n.children : childMatch }];
  });
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface HierarchicalFormatSelectProps {
  /** 已选的 dict ID 数组（受控，由父组件管理） */
  value:         string[];
  onChange:      (ids: string[]) => void;
  /** 活跃选项树（仅用于下拉展示） */
  tree:          DictNode[];
  /** 全量字典 Map，含已停用项（用于 chip 名称解析） */
  byId:          Map<string, DictNode>;
  /** 字典 CRUD 成功后调用，触发父组件刷新字典树 */
  onDictChanged: () => void;
  placeholder?:  string;
  isSuperAdmin?: boolean;
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export function HierarchicalFormatSelect({
  value,
  onChange,
  tree,
  byId,
  onDictChanged,
  placeholder  = "请选择接待形式（可多选）",
  isSuperAdmin = false,
}: HierarchicalFormatSelectProps) {
  const [isOpen,   setIsOpen]   = useState(false);
  const [search,   setSearch]   = useState("");
  const [dropRect, setDropRect] = useState({ top: 0, left: 0, width: 0 });
  const [saving,   setSaving]   = useState(false);

  // 防御：历史数据可能含 null / 非数组
  const ids = Array.isArray(value) ? value : [];

  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef    = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);

  // 定位 dropdown
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setDropRect({ top: r.bottom + 4, left: r.left, width: r.width });
    setTimeout(() => searchRef.current?.focus(), 20);
  }, [isOpen]);

  // 点击外部关闭
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
      setSearch("");
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [isOpen]);

  // ── 勾选事件（约束A：只调 onChange，绝不碰 onDictChanged / API）────────────

  /**
   * 勾选/取消勾选一个 ID。
   * 严格约束：此函数只能调用 onChange，不允许调用任何 API 或 onDictChanged。
   */
  function handleToggle(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡，防止外层触发额外处理器
    const next = ids.includes(id)
      ? ids.filter((v) => v !== id)
      : [...ids, id];
    onChange(next); // ← 唯一允许的副作用
  }

  function handleRemoveChip(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    onChange(ids.filter((v) => v !== id));
  }

  // ── 字典管理事件（约束B：只在 API 成功后调 onDictChanged）────────────────

  async function apiPost(body: Record<string, unknown>) {
    const r = await fetch("/api/reception/dicts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json() as Promise<{ row?: { id: string; value: string }; error?: string }>;
  }

  async function apiPatch(id: string, body: Record<string, unknown>) {
    const r = await fetch(`/api/reception/dicts/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json() as Promise<{ row?: { id: string }; error?: string }>;
  }

  async function apiDelete(id: string) {
    const r = await fetch(`/api/reception/dicts/${id}`, { method: "DELETE" });
    return r.json() as Promise<{ success?: boolean; error?: string }>;
  }

  async function handleAddChild(e: React.MouseEvent, parentId: string, parentName: string) {
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡，防止触发行的 handleToggle
    const v = window.prompt(`新增「${parentName}」的子选项名称:`);
    if (!v?.trim()) return;
    setSaving(true);
    try {
      const res = await apiPost({ category: "format", value: v.trim(), parentId });
      if (res.error) { window.alert(`添加失败：${res.error}`); return; }
      // 读取最新 ids（此处 ids 来自渲染闭包，prompt 阻塞期间用户无法操作，安全）
      if (res.row) onChange([...ids, res.row.id]);
      onDictChanged(); // 字典管理操作完成后通知刷新
    } finally { setSaving(false); }
  }

  async function handleRename(e: React.MouseEvent, id: string, currentValue: string) {
    e.preventDefault();
    e.stopPropagation();
    const v = window.prompt("修改选项名称:", currentValue);
    if (v === null || !v.trim() || v.trim() === currentValue) return;
    setSaving(true);
    try {
      const res = await apiPatch(id, { value: v.trim() });
      if (res.error) { window.alert(`修改失败：${res.error}`); return; }
      onDictChanged();
    } finally { setSaving(false); }
  }

  async function handleDelete(e: React.MouseEvent, id: string, label: string) {
    e.preventDefault();
    e.stopPropagation();
    const ok = window.confirm(
      `确定要停用「${label}」吗？\n停用后该选项不会出现在新增列表里，但历史记录仍会正常显示。`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await apiDelete(id);
      if (res.error) { window.alert(`停用失败：${res.error}`); return; }
      onChange(ids.filter((v) => v !== id));
      onDictChanged();
    } finally { setSaving(false); }
  }

  async function handleAddRoot(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const v = window.prompt("新增一级接待形式选项:");
    if (!v?.trim()) return;
    setSaving(true);
    try {
      const res = await apiPost({ category: "format", value: v.trim(), parentId: null });
      if (res.error) { window.alert(`添加失败：${res.error}`); return; }
      if (res.row) onChange([...ids, res.row.id]);
      onDictChanged();
    } finally { setSaving(false); }
  }

  // ── 渲染节点 ──────────────────────────────────────────────────────────────────

  function renderNode(node: DictNode, depth = 0): React.ReactNode {
    const isChild = depth > 0;
    const isSel   = ids.includes(node.id); // 基于完整 ids，不做任何过滤

    return (
      <React.Fragment key={node.id}>
        {/* 选项行：仅负责勾选，不触发任何字典操作 */}
        <div
          onClick={(e) => handleToggle(e, node.id)}
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        8,
            padding:    `7px 10px 7px ${isChild ? 32 : 10}px`,
            cursor:     "pointer",
            background: isSel ? "rgba(37,99,235,0.04)" : undefined,
            borderLeft: isChild ? "2px solid #e2e8f0" : undefined,
            marginLeft: isChild ? 14 : 0,
            userSelect: "none",
            position:   "relative",
          }}
          onMouseEnter={(e) => {
            const icons = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]");
            if (icons) icons.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            const icons = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]");
            if (icons) icons.style.opacity = "0";
          }}
        >
          {/* Checkbox */}
          <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: isSel ? "none" : "1.5px solid #cbd5e1", background: isSel ? "#2563eb" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isSel && <Check size={10} style={{ color: "white" }} />}
          </div>

          {/* 名称 */}
          <span style={{ flex: 1, fontSize: 13, color: isSel ? "#2563eb" : "#1e293b", fontWeight: isSel ? 500 : 400 }}>
            {node.value}
          </span>

          {/* 字典管理图标（独立区域，事件不冒泡到选项行）*/}
          <div
            data-icons=""
            style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, opacity: 0, transition: "opacity 0.12s" }}
            onClick={(e) => e.stopPropagation()} // 容器层隔离，防止任何图标区域点击冒泡到行
          >
            {!isChild && (
              <button type="button" title="添加子选项" disabled={saving}
                onClick={(e) => void handleAddChild(e, node.id, node.value)}
                style={{ border: "none", background: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 4, display: "flex", alignItems: "center", color: "#22c55e", lineHeight: 1 }}>
                <Plus size={13} />
              </button>
            )}
            <button type="button" title="重命名" disabled={saving}
              onClick={(e) => void handleRename(e, node.id, node.value)}
              style={{ border: "none", background: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 4, display: "flex", alignItems: "center", color: "#64748b", lineHeight: 1 }}>
              <Pencil size={12} />
            </button>
            {isSuperAdmin && !node.isDefault && (
              <button type="button" title="停用" disabled={saving}
                onClick={(e) => void handleDelete(e, node.id, node.value)}
                style={{ border: "none", background: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 4, display: "flex", alignItems: "center", color: "#ef4444", lineHeight: 1 }}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        {/* 子节点 */}
        {node.children.map((child) => renderNode(child, depth + 1))}
      </React.Fragment>
    );
  }

  // ── 渲染 ─────────────────────────────────────────────────────────────────────

  const chips    = resolveChips(ids, byId); // byId 必须是全量 Map（含已停用项）
  const filtered = filterTree(tree, search);

  return (
    <>
      {/* Trigger */}
      <div
        ref={triggerRef}
        onClick={() => setIsOpen((o) => !o)}
        style={{ boxSizing: "border-box", width: "100%", minHeight: 42, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, padding: "6px 10px 6px 12px", borderRadius: 12, border: "1px solid #e2e8f0", background: "white", cursor: "pointer" }}
      >
        {chips.length === 0
          ? <span style={{ color: "#94a3b8", fontSize: 14, flex: 1 }}>{placeholder}</span>
          : chips.map((c) => (
              <span key={c.id}
                style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 6, background: c.missing ? "rgba(239,68,68,0.08)" : "rgba(37,99,235,0.08)", border: `1px solid ${c.missing ? "rgba(239,68,68,0.2)" : "rgba(37,99,235,0.15)"}`, fontSize: 12, color: c.missing ? "#dc2626" : "#2563eb" }}>
                {c.parentLabel ? `${c.parentLabel} · ${c.label}` : c.label}
                <button type="button"
                  onClick={(e) => handleRemoveChip(e, c.id)}
                  style={{ border: "none", background: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: c.missing ? "#fca5a5" : "#93c5fd" }}>
                  <X size={10} />
                </button>
              </span>
            ))}
        <ChevronDown size={13} style={{ color: "#94a3b8", flexShrink: 0, marginLeft: "auto", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div ref={dropRef}
          style={{ position: "fixed", top: dropRect.top, left: dropRect.left, width: dropRect.width, zIndex: 9999, background: "white", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.14)", maxHeight: 340, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* 搜索 */}
          <div style={{ padding: "7px 8px 6px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
            <input ref={searchRef} value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setIsOpen(false); setSearch(""); } }}
              placeholder="搜索选项…"
              style={{ boxSizing: "border-box", width: "100%", padding: "5px 9px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none" }} />
          </div>

          {/* 选项列表 */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0
              ? <div style={{ padding: 12, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>无匹配选项</div>
              : filtered.map((n) => renderNode(n))}
          </div>

          {/* 底部：添加一级选项 */}
          <div style={{ borderTop: "1px solid #f1f5f9", padding: "6px 10px", flexShrink: 0 }}>
            <button type="button" disabled={saving}
              onClick={(e) => void handleAddRoot(e)}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: saving ? "#94a3b8" : "#64748b", background: "none", border: "none", cursor: saving ? "not-allowed" : "pointer", padding: "2px 0" }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} style={{ color: "#22c55e" }} />}
              添加选项
            </button>
          </div>
        </div>
      )}
    </>
  );
}
