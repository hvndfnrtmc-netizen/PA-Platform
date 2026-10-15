"use client";

/**
 * /dashboard/settings — 超级管理员后台
 * Tab：组织与人员 | 侧边栏菜单 | 模板配置 | 审计日志 | 系统文案配置 | 飞书通知配置
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Users, Building2, Settings2, ScrollText,
  ShieldCheck, Plus, Pencil, Trash2, AlertTriangle,
  Loader2, RefreshCw, X, ChevronLeft, ChevronRight,
  Search, FileText, Save, ExternalLink, CheckCircle2,
  Bell, MessageSquare, User, Settings, ChevronDown, ChevronUp, UserPlus,
  LayoutList, Eye, EyeOff, RotateCcw,
} from "lucide-react";
import FeishuChatLink from "@/components/FeishuChatLink";
import {
  ALL_NAV_ITEMS, CONFIG_ROLES, ROLE_LABEL, getNavItems, navKey,
} from "@/lib/nav-items";
import {
  type SidebarConfig,
  DEFAULT_SIDEBAR_CONFIG,
} from "@/lib/sidebar-config";

// ── 类型 ──────────────────────────────────────────────────────

interface Department {
  id: string;
  name: string;
  code: string;
  type: "PA" | "BUSINESS";
  isActive: boolean;
  _count: { users: number; taskAssignments: number };
}

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  feishuOpenId: string | null;
  departmentId: string | null;
  department: { id: string; name: string } | null;
  lastLoginAt: string | null;
  createdAt: string;
  hasPartyModuleAccess: boolean;
}

interface AuditLog {
  id: string;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  isDangerous: boolean;
  createdAt: string;
  user: { id: string; name: string; email: string; role: string };
}

// ── 配置 ──────────────────────────────────────────────────────

const ROLE_CFG: Record<string, { label: string; color: string; bg: string }> = {
  SUPER_ADMIN:   { label: "超级管理员", color: "#ef4444", bg: "rgba(239,68,68,0.1)"  },
  PA_SPECIALIST: { label: "PA 专员",   color: "#2563eb", bg: "rgba(37,99,235,0.1)"  },
  DEPT_CONTACT:  { label: "部门对接人", color: "#64748b", bg: "rgba(100,116,139,0.1)"},
};

const TABS = [
  { key: "org",             label: "组织与人员",   icon: Building2  },
  { key: "sidebar",         label: "侧边栏菜单",   icon: LayoutList },
  { key: "template",        label: "模板配置",     icon: Settings2  },
  { key: "audit",           label: "审计日志",     icon: ScrollText },
  { key: "config",          label: "系统文案配置", icon: FileText   },
  { key: "feishu_targets",  label: "飞书通知配置", icon: Bell       },
];

// ── 新建部门弹窗 ──────────────────────────────────────────────

function DeptFormModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"PA" | "BUSINESS">("BUSINESS");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim()) { setErr("部门名称不能为空"); return; }
    setSaving(true); setErr("");
    try {
      const autoCode = `DEPT_${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      const res = await fetch("/api/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), code: autoCode, type }),
      });
      if (!res.ok) {
        let msg = "创建失败";
        try {
          const d = await res.json();
          msg = d.detail ? `${d.error ?? "创建失败"}：${d.detail}` : (d.error ?? "创建失败");
        } catch { /* 非 JSON 响应 */ }
        throw new Error(msg);
      }
      onSaved();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h2 className="text-base font-bold text-slate-900">新增部门</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={16} className="text-slate-500" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-sm text-red-500 px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.08)" }}>{err}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">部门名称 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={{ border: "1px solid #e2e8f0" }} placeholder="如：财务部" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">部门类型</label>
            <select value={type} onChange={(e) => setType(e.target.value as "PA" | "BUSINESS")}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-white outline-none" style={{ border: "1px solid #e2e8f0" }}>
              <option value="BUSINESS">业务配合部门（填报方）</option>
              <option value="PA">公共事务部门（主控方）</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4" style={{ borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 font-medium">取消</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium hover:opacity-90 disabled:opacity-50"
            style={{ background: "#2563eb" }}>
            {saving ? "创建中..." : "创建部门"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 编辑部门弹窗 ──────────────────────────────────────────────

function EditDeptModal({
  dept, onClose, onSaved,
}: {
  dept: Department; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(dept.name);
  const [type, setType] = useState<"PA" | "BUSINESS">(dept.type);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim()) { setErr("部门名称不能为空"); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch(`/api/departments/${dept.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), type }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "更新失败");
      }
      onSaved();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h2 className="text-base font-bold text-slate-900">编辑部门</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={16} className="text-slate-500" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-sm text-red-500 px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.08)" }}>{err}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">部门名称 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={{ border: "1px solid #e2e8f0" }} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">部门类型</label>
            <select value={type} onChange={(e) => setType(e.target.value as "PA" | "BUSINESS")}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-white outline-none" style={{ border: "1px solid #e2e8f0" }}>
              <option value="BUSINESS">业务配合部门（填报方）</option>
              <option value="PA">公共事务部门（主控方）</option>
            </select>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4" style={{ borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 font-medium">取消</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium hover:opacity-90 disabled:opacity-50"
            style={{ background: "#2563eb" }}>
            {saving ? "保存中..." : "保存变更"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 飞书通讯录搜索结果类型 ─────────────────────────────────────────
interface FeishuUserResult {
  open_id:          string;
  name:             string;   // 中文名（优先存入 DB）
  en_name:          string;   // 英文名（仅展示，不单独入库）
  email:            string;
  enterprise_email: string;
  avatar_url:       string;
}

// ── 新建用户弹窗（含飞书通讯录搜索选人）─────────────────────────────

function UserFormModal({ departments, onClose, onSaved }: { departments: Department[]; onClose: () => void; onSaved: () => void }) {
  const [name,          setName]          = useState("");
  const [email,         setEmail]         = useState("");
  const [role,          setRole]          = useState("DEPT_CONTACT");
  const [departmentId,  setDepartmentId]  = useState("");
  const [feishuOpenId,  setFeishuOpenId]  = useState("");
  const [saving,        setSaving]        = useState(false);
  const [err,           setErr]           = useState("");

  const [searchQuery,   setSearchQuery]   = useState("");
  const [searchResults, setSearchResults] = useState<FeishuUserResult[]>([]);
  const [searching,     setSearching]     = useState(false);
  const [showDropdown,  setShowDropdown]  = useState(false);
  const [searchError,   setSearchError]   = useState<string | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node))
        setShowDropdown(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleSearchInput(q: string) {
    setSearchQuery(q);
    setShowDropdown(true);
    setSearchError(null);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!q.trim()) { setSearchResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/feishu/users/search?q=${encodeURIComponent(q.trim())}`);
        const data = await res.json();
        if (!res.ok) {
          setSearchError(data.error ?? `请求失败 (HTTP ${res.status})`);
          setSearchResults([]);
        } else {
          setSearchResults(data.users ?? []);
        }
      } catch (e) {
        setSearchError((e as Error).message ?? "网络错误");
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }

  function selectFeishuUser(u: FeishuUserResult) {
    // 始终将飞书中文名（name）存入系统 name 字段
    setName(u.name);
    setEmail(u.enterprise_email || u.email || "");
    // 搜索框展示 "中文名 (英文名)" 以便确认是否选对了人
    setSearchQuery(u.en_name && u.en_name !== u.name ? `${u.name} (${u.en_name})` : u.name);
    setShowDropdown(false);
  }

  async function submit() {
    if (!name.trim()) { setErr("姓名不能为空"); return; }
    if (!email.trim()) { setErr("邮箱不能为空"); return; }
    if (!feishuOpenId.trim()) { setErr("飞书 open_id 为必填项，请填写后提交"); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/users", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:         name.trim(),
          email:        email.trim(),
          role,
          departmentId: departmentId || null,
          feishuOpenId: feishuOpenId.trim(),
        }),
      });
      if (!res.ok) {
        let msg = "创建失败";
        try { const d = await res.json(); msg = d.error ?? msg; } catch { /* 非 JSON */ }
        throw new Error(msg);
      }
      onSaved();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h2 className="text-base font-bold text-slate-900">新增用户</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={16} className="text-slate-500" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-sm text-red-500 px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.08)" }}>{err}</p>}

          {/* 飞书通讯录搜索选人 */}
          <div ref={dropdownRef} className="relative">
            <label className="block text-xs font-medium text-slate-600 mb-1.5">
              从飞书通讯录搜索 <span className="text-slate-400 font-normal">（支持姓名/拼音）</span>
            </label>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(e) => handleSearchInput(e.target.value)}
                onFocus={() => searchQuery && setShowDropdown(true)}
                placeholder="输入姓名或拼音搜索全公司员工..."
                className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ border: "1px solid #e2e8f0" }}
              />
              {searching && (
                <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" />
              )}
            </div>

            {showDropdown && searchQuery.trim() && (
              <div className="absolute z-20 w-full mt-1 bg-white rounded-xl shadow-lg overflow-hidden"
                style={{ border: "1px solid #e2e8f0", maxHeight: 220 }}>
                {searching ? (
                  <div className="flex items-center justify-center py-6 text-slate-400 text-xs gap-2">
                    <Loader2 size={14} className="animate-spin" />搜索中...
                  </div>
                ) : searchError ? (
                  <div className="py-4 px-4 text-xs" style={{ color: "#dc2626" }}>
                    <p className="font-medium mb-1.5">⚠ 飞书搜索失败</p>
                    <p className="font-mono break-all" style={{ color: "#7f1d1d", background: "rgba(239,68,68,0.06)", padding: "6px 8px", borderRadius: 6 }}>
                      {searchError.split("\n")[0]}
                    </p>
                    {searchError.includes("99991663") && (
                      <div className="mt-2 text-slate-500 space-y-0.5">
                        <p className="font-medium text-slate-600">常见原因（99991663）：</p>
                        <p>① 飞书管理后台 → 应用管理 → <strong>通讯录权限范围</strong> 未设为「全员」</p>
                        <p>② 权限改动后未重新发布应用版本</p>
                        <a href="/api/feishu/debug" target="_blank" rel="noopener"
                          className="inline-block mt-1 underline" style={{ color: "#2563eb" }}>
                          点击查看完整诊断信息 →
                        </a>
                      </div>
                    )}
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-400">
                    未找到匹配员工
                  </div>
                ) : (
                  <div className="overflow-y-auto" style={{ maxHeight: 220 }}>
                    {searchResults.map((u) => (
                      <button
                        key={u.open_id}
                        onClick={() => selectFeishuUser(u)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                      >
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt={u.name}
                            className="w-7 h-7 rounded-full flex-shrink-0 object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white flex-shrink-0"
                            style={{ background: "linear-gradient(135deg,#2563eb,#06b6d4)" }}>
                            {u.name[0]}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">
                            {u.name}
                            {u.en_name && u.en_name !== u.name && (
                              <span className="ml-1.5 text-xs font-normal text-slate-400">({u.en_name})</span>
                            )}
                          </p>
                          <p className="text-xs text-slate-400 truncate">
                            {u.enterprise_email || u.email || "邮箱未知"}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-100" />
            <span className="text-xs text-slate-400">或手动填写</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">姓名 *</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={{ border: "1px solid #e2e8f0" }} placeholder="如：张三" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">邮箱 *</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={{ border: "1px solid #e2e8f0" }} placeholder="zhangsan@momenta.ai" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">角色</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-white outline-none" style={{ border: "1px solid #e2e8f0" }}>
              <option value="DEPT_CONTACT">部门对接人</option>
              <option value="PA_SPECIALIST">PA 专员</option>
              <option value="SUPER_ADMIN">超级管理员</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">所属部门</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-white outline-none" style={{ border: "1px solid #e2e8f0" }}>
              <option value="">-- 不绑定部门 --</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          {/* 飞书 open_id（必填）*/}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-600">
                飞书 open_id <span className="text-red-500">*</span>
              </label>
              <a
                href="https://open.feishu.cn/api-explorer/cli_a9707ec953b8dcd2?apiName=batch_get_id&project=contact&resource=user&version=v3"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-medium"
                style={{ color: "#2563eb" }}
              >
                <ExternalLink size={11} />跳转获取 ID
              </a>
            </div>
            <input
              value={feishuOpenId}
              onChange={(e) => setFeishuOpenId(e.target.value)}
              placeholder="ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none font-mono"
              style={{ border: `1px solid ${err.includes("open_id") ? "#fca5a5" : "#e2e8f0"}` }}
            />
            <p className="text-xs text-slate-400 mt-1">用于发送飞书消息卡片，在上方链接中输入邮箱即可获取</p>
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4" style={{ borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 font-medium">取消</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium hover:opacity-90 disabled:opacity-50"
            style={{ background: "#2563eb" }}>
            {saving ? "创建中..." : "创建用户"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 编辑用户弹窗 ──────────────────────────────────────────────

function EditUserModal({
  user, departments, onClose, onSaved,
}: {
  user: User; departments: Department[]; onClose: () => void; onSaved: () => void;
}) {
  const [role,         setRole]         = useState(user.role);
  const [departmentId, setDepartmentId] = useState(user.departmentId ?? "");
  const [feishuOpenId, setFeishuOpenId] = useState(user.feishuOpenId ?? "");
  const [saving,       setSaving]       = useState(false);
  const [err,          setErr]          = useState("");

  async function submit() {
    setSaving(true); setErr("");
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          role,
          departmentId:  departmentId || null,
          feishuOpenId:  feishuOpenId.trim() || null,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "更新失败"); }
      onSaved();
    } catch (e: unknown) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div>
            <h2 className="text-base font-bold text-slate-900">编辑用户</h2>
            <p className="text-xs text-slate-400 mt-0.5">{user.name} · {user.email}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={16} className="text-slate-500" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {err && <p className="text-sm text-red-500 px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.08)" }}>{err}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">角色</label>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-white outline-none" style={{ border: "1px solid #e2e8f0" }}>
              <option value="DEPT_CONTACT">部门对接人</option>
              <option value="PA_SPECIALIST">PA 专员</option>
              <option value="SUPER_ADMIN">超级管理员</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">所属部门</label>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm bg-white outline-none" style={{ border: "1px solid #e2e8f0" }}>
              <option value="">── 移出部门（置空）──</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {/* 飞书 open_id */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-600">飞书 open_id</label>
              <a
                href="https://open.feishu.cn/api-explorer/cli_a9707ec953b8dcd2?apiName=batch_get_id&project=contact&resource=user&version=v3"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-medium"
                style={{ color: "#2563eb" }}
              >
                <ExternalLink size={11} />跳转获取 ID
              </a>
            </div>
            <input
              value={feishuOpenId}
              onChange={(e) => setFeishuOpenId(e.target.value)}
              placeholder="ou_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none font-mono"
              style={{ border: "1px solid #e2e8f0" }}
            />
            {user.feishuOpenId && (
              <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                <CheckCircle2 size={11} />已配置，可发送飞书卡片
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-3 px-6 py-4" style={{ borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 font-medium">取消</button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium hover:opacity-90 disabled:opacity-50"
            style={{ background: "#2563eb" }}>
            {saving ? "保存中..." : "保存变更"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 党员模块授权拨动开关 ──────────────────────────────────────────

function PartyToggle({
  userId, userName, initial, onToast,
}: {
  userId: string; userName: string; initial: boolean;
  onToast: (msg: string, type: "success" | "error") => void;
}) {
  const [enabled, setEnabled] = useState(initial);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    const next = !enabled;
    try {
      const res = await fetch(`/api/users/${userId}/party-access`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ hasPartyModuleAccess: next }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "操作失败");
      }
      setEnabled(next);
      onToast(`已为 ${userName} ${next ? "开通" : "关闭"} 党员关系访问权限`, "success");
    } catch (e) {
      onToast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading}
      title={enabled ? "已开通，点击关闭" : "点击开通党员关系访问权限"}
      className="relative inline-flex items-center flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-200 disabled:opacity-50"
      style={{ background: enabled ? "#22c55e" : "#cbd5e1" }}
    >
      <span
        className="inline-block w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-transform duration-200"
        style={{ transform: enabled ? "translateX(18px)" : "translateX(2px)" }}
      />
    </button>
  );
}

// ── Toast 通知（自动 3s 消失） ────────────────────────────────────

function Toast({
  message, type, onDismiss,
}: {
  message: string; type: "success" | "error"; onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium text-white"
      style={{ background: type === "success" ? "#22c55e" : "#ef4444" }}
    >
      <span>{type === "success" ? "✓" : "✕"}</span>
      <span>{message}</span>
    </div>
  );
}

// ── 批量从飞书通讻录导入系统用户弹窗 ──────────────────────────────

interface FTSimple { id: string; name: string; feishuId: string; type: string; relatedGroups?: string[]; }

function BatchImportModal({
  departments,
  onClose,
  onSaved,
}: {
  departments: Department[];
  onClose: () => void;
  onSaved: (created: number, skipped: number) => void;
}) {
  const [allTargets,   setAllTargets]   = useState<FTSimple[]>([]);
  const [loadingFT,    setLoadingFT]    = useState(true);
  const [search,       setSearch]       = useState("");
  const [pendingIds,   setPendingIds]   = useState<Set<string>>(new Set());
  const [role,         setRole]         = useState("DEPT_CONTACT");
  const [departmentId, setDepartmentId] = useState("");
  const [importing,    setImporting]    = useState(false);
  const [err,          setErr]          = useState("");

  useEffect(() => {
    fetch("/api/admin/feishu-targets")
      .then(r => r.json() as Promise<{ targets?: FTSimple[] }>)
      .then(d => { setAllTargets(d.targets ?? []); setLoadingFT(false); })
      .catch(() => setLoadingFT(false));
  }, []);

  const groups  = allTargets.filter(t => t.type === "GROUP");
  const allUsers = allTargets.filter(t => t.type === "USER");

  const filteredGroups = search.trim()
    ? groups.filter(g => g.name.includes(search))
    : groups;
  const filteredUsers = search.trim()
    ? allUsers.filter(u => u.name.includes(search) || u.feishuId.includes(search))
    : allUsers;

  const pendingList = allUsers.filter(u => pendingIds.has(u.id));

  function toggleGroup(group: FTSimple) {
    const members = allUsers.filter(u => u.relatedGroups?.includes(group.name));
    if (members.length === 0) return;
    setPendingIds(prev => {
      const next = new Set(prev);
      const allIn = members.every(u => next.has(u.id));
      if (allIn) members.forEach(u => next.delete(u.id));
      else        members.forEach(u => next.add(u.id));
      return next;
    });
  }

  function toggleUser(u: FTSimple) {
    setPendingIds(prev => {
      const next = new Set(prev);
      if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
      return next;
    });
  }

  function groupCheckState(group: FTSimple): "all" | "some" | "none" {
    const members = allUsers.filter(u => u.relatedGroups?.includes(group.name));
    if (members.length === 0) return "none";
    const count = members.filter(u => pendingIds.has(u.id)).length;
    if (count === 0) return "none";
    if (count === members.length) return "all";
    return "some";
  }

  async function handleImport() {
    setErr("");
    if (pendingList.length === 0) { setErr("请先选择要导入的人员"); return; }
    if (!departmentId)            { setErr("请选择所属部门"); return; }
    setImporting(true);
    try {
      const payload = pendingList.map(u => ({
        name:     u.name,
        feishuId: u.feishuId,
        email:    `${u.feishuId}@momenta.mock`,
      }));
      const res = await fetch("/api/users/batch", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ users: payload, role, departmentId }),
      });
      const data = await res.json() as { created?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "导入失败");
      onSaved(data.created ?? 0, data.skipped ?? 0);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.45)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full mx-4 flex flex-col" style={{ maxWidth: 640, maxHeight: "88vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div>
            <p className="text-base font-bold text-slate-800">批量导入飞书联系人</p>
            <p className="text-xs text-slate-400 mt-0.5">从全局通讻录池选人或选群，一键批量开号</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 flex-shrink-0" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
            <Search size={13} className="text-slate-400" />
            <input type="text" placeholder="搜索群名或人名…" value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 text-sm outline-none bg-transparent text-slate-700" />
          </div>
        </div>

        {/* Body: selector + preview */}
        <div className="flex-1 overflow-hidden flex gap-0" style={{ minHeight: 0 }}>
          {/* Left: group + user selector */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4" style={{ borderRight: "1px solid #f1f5f9" }}>
            {loadingFT ? (
              <div className="flex justify-center py-8 text-slate-400"><Loader2 size={18} className="animate-spin" /></div>
            ) : (
              <>
                {/* Groups */}
                {filteredGroups.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                      <MessageSquare size={11} /> 按群聊选择（自动包含群成员）
                    </p>
                    <div className="space-y-1.5">
                      {filteredGroups.map(g => {
                        const state = groupCheckState(g);
                        const memberCount = allUsers.filter(u => u.relatedGroups?.includes(g.name)).length;
                        return (
                          <label key={g.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 cursor-pointer">
                            <input type="checkbox"
                              checked={state === "all"}
                              ref={el => { if (el) el.indeterminate = state === "some"; }}
                              onChange={() => toggleGroup(g)}
                              className="accent-blue-600 w-4 h-4 flex-shrink-0" />
                            <MessageSquare size={13} className="text-blue-500 flex-shrink-0" />
                            <span className="text-sm text-slate-700 flex-1">{g.name}</span>
                            <span className="text-xs text-slate-400">{memberCount} 人</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Individual users */}
                {filteredUsers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 mb-2 flex items-center gap-1.5">
                      <User size={11} /> 按个人选择
                    </p>
                    <div className="space-y-1.5">
                      {filteredUsers.map(u => (
                        <label key={u.id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-50 cursor-pointer">
                          <input type="checkbox"
                            checked={pendingIds.has(u.id)}
                            onChange={() => toggleUser(u)}
                            className="accent-emerald-600 w-4 h-4 flex-shrink-0" />
                          <User size={13} className="text-emerald-500 flex-shrink-0" />
                          <span className="text-sm text-slate-700 flex-1">{u.name}</span>
                          <span className="text-xs text-slate-400 font-mono">{u.feishuId.slice(0, 10)}…</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {filteredGroups.length === 0 && filteredUsers.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-8">没有匹配的联系人</p>
                )}
              </>
            )}
          </div>

          {/* Right: preview */}
          <div className="w-52 flex-shrink-0 overflow-y-auto px-4 py-4">
            <p className="text-xs font-semibold text-slate-500 mb-2">
              待导入（{pendingList.length} 人）
            </p>
            {pendingList.length === 0 ? (
              <p className="text-xs text-slate-400 text-center mt-6">请在左侧勾选</p>
            ) : (
              <div className="space-y-1.5">
                {pendingList.map(u => (
                  <div key={u.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg group/p"
                    style={{ background: "#f0fdf4", border: "1px solid rgba(5,150,105,0.15)" }}>
                    <User size={11} className="text-emerald-600 flex-shrink-0" />
                    <span className="text-xs text-slate-700 flex-1 truncate">{u.name}</span>
                    <button onClick={() => toggleUser(u)}
                      className="p-0.5 rounded opacity-0 group-hover/p:opacity-100 hover:bg-red-100 transition-all flex-shrink-0"
                      style={{ color: "#ef4444" }}><X size={10} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer: config + action */}
        <div className="px-6 py-4 flex-shrink-0 space-y-3" style={{ borderTop: "1px solid #f1f5f9" }}>
          {err && <p className="text-xs text-red-500 px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.08)" }}>{err}</p>}
          <p className="text-xs text-slate-500 font-medium">以下配置将统一应用于本次导入的所有人员：</p>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">所属部门 <span className="text-red-500">*</span></label>
              <select value={departmentId} onChange={e => setDepartmentId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none bg-white" style={{ border: "1px solid #e2e8f0" }}>
                <option value="">请选择…</option>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">系统角色</label>
              <select value={role} onChange={e => setRole(e.target.value)}
                className="w-full px-3 py-2 rounded-xl text-sm outline-none bg-white" style={{ border: "1px solid #e2e8f0" }}>
                <option value="DEPT_CONTACT">部门对接人</option>
                <option value="PA_SPECIALIST">PA 专员</option>
                <option value="SUPER_ADMIN">超级管理员</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-slate-400">邮箱将自动生成占位符（飞书ID@momenta.mock），可在创建后编辑修改。</p>
          <div className="flex justify-end gap-3 pt-1">
            <button onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">取消</button>
            <button onClick={() => void handleImport()} disabled={importing || pendingList.length === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#2563eb" }}>
              {importing ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
              {importing ? "导入中..." : `开始导入 ${pendingList.length} 人`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Tab: 组织与人员（折叠面板） ───────────────────────────────────

function OrgTab() {
  const [depts,          setDepts]          = useState<Department[]>([]);
  const [users,          setUsers]          = useState<User[]>([]);
  const [isLoading,      setIsLoading]      = useState(true);
  const [expanded,       setExpanded]       = useState<Set<string>>(new Set());
  const [showAddDept,    setShowAddDept]    = useState(false);
  const [showAddUser,    setShowAddUser]    = useState(false);
  const [showBatchImport,setShowBatchImport]= useState(false);
  const [editingUser,    setEditingUser]    = useState<User | null>(null);
  const [editingDept,    setEditingDept]    = useState<Department | null>(null);
  const [syncing,        setSyncing]        = useState(false);

  const [toast,      setToast]      = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [fetchError, setFetchError]  = useState<string | null>(null);
  const showToast = (msg: string, type: "success" | "error") => setToast({ msg, type });

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    setFetchError(null);
    try {
      const [usersRes, deptsRes] = await Promise.all([
        fetch("/api/users"),
        fetch("/api/departments"),
      ]);

      const parseOrThrow = async (res: Response, label: string) => {
        const text = await res.text().catch(() => "");
        if (!res.ok) {
          let msg = `${label} 请求失败 (HTTP ${res.status})`;
          if (text.trim()) {
            try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* ignore */ }
          }
          throw new Error(msg);
        }
        if (!text.trim()) throw new Error(`${label} 返回了空响应`);
        return JSON.parse(text) as Record<string, unknown>;
      };

      const [ud, dd] = await Promise.all([
        parseOrThrow(usersRes, "/api/users"),
        parseOrThrow(deptsRes, "/api/departments"),
      ]);

      setUsers((ud.users as User[]) ?? []);
      setDepts((dd.departments as Department[]) ?? []);
    } catch (e) {
      const msg = (e as Error).message ?? "加载失败";
      console.error("[OrgTab] fetchAll:", msg);
      setFetchError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  async function deleteUser(id: string, name: string) {
    if (!confirm(`确认删除用户「${name}」？此操作为软删除，可恢复。`)) return;
    await fetch(`/api/users/${id}`, { method: "DELETE" });
    fetchAll();
  }

  async function handleSyncFeishu() {
    setSyncing(true);
    try {
      const res  = await fetch("/api/admin/sync-feishu-users", { method: "POST" });
      const data = await res.json() as { success?: boolean; synced?: number; cleaned?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "同步失败");
      showToast(`同步完成，共拉取了 ${data.synced ?? 0} 名真实员工（清理假人 ${data.cleaned ?? 0} 个）`, "success");
      await fetchAll();
    } catch (e) {
      showToast(`同步失败：${(e as Error).message}`, "error");
    } finally {
      setSyncing(false);
    }
  }

  const byDept = new Map<string, User[]>();
  const unassigned: User[] = [];
  for (const u of users) {
    if (!u.departmentId) { unassigned.push(u); continue; }
    const arr = byDept.get(u.departmentId) ?? [];
    arr.push(u);
    byDept.set(u.departmentId, arr);
  }

  const renderUserRow = (u: User) => {
    const cfg = ROLE_CFG[u.role] ?? ROLE_CFG.DEPT_CONTACT;
    return (
      <div key={u.id}
        className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors group"
        style={{ borderTop: "1px solid #f8fafc" }}>
        <FeishuChatLink email={u.email}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}>
            {u.name[0].toUpperCase()}
          </div>
        </FeishuChatLink>
        <div className="flex-1 min-w-0">
          <FeishuChatLink email={u.email} showIcon={false}>
            <p className="text-sm font-medium text-slate-800 hover:text-blue-600 transition-colors">{u.name}</p>
          </FeishuChatLink>
          <p className="text-xs text-slate-400">{u.email}</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
          style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>

        {/* 飞书 open_id 状态 */}
        <span className="text-xs px-2 py-0.5 rounded-full flex-shrink-0 hidden sm:inline"
          style={u.feishuOpenId
            ? { background: "rgba(34,197,94,0.1)", color: "#16a34a" }
            : { background: "rgba(239,68,68,0.08)", color: "#dc2626" }}>
          {u.feishuOpenId ? "✓ 可发卡" : "未配 ID"}
        </span>

        {/* 党员模块授权列 */}
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-1">
          <span className="text-xs text-slate-400 hidden sm:inline">党员模块</span>
          {u.role === "SUPER_ADMIN" ? (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb" }}>
              超管默认
            </span>
          ) : (
            <PartyToggle
              userId={u.id}
              userName={u.name}
              initial={u.hasPartyModuleAccess}
              onToast={showToast}
            />
          )}
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
          <button className="p-1.5 rounded-lg hover:bg-blue-50" title="编辑" onClick={() => setEditingUser(u)}>
            <Pencil size={13} style={{ color: "#3b82f6" }} />
          </button>
          <button className="p-1.5 rounded-lg hover:bg-red-50" title="删除" onClick={() => deleteUser(u.id, u.name)}>
            <Trash2 size={13} style={{ color: "#ef4444" }} />
          </button>
        </div>
      </div>
    );
  };

  const renderAccordion = (key: string, header: React.ReactNode, members: User[], onEdit?: () => void) => {
    const open = expanded.has(key);
    return (
      <div key={key} className="rounded-2xl overflow-hidden mb-3"
        style={{ border: "1px solid #e2e8f0", background: "white" }}>
        <div
          onClick={() => toggle(key)}
          className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors group select-none">
          {header}
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-50 flex-shrink-0"
              title="编辑部门"
            >
              <Pencil size={13} style={{ color: "#3b82f6" }} />
            </button>
          )}
          <ChevronRight size={15} className="text-slate-400 flex-shrink-0 transition-transform duration-200"
            style={{ transform: open ? "rotate(90deg)" : "none" }} />
        </div>
        {open && (
          <div style={{ borderTop: "1px solid #f1f5f9" }}>
            {members.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-slate-400">
                <Users size={22} className="mb-2 opacity-30" />
                <p className="text-xs">该部门暂无成员</p>
              </div>
            ) : members.map(renderUserRow)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-700">
          组织架构（{depts.length} 个部门 · {users.length} 名用户）
        </h2>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setShowAddUser(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" }}>
            <Plus size={12} />新增用户
          </button>
          <button onClick={() => setShowBatchImport(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: "rgba(37,99,235,0.08)", color: "#1d4ed8", border: "1px solid rgba(37,99,235,0.2)" }}>
            <UserPlus size={12} />批量导入飞书联系人
          </button>
          <button onClick={() => setShowAddDept(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium text-white"
            style={{ background: "#2563eb" }}>
            <Plus size={12} />新增部门
          </button>
          <button
            onClick={() => void handleSyncFeishu()}
            disabled={syncing}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: syncing ? "#f1f5f9" : "linear-gradient(135deg,rgba(37,99,235,0.12),rgba(6,182,212,0.12))", color: syncing ? "#64748b" : "#0369a1", border: "1px solid rgba(6,182,212,0.3)" }}>
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {syncing ? "同步中..." : "同步飞书全量人员"}
          </button>
        </div>
      </div>

      {/* 加载失败提示 */}
      {fetchError && !isLoading && (
        <div className="flex items-start gap-3 px-4 py-4 rounded-2xl mb-4"
          style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <AlertTriangle size={15} style={{ color: "#ef4444", flexShrink: 0, marginTop: 1 }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-600">数据加载失败</p>
            <p className="text-xs text-red-400 mt-0.5 break-all">{fetchError}</p>
            <p className="text-xs text-slate-500 mt-1.5">
              如果错误信息包含 <code className="font-mono text-red-500">Unknown field</code>，请重启开发服务器（<code className="font-mono">npm run dev</code>）后刷新页面。
            </p>
          </div>
          <button onClick={fetchAll}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg flex-shrink-0"
            style={{ background: "rgba(239,68,68,0.1)", color: "#dc2626" }}>
            <RefreshCw size={11} />重试
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <>
          {depts.map((dept) => {
            const members = byDept.get(dept.id) ?? [];
            const uniqueRoles = [...new Set(members.map((u) => u.role))];
            return renderAccordion(
              dept.id,
              <>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: dept.type === "PA" ? "rgba(37,99,235,0.1)" : "rgba(100,116,139,0.1)" }}>
                  <Building2 size={16} style={{ color: dept.type === "PA" ? "#2563eb" : "#64748b" }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-semibold text-slate-800">{dept.name}</p>
                    {dept.type === "PA" && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                        style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}>主控方</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs text-slate-400">{members.length} 名成员</span>
                    {uniqueRoles.length > 0 && (
                      <>
                        <span className="text-xs text-slate-300">·</span>
                        <span className="text-xs text-slate-400">包含：</span>
                        {uniqueRoles.map((r) => {
                          const cfg = ROLE_CFG[r] ?? ROLE_CFG.DEPT_CONTACT;
                          return (
                            <span key={r} className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                              style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
              </>,
              members,
              () => setEditingDept(dept),
            );
          })}

          {renderAccordion(
            "__unassigned__",
            <>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "#f8fafc", border: "1px dashed #cbd5e1" }}>
                <Users size={16} className="text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-500">未分配部门</p>
                <p className="text-xs text-slate-400 mt-0.5">{unassigned.length} 名成员</p>
              </div>
            </>,
            unassigned,
          )}
        </>
      )}

      {showBatchImport && (
        <BatchImportModal
          departments={depts}
          onClose={() => setShowBatchImport(false)}
          onSaved={(created, skipped) => {
            setShowBatchImport(false);
            showToast(`成功导入 ${created} 人，${skipped} 人已存在系统中`, created > 0 ? "success" : "error");
            fetchAll();
          }}
        />
      )}
      {showAddDept && (
        <DeptFormModal onClose={() => setShowAddDept(false)} onSaved={() => { setShowAddDept(false); fetchAll(); }} />
      )}
      {editingDept && (
        <EditDeptModal
          dept={editingDept}
          onClose={() => setEditingDept(null)}
          onSaved={() => { setEditingDept(null); fetchAll(); }}
        />
      )}
      {showAddUser && (
        <UserFormModal departments={depts} onClose={() => setShowAddUser(false)} onSaved={() => { setShowAddUser(false); fetchAll(); }} />
      )}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          departments={depts}
          onClose={() => setEditingUser(null)}
          onSaved={() => { setEditingUser(null); fetchAll(); }}
        />
      )}

      {toast && (
        <Toast
          message={toast.msg}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}

// ── Tab: 审计日志 ──────────────────────────────────────────────

function AuditTab() {
  const [logs,       setLogs]       = useState<AuditLog[]>([]);
  const [total,      setTotal]      = useState(0);
  const [isLoading,  setIsLoading]  = useState(true);
  const [dangerous,  setDangerous]  = useState(false);
  const [page,       setPage]       = useState(0);
  const PAGE_SIZE = 30;

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    const params = new URLSearchParams({ take: String(PAGE_SIZE), skip: String(page * PAGE_SIZE) });
    if (dangerous) params.set("dangerous", "true");
    const res = await fetch(`/api/audit-logs?${params}`);
    const data = await res.json();
    setLogs(data.logs ?? []);
    setTotal(data.total ?? 0);
    setIsLoading(false);
  }, [dangerous, page]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">审计日志（共 {total} 条）</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={dangerous} onChange={(e) => { setDangerous(e.target.checked); setPage(0); }} />
            仅显示高危操作
          </label>
          <button onClick={fetchLogs} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
            <RefreshCw size={12} />刷新
          </button>
        </div>
      </div>
      <div className="bg-white rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
        {isLoading ? (
          <div className="flex justify-center py-12 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
        ) : (
          <table className="w-full">
            <thead>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">操作人</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">动作</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">操作对象</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">时间</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase">风险</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {logs.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-slate-400">暂无日志记录</td></tr>
              ) : logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 text-sm text-slate-700 font-medium">{log.user.name}</td>
                  <td className="px-5 py-3.5">
                    <span className="text-xs font-mono px-2 py-1 rounded"
                      style={{ background: "#f8fafc", color: "#475569", border: "1px solid #e2e8f0" }}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-sm text-slate-500">
                    {log.resourceType ? `${log.resourceType}${log.resourceId ? ` #${log.resourceId.slice(0, 8)}` : ""}` : "—"}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-400 font-mono">
                    {new Date(log.createdAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="px-5 py-3.5">
                    {log.isDangerous ? (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>⚡ 高危</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e" }}>常规</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: "1px solid #f1f5f9" }}>
            <span className="text-xs text-slate-400">第 {page + 1} / {totalPages} 页</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-40">
                <ChevronLeft size={14} className="text-slate-500" />
              </button>
              <button onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-40">
                <ChevronRight size={14} className="text-slate-500" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: 系统文案配置（傻瓜式结构化表单） ─────────────────────────
//
// 英文 Key 仅用于内部绑定，业务人员只看到中文 Label 和输入框。
// 保存时统一调用 PUT /api/system-config 做批量 Upsert。

interface SystemConfig {
  id:          string;
  key:         string;
  value:       string;
  description: string | null;
  updatedAt:   string;
}

// 固定表单结构：业务人员可见内容 + 内部 key 绑定
const CONFIG_SECTIONS = [
  {
    title:       "全局基础设置",
    description: "影响整个平台的品牌与基础展示内容",
    icon:        "🌐",
    fields: [
      {
        key:         "platform_name",
        label:       "平台主名称",
        hint:        "显示在侧边栏左上角的平台品牌名",
        type:        "input"    as const,
        placeholder: "瑞启深空 PA",
      },
      {
        key:         "sidebar_footer_text",
        label:       "侧边栏底部说明",
        hint:        "版权信息或支持联系方式（侧边栏展开时可见）",
        type:        "textarea" as const,
        placeholder: "© 2025 瑞启深空 · PA 部门",
      },
    ],
  },
  {
    title:       "各模块引导语文案",
    description: "各功能模块顶部的副标题和欢迎引导语",
    icon:        "📝",
    fields: [
      {
        key:         "dashboard_subtitle",
        label:       "数据中台 — 顶部副标题",
        hint:        "数据中台页面标题下方的描述文字",
        type:        "input" as const,
        placeholder: "所有核心结构化指标，均携带飞书溯源链接",
      },
      {
        key:         "reporting_subtitle",
        label:       "对外填报 — 顶部副标题",
        hint:        "对外填报页面标题下方的说明文字",
        type:        "input" as const,
        placeholder: "告别繁琐的表格流转，大幅减少各部门的重复性填报工作。",
      },
      {
        key:         "copilot_welcome",
        label:       "智库chat — 欢迎引导语",
        hint:        "智库 Chat 空状态页面的欢迎文案",
        type:        "input" as const,
        placeholder: "基于数据大盘与资质奖项库的智能问答助手，所有回答均附飞书溯源链接，严格防幻觉",
      },
    ],
  },
] as const;

type ConfigKey = typeof CONFIG_SECTIONS[number]["fields"][number]["key"];

function ConfigTab() {
  const [values,    setValues]    = useState<Partial<Record<ConfigKey, string>>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving,  setIsSaving]  = useState(false);
  const [dirty,     setDirty]     = useState(false);
  const [toast,     setToast]     = useState<{ msg: string; type: "success" | "error" } | null>(null);

  function showToast(msg: string, type: "success" | "error") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const fetchConfigs = useCallback(async () => {
    setIsLoading(true);
    try {
      const res  = await fetch("/api/system-config");
      const data = await res.json() as { configs?: SystemConfig[] };
      const map: Partial<Record<string, string>> = {};
      for (const c of data.configs ?? []) map[c.key] = c.value;
      setValues(map as Partial<Record<ConfigKey, string>>);
    } catch { /* silent */ }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  function handleChange(key: ConfigKey, val: string) {
    setValues(prev => ({ ...prev, [key]: val }));
    setDirty(true);
  }

  async function handleSave() {
    setIsSaving(true);
    try {
      const updates = (Object.entries(values) as [string, string | undefined][])
        .filter(([, v]) => v !== undefined && v.trim() !== "")
        .map(([key, value]) => ({ key, value: value!.trim() }));

      if (updates.length === 0) {
        showToast("没有需要保存的内容", "error");
        return;
      }

      const res = await fetch("/api/system-config", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ updates }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(d.error ?? "保存失败");
      }
      setDirty(false);
      showToast(`已保存 ${updates.length} 项配置`, "success");
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setIsSaving(false);
    }
  }

  const SaveButton = ({ compact = false }: { compact?: boolean }) => (
    <button
      onClick={handleSave}
      disabled={isSaving || !dirty}
      className={`flex items-center gap-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 ${
        compact ? "px-4 py-2" : "px-5 py-2.5"
      }`}
      style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}
    >
      {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
      {isSaving ? "保存中..." : "💾 保存所有更改"}
    </button>
  );

  return (
    <div className="max-w-2xl">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">系统文案配置</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {dirty
              ? <span className="text-amber-500 font-medium">● 有未保存的更改</span>
              : "修改后点击「保存」即可实时生效，无需重新部署"}
          </p>
        </div>
        <SaveButton compact />
      </div>

      {/* 安全提示 */}
      <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl text-xs"
        style={{ background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.2)", color: "#92400e" }}>
        <AlertTriangle size={14} style={{ color: "#f59e0b", flexShrink: 0, marginTop: 1 }} />
        <p>此处修改的文案将直接影响所有用户的界面展示，每次保存均写入审计日志。</p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : (
        <div className="space-y-5">
          {CONFIG_SECTIONS.map(section => (
            <div key={section.title} className="bg-white rounded-2xl shadow-sm overflow-hidden"
              style={{ border: "1px solid #e2e8f0" }}>

              {/* 分区标题 */}
              <div className="px-6 py-4 flex items-center gap-3"
                style={{ borderBottom: "1px solid #f1f5f9", background: "#fafafa" }}>
                <span className="text-xl">{section.icon}</span>
                <div>
                  <p className="text-sm font-semibold text-slate-700">{section.title}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{section.description}</p>
                </div>
              </div>

              {/* 表单字段 */}
              <div className="divide-y divide-slate-50">
                {section.fields.map(field => (
                  <div key={field.key} className="flex items-start gap-6 px-6 py-5">
                    {/* 中文 Label + Hint（不展示英文 Key） */}
                    <div className="w-48 flex-shrink-0 pt-0.5">
                      <p className="text-sm font-medium text-slate-700">{field.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{field.hint}</p>
                    </div>

                    {/* 输入控件 */}
                    <div className="flex-1">
                      {field.type === "textarea" ? (
                        <textarea
                          value={values[field.key] ?? ""}
                          onChange={e => handleChange(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          rows={3}
                          className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none resize-none text-slate-800 placeholder-slate-400"
                          style={{ border: "1px solid #e2e8f0", lineHeight: 1.6 }}
                          onFocus={e  => (e.target.style.borderColor = "#3b82f6")}
                          onBlur={e   => (e.target.style.borderColor = "#e2e8f0")}
                        />
                      ) : (
                        <input
                          type="text"
                          value={values[field.key] ?? ""}
                          onChange={e => handleChange(field.key, e.target.value)}
                          placeholder={field.placeholder}
                          className="w-full px-3.5 py-2.5 rounded-xl text-sm outline-none text-slate-800 placeholder-slate-400"
                          style={{ border: "1px solid #e2e8f0" }}
                          onFocus={e  => (e.target.style.borderColor = "#3b82f6")}
                          onBlur={e   => (e.target.style.borderColor = "#e2e8f0")}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* 底部保存按钮（有变更时才显示） */}
          {dirty && (
            <div className="flex justify-end pt-2">
              <SaveButton />
            </div>
          )}
        </div>
      )}

      {/* Toast 通知 */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium text-white"
          style={{ background: toast.type === "success" ? "#22c55e" : "#ef4444" }}
        >
          {toast.type === "success" ? "✓" : "✕"} {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Tab: 飞书通知配置 ─────────────────────────────────────────

interface FeishuTarget {
  id: string;
  name: string;
  feishuId: string;
  type: string;
  modules: string[];
  relatedGroups?: string[];
  createdAt: string;
}

interface Dept { id: string; name: string }

const MODULE_OPTS = [
  { value: "reception",          label: "会议接待",   color: "#2563eb", bg: "#eff6ff" },
  { value: "major-project",      label: "重大项目",   color: "#059669", bg: "#f0fdf4" },
  { value: "honor",              label: "荣誉资质",   color: "#d97706", bg: "#fffbeb" },
  { value: "talent",             label: "人才福利",   color: "#7c3aed", bg: "#f5f3ff" },
  { value: "talent-declaration", label: "人才申报",   color: "#9333ea", bg: "#faf5ff" },
  { value: "odc",                label: "ODC",        color: "#4f46e5", bg: "#eef2ff" },
  { value: "report",             label: "对外填报",   color: "#0891b2", bg: "#ecfeff" },
  { value: "agreement",          label: "落地协议",   color: "#0284c7", bg: "#f0f9ff" },
  { value: "party",              label: "党员关系",   color: "#dc2626", bg: "#fef2f2" },
  { value: "doc-gen",            label: "公文生成",   color: "#ea580c", bg: "#fff7ed" },
  { value: "chat",               label: "智库 Chat",  color: "#0d9488", bg: "#f0fdfa" },
  { value: "data",               label: "数据中台",   color: "#475569", bg: "#f8fafc" },
  { value: "all",                label: "全部可见",   color: "#ca8a04", bg: "#fefce8" },
];

const ROLE_OPTS = [
  { value: "DEPT_CONTACT",  label: "部门联系人" },
  { value: "PA_SPECIALIST", label: "PA 专员" },
  { value: "SUPER_ADMIN",   label: "超级管理员" },
];

function FeishuTargetsTab() {
  // ── State ─────────────────────────────────────────────────────
  const [targets,      setTargets]      = useState<FeishuTarget[]>([]);
  const [isLoading,    setIsLoading]    = useState(true);
  const [newId,        setNewId]        = useState("");
  const [newName,      setNewName]      = useState("");
  const [addErr,       setAddErr]       = useState("");
  const [saving,       setSaving]       = useState(false);
  const [syncing,      setSyncing]      = useState(false);
  const [syncingUsers, setSyncingUsers] = useState(false);
  const [poolOpen,     setPoolOpen]     = useState(false);
  const [cascadeMembers, setCascadeMembers] = useState(false);
  const [toast,        setToast]        = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // ── Batch modal state ─────────────────────────────────────────
  const [batchModal, setBatchModal] = useState<{
    open: boolean;
    moduleName: string;
    moduleLabel: string;
    selected: Set<string>;
    original: Set<string>;
    search: string;
  }>({ open: false, moduleName: "", moduleLabel: "", selected: new Set(), original: new Set(), search: "" });
  const [batchSaving, setBatchSaving] = useState(false);

  // ── User modal state ──────────────────────────────────────────
  const [userModal, setUserModal] = useState<{
    open: boolean;
    target: FeishuTarget | null;
    name: string;
    email: string;
    role: string;
    deptId: string;
  }>({ open: false, target: null, name: "", email: "", role: "DEPT_CONTACT", deptId: "" });
  const [depts,      setDepts]     = useState<Dept[]>([]);
  const [userSaving, setUserSaving] = useState(false);
  const [userErr,    setUserErr]    = useState("");

  // ── Helpers ───────────────────────────────────────────────────
  function showToast(msg: string, type: "success" | "error") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  }

  const fetchTargets = useCallback(async () => {
    setIsLoading(true);
    try {
      const res  = await fetch("/api/admin/feishu-targets");
      const data = await res.json() as { targets?: FeishuTarget[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "加载失败");
      setTargets(data.targets ?? []);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchTargets(); }, [fetchTargets]);

  // ── Handlers ──────────────────────────────────────────────────
  async function handleAdd() {
    const tid  = newId.trim();
    const name = newName.trim();
    setAddErr("");
    if (!tid)  { setAddErr("飞书 ID 不能为空"); return; }
    if (!/^(oc_|ou_|on_)/.test(tid)) { setAddErr("ID 须以 oc_ / ou_ / on_ 开头"); return; }
    if (!name) { setAddErr("备注名称不能为空"); return; }
    setSaving(true);
    try {
      const res  = await fetch("/api/admin/feishu-targets", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ name, feishuId: tid }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) { setAddErr(data.error ?? "添加失败"); return; }
      setNewId(""); setNewName("");
      showToast("通知目标已添加", "success");
      fetchTargets();
    } catch (e) {
      setAddErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`确认删除「${name}」？删除后各模块的通知弹窗将无法选择此目标。`)) return;
    try {
      const res = await fetch(`/api/admin/feishu-targets/${id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json() as { error?: string }; throw new Error(d.error ?? "删除失败"); }
      showToast("已删除", "success");
      setTargets(prev => prev.filter(t => t.id !== id));
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  }

  async function handleSyncChats() {
    setSyncing(true);
    try {
      const res  = await fetch("/api/admin/feishu-targets/sync-chats", { method: "POST" });
      const data = await res.json() as { synced?: number; message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "同步失败");
      showToast(data.message ?? `已同步 ${data.synced} 个群聊`, "success");
      fetchTargets();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncUsers() {
    setSyncingUsers(true);
    try {
      const res  = await fetch("/api/admin/feishu-targets/sync-users", { method: "POST" });
      const data = await res.json() as { success?: boolean; count?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "同步失败");
      showToast(`成功同步 ${data.count ?? 0} 个联系人`, "success");
      fetchTargets();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setSyncingUsers(false);
    }
  }

  function openBatchModal(mod: { value: string; label: string }) {
    const original = new Set(targets.filter(t => t.modules.includes(mod.value)).map(t => t.id));
    setBatchModal({ open: true, moduleName: mod.value, moduleLabel: mod.label, selected: new Set(original), original, search: "" });
  }

  async function handleSaveBatch() {
    setBatchSaving(true);
    try {
      const res = await fetch("/api/admin/feishu-targets/batch-module", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          moduleName: batchModal.moduleName,
          targetIds:  [...batchModal.selected],
        }),
      });
      const data = await res.json() as { ok?: boolean; changed?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "保存失败");
      showToast(`模块成员已更新（共 ${batchModal.selected.size} 人）`, "success");
      setBatchModal(prev => ({ ...prev, open: false }));
      fetchTargets();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setBatchSaving(false);
    }
  }

  async function openUserModal(t: FeishuTarget) {
    setUserErr("");
    setUserModal({ open: true, target: t, name: t.name, email: "", role: "DEPT_CONTACT", deptId: "" });
    if (depts.length === 0) {
      try {
        const res  = await fetch("/api/departments");
        const data = await res.json() as { departments?: Dept[] };
        setDepts(data.departments ?? []);
      } catch { /* ignore */ }
    }
  }

  async function handleSubmitUser() {
    setUserErr("");
    if (!userModal.name.trim())  { setUserErr("姓名不能为空"); return; }
    if (!userModal.email.trim()) { setUserErr("邮箱不能为空"); return; }
    if (!userModal.deptId)       { setUserErr("请选择所属部门"); return; }
    setUserSaving(true);
    try {
      const res = await fetch("/api/users", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          name:         userModal.name.trim(),
          email:        userModal.email.trim(),
          role:         userModal.role,
          departmentId: userModal.deptId,
          feishuOpenId: userModal.target?.feishuId ?? "",
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "创建失败");
      showToast("系统用户已创建", "success");
      setUserModal(prev => ({ ...prev, open: false }));
    } catch (e) {
      setUserErr((e as Error).message);
    } finally {
      setUserSaving(false);
    }
  }

  // ── Derived ───────────────────────────────────────────────────
  const poolGroups = targets.filter(t => t.feishuId.startsWith("oc_"));
  const poolUsers  = targets.filter(t => !t.feishuId.startsWith("oc_"));

  // ── Batch modal accordion derived ────────────────────────────
  const batchSearchTerm  = batchModal.search.trim().toLowerCase();
  const allBatchGroups   = targets.filter(t => t.feishuId.startsWith("oc_"));
  const allBatchUsers    = targets.filter(t => !t.feishuId.startsWith("oc_"));
  const batchGroupNames  = new Set(allBatchGroups.map(g => g.name));
  const batchOrphanUsers = allBatchUsers.filter(u =>
    !u.relatedGroups || u.relatedGroups.length === 0 || !u.relatedGroups.some(gn => batchGroupNames.has(gn))
  );
  const filteredBatchGroups = batchSearchTerm
    ? allBatchGroups.filter(g =>
        g.name.toLowerCase().includes(batchSearchTerm) ||
        g.feishuId.toLowerCase().includes(batchSearchTerm) ||
        allBatchUsers.some(u =>
          u.relatedGroups?.includes(g.name) &&
          (u.name.toLowerCase().includes(batchSearchTerm) || u.feishuId.toLowerCase().includes(batchSearchTerm))
        )
      )
    : allBatchGroups;
  const filteredOrphanUsers = batchSearchTerm
    ? batchOrphanUsers.filter(u => u.name.toLowerCase().includes(batchSearchTerm) || u.feishuId.toLowerCase().includes(batchSearchTerm))
    : batchOrphanUsers;

  return (
    <div className="max-w-3xl">
      {/* 说明 */}
      <div className="mb-5 flex items-start gap-3 px-4 py-3 rounded-xl text-xs"
        style={{ background: "rgba(37,99,235,0.05)", border: "1px solid rgba(37,99,235,0.15)", color: "#1e40af" }}>
        <Bell size={14} style={{ color: "#2563eb", flexShrink: 0, marginTop: 1 }} />
        <p>在此统一管理飞书通知接收方（群聊 / 个人）。以模块为单位批量分配联系人，各业务模块发送弹窗将自动读取对应名单。</p>
      </div>

      {/* ── 模块卡片区 ──────────────────────────────────────────── */}
      {isLoading ? (
        <div className="flex justify-center py-12 text-slate-400"><Loader2 size={20} className="animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-6">
          {MODULE_OPTS.map(mod => {
            const members = targets.filter(t => t.modules.includes(mod.value));
            return (
              <div key={mod.value} className="bg-white rounded-2xl shadow-sm overflow-hidden"
                style={{ border: `1.5px solid ${mod.color}30` }}>
                {/* Card header */}
                <div className="flex items-center justify-between px-5 py-3"
                  style={{ background: mod.bg, borderBottom: `1px solid ${mod.color}20` }}>
                  <span className="text-sm font-semibold" style={{ color: mod.color }}>{mod.label}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: `${mod.color}18`, color: mod.color }}>
                    {members.length} 人
                  </span>
                </div>
                {/* Member chips */}
                <div className="px-5 py-3 min-h-[64px] flex flex-wrap gap-1.5">
                  {members.length === 0 ? (
                    <span className="text-xs text-slate-400 self-center">暂无成员</span>
                  ) : members.slice(0, 8).map(t => (
                    <span key={t.id}
                      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
                      style={{
                        background: t.feishuId.startsWith("oc_") ? "rgba(37,99,235,0.08)" : "rgba(5,150,105,0.08)",
                        color:      t.feishuId.startsWith("oc_") ? "#1d4ed8" : "#047857",
                        border:     `1px solid ${t.feishuId.startsWith("oc_") ? "rgba(37,99,235,0.2)" : "rgba(5,150,105,0.2)"}`,
                      }}>
                      {t.feishuId.startsWith("oc_") ? <MessageSquare size={9} /> : <User size={9} />}
                      {t.name}
                    </span>
                  ))}
                  {members.length > 8 && (
                    <span className="text-xs text-slate-400 self-center">+{members.length - 8} 更多</span>
                  )}
                </div>
                {/* Batch add button */}
                <div className="px-5 pb-4">
                  <button
                    onClick={() => openBatchModal(mod)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold transition-colors"
                    style={{ border: `1.5px dashed ${mod.color}60`, color: mod.color, background: `${mod.color}06` }}
                  >
                    ⚙️ 管理模块成员
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 手动新增表单 ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm mb-5 overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderBottom: "1px solid #f1f5f9", background: "#fafafa" }}>
          <Plus size={15} style={{ color: "#2563eb" }} />
          <p className="text-sm font-semibold text-slate-700">手动新增通知目标</p>
        </div>
        <div className="px-6 py-5 space-y-3">
          {addErr && (
            <p className="text-xs text-red-500 px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.08)" }}>{addErr}</p>
          )}
          <div className="flex gap-3">
            <div className="flex-[0_0_200px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">飞书 ID <span className="text-red-500">*</span></label>
              <input
                value={newId}
                onChange={e => { setNewId(e.target.value); setAddErr(""); }}
                onKeyDown={e => { if (e.key === "Enter") void handleAdd(); }}
                placeholder="oc_ / ou_ / on_"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none font-mono"
                style={{ border: `1px solid ${addErr ? "#fca5a5" : "#e2e8f0"}` }}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-600 mb-1">备注名称 <span className="text-red-500">*</span></label>
              <input
                value={newName}
                onChange={e => { setNewName(e.target.value); setAddErr(""); }}
                onKeyDown={e => { if (e.key === "Enter") void handleAdd(); }}
                placeholder="如：PA小群、Zoe"
                className="w-full px-3 py-2 rounded-xl text-sm outline-none"
                style={{ border: `1px solid ${addErr ? "#fca5a5" : "#e2e8f0"}` }}
              />
            </div>
          </div>
          <p className="text-xs text-slate-400">蓝色 = 群聊（oc_） · 绿色 = 个人（ou_ / on_）· 按回车快速添加</p>
          <div className="flex items-start gap-3 flex-wrap">
            <button
              onClick={() => void handleAdd()}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "#2563eb" }}
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {saving ? "添加中..." : "+ 新增配置"}
            </button>

            {/* 从飞书多维表格同步联系人 */}
            <div>
              <button
                onClick={() => void handleSyncUsers()}
                disabled={syncingUsers}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50"
                style={{ background: syncingUsers ? "#f1f5f9" : "rgba(37,99,235,0.08)", color: syncingUsers ? "#64748b" : "#1d4ed8", border: "1.5px solid rgba(37,99,235,0.25)" }}
              >
                {syncingUsers ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                {syncingUsers ? "同步中..." : "🔄 从飞书多维表格同步联系人"}
              </button>
              <p className="text-xs text-slate-400 mt-1.5 max-w-xs">从飞书通讯录多维表格（@艾特）自动解析并同步个人通知目标。</p>
            </div>

            {/* 飞书通讻录源表快捷入口 */}
            <div>
              <a
                href="https://momenta.feishu.cn/wiki/TUPGwcjXAi7FQhklMSxcoTH5neX?table=tbljHYnKPMTbvrtZ&view=vewpK1k9Xa"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: "rgba(234,88,12,0.07)", color: "#c2410c", border: "1.5px solid rgba(234,88,12,0.25)" }}
              >
                <ExternalLink size={13} />
                编辑飞书通讯录源表
              </a>
              <p className="text-xs text-slate-400 mt-1.5 max-w-xs">跳转飞书多维表格，直接修改通讯录底层数据后再同步。</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 全局目标池（可折叠） ──────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
        <button
          onClick={() => setPoolOpen(v => !v)}
          className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
          style={{ borderBottom: poolOpen ? "1px solid #f1f5f9" : "none", background: "#fafafa" }}
        >
          <span className="text-sm font-semibold text-slate-700">全局通知目标池（{targets.length} 个）</span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">{poolOpen ? "收起" : "展开查看 / 删除"}</span>
            {poolOpen ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
          </div>
        </button>

        {poolOpen && (
          <div className="p-4 space-y-2">
            {poolGroups.map(group => {
              const members = poolUsers.filter(u => u.relatedGroups?.includes(group.name));
              return (
                <details key={group.id} className="group/g rounded-xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
                  <summary className="cursor-pointer px-4 py-2.5 flex items-center justify-between bg-slate-50 hover:bg-slate-100 outline-none list-none"
                    style={{ borderBottom: "1px solid transparent" }}>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-400 transition-transform group-open/g:rotate-90 inline-block text-[10px]">▶</span>
                      <MessageSquare size={13} className="text-blue-500 flex-shrink-0" />
                      <span className="text-sm font-semibold text-blue-700">{group.name}</span>
                      <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{members.length} 人</span>
                    </div>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleDelete(group.id, group.name); }}
                      className="p-0.5 rounded opacity-0 group-hover/g:opacity-100 hover:bg-red-100 transition-all"
                      style={{ color: "#ef4444" }} title="删除群聊">
                      <X size={11} />
                    </button>
                  </summary>
                  <div className="px-4 py-3 bg-white flex flex-wrap gap-2" style={{ borderTop: "1px solid #f1f5f9" }}>
                    {members.length === 0 ? (
                      <span className="text-xs text-slate-400">暂无解析到的人员（请先「从多维表格同步联系人」）</span>
                    ) : members.map(u => (
                      <div key={u.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs group/u"
                        style={{ background: "#f0fdf4", border: "1px solid rgba(5,150,105,0.2)", color: "#047857" }}>
                        <User size={11} />
                        <span>{u.name}</span>
                        <button onClick={() => void openUserModal(u)}
                          className="p-0.5 rounded opacity-0 group-hover/u:opacity-100 hover:bg-emerald-100 transition-all"
                          style={{ color: "#059669" }} title="转为系统用户"><UserPlus size={10} /></button>
                        <button onClick={() => void handleDelete(u.id, u.name)}
                          className="p-0.5 rounded opacity-0 group-hover/u:opacity-100 hover:bg-red-100 transition-all"
                          style={{ color: "#ef4444" }} title="删除"><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })}

            {/* 没有群归属的孤立人员 */}
            {(() => {
              const poolGroupNames = new Set(poolGroups.map(g => g.name));
              const orphans = poolUsers.filter(u => !u.relatedGroups || u.relatedGroups.length === 0 || !u.relatedGroups.some(gn => poolGroupNames.has(gn)));
              if (orphans.length === 0) return null;
              return (
                <details className="group/o rounded-xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
                  <summary className="cursor-pointer px-4 py-2.5 flex items-center gap-2 bg-slate-50 hover:bg-slate-100 outline-none list-none">
                    <span className="text-slate-400 transition-transform group-open/o:rotate-90 inline-block text-[10px]">▶</span>
                    <User size={13} className="text-slate-400 flex-shrink-0" />
                    <span className="text-sm font-semibold text-slate-600">其他人员</span>
                    <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{orphans.length} 人</span>
                  </summary>
                  <div className="px-4 py-3 bg-white flex flex-wrap gap-2" style={{ borderTop: "1px solid #f1f5f9" }}>
                    {orphans.map(u => (
                      <div key={u.id}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs group/u"
                        style={{ background: "#f0fdf4", border: "1px solid rgba(5,150,105,0.2)", color: "#047857" }}>
                        <User size={11} />
                        <span>{u.name}</span>
                        <button onClick={() => void openUserModal(u)}
                          className="p-0.5 rounded opacity-0 group-hover/u:opacity-100 hover:bg-emerald-100 transition-all"
                          style={{ color: "#059669" }} title="转为系统用户"><UserPlus size={10} /></button>
                        <button onClick={() => void handleDelete(u.id, u.name)}
                          className="p-0.5 rounded opacity-0 group-hover/u:opacity-100 hover:bg-red-100 transition-all"
                          style={{ color: "#ef4444" }} title="删除"><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })()}
          </div>
        )}
      </div>

      {/* ── 批量选择弹窗 ──────────────────────────────────────────── */}
      {batchModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 flex flex-col" style={{ maxHeight: "80vh" }}>
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
              <div>
                <p className="text-base font-semibold text-slate-800">批量配置「{batchModal.moduleLabel}」成员</p>
                <p className="text-xs text-slate-400 mt-0.5">已选 {batchModal.selected.size} 人</p>
              </div>
              <button onClick={() => setBatchModal(prev => ({ ...prev, open: false }))}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
            </div>
            <div className="px-6 py-3" style={{ borderBottom: "1px solid #f1f5f9" }}>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <Search size={13} className="text-slate-400" />
                <input
                  type="text"
                  placeholder="搜索姓名或飞书 ID…"
                  value={batchModal.search}
                  onChange={e => setBatchModal(prev => ({ ...prev, search: e.target.value }))}
                  className="flex-1 text-sm outline-none bg-transparent text-slate-700"
                />
              </div>
              <label className="flex items-center justify-between mt-2.5 cursor-pointer select-none">
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="checkbox"
                    checked={cascadeMembers}
                    onChange={e => setCascadeMembers(e.target.checked)}
                    className="accent-blue-600 w-3.5 h-3.5"
                  />
                  <span>勾选群聊时，同时勾选群内所有成员</span>
                </div>
                <span className="text-xs text-slate-400">大多数通知仅需发送到群</span>
              </label>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-2">
              {filteredBatchGroups.map(t => {
                const allGrpMembers = allBatchUsers.filter(u => u.relatedGroups?.includes(t.name));
                const visMembers    = batchSearchTerm
                  ? allGrpMembers.filter(u => u.name.toLowerCase().includes(batchSearchTerm) || u.feishuId.toLowerCase().includes(batchSearchTerm))
                  : allGrpMembers;
                const checkedCount = allGrpMembers.filter(u => batchModal.selected.has(u.id)).length;
                return (
                  <details key={t.id} className="group/b rounded-xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
                    <summary className="cursor-pointer px-4 py-2.5 flex items-center gap-3 bg-slate-50 hover:bg-slate-100 outline-none list-none">
                      <span onClick={e => e.stopPropagation()}>
                        <input type="checkbox"
                          checked={batchModal.selected.has(t.id)}
                          onChange={() => setBatchModal(prev => {
                            const next = new Set(prev.selected);
                            const adding = !next.has(t.id);
                            if (adding) {
                              next.add(t.id);
                              if (cascadeMembers) allGrpMembers.forEach(u => next.add(u.id));
                            } else {
                              next.delete(t.id);
                              if (cascadeMembers) allGrpMembers.forEach(u => next.delete(u.id));
                            }
                            return { ...prev, selected: next };
                          })}
                          className="accent-blue-600 w-4 h-4" />
                      </span>
                      <span className="text-slate-400 group-open/b:rotate-90 transition-transform inline-block text-[10px] flex-shrink-0">▶</span>
                      <MessageSquare size={13} className="text-blue-500 flex-shrink-0" />
                      <span className="text-sm text-slate-700 flex-1 font-medium">{t.name}</span>
                      <span className="text-xs text-slate-400">
                        {allGrpMembers.length > 0
                          ? `${checkedCount}/${allGrpMembers.length} 人`
                          : <span className="font-mono">{t.feishuId.slice(0, 12)}…</span>}
                      </span>
                    </summary>
                    <div className="px-4 py-2 bg-white flex flex-col gap-0.5" style={{ borderTop: "1px solid #f1f5f9" }}>
                      {visMembers.length === 0 ? (
                        <span className="text-xs text-slate-400 py-1">暂无成员</span>
                      ) : visMembers.map(u => (
                        <label key={u.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                          <input type="checkbox"
                            checked={batchModal.selected.has(u.id)}
                            onChange={() => setBatchModal(prev => {
                              const next = new Set(prev.selected);
                              if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                              return { ...prev, selected: next };
                            })}
                            className="accent-emerald-600 w-4 h-4" />
                          <User size={13} className="text-emerald-500 flex-shrink-0" />
                          <span className="text-sm text-slate-700">{u.name}</span>
                        </label>
                      ))}
                    </div>
                  </details>
                );
              })}
              {filteredOrphanUsers.length > 0 && (
                <details className="group/bo rounded-xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
                  <summary className="cursor-pointer px-4 py-2.5 flex items-center gap-3 bg-slate-50 hover:bg-slate-100 outline-none list-none">
                    <span className="w-4 h-4 flex-shrink-0" />
                    <span className="text-slate-400 group-open/bo:rotate-90 transition-transform inline-block text-[10px] flex-shrink-0">▶</span>
                    <User size={13} className="text-slate-400 flex-shrink-0" />
                    <span className="text-sm text-slate-600 flex-1 font-medium">其他人员</span>
                    <span className="text-xs text-slate-400">
                      {filteredOrphanUsers.filter(u => batchModal.selected.has(u.id)).length}/{filteredOrphanUsers.length} 人
                    </span>
                  </summary>
                  <div className="px-4 py-2 bg-white flex flex-col gap-0.5" style={{ borderTop: "1px solid #f1f5f9" }}>
                    {filteredOrphanUsers.map(u => (
                      <label key={u.id} className="flex items-center gap-3 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox"
                          checked={batchModal.selected.has(u.id)}
                          onChange={() => setBatchModal(prev => {
                            const next = new Set(prev.selected);
                            if (next.has(u.id)) next.delete(u.id); else next.add(u.id);
                            return { ...prev, selected: next };
                          })}
                          className="accent-emerald-600 w-4 h-4" />
                        <User size={13} className="text-emerald-500 flex-shrink-0" />
                        <span className="text-sm text-slate-700 flex-1">{u.name}</span>
                        <span className="text-xs text-slate-400 font-mono">{u.feishuId.slice(0, 12)}…</span>
                      </label>
                    ))}
                  </div>
                </details>
              )}
              {filteredBatchGroups.length === 0 && filteredOrphanUsers.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-8">没有匹配的联系人</p>
              )}
            </div>
            <div className="px-6 py-4 flex justify-end gap-3" style={{ borderTop: "1px solid #f1f5f9" }}>
              <button onClick={() => setBatchModal(prev => ({ ...prev, open: false }))}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">取消</button>
              <button onClick={() => void handleSaveBatch()} disabled={batchSaving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#2563eb" }}>
                {batchSaving ? <Loader2 size={13} className="animate-spin" /> : null}
                {batchSaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 转为系统用户弹窗 ─────────────────────────────────────── */}
      {userModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
              <p className="text-base font-semibold text-slate-800">转为系统用户</p>
              <button onClick={() => setUserModal(prev => ({ ...prev, open: false }))}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {userErr && (
                <p className="text-xs text-red-500 px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.08)" }}>{userErr}</p>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">姓名 <span className="text-red-500">*</span></label>
                <input value={userModal.name} onChange={e => setUserModal(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ border: "1px solid #e2e8f0" }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">邮箱 <span className="text-red-500">*</span></label>
                <input type="email" value={userModal.email} onChange={e => setUserModal(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ border: "1px solid #e2e8f0" }} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">所属部门 <span className="text-red-500">*</span></label>
                <select value={userModal.deptId} onChange={e => setUserModal(prev => ({ ...prev, deptId: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ border: "1px solid #e2e8f0" }}>
                  <option value="">请选择…</option>
                  {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">系统角色</label>
                <select value={userModal.role} onChange={e => setUserModal(prev => ({ ...prev, role: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl text-sm outline-none" style={{ border: "1px solid #e2e8f0" }}>
                  {ROLE_OPTS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <p className="text-xs text-slate-400">飞书 Open ID：<span className="font-mono">{userModal.target?.feishuId}</span></p>
            </div>
            <div className="px-6 pb-5 flex justify-end gap-3">
              <button onClick={() => setUserModal(prev => ({ ...prev, open: false }))}
                className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100">取消</button>
              <button onClick={() => void handleSubmitUser()} disabled={userSaving}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: "#059669" }}>
                {userSaving ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                {userSaving ? "创建中..." : "创建系统用户"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-[9999] flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-sm font-medium text-white"
          style={{ background: toast.type === "success" ? "#22c55e" : "#ef4444" }}
        >
          {toast.type === "success" ? "✓" : "✕"} {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Tab: 侧边栏菜单（显示 / 隐藏 + 账号权限关联） ────────────────

function SidebarMenuTab() {
  const [cfg, setCfg]           = useState<SidebarConfig>(DEFAULT_SIDEBAR_CONFIG);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [dirty, setDirty]       = useState(false);
  const [msg, setMsg]           = useState("");
  const [err, setErr]           = useState("");
  const [accounts, setAccounts] = useState<User[]>([]);
  const [pickEmail, setPickEmail] = useState("");

  useEffect(() => {
    void load();
    void loadAccounts();
  }, []);

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch("/api/sidebar-config");
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "读取配置失败");
      setCfg({ ...DEFAULT_SIDEBAR_CONFIG, ...(d.config ?? {}) });
      setDirty(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "读取配置失败");
    } finally {
      setLoading(false);
    }
  }

  async function loadAccounts() {
    try {
      const r = await fetch("/api/users?take=200");
      const d = await r.json();
      if (r.ok && Array.isArray(d.users)) setAccounts(d.users as User[]);
    } catch {
      /* 账号列表拉取失败不阻塞主流程 */
    }
  }

  function patch(next: Partial<SidebarConfig>) {
    setCfg((c) => ({ ...c, ...next }));
    setDirty(true);
    setMsg("");
  }

  /** 全局显示开关：只有显式 false 才是隐藏 */
  function isVisible(key: string) {
    return cfg.global[key] !== false;
  }

  function toggleGlobal(key: string) {
    const g = { ...cfg.global };
    if (isVisible(key)) g[key] = false;
    else delete g[key];
    patch({ global: g });
  }

  /** 某菜单当前允许的角色（未配置 = 全部角色） */
  function rolesOf(key: string): string[] {
    const s = cfg.roleScope[key];
    return Array.isArray(s) && s.length > 0 ? s : [...CONFIG_ROLES];
  }

  function toggleRole(key: string, role: string) {
    const cur  = rolesOf(key);
    const next = cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role];
    const rs   = { ...cfg.roleScope };
    const g    = { ...cfg.global };

    if (next.length === 0) {
      // 没有任何角色可见 → 等价于全局隐藏
      g[key] = false;
      delete rs[key];
    } else if (next.length === CONFIG_ROLES.length) {
      // 三个角色都允许 → 回到「不额外限制」
      delete rs[key];
      delete g[key];
    } else {
      rs[key] = next;
      delete g[key];
    }
    patch({ roleScope: rs, global: g });
  }

  /** 角色默认可见性（不含任何显示配置），用于给管理员一个参照 */
  function defaultRolesFor(key: string): string[] {
    return CONFIG_ROLES.filter((role) =>
      getNavItems(role, [], false, null).some((i) => navKey(i) === key),
    );
  }

  function modsOf(email: string): string[] {
    return cfg.accountWhitelist[email] ?? [];
  }

  function toggleAccountMod(email: string, key: string) {
    const cur  = modsOf(email);
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    patch({ accountWhitelist: { ...cfg.accountWhitelist, [email]: next } });
  }

  function addAccount(raw: string) {
    const e = raw.trim().toLowerCase();
    if (!e) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setErr("邮箱格式不合法：" + e);
      return;
    }
    setErr("");
    patch({
      accountWhitelist: { ...cfg.accountWhitelist, [e]: cfg.accountWhitelist[e] ?? [] },
    });
    setPickEmail("");
  }

  function removeAccount(email: string) {
    const next = { ...cfg.accountWhitelist };
    delete next[email];
    patch({ accountWhitelist: next });
  }

  async function save() {
    setSaving(true);
    setErr("");
    setMsg("");
    try {
      const r = await fetch("/api/sidebar-config", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ config: cfg }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error ?? "保存失败");
      setCfg({ ...DEFAULT_SIDEBAR_CONFIG, ...(d.config ?? {}) });
      setDirty(false);
      setMsg("已保存。刷新页面（或重新进入）后侧边栏即按新配置渲染。");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const hiddenCount   = ALL_NAV_ITEMS.filter((i) => !isVisible(navKey(i))).length;
  const accountList   = Object.keys(cfg.accountWhitelist);
  /** 已加入白名单的账号从下拉里剔除 */
  const pickCandidates = accounts.filter(
    (u) => !Object.prototype.hasOwnProperty.call(cfg.accountWhitelist, (u.email ?? "").toLowerCase()),
  );

  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-12 shadow-sm text-center" style={{ border: "1px solid #e2e8f0" }}>
        <Loader2 size={22} className="animate-spin mx-auto mb-3 text-slate-400" />
        <p className="text-sm text-slate-400">正在读取侧边栏配置…</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* 卡片头 */}
      <div className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "linear-gradient(135deg,#2563eb,#06b6d4)" }}>
              <LayoutList size={17} className="text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-800">侧边栏菜单显示</h2>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
                控制左侧导航栏渲染哪些菜单入口。隐藏只影响<span className="font-medium text-slate-600">入口是否出现</span>，
                <span className="font-medium text-slate-600">不会删除任何页面与数据</span>；隐藏后直接访问该模块网址依然可用。
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setCfg({ ...DEFAULT_SIDEBAR_CONFIG, global: {}, roleScope: {}, accountWhitelist: {} }); setDirty(true); setMsg(""); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors"
              style={{ background: "#f1f5f9", color: "#475569" }}>
              <RotateCcw size={13} />恢复默认
            </button>
            <button
              onClick={save}
              disabled={saving || !dirty}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-white transition-opacity"
              style={{
                background: saving || !dirty ? "#94a3b8" : "linear-gradient(135deg,#2563eb,#4f46e5)",
                cursor:     saving || !dirty ? "not-allowed" : "pointer",
              }}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {saving ? "保存中…" : "保存所有更改"}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-3 mt-4 px-4 py-2.5 rounded-xl"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
          <AlertTriangle size={14} style={{ color: "#f59e0b" }} />
          <p className="text-xs" style={{ color: "#92400e" }}>
            当前 {hiddenCount} 个菜单被隐藏 · {accountList.length} 个账号被限定了专属可见范围。
            每次保存均写入审计日志。
          </p>
        </div>

        {msg && (
          <div className="flex items-center gap-2 mt-3 px-4 py-2.5 rounded-xl"
            style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
            <CheckCircle2 size={14} style={{ color: "#22c55e" }} />
            <p className="text-xs" style={{ color: "#15803d" }}>{msg}</p>
          </div>
        )}
        {err && (
          <div className="flex items-center gap-2 mt-3 px-4 py-2.5 rounded-xl"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <AlertTriangle size={14} style={{ color: "#ef4444" }} />
            <p className="text-xs" style={{ color: "#b91c1c" }}>{err}</p>
          </div>
        )}
      </div>

      {/* 区块一：菜单项开关 */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
        <div className="px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h3 className="text-sm font-semibold text-slate-800">菜单显示开关</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            「全局显示」关闭后，所有角色（含超级管理员）都看不到该入口；「可见角色」用于按角色收窄。
          </p>
        </div>

        <div className="divide-y" style={{ borderColor: "#f8fafc" }}>
          {ALL_NAV_ITEMS.map((item) => {
            const key      = navKey(item);
            const visible  = isVisible(key);
            const roles    = rolesOf(key);
            const defaults = defaultRolesFor(key);
            const Icon     = item.icon;
            return (
              <div key={key} className="px-6 py-3.5 flex items-center gap-4" style={{ opacity: visible ? 1 : 0.55 }}>
                {/* 图标 */}
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: visible ? "#f1f5f9" : "#fef2f2" }}>
                  <Icon size={15} style={{ color: visible ? "#475569" : "#ef4444" }} />
                </div>

                {/* 名称 */}
                <div className="min-w-0 w-52 flex-shrink-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{item.label}</p>
                  <p className="text-xs text-slate-400 truncate">{item.href}</p>
                </div>

                {/* 可见角色 */}
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  {CONFIG_ROLES.map((role) => {
                    const on = visible && roles.includes(role);
                    return (
                      <button
                        key={role}
                        onClick={() => { if (!visible) toggleGlobal(key); toggleRole(key, role); }}
                        title={`${ROLE_LABEL[role]} · 默认${defaults.includes(role) ? "可见" : "不可见"}`}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap"
                        style={{
                          background: on ? ROLE_CFG[role].bg : "#f8fafc",
                          color:      on ? ROLE_CFG[role].color : "#cbd5e1",
                          border:     `1px solid ${on ? ROLE_CFG[role].color + "33" : "#f1f5f9"}`,
                        }}>
                        {ROLE_LABEL[role]}
                      </button>
                    );
                  })}
                  {!visible && (
                    <span className="text-xs px-2 py-0.5 rounded-md"
                      style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626" }}>
                      全局已隐藏
                    </span>
                  )}
                </div>

                {/* 全局开关 */}
                <button
                  onClick={() => toggleGlobal(key)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium flex-shrink-0 transition-colors"
                  style={{
                    background: visible ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                    color:      visible ? "#15803d" : "#dc2626",
                  }}>
                  {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  {visible ? "显示" : "隐藏"}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* 区块二：账号专属可见范围 */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
        <div className="px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h3 className="text-sm font-semibold text-slate-800">账号专属可见范围（关联账号权限）</h3>
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
            为指定账号指定「只允许看到哪些菜单」。一旦某账号进入此表，其侧边栏<span className="font-medium text-slate-500">只</span>渲染被勾选的菜单，
            角色默认可见范围被完全覆盖（全局隐藏仍然优先）。<span className="font-medium text-slate-500">全局显示开关对所有人都生效，账号白名单不能反向放开被全局隐藏的菜单。</span>
          </p>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* 新增账号 */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <select
                value={pickEmail}
                onChange={(e) => setPickEmail(e.target.value)}
                className="appearance-none pr-8 pl-3 py-2 rounded-lg text-xs text-slate-600 outline-none"
                style={{ background: "#f8fafc", border: "1px solid #e2e8f0", minWidth: 260 }}>
                <option value="">— 选择要限定范围的账号 —</option>
                {pickCandidates
                  .filter((u) => u.email && !Object.prototype.hasOwnProperty.call(cfg.accountWhitelist, u.email.toLowerCase()))
                  .map((u) => (
                    <option key={u.id} value={u.email}>
                      {u.name} · {u.email} · {ROLE_LABEL[u.role] ?? u.role}
                    </option>
                  ))}
              </select>
              <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400" />
            </div>
            <button
              onClick={() => addAccount(pickEmail)}
              disabled={!pickEmail}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white"
              style={{ background: pickEmail ? "#2563eb" : "#cbd5e1", cursor: pickEmail ? "pointer" : "not-allowed" }}>
              <Plus size={13} />加入白名单
            </button>
            <button
              onClick={() => { const v = window.prompt("输入账号邮箱（用于手工录入未在系统中的邮箱）"); if (v) addAccount(v); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium"
              style={{ background: "#f1f5f9", color: "#475569" }}>
              <UserPlus size={13} />手工输入邮箱
            </button>
          </div>

          {accountList.length === 0 && (
            <div className="px-4 py-6 rounded-xl text-center text-xs text-slate-400"
              style={{ background: "#f8fafc", border: "1px dashed #e2e8f0" }}>
              尚未限定任何账号。未列入此表的账号按「角色默认权限 + 全局开关」渲染侧边栏。
            </div>
          )}

          {/* 已有账号 */}
          {accountList.map((email) => {
            const mods = modsOf(email);
            return (
              <div key={email} className="rounded-xl p-4" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{email}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      允许看到 {mods.length} 个菜单{mods.length === 0 ? "（当前为空 → 该账号侧边栏无任何菜单）" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => patch({ accountWhitelist: { ...cfg.accountWhitelist, [email]: ALL_NAV_ITEMS.map((i) => navKey(i)) } })}
                      className="px-2.5 py-1 rounded-md text-xs" style={{ background: "white", color: "#475569", border: "1px solid #e2e8f0" }}>
                      全选
                    </button>
                    <button
                      onClick={() => patch({ accountWhitelist: { ...cfg.accountWhitelist, [email]: [] } })}
                      className="px-2.5 py-1 rounded-md text-xs" style={{ background: "white", color: "#475569", border: "1px solid #e2e8f0" }}>
                      清空
                    </button>
                    <button
                      onClick={() => removeAccount(email)}
                      className="p-1.5 rounded-md" style={{ background: "rgba(239,68,68,0.08)", color: "#dc2626" }}
                      title="移出白名单（恢复角色默认）">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {ALL_NAV_ITEMS.map((item) => {
                    const key = navKey(item);
                    const on  = mods.includes(key);
                    const Icon = item.icon;
                    return (
                      <button
                        key={key}
                        onClick={() => toggleAccountMod(email, key)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{
                          background: on ? "rgba(37,99,235,0.1)" : "white",
                          color:      on ? "#2563eb" : "#94a3b8",
                          border:     `1px solid ${on ? "rgba(37,99,235,0.3)" : "#e2e8f0"}`,
                        }}>
                        <Icon size={12} />
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("org");

  return (
    <div className="flex-1 overflow-auto" style={{ background: "#f8fafc" }}>
      {/* Header */}
      <div className="px-8 pt-8 pb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #dc2626, #7c3aed)" }}>
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">超级管理员后台</h1>
            <p className="text-sm text-slate-500 mt-0.5">动态配置组织架构、用户权限与系统设置 · 高危操作均写入审计日志</p>
          </div>
        </div>
      </div>

      {/* 高危操作警示 */}
      <div className="px-8 mb-6">
        <div className="flex items-center gap-3 px-5 py-3 rounded-xl"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}>
          <AlertTriangle size={16} style={{ color: "#f59e0b" }} />
          <p className="text-xs" style={{ color: "#92400e" }}>
            权限变更、删除部门等高危操作将实时写入审计日志，删除操作为软删除，数据不会真实丢失。
          </p>
        </div>
      </div>

      {/* Tab 导航 */}
      <div className="px-8 mb-6">
        <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: "#f1f5f9" }}>
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: active ? "white" : "transparent",
                  color: active ? "#0f172a" : "#64748b",
                  boxShadow: active ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                }}>
                <Icon size={15} />{tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-8 pb-8">
        {activeTab === "org"             && <OrgTab />}
        {activeTab === "sidebar"         && <SidebarMenuTab />}
        {activeTab === "audit"           && <AuditTab />}
        {activeTab === "config"          && <ConfigTab />}
        {activeTab === "feishu_targets"  && <FeishuTargetsTab />}
        {activeTab === "template" && (
          <div className="bg-white rounded-2xl p-8 shadow-sm text-center text-slate-400" style={{ border: "1px solid #e2e8f0" }}>
            <Settings2 size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium text-slate-500">模板配置功能开发中</p>
            <p className="text-xs mt-1">支持上传 Word 模板并定义占位符与资产字段的映射关系</p>
          </div>
        )}
      </div>
    </div>
  );
}
