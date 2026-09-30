"use client";

/**
 * 主接待人层级单选下拉组件（HierarchicalHostSelect）
 *
 * 基于 ReceptionDictionary category="host" 的两级字典。
 * - value: 当前选中的 dict ID（单选）
 * - onChange(id, displayName): 通知父组件更新 hostDictId + hostName
 * - 支持 hover 显示 Edit/Delete/AddChild 图标
 * - 选中显示：一级直接显示名称；二级显示 "一级 · 二级"
 * - 搜索：按文本匹配（两级均可搜索）
 */

import React, { useState, useEffect, useRef } from "react";
import { X, ChevronDown, Check, Plus, Pencil, Trash2, Loader2 } from "lucide-react";

// ── 类型（复用 FormatSelect 的 DictNode 结构）────────────────────────────────

export interface HostDictNode {
  id:        string;
  value:     string;
  parentId:  string | null;
  isDefault: boolean;
  sortOrder: number;
  children:  HostDictNode[];
}

export function buildHostByIdMap(tree: HostDictNode[]): Map<string, HostDictNode> {
  const map = new Map<string, HostDictNode>();
  const walk = (nodes: HostDictNode[]) => {
    for (const n of nodes) { map.set(n.id, n); walk(n.children); }
  };
  walk(tree);
  return map;
}

/** 把单个 hostDictId 解析为一级名称（列表视图降维用）*/
export function resolveHostRootName(
  id:    string | null | undefined,
  byId:  Map<string, HostDictNode>,
): string | null {
  if (!id) return null;
  const n = byId.get(id);
  if (!n) return null;
  if (n.parentId) return byId.get(n.parentId)?.value ?? n.value;
  return n.value;
}

