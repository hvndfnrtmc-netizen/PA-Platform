"use client";

/**
 * 重大项目字典下拉选择器（支持轻代码编辑）
 *
 * 特性：
 * - 单选（value 为字典项 ID）
 * - 支持搜索
 * - 管理员可增/删/改字典选项
 * - 软删除机制（停用后不在列表显示，但历史记录仍可用）
 *
 * 使用示例：
 * <DictSelect
 *   category="level"
 *   value={levelDictId}
 *   onChange={(id, displayName) => setLevelDictId(id)}
 *   placeholder="请选择项目级别"
 *   canEdit={isAdmin}
 * />
 */

import React, { useState, useEffect, useRef } from "react";
import { X, ChevronDown, Check, Plus, Pencil, Trash2, Loader2 } from "lucide-react";

// ── 类型定义 ──────────────────────────────────────────────────────────

export interface DictItem {
  id: string;
  category: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
}

export interface DictSelectProps {
  /** 字典分类：level | category | companyEntity */
  category: string;
  /** 已选的字典项 ID（null = 未选） */
  value: string | null;
  /** 选中或清空时回调：(id | null, displayName | null) */
  onChange: (id: string | null, displayName: string | null) => void;
  /** 占位符 */
  placeholder?: string;
  /** 是否允许编辑字典（管理员权限） */
  canEdit?: boolean;
  /** 字典刷新回调（外部可选监听） */
  onDictChanged?: () => void;
  /** 禁用状态 */
  disabled?: boolean;
}

// ── 主组件 ────────────────────────────────────────────────────────────

