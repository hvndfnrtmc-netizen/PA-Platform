"use client";

/**
 * /dashboard/tasks — PA 任务发牌台
 * 支持：新建任务（含部门分配）、编辑、删除、锁定、状态筛选
 * v2：新增操作列（飞书跳转 / 归档确认 / 驳回 Modal）
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Plus, Clock, Archive, ArchiveRestore, AlertCircle,
  Search, Loader2, RefreshCw, Pencil, Trash2,
  X, ClipboardList, ExternalLink, XCircle, Send,
  Upload, Link2, Sparkles, Trash, ShieldCheck, CheckCircle2,
  LayoutDashboard, List, Copy, Package2,
} from "lucide-react";
import {
  PieChart, Pie, Cell, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import FeishuChatLink from "@/components/FeishuChatLink";

// ── 类型 ──────────────────────────────────────────────────────

interface Department { id: string; name: string; code: string }

interface AssigneeUser { id: string; name: string }

interface Assignment {
  id:              string;
  status:          "PENDING_SEND" | "PENDING_FILL" | "SUBMITTED" | "REJECTED" | "ARCHIVED";
  assigneeUserIds: string[];
  assigneeUsers:   AssigneeUser[];   // 由 API 批量注入，用于显示姓名
  rejectNote:      string | null;
  submittedAt:     string | null;
  department:      Department;
}

export interface FieldDef {
  _id:       string;
  fieldKey:  string;
  label:     string;
  unit:      string;
  required:  boolean;
  fieldType: "text" | "number" | "date";
  hint:      string;
  deptCode:  string;
}

interface Task {
  id:            string;
  title:         string;
  description:   string | null;
  type:          "PERIODIC" | "SPECIAL";
  status:        string;
  deadline:      string | null;
  archivedAt:    string | null;
  feishuSheetUrl: string | null;
  createdBy:     { id: string; name: string };
  assignments:   Assignment[];
  createdAt:     string;
}

interface Stats {
  total:      number;
  draft:      number;
  pending:    number;
  inProgress: number;
  submitted:  number;
  archived:   number;
}

export type DeptPermLevel = "edit" | "view" | "none";
export type DeptPermMap   = Record<string, DeptPermLevel>;

// ── 防抖 Hook ─────────────────────────────────────────────────

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// ── 本地用户多选器（数据来自系统人员库，级联按部门过滤）──────

interface LocalUser {
  id:           string;
  name:         string;
  feishuOpenId: string | null;
  departmentId: string | null;
  department:   { name: string } | null;
}

/** 单选版（给 TaskDetailModal 追加单人用） */
function FeishuUserPicker({
  value, onChange, placeholder = "搜索本地用户（姓名）...", disabled = false,
}: {
  value: { openId: string; name: string } | null;
  onChange: (v: { openId: string; name: string } | null) => void;
  placeholder?: string; disabled?: boolean;
}) {
  const [allUsers, setAllUsers] = useState<LocalUser[]>([]);
  const [query,    setQuery]    = useState("");
  const [open,     setOpen]     = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/users?take=200")
      .then(r => r.json())
      .then((d: { users?: LocalUser[] }) => {
        setAllUsers((d.users ?? []).filter(u => u.feishuOpenId));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = allUsers.filter(u =>
    !query || u.name.toLowerCase().includes(query.toLowerCase())
  );

  if (value) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{ background: "rgba(37,99,235,0.06)", border: "1px solid rgba(37,99,235,0.25)", minHeight: "38px" }}>
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
          style={{ background: "linear-gradient(135deg,#2563eb,#06b6d4)" }}>{value.name[0]}</div>
        <span className="flex-1 text-sm font-medium text-slate-800 truncate">{value.name}</span>
        {!disabled && (
          <button type="button" onClick={() => { onChange(null); setQuery(""); }}
            className="flex-shrink-0 p-0.5 rounded hover:bg-blue-100">
            <X size={12} style={{ color: "#64748b" }} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full" style={{ position: "relative" }}>
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl w-full"
        style={{ border: "1px solid #e2e8f0", background: "white", minHeight: "38px" }}>
        <Search size={13} className="flex-shrink-0" style={{ color: "#94a3b8" }} />
        <input type="text" value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          disabled={disabled} placeholder={placeholder}
          className="flex-1 min-w-0 text-sm outline-none bg-transparent text-slate-800 placeholder-slate-400" />
      </div>
      {open && filtered.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 9999, marginTop: "4px",
          background: "white", border: "1px solid #e2e8f0", borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.14)", maxHeight: "200px", overflowY: "auto" }}>
          {filtered.map(u => (
            <button key={u.id} type="button"
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
              onMouseDown={(e) => { e.preventDefault(); onChange({ openId: u.feishuOpenId!, name: u.name }); setQuery(""); setOpen(false); }}>
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: "linear-gradient(135deg,#2563eb,#06b6d4)" }}>{u.name[0]}</div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{u.name}</p>
                {u.department && <p className="text-xs text-slate-400">{u.department.name}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
      {open && !query && filtered.length === 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 9999, marginTop: "4px",
          background: "white", border: "1px solid #e2e8f0", borderRadius: "12px", padding: "12px 16px" }}>
          <p className="text-xs text-slate-400">暂无已配置飞书 ID 的用户，请先在超级后台添加</p>
        </div>
      )}
    </div>
  );
}

/** 多选版：从本地用户库多选，支持按 departmentId 级联过滤 */
function LocalUserMultiSelect({
  selectedIds,
  onChange,
  departmentId,
  placeholder = "搜索本地用户（姓名）...",
}: {
  selectedIds:   string[];
  /** 回调同时返回完整 user 对象，避免父组件再查库 */
  onChange:      (ids: string[], users: AssigneeUser[]) => void;
  departmentId?: string;
  placeholder?:  string;
}) {
  const [allUsers, setAllUsers] = useState<LocalUser[]>([]);
  const [query,    setQuery]    = useState("");
  const [open,     setOpen]     = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 每当 departmentId 变化时重新拉取（级联）
  useEffect(() => {
    const qs = departmentId
      ? `/api/users?take=200&departmentId=${departmentId}`
      : `/api/users?take=200`;
    fetch(qs)
      .then(r => r.json())
      .then((d: { users?: LocalUser[] }) => {
        setAllUsers((d.users ?? []).filter(u => u.feishuOpenId));
      })
      .catch(() => {});
  }, [departmentId]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 只展示还未选中的匹配用户
  const filtered = allUsers.filter(u =>
    !selectedIds.includes(u.id) &&
    (!query || u.name.toLowerCase().includes(query.toLowerCase()))
  );
  const selectedUsers = allUsers.filter(u => selectedIds.includes(u.id));

  function toggle(u: LocalUser) {
    let newIds: string[];
    if (selectedIds.includes(u.id)) {
      newIds = selectedIds.filter(id => id !== u.id);
    } else {
      newIds = [...selectedIds, u.id];
    }
    const newUsers = allUsers.filter(x => newIds.includes(x.id));
    onChange(newIds, newUsers.map(x => ({ id: x.id, name: x.name })));
  }

  return (
    <div ref={containerRef} className="w-full" style={{ position: "relative" }}>
      {/* 已选 Tags */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {selectedUsers.map(u => (
            <span key={u.id}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}>
              {u.name}
              <button type="button" onMouseDown={(e) => { e.preventDefault(); toggle(u); }}
                className="ml-0.5 hover:text-red-500"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}

      {/* 搜索输入框 */}
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl w-full"
        style={{ border: "1px solid #e2e8f0", background: "white", minHeight: "36px" }}>
        <Search size={13} className="flex-shrink-0" style={{ color: "#94a3b8" }} />
        <input type="text" value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={selectedIds.length > 0 ? "继续添加..." : placeholder}
          className="flex-1 min-w-0 text-sm outline-none bg-transparent text-slate-800 placeholder-slate-400" />
        {selectedIds.length > 0 && (
          <span className="text-xs text-slate-400 flex-shrink-0">已选 {selectedIds.length} 人</span>
        )}
      </div>

      {/* 下拉列表 */}
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 9999, marginTop: "4px",
          background: "white", border: "1px solid #e2e8f0", borderRadius: "12px",
          boxShadow: "0 8px 32px rgba(0,0,0,0.14)", maxHeight: "200px", overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-400 px-4 py-3">
              {allUsers.length === 0
                ? (departmentId ? "该部门暂无已配置飞书 ID 的用户" : "暂无已配置飞书 ID 的用户，请先在超级后台添加")
                : query ? "未找到匹配用户" : "所有用户已选完"}
            </p>
          ) : (
            filtered.map(u => (
              <button key={u.id} type="button"
                className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                onMouseDown={(e) => { e.preventDefault(); toggle(u); setQuery(""); }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ background: "linear-gradient(135deg,#2563eb,#06b6d4)" }}>{u.name[0]}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{u.name}</p>
                  {u.department && <p className="text-xs text-slate-400">{u.department.name}</p>}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── 任务卡片网格（卡片视图）────────────────────────────────────

function TaskCardGrid({
  tasks,
  onCardClick,
}: {
  tasks:       Task[];
  onCardClick: (task: Task) => void;
}) {
  const STATUS_CARD: Record<string, { label: string; color: string; bg: string; dot: string }> = {
    ARCHIVED:    { label: "已归档",  color: "#6b7280", bg: "rgba(107,114,128,0.1)", dot: "#6b7280" },
    IN_PROGRESS: { label: "进行中",  color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  dot: "#f59e0b" },
    PENDING:     { label: "待发起",  color: "#ef4444", bg: "rgba(239,68,68,0.1)",   dot: "#ef4444" },
    SUBMITTED:   { label: "待归档",  color: "#22c55e", bg: "rgba(34,197,94,0.1)",   dot: "#22c55e" },
    DRAFT:       { label: "草稿",    color: "#94a3b8", bg: "rgba(148,163,184,0.1)", dot: "#94a3b8" },
  };

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-slate-400">
        <ClipboardList size={40} className="mb-3 opacity-30" />
        <p className="text-sm font-medium">暂无任务</p>
      </div>
    );
  }

  return (
    <div className="px-8 pb-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {tasks.map((task) => {
        const st    = STATUS_CARD[task.status] ?? STATUS_CARD.DRAFT;
        const done  = task.assignments.filter(a => a.status === "SUBMITTED" || a.status === "ARCHIVED").length;
        const total = task.assignments.length;
        const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

        // 截止时间倒计时
        let deadlineNode: React.ReactNode = null;
        if (task.deadline) {
          const diff  = new Date(task.deadline).getTime() - Date.now();
          const days  = Math.ceil(diff / 86400000);
          const color = diff < 0 ? "#ef4444" : days <= 3 ? "#f59e0b" : "#64748b";
          const label = diff < 0
            ? `已逾期 ${Math.abs(days)} 天`
            : days === 0 ? "今日截止"
            : `${days} 天后截止`;
          deadlineNode = (
            <span className="flex items-center gap-1 text-xs" style={{ color }}>
              <Clock size={11} />{label}
            </span>
          );
        }

        return (
          <div
            key={task.id}
            onClick={() => onCardClick(task)}
            className="bg-white rounded-2xl p-5 cursor-pointer transition-all hover:shadow-lg hover:-translate-y-0.5 flex flex-col gap-3"
            style={{ border: "1px solid #e2e8f0" }}
          >
            {/* 顶部：类型 + 状态 */}
            <div className="flex items-center justify-between">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: task.type === "PERIODIC" ? "rgba(59,130,246,0.08)" : "rgba(139,92,246,0.08)",
                  color:      task.type === "PERIODIC" ? "#2563eb" : "#7c3aed",
                }}>
                {task.type === "PERIODIC" ? "周期" : "专项"}
              </span>
              <span className="flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full font-medium"
                style={{ background: st.bg, color: st.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
                {st.label}
              </span>
            </div>

            {/* 任务标题 */}
            <div>
              <h3 className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2">{task.title}</h3>
            </div>

            {/* 截止时间 */}
            {deadlineNode && <div>{deadlineNode}</div>}

            {/* 进度条 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-slate-400">填报进度</span>
                <span className="text-xs font-medium text-slate-600">{done}/{total}</span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: pct === 100 ? "#22c55e" : "#3b82f6" }}
                />
              </div>
            </div>

            {/* 部门标签 */}
            {task.assignments.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1" style={{ borderTop: "1px solid #f8fafc" }}>
                {task.assignments.slice(0, 4).map(a => (
                  <span key={a.id} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                    {a.department.name}
                  </span>
                ))}
                {task.assignments.length > 4 && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
                    +{task.assignments.length - 4}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 配置 ──────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  ARCHIVED:    { label: "已归档",  dot: "#6b7280", text: "#6b7280", bg: "rgba(107,114,128,0.1)" },
  IN_PROGRESS: { label: "进行中",  dot: "#f59e0b", text: "#f59e0b", bg: "rgba(245,158,11,0.1)"  },
  PENDING:     { label: "待填报",  dot: "#ef4444", text: "#ef4444", bg: "rgba(239,68,68,0.1)"   },
  SUBMITTED:   { label: "待归档",  dot: "#22c55e", text: "#22c55e", bg: "rgba(34,197,94,0.1)"   },
  DRAFT:       { label: "草稿",    dot: "#475569", text: "#475569", bg: "rgba(71,85,105,0.1)"   },
  CANCELLED:   { label: "已取消",  dot: "#94a3b8", text: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
};

/**
 * 展示状态映射：有被驳回分配的任务，对外统一显示为「进行中」。
 * 系统内部状态不变，仅影响 UI 渲染和统计卡片计数。
 */
function getDisplayStatus(task: { status: string; assignments: Array<{ status: string }> }): string {
  const hasRejected = task.assignments.some((a) => a.status === "REJECTED");
  if (hasRejected && (task.status === "PENDING" || task.status === "IN_PROGRESS")) {
    return "IN_PROGRESS";
  }
  return task.status;
}

// ── 字段编辑器 ────────────────────────────────────────────────

function FieldEditor({
  fields, onChange,
}: {
  fields: FieldDef[];
  onChange: (fields: FieldDef[]) => void;
}) {
  function updateField(id: string, patch: Partial<FieldDef>) {
    onChange(fields.map((f) => (f._id === id ? { ...f, ...patch } : f)));
  }

  function removeField(id: string) {
    onChange(fields.filter((f) => f._id !== id));
  }

  function addField() {
    onChange([
      ...fields,
      {
        _id:       crypto.randomUUID(),
        fieldKey:  `field_${fields.length + 1}`,
        label:     "",
        unit:      "",
        required:  true,
        fieldType: "text",
        hint:      "",
        deptCode:  "",
      },
    ]);
  }

  if (fields.length === 0) {
    return (
      <div className="flex flex-col items-center py-6 rounded-xl" style={{ border: "1px dashed #e2e8f0", background: "#fafafa" }}>
        <p className="text-xs text-slate-400 mb-2">暂无字段，点击「添加字段」手动创建</p>
        <button onClick={addField}
          className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
          style={{ background: "#eff6ff", color: "#2563eb" }}>
          <Plus size={12} /> 添加字段
        </button>
      </div>
    );
  }

  const FIELD_TYPE_OPTS = [
    { value: "text",   label: "文本" },
    { value: "number", label: "数值" },
    { value: "date",   label: "日期" },
  ];

  return (
    <div className="space-y-2">
      {fields.map((f, idx) => (
        <div
          key={f._id}
          className="rounded-xl px-3 py-3 flex items-start gap-2"
          style={{ border: "1px solid #e2e8f0", background: "#fafbfc" }}
        >
          {/* 序号 */}
          <span className="text-xs text-slate-400 mt-2.5 w-4 flex-shrink-0 text-center">{idx + 1}</span>

          <div className="flex-1 grid grid-cols-2 gap-2">
            {/* 字段名称 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">字段名称 *</label>
              <input value={f.label}
                onChange={(e) => updateField(f._id, { label: e.target.value })}
                placeholder="如：累计专利总数"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg outline-none"
                style={{ border: "1px solid #e2e8f0" }} />
            </div>
            {/* 英文 Key */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">英文 Key</label>
              <input value={f.fieldKey}
                onChange={(e) => updateField(f._id, { fieldKey: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
                placeholder="total_patents"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg outline-none font-mono"
                style={{ border: "1px solid #e2e8f0" }} />
            </div>
            {/* 单位 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">单位</label>
              <input value={f.unit}
                onChange={(e) => updateField(f._id, { unit: e.target.value })}
                placeholder="km / 万元 / 人"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg outline-none"
                style={{ border: "1px solid #e2e8f0" }} />
            </div>
            {/* 类型 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">字段类型</label>
              <select value={f.fieldType}
                onChange={(e) => updateField(f._id, { fieldType: e.target.value as FieldDef["fieldType"] })}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg outline-none bg-white"
                style={{ border: "1px solid #e2e8f0" }}>
                {FIELD_TYPE_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* 填报部门 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">填报部门代码</label>
              <input value={f.deptCode}
                onChange={(e) => updateField(f._id, { deptCode: e.target.value.toUpperCase() })}
                placeholder="FINANCE / RD / HR"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg outline-none font-mono"
                style={{ border: "1px solid #e2e8f0" }} />
            </div>
            {/* 填报说明 */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">填报说明</label>
              <input value={f.hint}
                onChange={(e) => updateField(f._id, { hint: e.target.value })}
                placeholder="可选的补充说明"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg outline-none"
                style={{ border: "1px solid #e2e8f0" }} />
            </div>
          </div>

          {/* 必填开关 + 删除 */}
          <div className="flex flex-col items-center gap-2 flex-shrink-0 mt-1">
            <button
              onClick={() => updateField(f._id, { required: !f.required })}
              className="text-xs px-2 py-1 rounded-lg font-medium transition-colors"
              style={
                f.required
                  ? { background: "rgba(34,197,94,0.1)", color: "#16a34a" }
                  : { background: "#f1f5f9", color: "#94a3b8" }
              }
              title="点击切换必填/选填"
            >
              {f.required ? "必填" : "选填"}
            </button>
            <button onClick={() => removeField(f._id)}
              className="p-1 rounded-lg hover:bg-red-50 transition-colors"
              title="删除此字段">
              <Trash size={13} style={{ color: "#ef4444" }} />
            </button>
          </div>
        </div>
      ))}

      <button onClick={addField}
        className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium transition-colors hover:bg-blue-50"
        style={{ border: "1px dashed #bfdbfe", color: "#2563eb" }}>
        <Plus size={12} /> 添加字段
      </button>
    </div>
  );
}

// ── 新建/编辑任务弹窗 ──────────────────────────────────────────

interface AssignmentInput {
  deptId:          string;
  deptName:        string;
  assigneeUserIds: string[];
  assigneeUsers:   AssigneeUser[];  // 同步存储，用于卡片展示
}

function TaskFormModal({
  task, departments, onClose, onSaved, prefill,
}: {
  task: Task | null;
  departments: Department[];
  onClose: () => void;
  onSaved: () => void;
  prefill?: { title: string; type: "PERIODIC" | "SPECIAL"; fieldsSchema: Omit<FieldDef, "_id">[] | null } | null;
}) {
  const isEdit = !!task;
  const [title,         setTitle]         = useState(task?.title ?? prefill?.title ?? "");
  const [description,   setDescription]   = useState(task?.description ?? "");
  const [type,          setType]          = useState<"PERIODIC" | "SPECIAL">(task?.type ?? prefill?.type ?? "SPECIAL");
  const [deadline,      setDeadline]      = useState(
    task?.deadline ? new Date(task.deadline).toISOString().slice(0, 16) : ""
  );
  const [feishuUrl,     setFeishuUrl]     = useState(task?.feishuSheetUrl ?? "");

  // ── 级联分配状态 ─────────────────────────────────────────────
  const [assignments, setAssignments] = useState<AssignmentInput[]>(
    () => task?.assignments.map((a) => ({
      deptId:          a.department.id,
      deptName:        a.department.name,
      assigneeUserIds: a.assigneeUserIds ?? [],
      assigneeUsers:   a.assigneeUsers   ?? [],
    })) ?? []
  );
  // 新增一行的临时选择状态
  const [addingDeptId,   setAddingDeptId]   = useState("");
  const [addingUserIds,  setAddingUserIds]  = useState<string[]>([]);
  const [addingUserObjs, setAddingUserObjs] = useState<AssigneeUser[]>([]);
  // "继续添加"扩展状态（在已有部门卡片上追加人员）
  const [expandingDeptId,   setExpandingDeptId]   = useState<string | null>(null);
  const [expandingUserIds,  setExpandingUserIds]  = useState<string[]>([]);
  const [expandingUserObjs, setExpandingUserObjs] = useState<AssigneeUser[]>([]);

  const [saving, setSaving] = useState(false);
  const [err,    setErr]    = useState("");

  function onDeptChange(deptId: string) {
    setAddingDeptId(deptId);
    setAddingUserIds([]);
    setAddingUserObjs([]);
  }

  function addAssignment() {
    if (!addingDeptId) return;
    if (assignments.some((a) => a.deptId === addingDeptId)) {
      setErr("该部门已添加，请勿重复"); return;
    }
    const dept = departments.find((d) => d.id === addingDeptId);
    setAssignments((prev) => [...prev, {
      deptId:          addingDeptId,
      deptName:        dept?.name ?? addingDeptId,
      assigneeUserIds: addingUserIds,
      assigneeUsers:   addingUserObjs,
    }]);
    setAddingDeptId("");
    setAddingUserIds([]);
    setAddingUserObjs([]);
    setErr("");
  }

  /** 移除某部门卡片上的单个指派人 */
  function removeAssignee(deptId: string, userId: string) {
    setAssignments(prev => prev.map(a =>
      a.deptId === deptId
        ? { ...a,
            assigneeUserIds: a.assigneeUserIds.filter(id => id !== userId),
            assigneeUsers:   a.assigneeUsers.filter(u => u.id !== userId),
          }
        : a
    ));
  }

  /** 确认"继续添加"的选人结果 */
  function confirmExpanding() {
    if (!expandingDeptId) return;
    setAssignments(prev => prev.map(a =>
      a.deptId === expandingDeptId
        ? { ...a, assigneeUserIds: expandingUserIds, assigneeUsers: expandingUserObjs }
        : a
    ));
    setExpandingDeptId(null);
    setExpandingUserIds([]);
    setExpandingUserObjs([]);
  }

  function removeAssignment(deptId: string) {
    setAssignments((prev) => prev.filter((a) => a.deptId !== deptId));
  }

  // ── 申报表单配置区状态 ─────────────────────────────────────
  const [inputMode,    setInputMode]    = useState<"file" | "url">("file");
  const [cloudUrl,     setCloudUrl]     = useState("");
  const [fields,       setFields]       = useState<FieldDef[]>(
    () => (prefill?.fieldsSchema ?? []).map((f) => ({ ...f, _id: crypto.randomUUID() }))
  );
  const [parsing,      setParsing]      = useState(false);
  const [parseMsg,     setParseMsg]     = useState("");
  const [parseMsgType, setParseMsgType] = useState<"ok" | "warn" | "err">("ok");
  const [dragging,     setDragging]     = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── 解析文件 ──────────────────────────────────────────────
  async function parseFile(file: File) {
    if (!file.name.match(/\.(docx|xlsx|xls)$/i)) {
      setParseMsg("仅支持 .docx / .xlsx / .xls 格式"); setParseMsgType("err"); return;
    }
    setParsing(true); setParseMsg(""); setFields([]);
    try {
      const form = new FormData();
      form.append("file", file);
      const res  = await fetch("/api/tasks/parse-template", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) { setParseMsg(data.error ?? "解析失败"); setParseMsgType("err"); return; }
      const parsed: FieldDef[] = (data.fields ?? []).map((f: Omit<FieldDef,"_id">) => ({ ...f, _id: crypto.randomUUID() }));
      setFields(parsed);
      const src = data.source === "llm" ? "AI 智能识别" : data.source === "regex" ? "规则匹配" : "手动填写";
      if (parsed.length > 0) {
        setParseMsg(`已识别 ${parsed.length} 个字段（${src}），可在下方编辑`); setParseMsgType("ok");
      } else {
        setParseMsg(`未识别到填报字段（${src}），请手动添加`); setParseMsgType("warn");
      }
    } catch { setParseMsg("解析请求失败，请检查网络"); setParseMsgType("err"); }
    finally   { setParsing(false); }
  }

  // ── 解析云端链接 ────────────────────────────────────────
  async function parseCloudUrl() {
    if (!cloudUrl.trim()) { setParseMsg("请先填写云端链接"); setParseMsgType("err"); return; }
    setParsing(true); setParseMsg(""); setFields([]);
    try {
      const res  = await fetch("/api/tasks/parse-template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ cloudUrl: cloudUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setParseMsg(data.error ?? "解析失败"); setParseMsgType("err"); return; }
      const parsed: FieldDef[] = (data.fields ?? []).map((f: Omit<FieldDef,"_id">) => ({ ...f, _id: crypto.randomUUID() }));
      setFields(parsed);
      if (parsed.length > 0) {
        setParseMsg(`从链接推断出 ${parsed.length} 个字段，请核对后修改`); setParseMsgType("warn");
      } else {
        setParseMsg(data.message ?? "无法从链接自动推断字段，请手动添加"); setParseMsgType("warn");
      }
    } catch { setParseMsg("解析请求失败"); setParseMsgType("err"); }
    finally   { setParsing(false); }
  }

  // ── 提交 ──────────────────────────────────────────────────
  async function submit() {
    if (!title.trim()) { setErr("填报标题不能为空"); return; }
    setSaving(true); setErr("");
    try {
      const cleanFields = fields.length > 0
        ? fields.map(({ _id: _, ...rest }) => rest)
        : null;

      // 无论新建还是编辑，统一使用完整 assignments 格式（含 assigneeUserIds）
      const assignmentsPayload = assignments.map((a) => ({
        deptId:          a.deptId,
        assigneeUserIds: a.assigneeUserIds ?? [],
      }));

      const body = {
        title:          title.trim(),
        description:    description.trim() || null,
        type,
        deadline:       deadline || null,
        feishuSheetUrl: feishuUrl.trim() || null,
        assignments:    assignmentsPayload,
        fieldsSchema:   cleanFields,
      };

      console.log("[TaskFormModal] submit payload:", JSON.stringify(body, null, 2));

      const url    = isEdit ? `/api/tasks/${task!.id}` : "/api/tasks";
      const method = isEdit ? "PUT" : "POST";
      const res    = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        const msg = d.error ?? "保存失败";
        console.error("[TaskFormModal] API 错误:", method, url, "→", msg, d);
        throw new Error(msg);
      }
      onSaved();
    } catch (e: unknown) {
      console.error("[TaskFormModal] submit 异常:", e);
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const parseMsgColor = parseMsgType === "ok" ? "#15803d" : parseMsgType === "warn" ? "#92400e" : "#dc2626";
  const parseMsgBg    = parseMsgType === "ok" ? "rgba(34,197,94,0.08)" : parseMsgType === "warn" ? "rgba(245,158,11,0.08)" : "rgba(239,68,68,0.08)";

  // 可选部门（排除 PA，排除已添加的）
  const availableDepts = departments.filter(
    (d) => d.code !== "PA" && !assignments.some((a) => a.deptId === d.id)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-xl mx-4 flex flex-col shadow-2xl" style={{ maxHeight: "92vh" }}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h2 className="text-base font-bold text-slate-900">{isEdit ? "编辑填报" : "新建填报"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        {/* 内容区（可滚动）—— overflow-x visible 防止下拉被裁剪 */}
        <div className="flex-1 px-6 py-5 space-y-4" style={{ overflowY: "auto", overflowX: "visible" }}>
          {err && <p className="text-sm text-red-500 px-3 py-2 rounded-xl" style={{ background: "rgba(239,68,68,0.08)" }}>{err}</p>}

          {/* 标题 */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">填报标题 *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-800 outline-none"
              style={{ border: "1px solid #e2e8f0" }} placeholder="如：2025年Q2季度数据收集" />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">填报描述</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-800 outline-none resize-none"
              style={{ border: "1px solid #e2e8f0" }} placeholder="可选，描述任务背景和填报要求..." />
          </div>

          {/* 类型 + 截止日期 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">填报类型</label>
              <select value={type} onChange={(e) => setType(e.target.value as "PERIODIC" | "SPECIAL")}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-white"
                style={{ border: "1px solid #e2e8f0" }}>
                <option value="SPECIAL">专项填报</option>
                <option value="PERIODIC">周期填报</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">截止时间</label>
              <input type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-800 outline-none bg-white"
                style={{ border: "1px solid #e2e8f0" }} />
            </div>
          </div>

          {/* 飞书链接 */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">飞书表格链接</label>
            <input value={feishuUrl} onChange={(e) => setFeishuUrl(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-slate-800 outline-none"
              style={{ border: "1px solid #e2e8f0" }} placeholder="https://momenta.feishu.cn/..." />
          </div>

          {/* ── 二级分配（级联选择器）────────────────────────── */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">
              分配给部门 / 负责人
              {assignments.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-medium"
                  style={{ background: "#eff6ff", color: "#2563eb" }}>
                  {assignments.length}
                </span>
              )}
            </label>

            {/* 已选分配卡片组 */}
            {assignments.length > 0 && (
              <div className="mb-2 space-y-2">
                {assignments.map((a) => (
                  <div key={a.deptId} className="rounded-xl text-sm"
                    style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    {/* 卡片头：部门名 + 删除整行 */}
                    <div className="flex items-center justify-between px-3 pt-2 pb-1">
                      <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-blue-400" />
                        {a.deptName}
                      </span>
                      <button onClick={() => removeAssignment(a.deptId)}
                        className="p-1 rounded-lg hover:bg-red-50 flex-shrink-0"
                        title="移除该部门">
                        <X size={12} style={{ color: "#94a3b8" }} />
                      </button>
                    </div>

                    {/* 已选人员 chips */}
                    <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                      {(a.assigneeUsers ?? []).length > 0 ? (
                        (a.assigneeUsers).map(u => (
                          <span key={u.id}
                            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                            style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}>
                            {u.name}
                            <button type="button" onMouseDown={(e) => { e.preventDefault(); removeAssignee(a.deptId, u.id); }}
                              className="hover:text-red-500"><X size={9} /></button>
                          </span>
                        ))
                      ) : (
                        <span className="text-xs text-slate-400">暂未指定，将发送给部门对接人</span>
                      )}

                      {/* + 继续添加 按钮 */}
                      {expandingDeptId !== a.deptId && (
                        <button
                          type="button"
                          onClick={() => {
                            setExpandingDeptId(a.deptId);
                            setExpandingUserIds(a.assigneeUserIds);
                            setExpandingUserObjs(a.assigneeUsers ?? []);
                          }}
                          className="flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-medium transition-colors hover:bg-blue-100"
                          style={{ color: "#2563eb", border: "1px dashed #93c5fd" }}>
                          <Plus size={9} />继续添加
                        </button>
                      )}
                    </div>

                    {/* 展开的多选面板 */}
                    {expandingDeptId === a.deptId && (
                      <div className="px-3 pb-2 space-y-1.5" style={{ borderTop: "1px solid #e2e8f0", paddingTop: "8px", marginTop: "4px" }}>
                        <LocalUserMultiSelect
                          selectedIds={expandingUserIds}
                          onChange={(ids, users) => { setExpandingUserIds(ids); setExpandingUserObjs(users); }}
                          departmentId={a.deptId}
                          placeholder="搜索该部门员工..."
                        />
                        <div className="flex gap-2">
                          <button type="button" onClick={confirmExpanding}
                            className="flex-1 py-1.5 rounded-lg text-xs font-semibold text-white"
                            style={{ background: "#2563eb" }}>确认</button>
                          <button type="button" onClick={() => setExpandingDeptId(null)}
                            className="flex-1 py-1.5 rounded-lg text-xs font-medium bg-slate-100 text-slate-600">取消</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* 添加一条分配：flex 单行，按钮不溢出 */}
            {availableDepts.length > 0 && (
              <div className="space-y-2">
                {/* 第一行：部门 + 飞书搜人 + 添加按钮 */}
                <div className="flex w-full gap-2 items-center">
                  {/* 部门下拉 */}
                  <select
                    value={addingDeptId}
                    onChange={(e) => onDeptChange(e.target.value)}
                    className="rounded-xl text-sm text-slate-800 outline-none bg-white py-2 px-2.5"
                    style={{ border: "1px solid #e2e8f0", flexShrink: 0, width: "120px" }}>
                    <option value="">选部门...</option>
                    {availableDepts.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                  {/* 本地用户多选：级联过滤 by 所选部门 */}
                  <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
                    <LocalUserMultiSelect
                      selectedIds={addingUserIds}
                      onChange={(ids, users) => { setAddingUserIds(ids); setAddingUserObjs(users); }}
                      departmentId={addingDeptId || undefined}
                      placeholder="多选负责人（选填）"
                    />
                  </div>
                  {/* 添加按钮：绝不被挤压 */}
                  <button
                    onClick={addAssignment}
                    disabled={!addingDeptId}
                    style={{ flexShrink: 0, background: "#2563eb", whiteSpace: "nowrap" }}
                    className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-40">
                    <Plus size={12} />添加
                  </button>
                </div>
              </div>
            )}

            {departments.filter((d) => d.code !== "PA").length === 0 && (
              <p className="text-xs text-slate-400 mt-1">暂无业务部门，请先在设置中创建</p>
            )}
          </div>

          {/* ── 申报表单配置区（仅周期填报） ────────────────── */}
          {type === "PERIODIC" && (
            <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
              {/* 区块头 */}
              <div className="flex items-center justify-between px-4 py-3" style={{ background: "linear-gradient(135deg, rgba(37,99,235,0.05), rgba(6,182,212,0.05))", borderBottom: "1px solid #e2e8f0" }}>
                <div className="flex items-center gap-2">
                  <Sparkles size={14} style={{ color: "#2563eb" }} />
                  <span className="text-xs font-semibold text-slate-700">申报表单配置</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}>
                    周期专属
                  </span>
                </div>
                {/* 输入方式 Tab */}
                <div className="flex gap-0.5 p-0.5 rounded-lg" style={{ background: "#f1f5f9" }}>
                  {(["file", "url"] as const).map((m) => (
                    <button key={m} onClick={() => setInputMode(m)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                      style={
                        inputMode === m
                          ? { background: "white", color: "#1e293b", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" }
                          : { color: "#64748b" }
                      }>
                      {m === "file" ? <><Upload size={11} />上传文件</> : <><Link2 size={11} />云端链接</>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="px-4 py-4 space-y-3">
                {/* 文件上传 */}
                {inputMode === "file" && (
                  <div
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) parseFile(f); }}
                    onClick={() => fileRef.current?.click()}
                    className="flex flex-col items-center justify-center py-6 rounded-xl cursor-pointer transition-colors"
                    style={{ border: `2px dashed ${dragging ? "#2563eb" : "#cbd5e1"}`, background: dragging ? "#eff6ff" : "#fafafa" }}
                  >
                    {parsing
                      ? <><Loader2 size={20} className="text-blue-400 animate-spin mb-1.5" /><p className="text-xs text-slate-500">AI 正在识别字段...</p></>
                      : <><Upload size={20} className="text-slate-400 mb-1.5" /><p className="text-xs text-slate-600 font-medium">拖拽文件到此处，或点击上传</p><p className="text-xs text-slate-400 mt-0.5">支持 Word (.docx) 和 Excel (.xlsx/.xls)</p></>
                    }
                    <input ref={fileRef} type="file" accept=".docx,.xlsx,.xls" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) parseFile(f); e.target.value = ""; }} />
                  </div>
                )}

                {/* 云端链接 */}
                {inputMode === "url" && (
                  <div className="flex gap-2">
                    <input
                      value={cloudUrl}
                      onChange={(e) => setCloudUrl(e.target.value)}
                      placeholder="粘贴飞书、腾讯文档、Google Docs 等链接..."
                      className="flex-1 px-3 py-2 text-sm rounded-xl outline-none"
                      style={{ border: "1px solid #e2e8f0" }}
                    />
                    <button
                      onClick={parseCloudUrl}
                      disabled={parsing || !cloudUrl.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white transition-all hover:opacity-90 disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)", whiteSpace: "nowrap" }}
                    >
                      {parsing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                      AI 识别
                    </button>
                  </div>
                )}

                {/* 解析结果提示 */}
                {parseMsg && (
                  <p className="text-xs px-3 py-2 rounded-lg" style={{ color: parseMsgColor, background: parseMsgBg }}>
                    {parseMsg}
                  </p>
                )}

                {/* 字段编辑器 */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-semibold text-slate-600">
                      申报字段
                      {fields.length > 0 && (
                        <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-medium" style={{ background: "#eff6ff", color: "#2563eb" }}>
                          {fields.length}
                        </span>
                      )}
                    </label>
                    {fields.length > 0 && (
                      <button onClick={() => setFields([])}
                        className="text-xs text-slate-400 hover:text-red-500 transition-colors">
                        清空全部
                      </button>
                    )}
                  </div>
                  <FieldEditor fields={fields} onChange={setFields} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0" style={{ borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 font-medium transition-colors">
            取消
          </button>
          <button onClick={submit} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}>
            {saving ? "保存中..." : (isEdit ? "保存修改" : "创建填报")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 删除确认弹窗 ──────────────────────────────────────────────

function DeleteDialog({ task, onClose, onDeleted }: { task: Task; onClose: () => void; onDeleted: () => void }) {
  const [loading, setLoading] = useState(false);

  async function confirm() {
    setLoading(true);
    await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    onDeleted();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl">
        <h3 className="text-base font-bold text-slate-900 mb-2">确认删除</h3>
        <p className="text-sm text-slate-600 mb-5">将软删除「{task.title}」，数据不会真实丢失。</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 font-medium">取消</button>
          <button onClick={confirm} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium disabled:opacity-50"
            style={{ background: "#ef4444" }}>
            {loading ? "删除中..." : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 归档确认弹窗 ──────────────────────────────────────────────

function ArchiveConfirmDialog({
  task, onClose, onConfirm, loading,
}: {
  task: Task;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(34,197,94,0.1)" }}>
            <Archive size={18} style={{ color: "#16a34a" }} />
          </div>
          <h3 className="text-base font-bold text-slate-900">确认归档</h3>
        </div>
        <p className="text-sm text-slate-600 mb-1">
          将对填报「<span className="font-medium text-slate-800">{task.title}</span>」执行归档操作。
        </p>
        <p className="text-xs text-slate-400 mb-5">
          归档后填报状态变为「已归档」，对应飞书表格权限将降级为只读，无法再编辑。
        </p>
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 font-medium transition-colors">
            取消
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
            {loading ? "归档中..." : "确认归档"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 取消归档确认 Dialog ────────────────────────────────────────

function UnarchiveConfirmDialog({
  task, onClose, onConfirm, loading,
}: {
  task: Task;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(217,119,6,0.1)" }}>
            <ArchiveRestore size={18} style={{ color: "#d97706" }} />
          </div>
          <h3 className="text-base font-bold text-slate-900">确认取消归档</h3>
        </div>
        <p className="text-sm text-slate-600 mb-1">
          将对填报「<span className="font-medium text-slate-800">{task.title}</span>」取消归档。
        </p>
        <p className="text-xs text-slate-400 mb-5">
          取消归档后任务状态恢复为「进行中」，各部门可继续补充填写数据。
        </p>
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 font-medium transition-colors">
            取消
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #d97706, #b45309)" }}>
            {loading ? "处理中..." : "确认取消归档"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 驳回对象选择 Modal（选择具体 assignment 再驳回）──────────────

function AssignmentRejectPickModal({
  task, onClose, onPickAssignment,
}: {
  task: Task;
  onClose: () => void;
  onPickAssignment: (assignment: Assignment) => void;
}) {
  const submitted = task.assignments.filter((a) => a.status === "SUBMITTED");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(239,68,68,0.1)" }}>
              <XCircle size={15} style={{ color: "#dc2626" }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">选择要驳回的部门</h2>
              <p className="text-xs text-slate-400">{task.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <X size={16} className="text-slate-500" />
          </button>
        </div>
        <div className="px-6 py-5">
          {submitted.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-4">暂无可驳回的分配（需处于「已提交」状态）</p>
          ) : (
            <div className="space-y-2">
              {submitted.map((a) => (
                <button
                  key={a.id}
                  onClick={() => onPickAssignment(a)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left transition-all hover:shadow-sm"
                  style={{ border: "1px solid #e2e8f0", background: "#fafafa" }}
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800">{a.department.name}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {(a.assigneeUserIds?.length ?? 0) > 0 ? `${a.assigneeUserIds.length} 位指派人` : "部门对接人"}
                    </p>
                  </div>
                  <span className="text-xs px-2 py-1 rounded-full font-medium"
                    style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a" }}>
                    已提交
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="px-6 pb-4">
          <button onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 font-medium transition-colors">
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 独立驳回 Modal（单条 assignment，含 resubmitDeadline）──────

function RejectModal({
  task, assignment, onClose, onRejected,
}: {
  task:       Task;
  assignment: Assignment;
  onClose:    () => void;
  onRejected: () => void;
}) {
  const [reason,          setReason]          = useState("");
  const [resubmitDeadline,setResubmitDeadline] = useState("");
  const [loading,         setLoading]         = useState(false);
  const [err,             setErr]             = useState("");

  const recipientLabel = assignment.department.name;

  async function submit() {
    if (!reason.trim()) { setErr("请填写驳回理由，不能为空"); return; }
    setLoading(true); setErr("");
    try {
      const res = await fetch(
        `/api/tasks/${task.id}/assignments/${assignment.id}`,
        {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            action:           "REJECT",
            rejectNote:       reason.trim(),
            resubmitDeadline: resubmitDeadline || undefined,
          }),
        }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error ?? "驳回失败");
      }
      onRejected();
    } catch (e: unknown) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-md mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(239,68,68,0.1)" }}>
              <XCircle size={15} style={{ color: "#dc2626" }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">驳回填报</h2>
              <p className="text-xs text-slate-400">
                {task.title} · <span className="font-medium text-slate-600">{recipientLabel}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* 驳回理由 */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              驳回理由 <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => { setReason(e.target.value); setErr(""); }}
              rows={4}
              placeholder="请详细说明驳回原因，例如：填报数据与系统记录不符，请核实后重新提交..."
              className="w-full px-3 py-2.5 text-sm rounded-xl outline-none resize-none"
              style={{ border: `1px solid ${err ? "#fca5a5" : "#e2e8f0"}`, lineHeight: "1.6" }}
              autoFocus
            />
            {err && (
              <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1">
                <AlertCircle size={11} /> {err}
              </p>
            )}
          </div>

          {/* 重填截止时间（选填）*/}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">
              重新填报截止时间
              <span className="ml-1 font-normal text-slate-400">（选填，不填则使用项目原截止时间）</span>
            </label>
            <input
              type="datetime-local"
              value={resubmitDeadline}
              onChange={(e) => setResubmitDeadline(e.target.value)}
              className="w-full px-3 py-2.5 text-sm rounded-xl outline-none bg-white"
              style={{ border: "1px solid #e2e8f0" }}
            />
          </div>

          <div className="px-3 py-2.5 rounded-xl text-xs" style={{ background: "#fef3c7", color: "#92400e" }}>
            ⚠ 驳回后仅该部门的填报状态回退为「待填报」，不影响其他部门进度。飞书通知将同步推送。
          </div>
        </div>

        <div className="flex items-center gap-3 px-6 py-4" style={{ borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 font-medium transition-colors">
            取消
          </button>
          <button onClick={submit} disabled={loading || !reason.trim()}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #dc2626, #b91c1c)" }}>
            {loading ? "驳回中..." : "确认驳回"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 任务管理 Modal（发邀请 / 驳回 / 追加成员 / 归档）────────────
//
// PA 专员在任务行点击「绑定表单」→ 粘贴 Bitable 链接 →
// 调用 /api/forms/extract-bitable → AI 提取字段 + 语义映射 →
// 显示字段预览 → 确认后完成绑定

interface ExtractedField {
  id: string;
  label: string;
  fieldType: string;
  syncMapping: { bitableFieldId: string | null; bitableFieldName: string | null; docxColumnIndex: number | null; aiMatchConfidence: number } | null;
}

interface ExtractResult {
  form: { id: string; status: string; fields: ExtractedField[] };
  aiResult: {
    suggestedLookupFieldId?:   string;
    suggestedLookupFieldName?: string;
    unmappedFieldKeys:         string[];
  };
}

// ── TaskDetailModal：任务管理（发邀请 / 驳回 / 追加成员 / 归档）──

const ASSIGN_STATUS_CFG: Record<string, { label: string; color: string; bg: string }> = {
  PENDING_SEND: { label: "待发送",  color: "#6b7280", bg: "rgba(107,114,128,0.1)" },
  PENDING_FILL: { label: "待填报",  color: "#f59e0b", bg: "rgba(245,158,11,0.1)"  },
  SUBMITTED:    { label: "已提交",  color: "#22c55e", bg: "rgba(34,197,94,0.1)"   },
  REJECTED:     { label: "已驳回",  color: "#ef4444", bg: "rgba(239,68,68,0.1)"   },
  ARCHIVED:     { label: "已归档",  color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
};

function TaskDetailModal({
  task, departments, onClose, onRefresh,
}: {
  task:        Task;
  departments: Department[];
  onClose:     () => void;
  onRefresh:   () => void;
}) {
  // 本地 assignments 状态（乐观更新）
  // 当父组件 task prop 更新（fetchTasks 完成）时同步重绘
  const [assignments, setAssignments] = useState<Assignment[]>(task.assignments);
  useEffect(() => { setAssignments(task.assignments); }, [task]);

  // 发邀请确认 dialog
  const [inviteTarget,  setInviteTarget]  = useState<Assignment | null>(null);
  const [inviting,      setInviting]      = useState(false);
  const [inviteErr,     setInviteErr]     = useState("");

  // 驳回 dialog
  const [rejectTarget,  setRejectTarget]  = useState<Assignment | null>(null);
  const [rejectNote,    setRejectNote]    = useState("");
  const [rejecting,     setRejecting]     = useState(false);
  const [rejectErr,     setRejectErr]     = useState("");

  // 追加成员（多选 + 级联）
  const [addingDeptId,    setAddingDeptId]    = useState("");
  const [addingUserIds,   setAddingUserIds]   = useState<string[]>([]);
  const [addingUserObjs,  setAddingUserObjs]  = useState<AssigneeUser[]>([]);
  const [addLoading,      setAddLoading]      = useState(false);
  const [addErr,          setAddErr]          = useState("");

  // 归档确认
  const [showArchive,   setShowArchive]   = useState(false);
  const [archiving,     setArchiving]     = useState(false);
  const [archiveErr,    setArchiveErr]    = useState("");

  // 取消归档确认
  const [showUnarchive,  setShowUnarchive]  = useState(false);
  const [unarchiving,    setUnarchiving]    = useState(false);
  const [unarchiveErr,   setUnarchiveErr]   = useState("");

  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  // ── 发送邀请 ────────────────────────────────────────────────
  async function sendInvite() {
    if (!inviteTarget) return;
    setInviting(true); setInviteErr("");
    try {
      const res = await fetch(
        `/api/tasks/${task.id}/assignments/${inviteTarget.id}/invite`,
        { method: "POST" }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "发送失败");
      setAssignments((prev) =>
        prev.map((a) => a.id === inviteTarget.id ? { ...a, status: "PENDING_FILL" } : a)
      );
      setInviteTarget(null);
      showToast(`✅ 已向 ${inviteTarget.department.name} 发送邀请`);
      onRefresh();
    } catch (e: unknown) { setInviteErr((e as Error).message); }
    finally { setInviting(false); }
  }

  // ── 驳回 ────────────────────────────────────────────────────
  async function submitReject() {
    if (!rejectTarget || !rejectNote.trim()) return;
    setRejecting(true); setRejectErr("");
    try {
      const res = await fetch(
        `/api/tasks/${task.id}/assignments/${rejectTarget.id}`,
        {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ rejectNote: rejectNote.trim() }),
        }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "驳回失败");
      setAssignments((prev) =>
        prev.map((a) => a.id === rejectTarget.id ? { ...a, status: "REJECTED", rejectNote: rejectNote.trim() } : a)
      );
      setRejectTarget(null); setRejectNote("");
      showToast(`已驳回 ${rejectTarget.department.name} 的填报`);
      onRefresh();
    } catch (e: unknown) { setRejectErr((e as Error).message); }
    finally { setRejecting(false); }
  }

  // ── 追加成员 ────────────────────────────────────────────────
  async function addMember() {
    if (!addingDeptId) { setAddErr("请选择部门"); return; }
    setAddLoading(true); setAddErr("");
    try {
      const res = await fetch(`/api/tasks/${task.id}/assignments`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ deptId: addingDeptId, assigneeUserIds: addingUserIds }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "添加失败");
      const dept = departments.find((dp) => dp.id === addingDeptId) ?? { id: addingDeptId, name: addingDeptId, code: "" };
      const newA: Assignment = {
        id:              d.assignment.id,
        status:          "PENDING_SEND",
        assigneeUserIds: addingUserIds,
        assigneeUsers:   addingUserObjs,
        rejectNote:      null,
        submittedAt:     null,
        department:      dept,
      };
      setAssignments((prev) => {
        const exists = prev.find((a) => a.id === d.assignment.id);
        return exists ? prev.map((a) => a.id === d.assignment.id ? newA : a) : [...prev, newA];
      });
      setAddingDeptId(""); setAddingUserIds([]); setAddingUserObjs([]);
      const nameStr = addingUserObjs.length > 0
        ? addingUserObjs.map(u => u.name).join("、")
        : dept.name;
      showToast(`已添加 ${nameStr}，可点击「发送邀请」`);
      onRefresh();
    } catch (e: unknown) { setAddErr((e as Error).message); }
    finally { setAddLoading(false); }
  }

  // ── 归档任务 ────────────────────────────────────────────────
  async function archiveTask() {
    setArchiving(true); setArchiveErr("");
    try {
      const res = await fetch("/api/tasks/lock", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ taskId: task.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "归档失败");
      setShowArchive(false);
      showToast(d.message ?? "任务已归档");
      onRefresh();
      setTimeout(onClose, 1500);
    } catch (e: unknown) { setArchiveErr((e as Error).message); }
    finally { setArchiving(false); }
  }

  // ── 取消归档 ─────────────────────────────────────────────────
  async function unarchiveTask() {
    setUnarchiving(true); setUnarchiveErr("");
    try {
      const res = await fetch("/api/tasks/unarchive", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ taskId: task.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "取消归档失败");
      setShowUnarchive(false);
      // 乐观更新：立即将所有 ARCHIVED assignment 改为 PENDING_SEND，无需等待 fetchTasks
      setAssignments((prev) =>
        prev.map((a) => a.status === "ARCHIVED" ? { ...a, status: "PENDING_SEND" } : a)
      );
      showToast(d.message ?? "任务已取消归档，可重新发送邀请");
      onRefresh();
    } catch (e: unknown) { setUnarchiveErr((e as Error).message); }
    finally { setUnarchiving(false); }
  }

  const availableDepts = departments.filter(
    (d) => d.code !== "PA" && !assignments.some((a) => a.department.id === d.id)
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-xl mx-4 flex flex-col shadow-2xl" style={{ maxHeight: "90vh" }}>

        {/* 顶栏 */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div>
            <h2 className="text-sm font-bold text-slate-900">{task.title}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {task.deadline ? `截止 ${new Date(task.deadline).toLocaleDateString("zh-CN")}` : "无截止日期"}
              {task.feishuSheetUrl && (
                <a href={task.feishuSheetUrl} target="_blank" rel="noopener noreferrer"
                  className="ml-2 text-blue-500 hover:underline inline-flex items-center gap-0.5">
                  <ExternalLink size={10} />飞书文档
                </a>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {task.status !== "ARCHIVED" ? (
              <button
                onClick={() => setShowArchive(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-opacity hover:opacity-80"
                style={{ background: "#f0fdf4", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}
              >
                <Archive size={11} />归档任务
              </button>
            ) : (
              <button
                onClick={() => { setShowUnarchive(true); setUnarchiveErr(""); }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium transition-opacity hover:opacity-80"
                style={{ background: "#fffbeb", color: "#d97706", border: "1px solid rgba(217,119,6,0.2)" }}
              >
                <ArchiveRestore size={11} />取消归档
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
              <X size={16} className="text-slate-500" />
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">

          {/* ── 分配列表 ──────────────────────────────────────── */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              参与成员 ({assignments.length})
            </p>
            {assignments.length === 0 ? (
              <p className="text-xs text-slate-400 py-4 text-center">暂无成员，请在下方添加</p>
            ) : (
              <div className="space-y-2">
                {assignments.map((a) => {
                  const cfg = ASSIGN_STATUS_CFG[a.status] ?? ASSIGN_STATUS_CFG.PENDING_SEND;
                  return (
                    <div key={a.id}
                      className="flex items-center justify-between px-3 py-2.5 rounded-xl"
                      style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">
                          {a.department.name}
                        </p>
                        {/* Phase 2 fix: 显示具体负责人姓名，而非重复部门名 */}
                        <p className="text-xs text-slate-400 truncate">
                          {(a.assigneeUsers ?? []).length > 0
                            ? (a.assigneeUsers).map(u => u.name).join("、")
                            : "暂未分配负责人"}
                        </p>
                        {a.status === "REJECTED" && a.rejectNote && (
                          <p className="text-xs text-red-500 mt-0.5 truncate">驳回：{a.rejectNote}</p>
                        )}
                        {a.status === "SUBMITTED" && a.submittedAt && (
                          <p className="text-xs text-green-600 mt-0.5">
                            {new Date(a.submittedAt).toLocaleString("zh-CN")} 已提交
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ background: cfg.bg, color: cfg.color }}>
                          {cfg.label}
                        </span>
                        {a.status === "PENDING_SEND" && (
                          <button
                            onClick={() => { setInviteTarget(a); setInviteErr(""); }}
                            className="text-xs px-2.5 py-1 rounded-lg font-medium transition-opacity hover:opacity-80"
                            style={{ background: "rgba(37,99,235,0.1)", color: "#2563eb" }}
                          >
                            发送邀请
                          </button>
                        )}
                        {a.status === "SUBMITTED" && (
                          <button
                            onClick={() => { setRejectTarget(a); setRejectNote(""); setRejectErr(""); }}
                            className="text-xs px-2.5 py-1 rounded-lg font-medium transition-opacity hover:opacity-80"
                            style={{ background: "rgba(239,68,68,0.1)", color: "#dc2626" }}
                          >
                            驳回
                          </button>
                        )}
                        {(a.status === "REJECTED" || a.status === "PENDING_FILL") && (
                          <button
                            onClick={() => { setInviteTarget(a); setInviteErr(""); }}
                            className="text-xs px-2.5 py-1 rounded-lg font-medium transition-opacity hover:opacity-80"
                            style={{ background: "rgba(245,158,11,0.1)", color: "#d97706" }}
                            title="重新发送邀请卡片（仅当对方已发过邀请时使用）"
                          >
                            重发邀请
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── 追加成员 ──────────────────────────────────────── */}
          {task.status !== "ARCHIVED" && (
            <div className="rounded-xl p-3 space-y-2" style={{ background: "#f8fafc", border: "1px dashed #e2e8f0" }}>
              <p className="text-xs font-semibold text-slate-600">动态追加成员</p>

              {/* 单行：部门 + 级联多选 + 添加按钮 */}
              <div className="flex w-full gap-2 items-center">
                <select
                  value={addingDeptId}
                  onChange={(e) => { setAddingDeptId(e.target.value); setAddingUserIds([]); setAddingUserObjs([]); setAddErr(""); }}
                  className="rounded-xl text-sm bg-white outline-none py-2 px-2.5"
                  style={{ border: "1px solid #e2e8f0", flexShrink: 0, width: "110px" }}>
                  <option value="">选部门...</option>
                  {availableDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
                  <LocalUserMultiSelect
                    selectedIds={addingUserIds}
                    onChange={(ids, users) => { setAddingUserIds(ids); setAddingUserObjs(users); setAddErr(""); }}
                    departmentId={addingDeptId || undefined}
                    placeholder="多选负责人（选填，级联过滤）"
                  />
                </div>
                <button onClick={addMember} disabled={addLoading || !addingDeptId}
                  style={{ flexShrink: 0, background: "#2563eb", whiteSpace: "nowrap" }}
                  className="flex items-center gap-1 px-3 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50">
                  {addLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  {addingUserObjs.length > 0 ? `加 ${addingUserObjs.map(u => u.name).join("、")}` : "添加"}
                </button>
              </div>
              {addErr && <p className="text-xs text-red-500">{addErr}</p>}
            </div>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div className="mx-6 mb-4 px-4 py-2.5 rounded-xl text-xs font-medium text-white"
            style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
            {toast}
          </div>
        )}
      </div>

      {/* ── 发邀请确认 dialog（内嵌层） ──────────────────────────── */}
      {inviteTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(37,99,235,0.1)" }}>
                <Send size={16} style={{ color: "#2563eb" }} />
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">确认发送填报邀请</p>
                <p className="text-xs text-slate-500 mt-0.5">将向对方发送飞书卡片通知</p>
              </div>
            </div>
            <p className="text-sm text-slate-700 mb-4">
              确认向 <span className="font-semibold">{inviteTarget.department.name}</span> 发送填报邀请吗？
            </p>
            {inviteErr && <p className="text-xs text-red-500 mb-3">{inviteErr}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setInviteTarget(null); setInviteErr(""); }} disabled={inviting}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 font-medium disabled:opacity-50">
                取消
              </button>
              <button onClick={sendInvite} disabled={inviting}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}>
                {inviting ? <><Loader2 size={14} className="animate-spin" />发送中...</> : <><Send size={14} />确认发送</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 驳回 dialog（内嵌层） ─────────────────────────────────── */}
      {rejectTarget && (
        <div className="fixed inset-0 z-60 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(239,68,68,0.1)" }}>
                <XCircle size={16} style={{ color: "#dc2626" }} />
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">驳回填报</p>
                <p className="text-xs text-slate-500 mt-0.5">{rejectTarget.department.name}</p>
              </div>
            </div>
            <textarea
              value={rejectNote}
              onChange={(e) => { setRejectNote(e.target.value); setRejectErr(""); }}
              rows={3}
              placeholder="请填写驳回原因（必填）..."
              className="w-full px-3 py-2.5 text-sm rounded-xl outline-none resize-none mb-3"
              style={{ border: `1px solid ${rejectErr ? "#fca5a5" : "#e2e8f0"}` }}
              autoFocus
            />
            {rejectErr && <p className="text-xs text-red-500 mb-3">{rejectErr}</p>}
            <div className="flex gap-3">
              <button onClick={() => { setRejectTarget(null); setRejectNote(""); }} disabled={rejecting}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 font-medium disabled:opacity-50">
                取消
              </button>
              <button onClick={submitReject} disabled={rejecting || !rejectNote.trim()}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #dc2626, #b91c1c)" }}>
                {rejecting ? <><Loader2 size={14} className="animate-spin" />驳回中...</> : "确认驳回"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 归档确认 dialog（内嵌层） ────────────────────────────── */}
      {showArchive && (
        <div className="fixed inset-0 z-60 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(34,197,94,0.1)" }}>
                <Archive size={16} style={{ color: "#16a34a" }} />
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">确认归档任务</p>
                <p className="text-xs text-slate-500 mt-0.5">归档后可点击「取消归档」恢复</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              确认归档「{task.title}」吗？归档后将向所有参与人发送飞书完结感谢卡片，所有分配状态变为已归档。
            </p>
            {archiveErr && <p className="text-xs text-red-500 mb-3">{archiveErr}</p>}
            <div className="flex gap-3">
              <button onClick={() => setShowArchive(false)} disabled={archiving}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 font-medium disabled:opacity-50">
                取消
              </button>
              <button onClick={archiveTask} disabled={archiving}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
                {archiving ? <><Loader2 size={14} className="animate-spin" />归档中...</> : <><Archive size={14} />确认归档</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 取消归档确认 dialog ───────────────────────────────────── */}
      {showUnarchive && (
        <div className="fixed inset-0 z-60 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-white rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(217,119,6,0.1)" }}>
                <ArchiveRestore size={16} style={{ color: "#d97706" }} />
              </div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">取消归档任务</p>
                <p className="text-xs text-slate-500 mt-0.5">任务将恢复为可编辑状态</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-4">
              确认取消归档「{task.title}」吗？任务状态将恢复为进行中，各部门提交状态将同步恢复，可继续编辑和重新归档。
            </p>
            {unarchiveErr && <p className="text-xs text-red-500 mb-3">{unarchiveErr}</p>}
            <div className="flex gap-3">
              <button onClick={() => setShowUnarchive(false)} disabled={unarchiving}
                className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 font-medium disabled:opacity-50">
                取消
              </button>
              <button onClick={unarchiveTask} disabled={unarchiving}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #d97706, #b45309)" }}>
                {unarchiving ? <><Loader2 size={14} className="animate-spin" />处理中...</> : <><ArchiveRestore size={14} />确认取消归档</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 以下仅保留 BindBitableModal 函数签名以避免编译错误 ────────────
function BindBitableModal({
  task,
  onClose,
  onBound,
}: {
  task:    Task;
  onClose: () => void;
  onBound: () => void;
}) {
  // AI form features removed in V1.0 pivot
  void task; void onBound;
  return <button className="hidden" onClick={onClose} />;
}

// ── 只读项目详情抽屉 ──────────────────────────────────────────

const ASSIGN_DETAIL_CFG: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
  PENDING_SEND: { label: "待发送",  color: "#94a3b8", bg: "rgba(148,163,184,0.1)", emoji: "⚪" },
  PENDING_FILL: { label: "待填报",  color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  emoji: "🟡" },
  SUBMITTED:    { label: "已提交",  color: "#22c55e", bg: "rgba(34,197,94,0.1)",   emoji: "🟢" },
  REJECTED:     { label: "已驳回",  color: "#ef4444", bg: "rgba(239,68,68,0.1)",   emoji: "🔴" },
  ARCHIVED:     { label: "已归档",  color: "#6b7280", bg: "rgba(107,114,128,0.1)", emoji: "⚫" },
};

function TaskDetailDrawer({
  task,
  onClose,
  onEdit,
  onManage,
  onUnarchive,
}: {
  task:         Task;
  onClose:      () => void;
  onEdit:       () => void;
  onManage:     () => void;
  onUnarchive?: () => void;
}) {
  const done  = task.assignments.filter(a => a.status === "SUBMITTED" || a.status === "ARCHIVED").length;
  const total = task.assignments.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  // 倒计时
  const countdown = (() => {
    if (!task.deadline) return null;
    const diff = new Date(task.deadline).getTime() - Date.now();
    const abs  = Math.abs(diff);
    const h    = Math.floor(abs / 3600000);
    const d    = Math.floor(h / 24);
    if (diff < 0)  return { text: `已逾期 ${d} 天`, color: "#ef4444" };
    if (h < 24)    return { text: `${h} 小时后截止`, color: "#ef4444" };
    if (d <= 3)    return { text: `${d} 天后截止`, color: "#f59e0b" };
    return { text: `${d} 天后截止`, color: "#22c55e" };
  })();

  const st = STATUS_CFG[task.status] ?? STATUS_CFG.DRAFT;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end" style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="h-full bg-white flex flex-col shadow-2xl"
        style={{ width: "min(640px, 95vw)", animation: "slideInRight 0.2s ease" }}
      >
        <style>{`@keyframes slideInRight{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>

        {/* 顶栏 */}
        <div className="flex items-start justify-between px-8 py-6 flex-shrink-0"
          style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="flex-1 min-w-0 pr-4">
            {/* 类型 + 状态 */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{
                  background: task.type === "PERIODIC" ? "rgba(59,130,246,0.08)" : "rgba(139,92,246,0.08)",
                  color:      task.type === "PERIODIC" ? "#2563eb" : "#7c3aed",
                }}>
                {task.type === "PERIODIC" ? "📅 周期填报" : "📌 专项填报"}
              </span>
              <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full font-medium"
                style={{ background: st.bg, color: st.text }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
                {st.label}
              </span>
            </div>
            {/* 大号标题 */}
            <h2 className="text-xl font-bold text-slate-900 leading-tight">{task.title}</h2>
            {task.description && (
              <p className="text-sm text-slate-500 mt-1 line-clamp-2">{task.description}</p>
            )}
            {/* 截止时间 + 倒计时 */}
            <div className="flex items-center gap-3 mt-3 flex-wrap">
              {task.deadline && (
                <span className="flex items-center gap-1.5 text-sm text-slate-500">
                  <Clock size={14} />
                  {new Date(task.deadline).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              {countdown && (
                <span className="text-sm font-semibold" style={{ color: countdown.color }}>
                  {countdown.text}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {task.status === "ARCHIVED" ? (
              <button onClick={onUnarchive}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors hover:bg-amber-50"
                style={{ color: "#d97706", border: "1px solid rgba(217,119,6,0.2)" }}>
                <ArchiveRestore size={12} />取消归档
              </button>
            ) : (
              <button onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors hover:bg-blue-50"
                style={{ color: "#2563eb", border: "1px solid rgba(37,99,235,0.2)" }}>
                <Pencil size={12} />编辑任务
              </button>
            )}
            <button onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100">
              <X size={16} className="text-slate-400" />
            </button>
          </div>
        </div>

        {/* 内容区（可滚动）*/}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">

          {/* 飞书云文档入口 */}
          {task.feishuSheetUrl ? (
            <a href={task.feishuSheetUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2.5 w-full py-3.5 rounded-2xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}>
              <ExternalLink size={15} />↗ 前往飞书云文档查看 / 填写
            </a>
          ) : (
            <div className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl text-sm text-slate-400"
              style={{ background: "#f8fafc", border: "1px dashed #e2e8f0" }}>
              <ExternalLink size={14} />暂未关联飞书文档
            </div>
          )}

          {/* 整体进度 */}
          <div className="bg-white rounded-2xl p-4" style={{ border: "1px solid #e2e8f0" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-700">整体填报进度</span>
              <span className="text-sm font-bold" style={{ color: pct === 100 ? "#22c55e" : "#2563eb" }}>
                {pct}%
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: pct === 100 ? "#22c55e" : "linear-gradient(90deg,#2563eb,#06b6d4)" }} />
            </div>
            <p className="text-xs text-slate-400 mt-1.5">已提交 {done} / 共 {total} 个部门</p>
          </div>

          {/* 分配列表 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">参与部门与负责人</h3>
              <button onClick={onManage}
                className="text-xs px-2.5 py-1 rounded-lg font-medium transition-colors hover:bg-blue-50"
                style={{ color: "#2563eb" }}>
                管理成员 →
              </button>
            </div>
            <div className="space-y-2">
              {task.assignments.length === 0 ? (
                <p className="text-xs text-slate-400 py-4 text-center">暂未分配部门</p>
              ) : task.assignments.map(a => {
                const cfg = ASSIGN_DETAIL_CFG[a.status] ?? ASSIGN_DETAIL_CFG.PENDING_SEND;
                return (
                  <div key={a.id}
                    className="flex items-center justify-between px-4 py-3 rounded-xl"
                    style={{ background: "#f8fafc", border: "1px solid #f1f5f9" }}>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{a.department.name}</p>
                      <p className="text-xs text-slate-400 truncate mt-0.5">
                        {(a.assigneeUsers ?? []).length > 0
                          ? (a.assigneeUsers).map(u => u.name).join("、")
                          : "暂未分配负责人"}
                      </p>
                      {a.status === "REJECTED" && a.rejectNote && (
                        <p className="text-xs text-red-500 mt-0.5 truncate">驳回：{a.rejectNote}</p>
                      )}
                    </div>
                    <span className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0 ml-3"
                      style={{ background: cfg.bg, color: cfg.color }}>
                      {cfg.emoji} {cfg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 创建信息 */}
          <div className="text-xs text-slate-400 pt-2" style={{ borderTop: "1px solid #f1f5f9" }}>
            由 {task.createdBy.name} 创建于 {new Date(task.createdAt).toLocaleDateString("zh-CN")}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 权限管理 Modal ────────────────────────────────────────────

const PERM_OPTS: { value: DeptPermLevel; label: string; desc: string; color: string; bg: string }[] = [
  { value: "edit", label: "可编辑", desc: "允许继续修改表格数据",   color: "#16a34a", bg: "rgba(34,197,94,0.08)"  },
  { value: "view", label: "可查看", desc: "只读，无法修改任何内容", color: "#2563eb", bg: "rgba(37,99,235,0.08)"  },
  { value: "none", label: "禁止访问", desc: "部门看不到此填报",    color: "#dc2626", bg: "rgba(239,68,68,0.08)" },
];

function PermissionModal({
  task,
  perms,
  onClose,
  onSaved,
}: {
  task: Task;
  perms: DeptPermMap;
  onClose: () => void;
  onSaved: (updated: DeptPermMap) => void;
}) {
  const [local, setLocal] = useState<DeptPermMap>(() => {
    // 初始化：继承已有 perms，未设置的默认 "view"
    const init: DeptPermMap = {};
    for (const a of task.assignments) {
      init[a.department.id] = perms[a.department.id] ?? "view";
    }
    return init;
  });

  function setDeptPerm(deptId: string, level: DeptPermLevel) {
    setLocal((prev) => ({ ...prev, [deptId]: level }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl w-full max-w-md mx-4 shadow-2xl flex flex-col" style={{ maxHeight: "85vh" }}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(124,58,237,0.1)" }}>
              <ShieldCheck size={15} style={{ color: "#7c3aed" }} />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">归档后权限管理</h2>
              <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[220px]">{task.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 flex-shrink-0">
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        {/* 说明 */}
        <div className="px-6 pt-4 pb-2 flex-shrink-0">
          <div className="px-4 py-3 rounded-xl text-xs leading-relaxed" style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)", color: "#5b21b6" }}>
            填报已归档，可单独控制每个参与部门对该填报的访问权限。修改后实时生效。
          </div>
        </div>

        {/* 部门列表 */}
        <div className="overflow-y-auto flex-1 px-6 py-3 space-y-3">
          {task.assignments.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">该填报暂无参与部门</p>
          )}
          {task.assignments.map((a) => {
            const current = local[a.department.id] ?? "view";
            return (
              <div key={a.department.id} className="rounded-xl p-4" style={{ border: "1px solid #e2e8f0" }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-slate-800">{a.department.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{
                      background: PERM_OPTS.find(o => o.value === current)?.bg,
                      color:      PERM_OPTS.find(o => o.value === current)?.color,
                    }}>
                    当前：{PERM_OPTS.find(o => o.value === current)?.label}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {PERM_OPTS.map((opt) => {
                    const active = current === opt.value;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => setDeptPerm(a.department.id, opt.value)}
                        className="flex flex-col items-center gap-1 px-2 py-2.5 rounded-xl text-xs font-medium transition-all"
                        style={{
                          background: active ? opt.bg : "#f8fafc",
                          border:     `1.5px solid ${active ? opt.color : "#e2e8f0"}`,
                          color:      active ? opt.color : "#64748b",
                        }}
                      >
                        <span className="font-semibold">{opt.label}</span>
                        <span className="text-xs font-normal opacity-70 text-center leading-tight">{opt.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部 */}
        <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0" style={{ borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 hover:bg-slate-200 font-medium transition-colors">
            取消
          </button>
          <button
            onClick={() => onSaved(local)}
            className="flex-1 py-2.5 rounded-xl text-sm text-white font-medium transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(135deg, #7c3aed, #6d28d9)" }}
          >
            保存权限
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 归档任务详情弹窗（SUPER_ADMIN 专属）────────────────────────

function ArchivedTaskDetailModal({
  task, onClose, onClone,
}: {
  task: Task;
  onClose: () => void;
  onClone: (p: { title: string; type: "PERIODIC" | "SPECIAL"; fieldsSchema: Omit<FieldDef, "_id">[] | null }) => void;
}) {
  const [assets, setAssets] = useState<Array<{
    id: string; metricName: string; category: string; value: string; unit: string | null; period: string;
  }>>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/assets?taskId=${task.id}&take=50`)
      .then((r) => r.json())
      .then((d) => setAssets(d.assets ?? []))
      .catch(() => {})
      .finally(() => setAssetsLoading(false));
  }, [task.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: "90vh" }}>

        {/* Header */}
        <div className="flex items-start gap-3 px-6 py-5" style={{ borderBottom: "1px solid #e2e8f0" }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(107,114,128,0.1)", color: "#6b7280" }}>已归档</span>
            </div>
            <h2 className="text-lg font-bold text-slate-900 truncate">{task.title}</h2>
          </div>
          <button
            onClick={() => onClone({ title: task.title + " - 副本", type: task.type, fieldsSchema: null })}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white flex-shrink-0 hover:opacity-90 transition-opacity"
            style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}
          >
            <Copy size={13} />复用为新填报
          </button>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 flex-shrink-0 transition-colors">
            <X size={16} className="text-slate-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* 基本信息 */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "填报类型", value: task.type === "PERIODIC" ? "周期填报" : "专项填报" },
              { label: "截止日期", value: task.deadline ? new Date(task.deadline).toLocaleDateString("zh-CN") : "无" },
              { label: "创建人",   value: task.createdBy.name },
              { label: "归档时间", value: task.archivedAt ? new Date(task.archivedAt).toLocaleDateString("zh-CN") : "—" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl p-4" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                <p className="text-xs text-slate-400 mb-1">{label}</p>
                <p className="text-sm font-medium text-slate-700">{value}</p>
              </div>
            ))}
          </div>

          {/* 参与部门 */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">参与部门</p>
            <div className="flex flex-wrap gap-2">
              {task.assignments.map((a) => (
                <span key={a.id} className="text-xs px-3 py-1.5 rounded-full"
                  style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb" }}>
                  {a.department.name}
                </span>
              ))}
            </div>
          </div>

          {/* 关联数据资产 */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Package2 size={14} className="text-slate-400" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">关联数据资产</p>
              {!assetsLoading && <span className="text-xs text-slate-400">（{assets.length} 条）</span>}
            </div>
            {assetsLoading ? (
              <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-slate-300" /></div>
            ) : assets.length === 0 ? (
              <div className="flex flex-col items-center py-8 text-slate-300">
                <Package2 size={32} className="mb-2" />
                <p className="text-sm">暂无关联的数据资产记录</p>
              </div>
            ) : (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#f8fafc" }}>
                      {["指标名称", "分类", "数值", "统计期"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {assets.map((a) => (
                      <tr key={a.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{a.metricName}</td>
                        <td className="px-4 py-2.5 text-slate-500 text-xs">{a.category}</td>
                        <td className="px-4 py-2.5 text-slate-700">{a.value}{a.unit ? ` ${a.unit}` : ""}</td>
                        <td className="px-4 py-2.5 text-slate-400 text-xs">{a.period}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 图表颜色 ──────────────────────────────────────────────────
const CHART_COLORS = ["#2563eb", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

// ── 可视化看板视图 ─────────────────────────────────────────────

function DashboardView({
  deptDistribution, typeRatio, completionRate, totalTasks, archivedCount,
  insight, insightLoading, onFetchInsight, onDeptClick, onTypeClick,
}: {
  deptDistribution: Array<{ name: string; count: number }>;
  typeRatio: { SPECIAL: number; PERIODIC: number };
  completionRate: number;
  totalTasks: number;
  archivedCount: number;
  insight: string;
  insightLoading: boolean;
  onFetchInsight: () => void;
  onDeptClick: (name: string) => void;
  onTypeClick: (type: string) => void;
}) {
  const deptData = deptDistribution.map((d) => ({ name: d.name, value: d.count }));
  const typeData = [
    { name: "专项填报", value: typeRatio.SPECIAL,  key: "SPECIAL"  },
    { name: "周期填报", value: typeRatio.PERIODIC, key: "PERIODIC" },
  ];
  // radialData removed — replaced by PieChart donut

  return (
    <div className="px-8 pb-8 space-y-5">

      {/* AI 洞察卡 */}
      <div className="rounded-2xl p-5 flex items-center gap-4"
        style={{ background: "linear-gradient(135deg, rgba(37,99,235,0.05), rgba(6,182,212,0.05))", border: "1px solid rgba(37,99,235,0.15)" }}>
        <Sparkles size={20} style={{ color: "#2563eb", flexShrink: 0 }} />
        <p className="text-sm text-slate-700 flex-1 leading-relaxed">
          {insightLoading
            ? "AI 正在生成洞察..."
            : (insight || "点击右侧「刷新洞察」按钮，获取基于当前数据的 AI 分析摘要")}
        </p>
        <button
          onClick={onFetchInsight}
          disabled={insightLoading}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-medium disabled:opacity-50 flex-shrink-0 transition-opacity hover:opacity-80"
          style={{ background: "#eff6ff", color: "#2563eb", border: "1px solid rgba(37,99,235,0.2)" }}
        >
          {insightLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          {insightLoading ? "生成中..." : "刷新洞察"}
        </button>
      </div>

      {/* 三图 Grid */}
      <div className="grid grid-cols-3 gap-5">

        {/* 图表 A：部门分布 Donut */}
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
          <p className="text-sm font-semibold text-slate-700 mb-0.5">填报部门占比</p>
          <p className="text-xs text-slate-400 mb-3">点击色块可下钻筛选</p>
          {deptData.length === 0 ? (
            <div className="flex items-center justify-center h-52 text-slate-300 text-sm">暂无数据</div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie
                  data={deptData}
                  cx="50%" cy="46%"
                  innerRadius={55} outerRadius={90}
                  paddingAngle={3} dataKey="value"
                  onClick={(entry) => onDeptClick((entry as { name: string }).name)}
                  style={{ cursor: "pointer" }}
                >
                  {deptData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`${v} 个填报`, "数量"]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* 图表 B：任务类型 Donut */}
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
          <p className="text-sm font-semibold text-slate-700 mb-0.5">填报类型构成</p>
          <p className="text-xs text-slate-400 mb-3">点击色块按类型筛选列表</p>
          <ResponsiveContainer width="100%" height={230}>
            <PieChart>
              <Pie
                data={typeData}
                cx="50%" cy="46%"
                innerRadius={55} outerRadius={90}
                paddingAngle={4} dataKey="value"
                onClick={(entry) => onTypeClick((entry as { key: string }).key)}
                style={{ cursor: "pointer" }}
              >
                <Cell fill="#8b5cf6" />
                <Cell fill="#2563eb" />
              </Pie>
              <Tooltip formatter={(v) => [`${v} 个`, "数量"]} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* 图表 C：整体完成率 Donut Chart */}
        <div className="bg-white rounded-2xl p-5 shadow-sm relative flex flex-col" style={{ border: "1px solid #e2e8f0" }}>
          <p className="text-sm font-semibold text-slate-700 mb-0.5">整体完成率</p>
          <p className="text-xs text-slate-400 mb-3">已提交 + 已归档 / 全部填报</p>
          <div className="relative flex-1" style={{ minHeight: "186px" }}>
            <ResponsiveContainer width="100%" height={186}>
              <PieChart>
                <Pie
                  data={[
                    { name: "已完成", value: Math.max(archivedCount, completionRate > 0 ? 1 : 0) },
                    { name: "未完成", value: Math.max(totalTasks - archivedCount, completionRate < 100 ? 1 : 0) },
                  ]}
                  cx="50%" cy="50%"
                  innerRadius="58%" outerRadius="82%"
                  startAngle={90} endAngle={-270}
                  paddingAngle={archivedCount > 0 && archivedCount < totalTasks ? 3 : 0}
                  dataKey="value"
                  stroke="none"
                >
                  <Cell fill="#22c55e" />
                  <Cell fill="#e2e8f0" />
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            {/* 居中文字 */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-3xl font-bold text-slate-800">{Math.round(completionRate)}%</span>
              <span className="text-xs text-slate-500 mt-1 font-medium">
                已完成 {archivedCount} / {totalTasks}
              </span>
            </div>
          </div>
          {/* 图例 */}
          <div className="flex justify-center gap-5 mt-2">
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#22c55e" }} />已完成
            </span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#e2e8f0" }} />未完成
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Toast 提示 ────────────────────────────────────────────────

function Toast({ msg, onHide }: { msg: string; onHide: () => void }) {
  useEffect(() => {
    const t = setTimeout(onHide, 2800);
    return () => clearTimeout(t);
  }, [onHide]);

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2.5 px-5 py-3 rounded-2xl shadow-xl text-sm font-medium text-white"
      style={{ background: "linear-gradient(135deg, #16a34a, #15803d)", minWidth: "200px", justifyContent: "center" }}
    >
      <CheckCircle2 size={16} />
      {msg}
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks,        setTasks]        = useState<Task[]>([]); // 全量数据源，不直接用于渲染
  const [departments,  setDepartments]  = useState<Department[]>([]);
  const [isLoading,    setIsLoading]    = useState(true);
  const [error,        setError]        = useState("");
  const [q,            setQ]            = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [typeFilter,   setTypeFilter]   = useState("ALL"); // ALL | PERIODIC | SPECIAL
  const [deptFilter,   setDeptFilter]   = useState("ALL"); // ALL | deptId

  // 防抖搜索词（300ms）
  const debouncedQ = useDebounce(q, 300);

  // 统计卡片：使用 getDisplayStatus 映射后的状态计数
  const stats: Stats = useMemo(() => ({
    total:      tasks.length,
    draft:      tasks.filter((t) => getDisplayStatus(t) === "DRAFT").length,
    pending:    tasks.filter((t) => getDisplayStatus(t) === "PENDING").length,
    inProgress: tasks.filter((t) => getDisplayStatus(t) === "IN_PROGRESS").length,
    submitted:  tasks.filter((t) => getDisplayStatus(t) === "SUBMITTED").length,
    archived:   tasks.filter((t) => getDisplayStatus(t) === "ARCHIVED").length,
  }), [tasks]);

  // 联合过滤：文本 AND 状态 AND 类型 AND 部门（均用 displayStatus）
  const filteredTasks = useMemo(() => {
    const keyword = debouncedQ.toLowerCase().trim();
    return tasks.filter((task) => {
      const displaySt = getDisplayStatus(task);
      const matchText   = !keyword || task.title.toLowerCase().includes(keyword) || (task.description ?? "").toLowerCase().includes(keyword);
      const matchStatus = statusFilter === "ALL" || displaySt === statusFilter;
      const matchType   = typeFilter   === "ALL" || task.type === typeFilter;
      const matchDept   = deptFilter   === "ALL" || task.assignments.some((a) => a.department.id === deptFilter);
      return matchText && matchStatus && matchType && matchDept;
    });
  }, [tasks, debouncedQ, statusFilter, typeFilter, deptFilter]);
  const [showForm,           setShowForm]           = useState(false);
  const [editTask,           setEditTask]           = useState<Task | null>(null);
  const [deleteTask,         setDeleteTask]         = useState<Task | null>(null);
  const [archiveTask,        setArchiveTask]        = useState<Task | null>(null);
  // 两步驳回：先选 task → 弹出部门选择 → 选 assignment → 弹出驳回 Modal
  const [rejectPickTask,     setRejectPickTask]     = useState<Task | null>(null);
  const [rejectAssignment,   setRejectAssignment]   = useState<Assignment | null>(null);
  const [rejectTaskForModal, setRejectTaskForModal] = useState<Task | null>(null);
  const [permTask,           setPermTask]           = useState<Task | null>(null);
  const [detailTask,         setDetailTask]         = useState<Task | null>(null);  // 只读详情抽屉
  const [manageTask,         setManageTask]         = useState<Task | null>(null);  // 任务管理弹窗
  const [locking,            setLocking]            = useState<string | null>(null);
  const [unarchiveTarget,    setUnarchiveTarget]    = useState<Task | null>(null);
  const [unarchiving,        setUnarchiving]        = useState(false);
  // taskId -> { deptId -> DeptPermLevel }（前端状态，持久化到 localStorage）
  const [deptPermissions,   setDeptPermissions]   = useState<Record<string, DeptPermMap>>(() => {
    try { return JSON.parse(localStorage.getItem("task_dept_perms") ?? "{}"); } catch { return {}; }
  });
  const [toast, setToast] = useState("");

  // ── 功能一：归档任务详情（SUPER_ADMIN 专属）─────────────────
  const [userRole,          setUserRole]          = useState<string>("PA_SPECIALIST");
  const [archivedDetailTask,setArchivedDetailTask]= useState<Task | null>(null);
  const [prefillData,       setPrefillData]       = useState<{
    title: string; type: "PERIODIC" | "SPECIAL"; fieldsSchema: Omit<FieldDef, "_id">[] | null;
  } | null>(null);

  // ── 功能二：可视化看板 ────────────────────────────────────────
  const [viewMode,          setViewMode]          = useState<"list" | "card" | "dashboard">("list");
  const [insight,           setInsight]           = useState<string>("");
  const [insightLoading,    setInsightLoading]    = useState(false);

  // 一次拉取全量数据，过滤在客户端完成
  const fetchTasks = useCallback(async () => {
    setIsLoading(true); setError("");
    try {
      const res = await fetch("/api/tasks?take=200");
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      const newTasks = (data.tasks ?? []) as Task[];
      setTasks(newTasks);
      // Phase 3 同步：如果「管理任务」弹窗正打开，用新数据刷新，触发 TaskDetailModal 内的 useEffect
      setManageTask(prev => {
        if (!prev) return null;
        return newTasks.find((t) => t.id === prev.id) ?? prev;
      });
    } catch { setError("加载失败，请刷新重试"); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // 读取当前用户角色（无 SessionProvider，调用 NextAuth 内置端点）
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => { if (d?.user?.role) setUserRole(d.user.role); })
      .catch(() => {});
  }, []);

  // 归档（通过 lock 接口）
  async function doArchive(task: Task) {
    setLocking(task.id);
    try {
      const res = await fetch("/api/tasks/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error ?? "归档失败");
      } else {
        setArchiveTask(null);
        await fetchTasks();
      }
    } finally { setLocking(null); }
  }

  async function doUnarchive(task: Task) {
    setUnarchiving(true);
    try {
      const res = await fetch("/api/tasks/unarchive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      const d = await res.json();
      if (!res.ok) {
        setToast(`取消归档失败：${d.error ?? "未知错误"}`);
      } else {
        setUnarchiveTarget(null);
        setToast(d.message ?? "任务已取消归档，可继续编辑");
        await fetchTasks();
      }
    } finally { setUnarchiving(false); }
  }

  async function savePermissions(taskId: string, perms: DeptPermMap) {
    // 同步写入数据库（真正持久化，部门端才能读到）
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ deptPermissions: perms }),
      });
      if (!res.ok) {
        const d = await res.json();
        setToast(`保存失败：${d.error ?? "未知错误"}`);
        return;
      }
    } catch {
      setToast("网络错误，权限配置保存失败");
      return;
    }
    // 本地缓存（UI 快速响应用）
    const updated = { ...deptPermissions, [taskId]: perms };
    setDeptPermissions(updated);
    try { localStorage.setItem("task_dept_perms", JSON.stringify(updated)); } catch {}
    setPermTask(null);
    await fetchTasks(); // 刷新列表，确保数据一致
    setToast("权限配置已保存并生效");
  }

  // ── 图表数据（客户端聚合，基于已加载的 200 条任务）─────────────
  const deptDistribution = useMemo(() => {
    const map: Record<string, { name: string; count: number }> = {};
    for (const t of tasks) {
      for (const a of t.assignments) {
        const name = a.department.name;
        map[name] = { name, count: (map[name]?.count ?? 0) + 1 };
      }
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [tasks]);

  const typeRatio = useMemo(() => ({
    SPECIAL:  tasks.filter((t) => t.type === "SPECIAL").length,
    PERIODIC: tasks.filter((t) => t.type === "PERIODIC").length,
  }), [tasks]);

  // 完成率：SUBMITTED (待归档) + ARCHIVED (已归档) 均算完成
  const completionRate = useMemo(() =>
    tasks.length === 0 ? 0
    : (tasks.filter((t) => t.status === "SUBMITTED" || t.status === "ARCHIVED").length / tasks.length) * 100,
  [tasks]);
  const archivedCount = useMemo(
    () => tasks.filter((t) => t.status === "SUBMITTED" || t.status === "ARCHIVED").length,
  [tasks]);

  // ── AI 洞察 ────────────────────────────────────────────────────
  const fetchInsight = useCallback(async () => {
    if (tasks.length === 0) return;
    setInsightLoading(true);
    try {
      const res = await fetch("/api/tasks/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stats: { departmentDistribution: deptDistribution, taskTypeRatio: typeRatio, completionRate } }),
      });
      const d = await res.json();
      setInsight(d.insight ?? "");
    } catch { setInsight("AI 服务暂时不可用"); }
    finally { setInsightLoading(false); }
  }, [tasks, deptDistribution, typeRatio, completionRate]);

  const statCards = [
    { label: "全部填报",  value: stats?.total ?? 0,      icon: "📋", accent: "#3b82f6", filter: "ALL"         },
    { label: "待填报",    value: stats?.pending ?? 0,    icon: "🔴", accent: "#ef4444", filter: "PENDING"     },
    { label: "进行中",    value: stats?.inProgress ?? 0, icon: "🟡", accent: "#f59e0b", filter: "IN_PROGRESS" },
    { label: "已归档",    value: stats?.archived ?? 0,   icon: "✅", accent: "#22c55e", filter: "ARCHIVED"    },
  ];

  return (
    <div className="flex-1 overflow-auto" style={{ background: "#f8fafc" }}>
      {/* Header */}
      <div className="px-8 pt-8 pb-6">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}>
              <ClipboardList size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">政府侧运营数据填报</h1>
              <p className="text-sm text-slate-500 mt-0.5">告别繁琐的表格流转，大幅减少各部门的重复性填报工作。</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchTasks} disabled={isLoading}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-500 bg-white disabled:opacity-50"
              style={{ border: "1px solid #e2e8f0" }}>
              <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
            </button>

            {/* 视图切换 */}
            <div className="flex rounded-xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
              {([
                { mode: "list"      as const, icon: List,            label: "列表" },
                { mode: "card"      as const, icon: Package2,        label: "卡片" },
                { mode: "dashboard" as const, icon: LayoutDashboard, label: "看板" },
              ] as const).map(({ mode, icon: Icon, label }, idx, arr) => (
                <button
                  key={mode}
                  onClick={() => { setViewMode(mode); if (mode === "dashboard") fetchInsight(); }}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm transition-colors"
                  style={{
                    background:  viewMode === mode ? "#eff6ff" : "white",
                    color:       viewMode === mode ? "#2563eb" : "#64748b",
                    borderRight: idx < arr.length - 1 ? "1px solid #e2e8f0" : "none",
                  }}
                >
                  <Icon size={13} />{label}
                </button>
              ))}
            </div>

            <button onClick={() => { setEditTask(null); setShowForm(true); }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}>
              <Plus size={15} />新建填报
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-8 mb-4 flex items-center gap-3 px-5 py-4 rounded-2xl text-red-600" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <AlertCircle size={16} /><p className="text-sm">{error}</p>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="px-8 mb-6 grid grid-cols-4 gap-4">
        {statCards.map((card) => (
          <button key={card.label} onClick={() => setStatusFilter(card.filter)}
            className="bg-white rounded-2xl px-5 py-4 shadow-sm text-left transition-all hover:shadow-md"
            style={{ border: `1px solid ${statusFilter === card.filter ? card.accent : "#e2e8f0"}` }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xl">{card.icon}</span>
              <span className="text-2xl font-bold" style={{ color: card.accent }}>{card.value}</span>
            </div>
            <p className="text-xs text-slate-500 font-medium">{card.label}</p>
          </button>
        ))}
      </div>

      {/* 搜索 + 高级筛选 */}
      <div className="px-8 mb-4 flex flex-wrap items-center gap-3">
        {/* 文本搜索 */}
        <div className="relative min-w-[200px] flex-1 max-w-xs">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            type="text" placeholder="搜索填报名称..."
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-xl bg-white outline-none text-slate-700 placeholder-slate-400"
            style={{ border: "1px solid #e2e8f0" }} />
        </div>

        {/* 任务类型 */}
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2.5 text-sm rounded-xl bg-white outline-none text-slate-700 cursor-pointer"
          style={{ border: "1px solid #e2e8f0" }}>
          <option value="ALL">全部类型</option>
          <option value="SPECIAL">专项填报</option>
          <option value="PERIODIC">周期填报</option>
        </select>

        {/* 参与部门 */}
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
          className="px-3 py-2.5 text-sm rounded-xl bg-white outline-none text-slate-700 cursor-pointer"
          style={{ border: "1px solid #e2e8f0" }}>
          <option value="ALL">全部部门</option>
          {departments.filter((d) => d.code !== "PA").map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>

        {/* 状态（与卡片联动） */}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2.5 text-sm rounded-xl bg-white outline-none text-slate-700 cursor-pointer"
          style={{ border: "1px solid #e2e8f0" }}>
          <option value="ALL">全部状态</option>
          <option value="PENDING">待填报</option>
          <option value="IN_PROGRESS">进行中</option>
          <option value="SUBMITTED">待归档</option>
          <option value="ARCHIVED">已归档</option>
          <option value="DRAFT">草稿</option>
        </select>

        {/* 清除筛选 */}
        {(q || typeFilter !== "ALL" || deptFilter !== "ALL" || statusFilter !== "ALL") && (
          <button onClick={() => { setQ(""); setTypeFilter("ALL"); setDeptFilter("ALL"); setStatusFilter("ALL"); }}
            className="flex items-center gap-1 px-3 py-2 text-xs rounded-xl text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            style={{ border: "1px solid #e2e8f0" }}>
            <X size={12} />清除
          </button>
        )}

        <span className="ml-auto text-xs text-slate-400">{filteredTasks.length} / {tasks.length} 条</span>
      </div>

      {/* 可视化看板视图 */}
      {viewMode === "dashboard" && (
        <DashboardView
          deptDistribution={deptDistribution}
          typeRatio={typeRatio}
          completionRate={completionRate}
          totalTasks={tasks.length}
          archivedCount={archivedCount}
          insight={insight}
          insightLoading={insightLoading}
          onFetchInsight={fetchInsight}
          onDeptClick={(name) => {
            const dept = departments.find((d) => d.name === name);
            if (dept) { setDeptFilter(dept.id); setViewMode("list"); }
          }}
          onTypeClick={(type) => { setTypeFilter(type); setViewMode("list"); }}
        />
      )}

      {/* 卡片视图 */}
      {viewMode === "card" && (
        <TaskCardGrid tasks={filteredTasks} onCardClick={(t) => setDetailTask(t)} />
      )}

      {/* 任务列表 */}
      {viewMode === "list" && <div className="px-8 pb-8">
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 size={24} className="animate-spin mr-3" />加载中...
            </div>
          ) : filteredTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <ClipboardList size={40} className="mb-3 opacity-30" />
              <p className="text-sm font-medium text-slate-500">
                {tasks.length === 0 ? "暂无填报" : "没有符合条件的填报"}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {tasks.length === 0 ? "点击「新建填报」创建第一条填报" : "尝试调整搜索词或状态筛选"}
              </p>
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">填报名称</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">类型</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">截止日期</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">参与部门</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">进度</th>
                  <th className="px-5 py-3.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">状态</th>
                  <th className="px-5 py-3.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filteredTasks.map((task) => {
                  const st    = STATUS_CFG[getDisplayStatus(task)] ?? STATUS_CFG.DRAFT;
                  const done  = task.assignments.filter((a) => a.status === "SUBMITTED" || a.status === "ARCHIVED").length;
                  const total = task.assignments.length;
                  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
                  const hasFeishu = !!task.feishuSheetUrl;

                  return (
                    <tr
                      key={task.id}
                      className="hover:bg-slate-50 transition-colors group cursor-pointer"
                      onClick={() => setDetailTask(task)}
                    >
                      {/* 任务名 */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: st.dot }} />
                          <span className="text-sm font-medium text-slate-800">{task.title}</span>
                        </div>
                        {task.description && (
                          <p className="text-xs text-slate-400 mt-0.5 line-clamp-1 pl-5">{task.description}</p>
                        )}
                      </td>

                      {/* 类型 Tag — 修复样式 */}
                      <td className="px-5 py-4">
                        <span
                          className="inline-flex items-center whitespace-nowrap text-xs font-medium px-2.5 py-1 rounded-full"
                          style={{
                            background: task.type === "PERIODIC" ? "rgba(59,130,246,0.1)" : "rgba(139,92,246,0.1)",
                            color: task.type === "PERIODIC" ? "#2563eb" : "#7c3aed",
                          }}
                        >
                          {task.type === "PERIODIC" ? "周期填报" : "专项填报"}
                        </span>
                      </td>

                      {/* 截止日期 */}
                      <td className="px-5 py-4">
                        {task.deadline ? (
                          <div className="flex items-center gap-1.5 text-sm text-slate-500">
                            <Clock size={13} />
                            {new Date(task.deadline).toLocaleDateString("zh-CN")}
                          </div>
                        ) : <span className="text-xs text-slate-400">无</span>}
                      </td>

                      {/* 参与部门（hover 可飞书私聊负责人）*/}
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1">
                          {task.assignments.slice(0, 3).map((a) => (
                            <span key={a.id}
                              className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                              {a.department.name}
                            </span>
                          ))}
                          {task.assignments.length > 3 && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-400">
                              +{task.assignments.length - 3}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* 进度 */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full rounded-full transition-all"
                              style={{ width: `${pct}%`, background: pct === 100 ? "#22c55e" : "#3b82f6" }} />
                          </div>
                          <span className="text-xs text-slate-500">{done}/{total}</span>
                        </div>
                      </td>

                      {/* 状态 */}
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
                          style={{ background: st.bg, color: st.text }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: st.dot }} />
                          {st.label}
                        </span>
                      </td>

                      {/* 操作列（stopPropagation 防止触发行点击）*/}
                      <td className="px-5 py-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 justify-end flex-wrap">

                          {/* 飞书链接按钮 */}
                          {hasFeishu ? (
                            <a
                              href={task.feishuSheetUrl!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                              style={{ background: "#e0f2fe", color: "#0369a1" }}
                            >
                              <ExternalLink size={11} />去填报
                            </a>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium cursor-not-allowed"
                              style={{ background: "#f1f5f9", color: "#94a3b8" }}
                              title="该填报暂无飞书表格链接"
                            >
                              <ExternalLink size={11} />去填报
                            </span>
                          )}

                          {/* 所有非草稿任务：统一进入「任务管理」弹窗 */}
                          {task.status !== "DRAFT" && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setManageTask(task); }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                              style={{ background: "rgba(37,99,235,0.08)", color: "#2563eb" }}
                              title="管理成员、发邀请、驳回、归档"
                            >
                              <ClipboardList size={11} />管理
                            </button>
                          )}

                          {/* 已归档状态：权限管理 + 取消归档 */}
                          {task.status === "ARCHIVED" && (
                            <>
                              <button
                                onClick={(e) => { e.stopPropagation(); setPermTask(task); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                                style={{ background: "rgba(124,58,237,0.08)", color: "#7c3aed" }}
                                title="管理各部门对已归档填报的访问权限"
                              >
                                <ShieldCheck size={11} />权限管理
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setUnarchiveTarget(task); }}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                                style={{ background: "rgba(217,119,6,0.08)", color: "#d97706" }}
                                title="将任务从归档状态恢复为进行中"
                              >
                                <ArchiveRestore size={11} />取消归档
                              </button>
                            </>
                          )}

                          {/* 编辑 / 删除（hover 时显示） */}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditTask(task); setShowForm(true); }}
                              className="p-1.5 rounded-lg hover:bg-blue-50"
                              title="编辑"
                            >
                              <Pencil size={13} style={{ color: "#3b82f6" }} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setDeleteTask(task); }}
                              className="p-1.5 rounded-lg hover:bg-red-50"
                              title="删除"
                            >
                              <Trash2 size={13} style={{ color: "#ef4444" }} />
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>}

      {/* 弹窗层 */}
      {showForm && (
        <TaskFormModal
          task={editTask}
          departments={departments}
          prefill={prefillData}
          onClose={() => { setShowForm(false); setEditTask(null); setPrefillData(null); }}
          onSaved={() => { setShowForm(false); setEditTask(null); setPrefillData(null); fetchTasks(); }}
        />
      )}
      {deleteTask && (
        <DeleteDialog
          task={deleteTask}
          onClose={() => setDeleteTask(null)}
          onDeleted={() => { setDeleteTask(null); fetchTasks(); }}
        />
      )}
      {archiveTask && (
        <ArchiveConfirmDialog
          task={archiveTask}
          loading={locking === archiveTask.id}
          onClose={() => setArchiveTask(null)}
          onConfirm={() => doArchive(archiveTask)}
        />
      )}
      {/* 只读详情抽屉 */}
      {detailTask && (
        <TaskDetailDrawer
          task={detailTask}
          onClose={() => setDetailTask(null)}
          onEdit={() => {
            setDetailTask(null);
            setEditTask(detailTask);
            setShowForm(true);
          }}
          onManage={() => {
            setManageTask(detailTask);
            setDetailTask(null);
          }}
          onUnarchive={() => {
            setDetailTask(null);
            setUnarchiveTarget(detailTask);
          }}
        />
      )}

      {/* 任务管理弹窗（发邀请 / 驳回 / 追加成员 / 归档）*/}
      {manageTask && (
        <TaskDetailModal
          task={manageTask}
          departments={departments}
          onClose={() => setManageTask(null)}
          onRefresh={fetchTasks}
        />
      )}
      {permTask && (
        <PermissionModal
          task={permTask}
          perms={deptPermissions[permTask.id] ?? {}}
          onClose={() => setPermTask(null)}
          onSaved={(updated) => savePermissions(permTask.id, updated)}
        />
      )}
      {archivedDetailTask && (
        <ArchivedTaskDetailModal
          task={archivedDetailTask}
          onClose={() => setArchivedDetailTask(null)}
          onClone={(prefill) => {
            setArchivedDetailTask(null);
            setPrefillData(prefill);
            setEditTask(null);
            setShowForm(true);
          }}
        />
      )}
{unarchiveTarget && (
        <UnarchiveConfirmDialog
          task={unarchiveTarget}
          loading={unarchiving}
          onClose={() => setUnarchiveTarget(null)}
          onConfirm={() => doUnarchive(unarchiveTarget)}
        />
      )}
{/* BindBitableModal removed in V1.0 pivot */}
      {toast && <Toast msg={toast} onHide={() => setToast("")} />}
    </div>
  );
}
