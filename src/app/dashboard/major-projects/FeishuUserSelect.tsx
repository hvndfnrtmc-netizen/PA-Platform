"use client";

/**
 * 飞书人员选择器组件
 *
 * 特性：
 * - 支持单选/多选
 * - 显示带头像的飞书人员卡片
 * - 搜索飞书通讯录
 * - 存储 feishuOpenId，显示 name + avatarUrl
 *
 * 使用示例：
 * <FeishuUserSelect
 *   value={ownerFeishuOpenId}
 *   onChange={(openId, user) => setOwner(openId)}
 *   placeholder="请选择负责人"
 *   mode="single"
 * />
 */

import React, { useState, useEffect, useRef } from "react";
import { X, ChevronDown, Search, Loader2, User } from "lucide-react";

// ── 类型定义 ──────────────────────────────────────────────────────────

export interface FeishuUser {
  feishuOpenId: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface FeishuUserSelectProps {
  value: string | null;
  onChange: (openId: string | null, user: FeishuUser | null) => void;
  placeholder?: string;
  disabled?: boolean;
}

// ── 主组件 ────────────────────────────────────────────────────────────

export function FeishuUserSelect({
  value,
  onChange,
  placeholder = "请选择人员",
  disabled = false,
}: FeishuUserSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<FeishuUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [dropRect, setDropRect] = useState({ top: 0, left: 0, width: 0 });
  // 已选用户的显示名缓存
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── 搜索飞书用户 ──────────────────────────────────────────────────────

  async function searchUsers(query: string) {
    if (!query.trim()) { setUsers([]); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/feishu/users/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.users) {
        setUsers(data.users.map((u: { open_id: string; name: string; email?: string; enterprise_email?: string; avatar_url?: string }) => ({
          feishuOpenId: u.open_id,
          name: u.name,
          email: u.enterprise_email || u.email || "",
          avatarUrl: u.avatar_url || "",
        })));
      }
    } catch (err) {
      console.error("搜索飞书用户失败:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim().length >= 2) searchUsers(search.trim());
      else setUsers([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

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
      setIsOpen(false); setSearch(""); setUsers([]);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [isOpen]);

  function handleSelect(user: FeishuUser) {
    onChange(user.feishuOpenId, user);
    setSelectedName(user.name);
    setIsOpen(false); setSearch(""); setUsers([]);
  }

  function handleClear(e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    onChange(null, null); setSelectedName(null);
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────

  const triggerLabel = value ? (selectedName ?? "已选择") : null;

  return (
    <>
      {/* Trigger */}
      <div
        ref={triggerRef}
        onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
        className={`
          relative flex items-center justify-between gap-2 px-3 py-2
          border border-gray-300 rounded-md bg-white cursor-pointer
          hover:border-gray-400 transition-colors
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
          ${isOpen ? "ring-2 ring-blue-500 border-blue-500" : ""}
        `}
      >
        <span className={triggerLabel ? "text-gray-900 text-sm" : "text-gray-400 text-sm"}>
          {triggerLabel || placeholder}
        </span>
        <div className="flex items-center gap-1">
          {triggerLabel && !disabled && (
            <X size={16} className="text-gray-400 hover:text-gray-600" onClick={handleClear} />
          )}
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div
          ref={dropRef}
          className="fixed z-50 bg-white border border-gray-300 rounded-md shadow-lg flex flex-col"
          style={{ top: dropRect.top, left: dropRect.left, width: dropRect.width, maxHeight: "360px" }}
        >
          <div className="p-2 border-b border-gray-200">
            <div className="relative">
              <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="输入姓名搜索（至少2字）..."
                className="w-full pl-7 pr-2 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 size={20} className="animate-spin text-gray-400" />
              </div>
            ) : search.trim().length < 2 ? (
              <div className="px-3 py-6 text-sm text-gray-400 text-center">请输入至少2个字符开始搜索</div>
            ) : users.length === 0 ? (
              <div className="px-3 py-6 text-sm text-gray-400 text-center">未找到匹配用户</div>
            ) : (
              users.map((user) => (
                <div
                  key={user.feishuOpenId}
                  onClick={() => handleSelect(user)}
                  className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-gray-50 ${value === user.feishuOpenId ? "bg-blue-50" : ""}`}
                >
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.name} className="w-8 h-8 rounded-full object-cover flex-shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                      <User size={14} className="text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{user.name}</div>
                    {user.email && <div className="text-xs text-gray-500 truncate">{user.email}</div>}
                  </div>
                  {value === user.feishuOpenId && (
                    <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3 text-white" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" stroke="currentColor">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
