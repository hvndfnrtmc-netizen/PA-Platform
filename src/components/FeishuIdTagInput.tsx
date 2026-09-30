"use client";

/**
 * 飞书 ID 标签输入组件
 *
 * 特性：
 * - 手动输入飞书 ID (oc_/ou_/on_) + 备注名称
 * - 保存到 localStorage 作为常用选项
 * - 展示为标签组（蓝色=群聊 oc_，绿色=个人 ou_/on_）
 * - 支持多选
 */

import React, { useEffect, useRef, useState } from "react";
import { X, Plus, MessageSquare, User, Check } from "lucide-react";

export interface FeishuIdTag {
  id: string;
  name: string;
}

export interface FeishuIdTagInputProps {
  value: FeishuIdTag[];
  onChange: (tags: FeishuIdTag[]) => void;
  placeholder?: string;
  disabled?: boolean;
  storageKey?: string; // localStorage key for saved targets
}

// ── LocalStorage ──────────────────────────────────────────────────────

function loadSavedTargets(key: string): FeishuIdTag[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "[]") as FeishuIdTag[];
  } catch {
    return [];
  }
}

function saveSavedTargets(key: string, list: FeishuIdTag[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

// ── 主组件 ────────────────────────────────────────────────────────────

export function FeishuIdTagInput({
  value,
  onChange,
  placeholder = "点击标签选择，或在下方手动添加",
  disabled = false,
  storageKey = "pa_feishu_saved_targets",
}: FeishuIdTagInputProps) {
  const [savedTargets, setSavedTargets] = useState<FeishuIdTag[]>([]);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [addErr, setAddErr] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const idRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSavedTargets(loadSavedTargets(storageKey));
  }, [storageKey]);

  const selectedIds = new Set(value.map(t => t.id));

  function handleToggle(target: FeishuIdTag) {
    if (disabled) return;
    if (selectedIds.has(target.id)) {
      onChange(value.filter(t => t.id !== target.id));
    } else {
      onChange([...value, target]);
    }
  }

  function handleDelete(id: string) {
    const next = savedTargets.filter(t => t.id !== id);
    setSavedTargets(next);
    saveSavedTargets(storageKey, next);
    // 如果删除的目标也在当前选中列表，同时移除
    if (selectedIds.has(id)) {
      onChange(value.filter(t => t.id !== id));
    }
  }

  function handleAdd() {
    const tid = newId.trim();
    const name = newName.trim();
    setAddErr("");
    if (!tid) {
      setAddErr("飞书 ID 不能为空");
      return;
    }
    if (/\s/.test(tid)) {
      setAddErr("ID 中不能包含空格");
      return;
    }
    if (!tid.startsWith("oc_") && !tid.startsWith("ou_") && !tid.startsWith("on_")) {
      setAddErr("ID 须以 oc_ / ou_ / on_ 开头");
      return;
    }
    if (!name) {
      setAddErr("备注名称不能为空");
      return;
    }
    if (savedTargets.some(t => t.id === tid)) {
      setAddErr("该 ID 已存在");
      return;
    }
    const newTarget = { id: tid, name };
    const next = [...savedTargets, newTarget];
    setSavedTargets(next);
    saveSavedTargets(storageKey, next);
    // 添加后自动选中
    onChange([...value, newTarget]);
    setNewId("");
    setNewName("");
    setShowManualInput(false); // 保存后自动收起
  }

  function handleCancel() {
    setNewId("");
    setNewName("");
    setAddErr("");
    setShowManualInput(false);
  }

  const isChat = (id: string) => id.startsWith("oc_");

  return (
    <div className="border border-gray-300 rounded-lg bg-white">
      {/* 已选标签区域 */}
      <div className="p-3 min-h-[48px]">
        {value.length === 0 ? (
          <p className="text-sm text-gray-400">{placeholder}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {value.map((tag) => {
              const isC = isChat(tag.id);
              return (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-medium"
                  style={{
                    border: `1.5px solid ${isC ? "#2563eb" : "#059669"}`,
                    background: isC ? "#eff6ff" : "#f0fdf4",
                    color: isC ? "#1d4ed8" : "#047857",
                  }}
                >
                  {isC ? <MessageSquare size={12} /> : <User size={12} />}
                  {tag.name}
                  {!disabled && (
                    <button
                      onClick={() => handleToggle(tag)}
                      className="hover:bg-opacity-20 rounded p-0.5"
                      type="button"
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* 可选列表区域 */}
      {!disabled && savedTargets.length > 0 && (
        <div className="border-t border-gray-200 p-3 bg-gray-50">
          <p className="text-xs text-gray-500 mb-2">常用选项（点击选择）</p>
          <div className="flex flex-wrap gap-2">
            {savedTargets.map((target) => {
              const isSel = selectedIds.has(target.id);
              const isC = isChat(target.id);
              return (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => handleToggle(target)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm transition-all"
                  style={{
                    border: `1.5px solid ${isSel ? (isC ? "#2563eb" : "#059669") : "#e2e8f0"}`,
                    background: isSel ? (isC ? "#eff6ff" : "#f0fdf4") : "white",
                    color: isSel ? (isC ? "#1d4ed8" : "#047857") : "#374151",
                    fontWeight: isSel ? 600 : 400,
                  }}
                >
                  {isSel ? (
                    <Check size={12} />
                  ) : isC ? (
                    <MessageSquare size={12} className="text-gray-400" />
                  ) : (
                    <User size={12} className="text-gray-400" />
                  )}
                  {target.name}
                  <button
                    type="button"
                    title="从地址簿删除"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(target.id);
                    }}
                    className="hover:bg-gray-200 rounded p-0.5"
                  >
                    <X size={10} />
                  </button>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 手动录入区域（可折叠） */}
      {!disabled && (
        <div className="border-t border-gray-200 p-3 bg-gray-50">
          {!showManualInput ? (
            <button
              type="button"
              onClick={() => setShowManualInput(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 border border-dashed border-gray-300 rounded-lg hover:border-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors w-full justify-center"
            >
              <Plus size={14} />
              找不到人？手动录入新人员
            </button>
          ) : (
            <div>
              <p className="text-xs text-gray-500 mb-2">添加新的飞书 ID</p>
              <div className="flex gap-2 items-start mb-2">
                <div className="flex-[0_0_160px]">
                  <input
                    ref={idRef}
                    value={newId}
                    onChange={(e) => {
                      setNewId(e.target.value);
                      setAddErr("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAdd();
                    }}
                    placeholder="oc_ / ou_ / on_"
                    className={`w-full px-2 py-1.5 text-sm border rounded font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      addErr ? "border-red-300" : "border-gray-300"
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <input
                    value={newName}
                    onChange={(e) => {
                      setNewName(e.target.value);
                      setAddErr("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAdd();
                    }}
                    placeholder="备注名称（如：PA群）"
                    className={`w-full px-2 py-1.5 text-sm border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      addErr ? "border-red-300" : "border-gray-300"
                    }`}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleAdd}
                  className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 whitespace-nowrap"
                >
                  <Plus size={12} />
                  保存
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-200 text-gray-700 text-sm font-medium rounded hover:bg-gray-300 whitespace-nowrap"
                >
                  取消
                </button>
              </div>
              {addErr && <p className="text-xs text-red-500 mb-2">{addErr}</p>}
              <p className="text-xs text-gray-400">
                蓝色标签 = 群聊（oc_） · 绿色标签 = 个人（ou_/on_）· 回车快速保存
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