function filterHostTree(nodes: HostDictNode[], q: string): HostDictNode[] {
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

export interface HierarchicalHostSelectProps {
  /** 已选的 dict ID（单选，null = 未选） */
  value:         string | null;
  /** 选中或清空时回调：(id | null, displayName | null) */
  onChange:      (id: string | null, displayName: string | null) => void;
  tree:          HostDictNode[];
  byId:          Map<string, HostDictNode>;
  onDictChanged: () => void;
  placeholder?:  string;
  isSuperAdmin?: boolean;
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export function HierarchicalHostSelect({
  value,
  onChange,
  tree,
  byId,
  onDictChanged,
  placeholder  = "请选择主接待人",
  isSuperAdmin = false,
}: HierarchicalHostSelectProps) {
  const [isOpen,   setIsOpen]   = useState(false);
  const [search,   setSearch]   = useState("");
  const [dropRect, setDropRect] = useState({ top: 0, left: 0, width: 0 });
  const [saving,   setSaving]   = useState(false);

  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef    = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setDropRect({ top: r.bottom + 4, left: r.left, width: r.width });
    setTimeout(() => searchRef.current?.focus(), 20);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropRef.current?.contains(e.target as Node)) return;
      setIsOpen(false); setSearch("");
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [isOpen]);

  // 选中的节点（用于 trigger 显示）
  const selectedNode   = value ? byId.get(value) : null;
  const selectedParent = selectedNode?.parentId ? byId.get(selectedNode.parentId) : null;
  const triggerLabel   = selectedNode
    ? selectedParent
      ? `${selectedParent.value} · ${selectedNode.value}`
      : selectedNode.value
    : null;

  function handleSelect(e: React.MouseEvent, node: HostDictNode) {
    e.preventDefault(); e.stopPropagation();
    const displayName = node.value;
    onChange(node.id, displayName);
    setIsOpen(false); setSearch("");
  }

  function handleClear(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    onChange(null, null);
  }

  // ── Dict CRUD ──────────────────────────────────────────────────────────────

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
    e.preventDefault(); e.stopPropagation();
    const v = window.prompt(`新增「${parentName}」的子选项名称:`);
    if (!v?.trim()) return;
    setSaving(true);
    try {
      const res = await apiPost({ category: "host", value: v.trim(), parentId });
      if (res.error) { window.alert(`添加失败：${res.error}`); return; }
      onDictChanged();
    } finally { setSaving(false); }
  }

  async function handleRename(e: React.MouseEvent, id: string, currentValue: string) {
    e.preventDefault(); e.stopPropagation();
    const v = window.prompt("修改名称:", currentValue);
    if (v === null || !v.trim() || v.trim() === currentValue) return;
    setSaving(true);
    try {
      const res = await apiPatch(id, { value: v.trim() });
      if (res.error) { window.alert(`修改失败：${res.error}`); return; }
      // 若当前已选就是被改名的项，同步更新显示名
      if (value === id) onChange(id, v.trim());
      onDictChanged();
    } finally { setSaving(false); }
  }

  async function handleDelete(e: React.MouseEvent, id: string, label: string) {
    e.preventDefault(); e.stopPropagation();
    const ok = window.confirm(
      `确定要停用「${label}」吗？\n停用后该选项不会出现在下拉列表里，但历史记录仍会正常显示。`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await apiDelete(id);
      if (res.error) { window.alert(`停用失败：${res.error}`); return; }
      if (value === id) onChange(null, null);
      onDictChanged();
    } finally { setSaving(false); }
  }

  async function handleAddRoot(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const v = window.prompt("新增一级接待人选项:");
    if (!v?.trim()) return;
    setSaving(true);
    try {
      const res = await apiPost({ category: "host", value: v.trim(), parentId: null });
      if (res.error) { window.alert(`添加失败：${res.error}`); return; }
      onDictChanged();
    } finally { setSaving(false); }
  }

  // ── 渲染节点 ──────────────────────────────────────────────────────────────────

  function renderNode(node: HostDictNode, depth = 0): React.ReactNode {
    const isChild = depth > 0;
    const isSel   = value === node.id;

    return (
      <React.Fragment key={node.id}>
        <div
          onClick={(e) => handleSelect(e, node)}
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        8,
            padding:    `7px 10px 7px ${isChild ? 32 : 10}px`,
            cursor:     "pointer",
            background: isSel ? "rgba(37,99,235,0.06)" : undefined,
            borderLeft: isChild ? "2px solid #e2e8f0" : undefined,
            marginLeft: isChild ? 14 : 0,
            userSelect: "none",
          }}
          onMouseEnter={(e) => {
            const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]");
            if (ic) ic.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]");
            if (ic) ic.style.opacity = "0";
          }}
        >
          {/* 选中指示 */}
          <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: isSel ? "none" : "1.5px solid #cbd5e1", background: isSel ? "#2563eb" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isSel && <Check size={10} style={{ color: "white" }} />}
          </div>

          <span style={{ flex: 1, fontSize: 13, color: isSel ? "#2563eb" : "#1e293b", fontWeight: isSel ? 500 : 400 }}>
            {node.value}
          </span>

          {/* 字典管理图标 */}
          <div
            data-icons=""
            style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, opacity: 0, transition: "opacity 0.12s" }}
            onClick={(e) => e.stopPropagation()}
          >
            {!isChild && (
              <button type="button" title="添加子选项" disabled={saving}
                onClick={(e) => void handleAddChild(e, node.id, node.value)}
                style={{ border: "none", background: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 4, display: "flex", color: "#22c55e" }}>
                <Plus size={13} />
              </button>
            )}
            <button type="button" title="重命名" disabled={saving}
              onClick={(e) => void handleRename(e, node.id, node.value)}
              style={{ border: "none", background: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 4, display: "flex", color: "#64748b" }}>
              <Pencil size={12} />
            </button>
            {isSuperAdmin && !node.isDefault && (
              <button type="button" title="停用" disabled={saving}
                onClick={(e) => void handleDelete(e, node.id, node.value)}
                style={{ border: "none", background: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 4, display: "flex", color: "#ef4444" }}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        {node.children.map((child) => renderNode(child, depth + 1))}
      </React.Fragment>
    );
  }

  const filtered = filterHostTree(tree, search);

  return (
    <>
      {/* Trigger */}
      <div
        ref={triggerRef}
        onClick={() => setIsOpen((o) => !o)}
        style={{ boxSizing: "border-box", width: "100%", minHeight: 42, display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 12, border: "1px solid #e2e8f0", background: "white", cursor: "pointer" }}
      >
        {triggerLabel ? (
          <>
            <span style={{ flex: 1, fontSize: 14, color: "#1e293b", fontWeight: 500 }}>{triggerLabel}</span>
            <button
              type="button"
              onClick={handleClear}
              style={{ border: "none", background: "none", cursor: "pointer", padding: 2, display: "flex", color: "#94a3b8" }}>
              <X size={13} />
            </button>
          </>
        ) : (
          <span style={{ flex: 1, fontSize: 14, color: "#94a3b8" }}>{placeholder}</span>
        )}
        <ChevronDown size={13} style={{ color: "#94a3b8", flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          ref={dropRef}
          style={{ position: "fixed", top: dropRect.top, left: dropRect.left, width: dropRect.width, zIndex: 9999, background: "white", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.14)", maxHeight: 340, display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          {/* 搜索 */}
          <div style={{ padding: "7px 8px 6px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setIsOpen(false); setSearch(""); } }}
              placeholder="搜索接待人…"
              style={{ boxSizing: "border-box", width: "100%", padding: "5px 9px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none" }}
            />
          </div>

          {/* 选项列表 */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0
              ? <div style={{ padding: 12, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>无匹配</div>
              : filtered.map((n) => renderNode(n))}
          </div>

          {/* 底部添加 */}
          <div style={{ borderTop: "1px solid #f1f5f9", padding: "6px 10px", flexShrink: 0 }}>
            <button type="button" disabled={saving}
              onClick={(e) => void handleAddRoot(e)}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} style={{ color: "#22c55e" }} />}
              添加一级接待人
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── HierarchicalHostMultiSelect（多选版本）────────────────────────────────────

export interface HierarchicalHostMultiSelectProps {
  /** 已选的 dict ID 数组 */
  value:         string[];
  /** 选中或取消时回调：(ids, displayNames) */
  onChange:      (ids: string[], displayNames: string[]) => void;
  tree:          HostDictNode[];
  byId:          Map<string, HostDictNode>;
  onDictChanged: () => void;
  placeholder?:  string;
  isSuperAdmin?: boolean;
}

export function HierarchicalHostMultiSelect({
  value,
  onChange,
  tree,
  byId,
  onDictChanged,
  placeholder  = "请选择主接待人（可多选）",
  isSuperAdmin = false,
}: HierarchicalHostMultiSelectProps) {
  const [isOpen,   setIsOpen]   = useState(false);
  const [search,   setSearch]   = useState("");
  const [dropRect, setDropRect] = useState({ top: 0, left: 0, width: 0 });
  const [saving,   setSaving]   = useState(false);

  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef    = useRef<HTMLDivElement>(null);
  const searchRef  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setDropRect({ top: r.bottom + 4, left: r.left, width: r.width });
    setTimeout(() => searchRef.current?.focus(), 20);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropRef.current?.contains(e.target as Node)) return;
      setIsOpen(false); setSearch("");
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [isOpen]);

  /** 获取节点的显示名（二级节点显示 "一级 · 二级"，一级直接显示） */
  function getDisplayName(node: HostDictNode): string {
    if (node.parentId) {
      const parent = byId.get(node.parentId);
      return parent ? `${parent.value} · ${node.value}` : node.value;
    }
    return node.value;
  }

  function handleToggle(e: React.MouseEvent, node: HostDictNode) {
    e.preventDefault(); e.stopPropagation();
    const newIds = value.includes(node.id)
      ? value.filter(id => id !== node.id)
      : [...value, node.id];
    const newNames = newIds
      .map(id => byId.get(id)?.value ?? null)
      .filter((n): n is string => n !== null);
    onChange(newIds, newNames);
  }

  function handleRemoveTag(e: React.MouseEvent, id: string) {
    e.preventDefault(); e.stopPropagation();
    const newIds = value.filter(v => v !== id);
    const newNames = newIds
      .map(i => byId.get(i)?.value ?? null)
      .filter((n): n is string => n !== null);
    onChange(newIds, newNames);
  }

  function handleClearAll(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    onChange([], []);
  }

  // ── Dict CRUD（复用单选版逻辑）──────────────────────────────────────────────

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
    e.preventDefault(); e.stopPropagation();
    const v = window.prompt(`新增「${parentName}」的子选项名称:`);
    if (!v?.trim()) return;
    setSaving(true);
    try {
      const res = await apiPost({ category: "host", value: v.trim(), parentId });
      if (res.error) { window.alert(`添加失败：${res.error}`); return; }
      onDictChanged();
    } finally { setSaving(false); }
  }

  async function handleRename(e: React.MouseEvent, id: string, currentValue: string) {
    e.preventDefault(); e.stopPropagation();
    const v = window.prompt("修改名称:", currentValue);
    if (v === null || !v.trim() || v.trim() === currentValue) return;
    setSaving(true);
    try {
      const res = await apiPatch(id, { value: v.trim() });
      if (res.error) { window.alert(`修改失败：${res.error}`); return; }
      if (value.includes(id)) {
        const newNames = value
          .map(i => (i === id ? v.trim() : byId.get(i)?.value ?? null))
          .filter((n): n is string => n !== null);
        onChange(value, newNames);
      }
      onDictChanged();
    } finally { setSaving(false); }
  }

  async function handleDelete(e: React.MouseEvent, id: string, label: string) {
    e.preventDefault(); e.stopPropagation();
    const ok = window.confirm(
      `确定要停用「${label}」吗？\n停用后该选项不会出现在下拉列表里，但历史记录仍会正常显示。`,
    );
    if (!ok) return;
    setSaving(true);
    try {
      const res = await apiDelete(id);
      if (res.error) { window.alert(`停用失败：${res.error}`); return; }
      if (value.includes(id)) {
        const newIds = value.filter(v => v !== id);
        const newNames = newIds
          .map(i => byId.get(i)?.value ?? null)
          .filter((n): n is string => n !== null);
        onChange(newIds, newNames);
      }
      onDictChanged();
    } finally { setSaving(false); }
  }

  async function handleAddRoot(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    const v = window.prompt("新增一级接待人选项:");
    if (!v?.trim()) return;
    setSaving(true);
    try {
      const res = await apiPost({ category: "host", value: v.trim(), parentId: null });
      if (res.error) { window.alert(`添加失败：${res.error}`); return; }
      onDictChanged();
    } finally { setSaving(false); }
  }

  // ── 渲染节点 ──────────────────────────────────────────────────────────────────

  function renderNode(node: HostDictNode, depth = 0): React.ReactNode {
    const isChild = depth > 0;
    const isSel   = value.includes(node.id);

    return (
      <React.Fragment key={node.id}>
        <div
          onClick={(e) => handleToggle(e, node)}
          style={{
            display:    "flex",
            alignItems: "center",
            gap:        8,
            padding:    `7px 10px 7px ${isChild ? 32 : 10}px`,
            cursor:     "pointer",
            background: isSel ? "rgba(37,99,235,0.06)" : undefined,
            borderLeft: isChild ? "2px solid #e2e8f0" : undefined,
            marginLeft: isChild ? 14 : 0,
            userSelect: "none",
          }}
          onMouseEnter={(e) => {
            const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]");
            if (ic) ic.style.opacity = "1";
          }}
          onMouseLeave={(e) => {
            const ic = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]");
            if (ic) ic.style.opacity = "0";
          }}
        >
          {/* 多选框 */}
          <div style={{ width: 15, height: 15, borderRadius: 4, flexShrink: 0, border: isSel ? "none" : "1.5px solid #cbd5e1", background: isSel ? "#2563eb" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {isSel && <Check size={10} style={{ color: "white" }} />}
          </div>

          <span style={{ flex: 1, fontSize: 13, color: isSel ? "#2563eb" : "#1e293b", fontWeight: isSel ? 500 : 400 }}>
            {node.value}
          </span>

          {/* 字典管理图标 */}
          <div
            data-icons=""
            style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0, opacity: 0, transition: "opacity 0.12s" }}
            onClick={(e) => e.stopPropagation()}
          >
            {!isChild && (
              <button type="button" title="添加子选项" disabled={saving}
                onClick={(e) => void handleAddChild(e, node.id, node.value)}
                style={{ border: "none", background: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 4, display: "flex", color: "#22c55e" }}>
                <Plus size={13} />
              </button>
            )}
            <button type="button" title="重命名" disabled={saving}
              onClick={(e) => void handleRename(e, node.id, node.value)}
              style={{ border: "none", background: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 4, display: "flex", color: "#64748b" }}>
              <Pencil size={12} />
            </button>
            {isSuperAdmin && !node.isDefault && (
              <button type="button" title="停用" disabled={saving}
                onClick={(e) => void handleDelete(e, node.id, node.value)}
                style={{ border: "none", background: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 4, display: "flex", color: "#ef4444" }}>
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        {node.children.map((child) => renderNode(child, depth + 1))}
      </React.Fragment>
    );
  }

  const filtered = filterHostTree(tree, search);

  return (
    <>
      {/* Trigger：显示已选 tags */}
      <div
        ref={triggerRef}
        onClick={() => setIsOpen((o) => !o)}
        style={{ boxSizing: "border-box", width: "100%", minHeight: 42, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5, padding: "6px 12px", borderRadius: 12, border: "1px solid #e2e8f0", background: "white", cursor: "pointer" }}
      >
        {value.length > 0 ? (
          <>
            {value.map(id => {
              const node = byId.get(id);
              if (!node) return null;
              return (
                <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 6, fontSize: 13, background: "rgba(37,99,235,0.08)", color: "#2563eb", fontWeight: 500 }}>
                  {getDisplayName(node)}
                  <button
                    type="button"
                    onClick={(e) => handleRemoveTag(e, id)}
                    style={{ border: "none", background: "none", cursor: "pointer", padding: 0, display: "flex", color: "#93c5fd", lineHeight: 1 }}>
                    <X size={11} />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={handleClearAll}
              style={{ border: "none", background: "none", cursor: "pointer", padding: 2, display: "flex", color: "#94a3b8", marginLeft: "auto" }}>
              <X size={13} />
            </button>
          </>
        ) : (
          <span style={{ flex: 1, fontSize: 14, color: "#94a3b8" }}>{placeholder}</span>
        )}
        <ChevronDown size={13} style={{ color: "#94a3b8", flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          ref={dropRef}
          style={{ position: "fixed", top: dropRect.top, left: dropRect.left, width: dropRect.width, zIndex: 9999, background: "white", border: "1px solid #e2e8f0", borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.14)", maxHeight: 340, display: "flex", flexDirection: "column", overflow: "hidden" }}
        >
          {/* 搜索 */}
          <div style={{ padding: "7px 8px 6px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setIsOpen(false); setSearch(""); } }}
              placeholder="搜索接待人…"
              style={{ boxSizing: "border-box", width: "100%", padding: "5px 9px", fontSize: 13, border: "1px solid #e2e8f0", borderRadius: 8, outline: "none" }}
            />
          </div>

          {/* 已选计数提示 */}
          {value.length > 0 && (
            <div style={{ padding: "4px 12px", fontSize: 11, color: "#2563eb", background: "rgba(37,99,235,0.04)", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
              已选 {value.length} 人，点击可取消选中
            </div>
          )}

          {/* 选项列表 */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0
              ? <div style={{ padding: 12, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>无匹配</div>
              : filtered.map((n) => renderNode(n))}
          </div>

          {/* 底部添加 */}
          <div style={{ borderTop: "1px solid #f1f5f9", padding: "6px 10px", flexShrink: 0 }}>
            <button type="button" disabled={saving}
              onClick={(e) => void handleAddRoot(e)}
              style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#64748b", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} style={{ color: "#22c55e" }} />}
              添加一级接待人
            </button>
          </div>
        </div>
      )}
    </>
  );
}