export function DictSelect({
  category,
  value,
  onChange,
  placeholder = "请选择",
  canEdit = false,
  onDictChanged,
  disabled = false,
}: DictSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<DictItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dropRect, setDropRect] = useState({ top: 0, left: 0, width: 0 });

  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── 加载字典数据 ──────────────────────────────────────────────────────

  async function loadDict() {
    setLoading(true);
    try {
      const res = await fetch(`/api/major-projects/dicts?category=${category}`);
      const data = await res.json();
      if (data.rows) {
        setItems(data.rows);
      }
    } catch (err) {
      console.error("加载字典失败:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDict();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  // ── 下拉框位置计算 ────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setDropRect({ top: r.bottom + 4, left: r.left, width: r.width });
    setTimeout(() => searchRef.current?.focus(), 20);
  }, [isOpen]);

  // ── 点击外部关闭 ──────────────────────────────────────────────────────

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

  // ── 数据处理 ──────────────────────────────────────────────────────────

  const activeItems = items.filter((i) => i.isActive);
  const selectedItem = items.find((i) => i.id === value);
  const triggerLabel = selectedItem?.value ?? null;

  const filteredItems = search
    ? activeItems.filter((i) => i.value.toLowerCase().includes(search.toLowerCase()))
    : activeItems;

  // ── 事件处理 ──────────────────────────────────────────────────────────

  function handleSelect(e: React.MouseEvent, item: DictItem) {
    e.preventDefault();
    e.stopPropagation();
    onChange(item.id, item.value);
    setIsOpen(false);
    setSearch("");
  }

  function handleClear(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onChange(null, null);
  }

  function handleToggle() {
    if (disabled) return;
    setIsOpen(!isOpen);
  }

  // ── 字典 CRUD ──────────────────────────────────────────────────────────

  async function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const v = window.prompt("新增选项名称:");
    if (!v?.trim()) return;

    setSaving(true);
    try {
      const res = await fetch("/api/major-projects/dicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, value: v.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        window.alert(`添加失败：${data.error}`);
        return;
      }
      await loadDict();
      onDictChanged?.();
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(e: React.MouseEvent, item: DictItem) {
    e.preventDefault();
    e.stopPropagation();
    const v = window.prompt("修改名称:", item.value);
    if (v === null || !v.trim() || v.trim() === item.value) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/major-projects/dicts/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: v.trim() }),
      });
      const data = await res.json();
      if (data.error) {
        window.alert(`修改失败：${data.error}`);
        return;
      }
      // 若当前已选就是被改名的项，同步更新显示名
      if (value === item.id) onChange(item.id, v.trim());
      await loadDict();
      onDictChanged?.();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, item: DictItem) {
    e.preventDefault();
    e.stopPropagation();
    const ok = window.confirm(
      `确定要停用「${item.value}」吗？\n停用后该选项不会出现在下拉列表里，但历史记录仍会正常显示。`
    );
    if (!ok) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/major-projects/dicts/${item.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (data.error) {
        window.alert(`停用失败：${data.error}`);
        return;
      }
      if (value === item.id) onChange(null, null);
      await loadDict();
      onDictChanged?.();
    } finally {
      setSaving(false);
    }
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────

  return (
    <>
      {/* Trigger */}
      <div
        ref={triggerRef}
        onClick={handleToggle}
        className={`
          relative flex items-center justify-between gap-2 px-3 py-2
          border border-gray-300 rounded-md bg-white cursor-pointer
          hover:border-gray-400 transition-colors
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          ${isOpen ? "ring-2 ring-blue-500 border-blue-500" : ""}
        `}
      >
        <span className={triggerLabel ? "text-gray-900" : "text-gray-400"}>
          {triggerLabel || placeholder}
        </span>
        <div className="flex items-center gap-1">
          {triggerLabel && !disabled && (
            <X
              size={16}
              className="text-gray-400 hover:text-gray-600"
              onClick={handleClear}
            />
          )}
          <ChevronDown
            size={16}
            className={`text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
          />
        </div>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          ref={dropRef}
          className="fixed z-50 bg-white border border-gray-300 rounded-md shadow-lg"
          style={{
            top: dropRect.top,
            left: dropRect.left,
            width: dropRect.width,
            maxHeight: "300px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* 搜索框 */}
          <div className="p-2 border-b border-gray-200">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索..."
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 选项列表 */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={20} className="animate-spin text-gray-400" />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400 text-center">
                {search ? "无匹配结果" : "暂无选项"}
              </div>
            ) : (
              filteredItems.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center justify-between px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  onClick={(e) => handleSelect(e, item)}
                >
                  <div className="flex items-center gap-2 flex-1">
                    {value === item.id && (
                      <Check size={16} className="text-blue-600" />
                    )}
                    <span className="text-sm text-gray-900">{item.value}</span>
                  </div>

                  {/* 管理员操作按钮 */}
                  {canEdit && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleRename(e, item)}
                        disabled={saving}
                        className="p-1 hover:bg-gray-200 rounded"
                        title="重命名"
                      >
                        <Pencil size={14} className="text-gray-600" />
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, item)}
                        disabled={saving}
                        className="p-1 hover:bg-gray-200 rounded"
                        title="停用"
                      >
                        <Trash2 size={14} className="text-red-500" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* 新增按钮 */}
          {canEdit && (
            <div className="border-t border-gray-200 p-2">
              <button
                onClick={handleAdd}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-3 py-2
                  text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
                <span>新增选项</span>
              </button>
            </div>
          )}

          {/* 加载指示器 */}
          {saving && (
            <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-blue-600" />
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── 便捷导出（预设各分类的选择器） ────────────────────────────────────

export function LevelDictSelect(props: Omit<DictSelectProps, "category">) {
  return <DictSelect {...props} category="level" placeholder="请选择项目级别" />;
}

export function CategoryDictSelect(props: Omit<DictSelectProps, "category">) {
  return <DictSelect {...props} category="category" placeholder="请选择项目类别" />;
}

export function CompanyEntityDictSelect(props: Omit<DictSelectProps, "category">) {
  return <DictSelect {...props} category="companyEntity" placeholder="请选择收款公司主体" />;
}

// ── 多选组件 DictMultiSelect ──────────────────────────────────────────

export interface DictMultiSelectProps {
  /** 字典分类 */
  category: string;
  /** 已选名称数组 */
  value: string[];
  /** 变更回调：传入新的名称数组 */
  onChange: (names: string[]) => void;
  placeholder?: string;
  canEdit?: boolean;
  disabled?: boolean;
}

export function DictMultiSelect({
  category,
  value = [],
  onChange,
  placeholder = "请选择（可多选）",
  canEdit = false,
  disabled = false,
}: DictMultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<DictItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dropRect, setDropRect] = useState({ top: 0, left: 0, width: 0 });

  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  async function loadDict() {
    setLoading(true);
    try {
      const res = await fetch(`/api/major-projects/dicts?category=${category}`);
      const data = await res.json();
      if (data.rows) setItems(data.rows);
    } catch (err) {
      console.error("加载字典失败:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDict(); }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setIsOpen(false);
      setSearch("");
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [isOpen]);

  const activeItems = items.filter(i => i.isActive);
  const filteredItems = search
    ? activeItems.filter(i => i.value.toLowerCase().includes(search.toLowerCase()))
    : activeItems;

  function isSelected(item: DictItem) { return value.includes(item.value); }

  function handleToggle(e: React.MouseEvent, item: DictItem) {
    e.preventDefault();
    e.stopPropagation();
    if (isSelected(item)) {
      onChange(value.filter(v => v !== item.value));
    } else {
      onChange([...value, item.value]);
    }
  }

  function handleRemove(e: React.MouseEvent, name: string) {
    e.preventDefault();
    e.stopPropagation();
    onChange(value.filter(v => v !== name));
  }

  async function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const v = window.prompt("新增选项名称:");
    if (!v?.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/major-projects/dicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, value: v.trim() }),
      });
      const data = await res.json();
      if (data.error) { window.alert(`添加失败：${data.error}`); return; }
      await loadDict();
      onChange([...value, v.trim()]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* 触发区域：显示已选 Badge + 下拉箭头 */}
      <div
        ref={triggerRef}
        onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
        className={`
          relative flex flex-wrap items-center gap-1 min-h-[38px] px-3 py-1.5
          border border-gray-300 rounded-md bg-white cursor-pointer
          hover:border-gray-400 transition-colors
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          ${isOpen ? "ring-2 ring-blue-500 border-blue-500" : ""}
        `}
      >
        {value.length === 0 ? (
          <span className="text-gray-400 text-sm">{placeholder}</span>
        ) : (
          value.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700"
              onClick={e => e.stopPropagation()}
            >
              {name}
              {!disabled && (
                <X
                  size={11}
                  className="cursor-pointer hover:text-blue-900"
                  onClick={(e) => handleRemove(e, name)}
                />
              )}
            </span>
          ))
        )}
        <ChevronDown
          size={16}
          className={`ml-auto text-gray-400 transition-transform flex-shrink-0 ${isOpen ? "rotate-180" : ""}`}
        />
      </div>

      {/* 下拉面板 */}
      {isOpen && (
        <div
          ref={dropRef}
          className="fixed z-50 bg-white border border-gray-300 rounded-md shadow-lg"
          style={{
            top: dropRect.top,
            left: dropRect.left,
            width: dropRect.width,
            maxHeight: "300px",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div className="p-2 border-b border-gray-200">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索..."
              className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 size={20} className="animate-spin text-gray-400" />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400 text-center">
                {search ? "无匹配结果" : "暂无选项"}
              </div>
            ) : (
              filteredItems.map(item => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  onClick={e => handleToggle(e, item)}
                >
                  <div
                    className={`w-4 h-4 rounded flex-shrink-0 border-2 flex items-center justify-center transition-colors ${
                      isSelected(item) ? "bg-blue-600 border-blue-600" : "border-gray-300"
                    }`}
                  >
                    {isSelected(item) && <Check size={10} color="white" />}
                  </div>
                  <span className="text-sm text-gray-900">{item.value}</span>
                </div>
              ))
            )}
          </div>

          {canEdit && (
            <div className="border-t border-gray-200 p-2">
              <button
                onClick={handleAdd}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
                <span>新增选项</span>
              </button>
            </div>
          )}

          {saving && (
            <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-blue-600" />
            </div>
          )}
        </div>
      )}
    </>
  );
}
