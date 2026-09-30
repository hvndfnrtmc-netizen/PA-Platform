"use client";

import { TodoManagerV2 } from "./TodoManagerV2";
import {
  HierarchicalFormatSelect,
  buildByIdMap,
  resolveFormatDisplay,
  type DictNode,
} from "./FormatSelect";
import {
  HierarchicalHostSelect,
  HierarchicalHostMultiSelect,
  buildHostByIdMap,
  resolveHostRootName,
  type HostDictNode,
} from "./HostSelect";

import React, {
  useState, useEffect, useCallback, useRef, useTransition, ChangeEvent, useMemo,
} from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  LayoutGrid, Table2, BarChart2, Loader2, Plus, X, Check,
  ChevronDown, ChevronLeft, ChevronRight, Trash2, Pencil,
  CalendarDays, Users, Upload, Link2, CheckSquare,
  Database, ExternalLink, Building2, User2, CheckCircle2, AlertCircle,
  Square, EyeOff, Eye, Tag, UploadCloud, Shirt, Bell, BellOff, ArrowRight,
} from "lucide-react";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartTooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TODO_CATEGORIES, TODO_CATEGORY_TASKS, interpolateContent,
} from "@/lib/receptionTodoConstants";
import { ClipboardImageUploader } from "@/components/ClipboardImageUploader";
import { ReceptionShareDialog } from "@/components/ReceptionShareDialog";
import { generateAmapUrl } from "@/lib/mapUtils";

// ── 类型 ──────────────────────────────────────────────────────

interface FileItem {
  type: "local" | "feishu";
  name: string;
  url:  string;
  size?: number;
}

interface HostUser { id: string; name: string }

interface ReceptionTodoTask {
  id:          string;
  receptionId: string;
  category:    string;
  content:     string;
  isCompleted: boolean;
  link:        string | null;
  sortOrder:   number;
  actionType?:  string | null;
  actionValue?: string | null;
}

interface Reception {
  id:               string;
  title:            string;
  startTime:        string;
  endTime:          string | null;
  level:            string;
  hostName:         string | null;
  hostUserId:       string | null;
  hostDictId:       string | null;
  hostDictIds:      string[];       // 多选 ID 数组（新字段，空数组时降级用 hostDictId）
  hostDisplay?:     string | null; // API 附加：一级名称（视图降维用）
  hostUser:         HostUser | null;
  dressCode:        string | null;
  formats:          string[];
  purpose:          string;
  status:           string;
  background:           string | null;
  address:              string | null;
  navigationAddress:    string | null;
  surveyFiles:      FileItem[];
  meetingMinutes:   FileItem[];
  meetingPhotos:    string[];
  leaderIntroText:  string | null;
  leaderIntroImages: string[];
  todos:            string[];          // 已启用的大类分类名称数组
  remarks:          string | null;
  customData?:      Record<string, string> | null;
  feishuRecordId:   string | null;    // 飞书多维表格行 ID（只读，由同步逻辑写入）
  feishuBitableUrl: string | null;    // 飞书多维表格行深层链接
  todoTasks?:       ReceptionTodoTask[];
  createdAt:        string;
  /** 后端解析后的一级名称数组，供视图层展示（不含二级名称） */
  formatsDisplay?:  string[];
  todoList?:        unknown; // 运行时为 TodoCategory[]，组件内 normalizeCategories 保证类型安全
  /** 待执行的定时通知列表（status=PENDING 且有 qstashMessageId）*/
  pendingNotifications?: Array<{ id: string; scheduledAt: string; targetIds: string[] }>;
}

type DictMap = Record<string, string[]>; // format 以外的分类仍用 string[] 存 values

interface CreateForm {
  title:          string;
  startTime:      string;
  endTime:        string;
  level:          string;
  hostName:       string;
  hostUserId:     string;
  hostDictId:     string;
  hostDictIds:    string[];
  dressCode:      string;
  formats:        string[];
  purpose:        string;
  status:         string;
  background:         string;
  address:            string;
  navigationAddress:  string;
  surveyFiles:    FileItem[];
  meetingMinutes: FileItem[];
  meetingPhotos:    string[];
  leaderIntroText:  string;
  leaderIntroImages: string[];
  todos:          string[];   // 旧字段，保留兼容
  todoList:       unknown;   // TodoCategory[]
  remarks:        string;
  customData:     Record<string, string>;
}

interface SysUser {
  id:           string;
  name:         string;
  email:        string;
  departmentId: string | null;
}

interface SysDept {
  id:   string;
  name: string;
  code: string;
}

interface ParsedReception {
  title:           string;
  startTime:       string | null;
  endTime:         string | null;
  level:           string;
  hostName:        string;
  formats:         string[];
  background:      string;
  purpose:         string;
  status:          string;
  feishuRecordId:  string | null;
}

type ViewMode = "table" | "card" | "kanban";

interface Filters {
  view:      ViewMode;
  q:         string;
  status:    string;
  level:     string;
  purpose:   string;
  hostName:  string;
  format:    string;
  startFrom: string;
  startTo:   string;
  page:      number;
  limit:     number;
}

// ── 样式常量 ──────────────────────────────────────────────────

const LEVEL_COLOR: Record<string, string> = {
  区级: "#06b6d4", 市级: "#8b5cf6", 省级: "#3b82f6", 国家级: "#ef4444",
};

const LEVEL_BG: Record<string, string> = {
  区级: "rgba(6,182,212,0.10)", 市级: "rgba(139,92,246,0.10)",
  省级: "rgba(59,130,246,0.10)", 国家级: "rgba(239,68,68,0.10)",
};
const LEVEL_ORDER = ["国家级", "省级", "市级", "区级", "板块", "企业/院所", "媒体"];
const STATUS_META: Record<string, { bg: string; color: string }> = {
  正常: { bg: "rgba(34,197,94,0.10)",  color: "#16a34a" },
  取消: { bg: "rgba(239,68,68,0.10)", color: "#ef4444" },
};
const VIEW_TABS: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
  { key: "table",  label: "数据表格", icon: <Table2    size={15} /> },
  { key: "card",   label: "卡片视图", icon: <LayoutGrid size={15} /> },
  { key: "kanban", label: "看板视图", icon: <BarChart2  size={15} /> },
];
const DEFAULT_LIMIT = 20;

// ── 工具 ──────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function fmtDateShort(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(dt.getMonth() + 1)}/${p(dt.getDate())}`;
}

function fmtDateTime(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" }) + " " +
    dt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** 将主接待字段（可能含"部门·姓名"格式）聚合为"去重部门名 空格连接"字符串。
 *  例：["LPA · Yuting", "LPA · Zoe"] → "LPA"
 *      ["LPA · Yuting", "SPA · John"] → "LPA SPA"
 *      "LPA · Yuting" → "LPA"
 */
function formatReceiversDisplay(receivers: string | string[] | null | undefined): string {
  if (!receivers) return "";
  const arr = Array.isArray(receivers) ? receivers : [receivers];
  const depts = new Set(arr.map(s => s.split(/[·•]|-/)[0].trim()).filter(Boolean));
  return [...depts].join(" ");
}

function fmtTime(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  return dt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtMonthGroup(d: string | null): string {
  if (!d) return "未定时间";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "未定时间";
  return `${dt.getFullYear()}年${dt.getMonth() + 1}月`;
}

function toDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function parseFilters(sp: URLSearchParams): Filters {
  const view = sp.get("view") ?? "table";
  return {
    view:      (["table", "card", "kanban"].includes(view) ? view : "table") as ViewMode,
    q:         sp.get("q")         ?? "",
    status:    sp.get("status")    ?? "",
    level:     sp.get("level")     ?? "",
    purpose:   sp.get("purpose")   ?? "",
    hostName:  sp.get("hostName")  ?? "",
    format:    sp.get("format")    ?? "",
    startFrom: sp.get("startFrom") ?? "",
    startTo:   sp.get("startTo")   ?? "",
    page:      Math.max(1, Number(sp.get("page") ?? 1)),
    limit:     Math.min(100, Math.max(10, Number(sp.get("limit") ?? DEFAULT_LIMIT))),
  };
}

function makeEmpty(): CreateForm {
  return {
    title: "", startTime: "", endTime: "", level: "", hostName: "", hostUserId: "", hostDictId: "", hostDictIds: [],
    dressCode: "", formats: [], purpose: "", status: "正常", background: "", address: "", navigationAddress: "",
    surveyFiles: [], meetingMinutes: [], meetingPhotos: [],
    leaderIntroText: "", leaderIntroImages: [],
    todos: [], todoList: [], remarks: "",
    customData: {},
  };
}

function parseBitableUrl(url: string): { appToken: string; tableId: string; isWiki: boolean } | null {
  try {
    const u = new URL(url);
    const tableId = u.searchParams.get("table") ?? "";
    if (!tableId) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    const baseIdx = parts.indexOf("base");
    if (baseIdx >= 0 && parts[baseIdx + 1]) return { appToken: parts[baseIdx + 1], tableId, isWiki: false };
    const wikiIdx = parts.indexOf("wiki");
    if (wikiIdx >= 0 && parts[wikiIdx + 1]) return { appToken: parts[wikiIdx + 1], tableId, isWiki: true };
    return null;
  } catch { return null; }
}

// ── ViewSwitcher ──────────────────────────────────────────────

function ViewSwitcher({ current, onChange }: { current: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="overflow-x-auto" style={{ scrollbarWidth: "none" }}>
      <div className="flex items-center gap-1 p-1 rounded-xl"
        style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", width: "fit-content" }}>
        {VIEW_TABS.map(tab => (
          <button key={tab.key} onClick={() => onChange(tab.key)}
            className="flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 rounded-lg text-xs font-semibold transition-all duration-200 whitespace-nowrap"
            style={current === tab.key
              ? { background: "white", color: "#1e293b", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }
              : { color: "rgba(255,255,255,0.6)" }}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Field ──────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "12px", fontWeight: 500, color: "#64748b", marginBottom: "6px" }}>
        {label}{required && <span style={{ color: "#ef4444", marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

// ── CreatableSelect（单选） ────────────────────────────────────

function CreatableSelect({
  category, value, onChange, options, onOptionAdded, placeholder = "请选择或输入…",
}: {
  category: string; value: string; onChange: (v: string) => void;
  options: string[]; onOptionAdded: (cat: string, val: string) => void; placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [dropRect, setDropRect] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const filtered  = options.filter(o => o.toLowerCase().includes(search.toLowerCase().trim()));
  const canCreate = search.trim() !== "" && !options.some(o => o.toLowerCase() === search.trim().toLowerCase());

  function select(opt: string) { onChange(opt); setIsOpen(false); setSearch(""); }

  async function create() {
    const v = search.trim(); if (!v || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reception/dicts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, value: v }) });
      if (res.ok) { onOptionAdded(category, v); onChange(v); setIsOpen(false); setSearch(""); }
    } finally { setSaving(false); }
  }

  const S: React.CSSProperties = { boxSizing: "border-box" };
  return (
    <>
      <button type="button" ref={triggerRef} onClick={() => setIsOpen(o => !o)}
        style={{ ...S, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", fontSize: "14px", borderRadius: "12px", border: "1px solid #e2e8f0", background: "white", cursor: "pointer", textAlign: "left" }}>
        <span style={{ color: value ? "#1e293b" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{value || placeholder}</span>
        <ChevronDown size={13} style={{ color: "#94a3b8", flexShrink: 0, marginLeft: 4, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>
      {isOpen && (
        <div ref={dropRef} style={{ position: "fixed", top: dropRect.top, left: dropRect.left, width: dropRect.width, zIndex: 9999, background: "white", border: "1px solid #e2e8f0", borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,0.14)", maxHeight: "240px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "7px 8px 6px", borderBottom: "1px solid #f1f5f9" }}>
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); canCreate ? void create() : (filtered.length === 1 && select(filtered[0])); } if (e.key === "Escape") setIsOpen(false); }}
              placeholder="搜索或输入新选项，按 Enter 创建…"
              style={{ ...S, width: "100%", padding: "5px 9px", fontSize: "13px", border: "1px solid #e2e8f0", borderRadius: "8px", outline: "none" }} />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 && !canCreate && <div style={{ padding: "12px", fontSize: "12px", color: "#94a3b8", textAlign: "center" }}>无匹配选项，输入后按 Enter 创建</div>}
            {filtered.map(opt => (
              <div key={opt} onMouseDown={() => select(opt)}
                style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 10px", background: value === opt ? "rgba(37,99,235,0.06)" : undefined, cursor: "pointer" }}>
                <span style={{ flex: 1, fontSize: "13px", color: value === opt ? "#2563eb" : "#1e293b", fontWeight: value === opt ? 500 : 400 }}>{opt}</span>
                {value === opt && <Check size={13} style={{ color: "#2563eb", flexShrink: 0 }} />}
              </div>
            ))}
            {canCreate && (
              <div onMouseDown={() => void create()}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 10px", cursor: saving ? "not-allowed" : "pointer", borderTop: filtered.length > 0 ? "1px solid #f1f5f9" : undefined, color: "#2563eb", fontSize: "13px" }}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}创建「{search.trim()}」
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── MultiCreatableSelect（多选） ───────────────────────────────

function MultiCreatableSelect({
  category, value, onChange, options, onOptionAdded, placeholder = "请选择或输入…",
}: {
  category: string; value: string[]; onChange: (v: string[]) => void;
  options: string[]; onOptionAdded: (cat: string, val: string) => void; placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [dropRect, setDropRect] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  const filtered  = options.filter(o => o.toLowerCase().includes(search.toLowerCase().trim()));
  const canCreate = search.trim() !== "" && !options.some(o => o.toLowerCase() === search.trim().toLowerCase());

  function toggle(opt: string) { onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]); }

  async function create() {
    const v = search.trim(); if (!v || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reception/dicts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, value: v }) });
      if (res.ok) { onOptionAdded(category, v); onChange([...value, v]); setSearch(""); }
    } finally { setSaving(false); }
  }

  const S: React.CSSProperties = { boxSizing: "border-box" };
  return (
    <>
      <div ref={triggerRef} onClick={() => setIsOpen(o => !o)}
        style={{ ...S, width: "100%", minHeight: "42px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px", padding: "6px 10px 6px 12px", borderRadius: "12px", border: "1px solid #e2e8f0", background: "white", cursor: "pointer" }}>
        {value.length === 0
          ? <span style={{ color: "#94a3b8", fontSize: "14px", flex: 1 }}>{placeholder}</span>
          : value.map(v => (
            <span key={v} style={{ display: "inline-flex", alignItems: "center", gap: "3px", padding: "2px 8px", borderRadius: "6px", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.15)", fontSize: "12px", color: "#2563eb" }}>
              {v}
              <button type="button" onMouseDown={e => { e.stopPropagation(); onChange(value.filter(x => x !== v)); }} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: "#93c5fd" }}><X size={10} /></button>
            </span>
          ))}
        <ChevronDown size={13} style={{ color: "#94a3b8", flexShrink: 0, marginLeft: "auto", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </div>
      {isOpen && (
        <div ref={dropRef} style={{ position: "fixed", top: dropRect.top, left: dropRect.left, width: dropRect.width, zIndex: 9999, background: "white", border: "1px solid #e2e8f0", borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,0.14)", maxHeight: "240px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "7px 8px 6px", borderBottom: "1px solid #f1f5f9" }}>
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); canCreate ? void create() : (filtered.length === 1 && toggle(filtered[0])); } if (e.key === "Escape") setIsOpen(false); }}
              placeholder="搜索或输入新选项，按 Enter 创建…"
              style={{ ...S, width: "100%", padding: "5px 9px", fontSize: "13px", border: "1px solid #e2e8f0", borderRadius: "8px", outline: "none" }} />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 && !canCreate && <div style={{ padding: "12px", fontSize: "12px", color: "#94a3b8", textAlign: "center" }}>无匹配选项，输入后按 Enter 创建</div>}
            {filtered.map(opt => {
              const isSel = value.includes(opt);
              return (
                <div key={opt} onMouseDown={() => toggle(opt)}
                  style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", cursor: "pointer", background: isSel ? "rgba(37,99,235,0.04)" : undefined }}>
                  <div style={{ width: 15, height: 15, borderRadius: "4px", border: isSel ? "none" : "1.5px solid #cbd5e1", background: isSel ? "#2563eb" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {isSel && <Check size={10} style={{ color: "white" }} />}
                  </div>
                  <span style={{ flex: 1, fontSize: "13px", color: isSel ? "#2563eb" : "#1e293b", fontWeight: isSel ? 500 : 400 }}>{opt}</span>
                </div>
              );
            })}
            {canCreate && (
              <div onMouseDown={() => void create()}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 10px", cursor: saving ? "not-allowed" : "pointer", borderTop: filtered.length > 0 ? "1px solid #f1f5f9" : undefined, color: "#2563eb", fontSize: "13px" }}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}创建「{search.trim()}」
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── HostSelector（两级级联：部门 → 用户，支持自由输入 fallback）─

function HostSelector({ hostUserId, hostName, onChangeUser, onChangeName }: {
  hostUserId:   string;
  hostName:     string;
  onChangeUser: (userId: string, userName: string) => void;
  onChangeName: (name: string) => void;
}) {
  const [showPicker,    setShowPicker]    = useState(false);
  const [depts,         setDepts]         = useState<SysDept[]>([]);
  const [users,         setUsers]         = useState<SysUser[]>([]);
  const [selectedDept,  setSelectedDept]  = useState("");
  const [loadingUsers,  setLoadingUsers]  = useState(false);

  useEffect(() => {
    if (!showPicker || depts.length > 0) return;
    fetch("/api/departments")
      .then(r => r.json() as Promise<{ departments: SysDept[] }>)
      .then(d => setDepts(d.departments ?? []))
      .catch(() => {});
  }, [showPicker, depts.length]);

  useEffect(() => {
    if (!selectedDept) { setUsers([]); return; }
    setLoadingUsers(true);
    fetch(`/api/users?departmentId=${selectedDept}&take=100`)
      .then(r => r.json() as Promise<{ users: SysUser[] }>)
      .then(d => setUsers(d.users ?? []))
      .catch(() => {})
      .finally(() => setLoadingUsers(false));
  }, [selectedDept]);

  const iStyle: React.CSSProperties = { boxSizing: "border-box", width: "100%", padding: "10px 12px", fontSize: "14px", borderRadius: "12px", border: "1px solid #e2e8f0", outline: "none", color: "#1e293b" };
  const btnSm: React.CSSProperties  = { padding: "5px 10px", borderRadius: "8px", border: "1px solid #e2e8f0", background: "white", fontSize: "12px", color: "#475569", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 };

  if (showPicker) {
    return (
      <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", padding: "12px", background: "#f8fafc" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#475569", display: "flex", alignItems: "center", gap: 5 }}>
            <Building2 size={13} />选择系统用户
          </span>
          <button type="button" onClick={() => { setShowPicker(false); setSelectedDept(""); }} style={{ ...btnSm, border: "none", background: "transparent", color: "#94a3b8" }}>
            <X size={14} />
          </button>
        </div>
        <select value={selectedDept} onChange={e => setSelectedDept(e.target.value)}
          style={{ ...iStyle, marginBottom: 8 }}>
          <option value="">— 选择部门 —</option>
          {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        {selectedDept && (
          <div style={{ maxHeight: 160, overflowY: "auto", borderRadius: "8px", border: "1px solid #e2e8f0", background: "white" }}>
            {loadingUsers
              ? <div style={{ padding: "12px", textAlign: "center" }}><Loader2 size={14} className="animate-spin" style={{ color: "#94a3b8" }} /></div>
              : users.length === 0
              ? <div style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8" }}>该部门暂无用户</div>
              : users.map(u => (
                <button key={u.id} type="button"
                  onClick={() => { onChangeUser(u.id, u.name); setShowPicker(false); setSelectedDept(""); }}
                  style={{ width: "100%", textAlign: "left", padding: "8px 12px", border: "none", background: u.id === hostUserId ? "rgba(37,99,235,0.06)" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 26, height: 26, borderRadius: "50%", background: "rgba(37,99,235,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <User2 size={12} style={{ color: "#2563eb" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: u.id === hostUserId ? "#2563eb" : "#1e293b" }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: "#94a3b8" }}>{u.email}</div>
                  </div>
                </button>
              ))}
          </div>
        )}
        <button type="button" onClick={() => { setShowPicker(false); setSelectedDept(""); onChangeUser("", ""); }}
          style={{ ...btnSm, marginTop: 8, fontSize: 11, color: "#94a3b8" }}>
          切换为手动输入
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8 }}>
      {hostUserId ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderRadius: "12px", border: "1px solid rgba(37,99,235,0.2)", background: "rgba(37,99,235,0.04)" }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(37,99,235,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <User2 size={13} style={{ color: "#2563eb" }} />
          </div>
          <span style={{ flex: 1, fontSize: 14, color: "#1e293b", fontWeight: 500 }}>{hostName}</span>
          <button type="button" onClick={() => onChangeUser("", "")} style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", color: "#94a3b8", padding: 2 }}>
            <X size={13} />
          </button>
          <button type="button" onClick={() => setShowPicker(true)} style={{ ...btnSm }}>更换</button>
        </div>
      ) : (
        <input value={hostName} onChange={e => onChangeName(e.target.value)}
          placeholder="请输入主接待人姓名（可系统内、可外部人员）"
          style={{ ...iStyle, flex: 1 }} />
      )}
      {!hostUserId && (
        <button type="button" onClick={() => setShowPicker(true)}
          style={{ ...btnSm, flexShrink: 0, whiteSpace: "nowrap", borderColor: "#d1d5db" }}>
          <Users size={12} />选系统用户
        </button>
      )}
    </div>
  );
}

// ── FileListEditor（本地上传 + 飞书 URL）──────────────────────

function FileListEditor({ value, onChange }: { value: FileItem[]; onChange: (v: FileItem[]) => void }) {
  const [addingFeishu, setAddingFeishu] = useState(false);
  const [feishuName,   setFeishuName]   = useState("");
  const [feishuUrl,    setFeishuUrl]    = useState("");
  const [uploading,    setUploading]    = useState(false);
  const [uploadErr,    setUploadErr]    = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleLocalUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true); setUploadErr("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res  = await fetch("/api/reception/upload", { method: "POST", body: fd });
      const data = await res.json() as { type?: string; name?: string; url?: string; size?: number; error?: string };
      if (!res.ok) { setUploadErr(data.error ?? "上传失败"); return; }
      onChange([...value, { type: "local", name: data.name ?? file.name, url: data.url ?? "", size: data.size }]);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function addFeishuDoc() {
    if (!feishuUrl.trim()) return;
    const name = feishuName.trim() || "飞书文档";
    onChange([...value, { type: "feishu", name, url: feishuUrl.trim() }]);
    setAddingFeishu(false); setFeishuName(""); setFeishuUrl("");
  }

  const btnStyle: React.CSSProperties = { padding: "6px 12px", borderRadius: "8px", border: "1px solid #e2e8f0", background: "white", fontSize: "12px", color: "#475569", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 };

  return (
    <div>
      {value.map((f, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: "8px", background: "#f8fafc", border: "1px solid #e2e8f0", marginBottom: 5 }}>
          <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: "4px", background: f.type === "feishu" ? "rgba(37,99,235,0.08)" : "rgba(6,182,212,0.08)", color: f.type === "feishu" ? "#2563eb" : "#0891b2", border: `1px solid ${f.type === "feishu" ? "rgba(37,99,235,0.15)" : "rgba(6,182,212,0.15)"}`, flexShrink: 0 }}
            title={f.type === "feishu" ? "飞书链接依赖外部服务，若文档被删除或权限变更则无法访问" : "已上传至云端存储，与本地文件无关"}>
            {f.type === "feishu" ? "飞书链接" : "云存储"}
          </span>
          <span style={{ flex: 1, fontSize: 13, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
          {f.size !== undefined && <span style={{ fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{(f.size / 1024 / 1024).toFixed(1)}MB</span>}
          <a href={f.url} target="_blank" rel="noopener noreferrer" style={{ display: "flex", alignItems: "center", color: "#2563eb", flexShrink: 0 }}>
            <ExternalLink size={12} />
          </a>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}
            style={{ border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", color: "#94a3b8", padding: 2, flexShrink: 0 }}>
            <X size={12} />
          </button>
        </div>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input type="file" ref={fileRef} onChange={handleLocalUpload} style={{ display: "none" }} />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} style={btnStyle}>
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {uploading ? "上传中…" : "上传本地文件"}
        </button>
        <button type="button" onClick={() => setAddingFeishu(v => !v)} style={{ ...btnStyle, color: addingFeishu ? "#2563eb" : "#475569", borderColor: addingFeishu ? "rgba(37,99,235,0.3)" : "#e2e8f0" }}>
          <Link2 size={12} />添加飞书云文档
        </button>
      </div>

      {uploadErr && <p style={{ fontSize: 12, color: "#ef4444", marginTop: 4 }}>{uploadErr}</p>}

      {addingFeishu && (
        <div style={{ marginTop: 8, padding: "12px", borderRadius: "10px", background: "#f0f4f8", border: "1px solid #e2e8f0" }}>
          <input value={feishuName} onChange={e => setFeishuName(e.target.value)}
            placeholder="文件名称（可选，默认「飞书文档」）"
            style={{ boxSizing: "border-box", width: "100%", padding: "7px 10px", fontSize: 13, borderRadius: "8px", border: "1px solid #e2e8f0", outline: "none", marginBottom: 6 }} />
          <input value={feishuUrl} onChange={e => setFeishuUrl(e.target.value)}
            placeholder="飞书文档 URL（必填）"
            style={{ boxSizing: "border-box", width: "100%", padding: "7px 10px", fontSize: 13, borderRadius: "8px", border: "1px solid #e2e8f0", outline: "none", marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={addFeishuDoc} disabled={!feishuUrl.trim()}
              style={{ padding: "6px 14px", borderRadius: "8px", border: "none", background: "#2563eb", color: "white", fontSize: 12, cursor: feishuUrl.trim() ? "pointer" : "not-allowed", fontWeight: 500 }}>确认添加</button>
            <button type="button" onClick={() => { setAddingFeishu(false); setFeishuName(""); setFeishuUrl(""); }}
              style={{ padding: "6px 12px", borderRadius: "8px", border: "1px solid #e2e8f0", background: "white", fontSize: 12, color: "#64748b", cursor: "pointer" }}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TodoCategorySelector（新建表单用：勾选大类）──────────────

function TodoCategorySelector({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  function toggle(cat: string) {
    onChange(value.includes(cat) ? value.filter(c => c !== cat) : [...value, cat]);
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {TODO_CATEGORIES.map(cat => {
        const isSel = value.includes(cat);
        return (
          <button key={cat} type="button" onClick={() => toggle(cat)}
            style={{ padding: "4px 10px", borderRadius: "6px", fontSize: "12px", cursor: "pointer", transition: "all 0.1s",
              background: isSel ? "rgba(37,99,235,0.08)" : "white",
              border:     isSel ? "1px solid rgba(37,99,235,0.25)" : "1px solid #e2e8f0",
              color:      isSel ? "#2563eb" : "#64748b", fontWeight: isSel ? 600 : 400 }}>
            {isSel && <Check size={10} style={{ marginRight: 3, display: "inline" }} />}{cat}
          </button>
        );
      })}
    </div>
  );
}

// ── TodoTaskManager（详情抽屉用：展示 + 勾选子任务）──────────

function TodoTaskManager({
  receptionId, categories, todoTasks, reception, onTaskToggled, onCategoriesChanged,
}: {
  receptionId:        string;
  categories:         string[];
  todoTasks:          ReceptionTodoTask[];
  reception:          { startTime: string; title: string; formats: string[] };
  onTaskToggled:      () => void;
  onCategoriesChanged: (cats: string[]) => void;
}) {
  const [hideCompleted, setHideCompleted] = useState(false);
  const [toggling,      setToggling]      = useState<Set<string>>(new Set());

  async function toggleTask(task: ReceptionTodoTask) {
    setToggling(prev => new Set(prev).add(task.id));
    try {
      await fetch(`/api/reception/${receptionId}/todo-tasks/${task.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isCompleted: !task.isCompleted }),
      });
      onTaskToggled();
    } finally {
      setToggling(prev => { const next = new Set(prev); next.delete(task.id); return next; });
    }
  }

  // 按 category 分组，只展示已启用分类的任务
  const tasksByCategory = TODO_CATEGORIES
    .filter(cat => categories.includes(cat))
    .reduce<Record<string, ReceptionTodoTask[]>>((acc, cat) => {
      acc[cat] = todoTasks.filter(t => t.category === cat);
      return acc;
    }, {});

  const totalCount     = todoTasks.length;
  const completedCount = todoTasks.filter(t => t.isCompleted).length;

  return (
    <div>
      {/* 大类勾选 */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.05em", marginBottom: 7 }}>启用分类</div>
        <TodoCategorySelector value={categories} onChange={onCategoriesChanged} />
      </div>

      {categories.length === 0 ? (
        <div style={{ padding: "16px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>请勾选上方分类以自动生成待办任务</div>
      ) : (
        <>
          {/* 控制栏 */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>
              {completedCount}/{totalCount} 已完成
            </span>
            <button type="button" onClick={() => setHideCompleted(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: "6px", border: "1px solid #e2e8f0", background: "white", fontSize: 11, color: "#64748b", cursor: "pointer" }}>
              {hideCompleted ? <><Eye size={11} />显示已完成</> : <><EyeOff size={11} />隐藏已完成</>}
            </button>
          </div>

          {/* 任务列表，按分类分组 */}
          {TODO_CATEGORIES.filter(cat => categories.includes(cat)).map(cat => {
            const tasks = tasksByCategory[cat] ?? [];
            const visible = hideCompleted ? tasks.filter(t => !t.isCompleted) : tasks;
            if (hideCompleted && visible.length === 0) return null;
            return (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 5, display: "flex", alignItems: "center", gap: 5 }}>
                  <span style={{ display: "inline-block", width: 3, height: 12, borderRadius: 2, background: "#2563eb", flexShrink: 0 }} />
                  {cat}
                </div>
                {tasks.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#94a3b8", paddingLeft: 10 }}>
                    {cat in TODO_CATEGORY_TASKS ? "点击「保存」后自动生成子任务" : "暂无子任务规则"}
                  </div>
                ) : (
                  visible.map(task => {
                    const content = interpolateContent(task.content, reception);
                    const isToggling = toggling.has(task.id);
                    return (
                      <div key={task.id}
                        style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "5px 0 5px 8px", borderRadius: 6, background: "transparent" }}>
                        <button type="button" onClick={() => void toggleTask(task)} disabled={isToggling}
                          style={{ border: "none", background: "transparent", cursor: "pointer", padding: "1px 0", display: "flex", alignItems: "center", flexShrink: 0, marginTop: 1 }}>
                          {isToggling
                            ? <Loader2 size={15} className="animate-spin" style={{ color: "#2563eb" }} />
                            : task.isCompleted
                            ? <CheckSquare size={15} style={{ color: "#2563eb" }} />
                            : <Square size={15} style={{ color: "#cbd5e1" }} />}
                        </button>
                        <span style={{ flex: 1, fontSize: 13, color: task.isCompleted ? "#94a3b8" : "#1e293b", textDecoration: task.isCompleted ? "line-through" : "none", lineHeight: 1.5 }}>
                          {content}
                        </span>
                        {task.link && (
                          <a href={task.link} target="_blank" rel="noopener noreferrer"
                            title="点击跳转" onClick={e => e.stopPropagation()}
                            style={{ display: "flex", alignItems: "center", padding: "2px 5px", borderRadius: 5, border: "1px solid rgba(37,99,235,0.2)", color: "#2563eb", background: "rgba(37,99,235,0.05)", flexShrink: 0, marginTop: 1 }}>
                            <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ── EditableCreatableSelect（单选 + 行内编辑 + 删除） ─────────────
// 用于着装要求等扁平字典字段：选择/创建/编辑/删除一体化

type DictRow = { id: string; value: string; isDefault: boolean };

function EditableCreatableSelect({
  category, value, onChange, options, rows, onOptionAdded, onDictChanged, placeholder = "请选择或输入…",
}: {
  category:       string;
  value:          string;
  onChange:       (v: string) => void;
  options:        string[];
  rows:           DictRow[];
  onOptionAdded:  (cat: string, val: string) => void;
  onDictChanged:  () => void;
  placeholder?:   string;
}) {
  const [isOpen,    setIsOpen]    = useState(false);
  const [search,    setSearch]    = useState("");
  const [saving,    setSaving]    = useState(false);
  const [dropRect,  setDropRect]  = useState({ top: 0, left: 0, width: 0 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const triggerRef = useRef<HTMLButtonElement>(null);
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
      setIsOpen(false); setSearch(""); setEditingId(null);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [isOpen]);

  const filtered  = options.filter(o => o.toLowerCase().includes(search.toLowerCase().trim()));
  const canCreate = search.trim() !== "" && !options.some(o => o.toLowerCase() === search.trim().toLowerCase());

  function select(opt: string) {
    if (editingId) return; // 编辑中不触发选择
    onChange(opt); setIsOpen(false); setSearch(""); setEditingId(null);
  }

  async function create() {
    const v = search.trim(); if (!v || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reception/dicts", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, value: v }),
      });
      if (res.ok) { onOptionAdded(category, v); onChange(v); setIsOpen(false); setSearch(""); }
    } finally { setSaving(false); }
  }

  async function saveEdit(id: string, oldValue: string) {
    const v = editValue.trim();
    if (!v) { setEditingId(null); return; }
    if (v === oldValue) { setEditingId(null); return; }
    setSaving(true);
    try {
      const res  = await fetch(`/api/reception/dicts/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: v }),
      });
      const data = await res.json() as { error?: string };
      if (data.error) { window.alert(`修改失败：${data.error}`); return; }
      if (value === oldValue) onChange(v); // 当前已选值同步更新
      setEditingId(null);
      onDictChanged();
    } finally { setSaving(false); }
  }

  async function doDelete(id: string, optValue: string) {
    const ok = window.confirm(`确定要停用「${optValue}」吗？\n停用后该选项不会出现在下拉列表里，但历史记录仍会正常显示。`);
    if (!ok) return;
    setSaving(true);
    try {
      const res  = await fetch(`/api/reception/dicts/${id}`, { method: "DELETE" });
      const data = await res.json() as { error?: string };
      if (data.error) { window.alert(`停用失败：${data.error}`); return; }
      if (value === optValue) onChange(""); // 清空已删除的选中值
      onDictChanged();
    } finally { setSaving(false); }
  }

  const S: React.CSSProperties = { boxSizing: "border-box" };
  return (
    <>
      <button type="button" ref={triggerRef} onClick={() => setIsOpen(o => !o)}
        style={{ ...S, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", fontSize: "14px", borderRadius: "12px", border: "1px solid #e2e8f0", background: "white", cursor: "pointer", textAlign: "left" }}>
        <span style={{ color: value ? "#1e293b" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{value || placeholder}</span>
        <ChevronDown size={13} style={{ color: "#94a3b8", flexShrink: 0, marginLeft: 4, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {isOpen && (
        <div ref={dropRef} style={{ position: "fixed", top: dropRect.top, left: dropRect.left, width: dropRect.width, zIndex: 9999, background: "white", border: "1px solid #e2e8f0", borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,0.14)", maxHeight: "280px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "7px 8px 6px", borderBottom: "1px solid #f1f5f9" }}>
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); canCreate ? void create() : (filtered.length === 1 && select(filtered[0])); } if (e.key === "Escape") { setIsOpen(false); setEditingId(null); } }}
              placeholder="搜索或输入新选项，按 Enter 创建…"
              style={{ ...S, width: "100%", padding: "5px 9px", fontSize: "13px", border: "1px solid #e2e8f0", borderRadius: "8px", outline: "none" }} />
          </div>

          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 && !canCreate && (
              <div style={{ padding: "12px", fontSize: "12px", color: "#94a3b8", textAlign: "center" }}>无匹配选项，输入后按 Enter 创建</div>
            )}

            {filtered.map(opt => {
              const row      = rows.find(r => r.value === opt);
              const isEditing = editingId !== null && row?.id === editingId;
              const isSel     = value === opt;

              return (
                <div
                  key={opt}
                  onClick={() => !isEditing && select(opt)}
                  style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 10px", background: isSel ? "rgba(37,99,235,0.06)" : undefined, cursor: isEditing ? "default" : "pointer", position: "relative", userSelect: "none" }}
                  onMouseEnter={(e) => {
                    const icons = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]");
                    if (icons) icons.style.opacity = "1";
                  }}
                  onMouseLeave={(e) => {
                    const icons = (e.currentTarget as HTMLElement).querySelector<HTMLElement>("[data-icons]");
                    if (icons) icons.style.opacity = "0";
                  }}
                >
                  {/* 行内编辑输入框 */}
                  {isEditing ? (
                    <>
                      <input
                        autoFocus
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => {
                          e.stopPropagation();
                          if (e.key === "Enter") { e.preventDefault(); void saveEdit(row!.id, opt); }
                          if (e.key === "Escape") { setEditingId(null); setEditValue(""); }
                        }}
                        onClick={e => e.stopPropagation()}
                        style={{ ...S, flex: 1, padding: "3px 8px", fontSize: "13px", border: "1px solid #2563eb", borderRadius: "6px", outline: "none" }}
                      />
                      <button type="button" onMouseDown={e => { e.stopPropagation(); void saveEdit(row!.id, opt); }}
                        style={{ fontSize: "11px", color: "white", background: "#2563eb", border: "none", borderRadius: "4px", padding: "2px 7px", cursor: saving ? "not-allowed" : "pointer", flexShrink: 0 }}>
                        {saving ? <Loader2 size={10} className="animate-spin" /> : "保存"}
                      </button>
                      <button type="button" onMouseDown={e => { e.stopPropagation(); setEditingId(null); setEditValue(""); }}
                        style={{ fontSize: "11px", color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: "4px", padding: "2px 6px", cursor: "pointer", flexShrink: 0 }}>
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: "13px", color: isSel ? "#2563eb" : "#1e293b", fontWeight: isSel ? 500 : 400 }}>{opt}</span>
                      {isSel && <Check size={13} style={{ color: "#2563eb", flexShrink: 0 }} />}
                      {/* 操作图标（仅 DB 中存在的选项才有） */}
                      {row && (
                        <div data-icons=""
                          style={{ display: "flex", alignItems: "center", gap: "2px", flexShrink: 0, opacity: 0, transition: "opacity 0.12s" }}
                          onClick={e => e.stopPropagation()}>
                          <button type="button" title="重命名" disabled={saving}
                            onClick={e => { e.stopPropagation(); setEditingId(row.id); setEditValue(opt); }}
                            style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", borderRadius: "4px", display: "flex", alignItems: "center", color: "#64748b" }}>
                            <Pencil size={12} />
                          </button>
                          <button type="button" title="停用" disabled={saving}
                            onClick={e => { e.stopPropagation(); void doDelete(row.id, opt); }}
                            style={{ border: "none", background: "none", cursor: "pointer", padding: "2px 3px", borderRadius: "4px", display: "flex", alignItems: "center", color: "#ef4444" }}>
                            <Trash2 size={12} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {canCreate && (
              <div onMouseDown={() => void create()}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 10px", cursor: saving ? "not-allowed" : "pointer", borderTop: filtered.length > 0 ? "1px solid #f1f5f9" : undefined, color: "#2563eb", fontSize: "13px" }}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}创建「{search.trim()}」
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ── CreateDrawer ──────────────────────────────────────────────

function CreateDrawer({
  dicts, onOptionAdded, onClose, onCreated, prefill, formatTree, formatById, onDictChanged,
  dressCodeRows, onDressCodeChanged, purposeRows, onPurposeChanged, hostTree, hostById, onHostChanged,
  drawerFields,
}: {
  dicts: DictMap; onOptionAdded: (cat: string, val: string) => void;
  onClose: () => void; onCreated: () => void; prefill?: Partial<CreateForm>;
  formatTree: DictNode[]; formatById: Map<string, DictNode>; onDictChanged: () => void;
  dressCodeRows: DictRow[]; onDressCodeChanged: () => void;
  purposeRows: DictRow[]; onPurposeChanged: () => void;
  hostTree: HostDictNode[]; hostById: Map<string, HostDictNode>; onHostChanged: () => void;
  drawerFields: DrawerField[];
}) {
  const [form,   setForm]   = useState<CreateForm>({ ...makeEmpty(), ...prefill });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  function set<K extends keyof CreateForm>(key: K, val: CreateForm[K]) { setForm(prev => ({ ...prev, [key]: val })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("会议名称不能为空"); return; }
    if (!form.startTime)    { setError("开始时间不能为空"); return; }
    setError(""); setSaving(true);
    try {
      const res = await fetch("/api/reception", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(), startTime: form.startTime, endTime: form.endTime || null,
          level: form.level,
          hostDictIds: form.hostDictIds,
          hostDictId: form.hostDictIds[0] ?? null,
          hostName: form.hostName || null,
          hostUserId: form.hostUserId || null,
          dressCode: form.dressCode || null,
          formats: form.formats, purpose: form.purpose, status: form.status || "正常",
          background: form.background || null,
          address: form.address || null,
          navigationAddress: form.navigationAddress || null,
          leaderIntroText: form.leaderIntroText || null,
          leaderIntroImages: form.leaderIntroImages,
          surveyFiles: form.surveyFiles,
          meetingMinutes: form.meetingMinutes, meetingPhotos: form.meetingPhotos,
          todos: form.todos, remarks: form.remarks || null,
          customData: form.customData,
        }),
      });
      if (!res.ok) { const d = await res.json() as { error?: string }; setError(d.error ?? "创建失败"); return; }
      onCreated(); onClose();
    } finally { setSaving(false); }
  }

  const iS: React.CSSProperties = { boxSizing: "border-box", width: "100%", padding: "10px 12px", fontSize: "14px", borderRadius: "12px", border: "1px solid #e2e8f0", outline: "none", color: "#1e293b" };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 999, backdropFilter: "blur(2px)" }} />
      <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: 540, zIndex: 1000, background: "white", boxShadow: "-8px 0 40px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column" }}>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: "17px", fontWeight: 700, color: "#1e293b", margin: 0 }}>新建接待</h2>
              <p style={{ fontSize: "12px", color: "#94a3b8", margin: "3px 0 0" }}>填写接待基本信息</p>
            </div>
            <button type="button" onClick={onClose} style={{ width: 32, height: 32, borderRadius: "8px", border: "none", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#64748b" }}>
              <X size={18} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {[...drawerFields].filter(f => f.visible !== false).sort((a, b) => a.order - b.order).map(field => {
                switch (field.key) {
                  case "title": return (
                    <Field key="title" label={field.label} required>
                      <input value={form.title} onChange={e => set("title", e.target.value)} placeholder="请输入接待名称" style={iS} />
                    </Field>
                  );
                  case "startTime": return (
                    <Field key="startTime" label={field.label} required>
                      <input type="datetime-local" value={toDateTimeLocal(form.startTime)} onChange={e => set("startTime", e.target.value ? new Date(e.target.value).toISOString() : "")} style={iS} />
                    </Field>
                  );
                  case "endTime": return (
                    <Field key="endTime" label={field.label}>
                      <input type="datetime-local" value={toDateTimeLocal(form.endTime)} onChange={e => set("endTime", e.target.value ? new Date(e.target.value).toISOString() : "")} style={iS} />
                    </Field>
                  );
                  case "level": return (
                    <Field key="level" label={field.label}>
                      <CreatableSelect category="level" value={form.level} onChange={v => set("level", v)} options={dicts.level ?? []} onOptionAdded={onOptionAdded} placeholder="请选择或新增级别" />
                    </Field>
                  );
                  case "status": return (
                    <Field key="status" label={field.label}>
                      <CreatableSelect category="status" value={form.status} onChange={v => set("status", v)} options={dicts.status ?? []} onOptionAdded={onOptionAdded} placeholder="请选择状态" />
                    </Field>
                  );
                  case "host": return (
                    <Field key="host" label={field.label}>
                      <HierarchicalHostMultiSelect
                        value={form.hostDictIds}
                        onChange={(ids, names) => { set("hostDictIds", ids); set("hostDictId", ids[0] ?? ""); set("hostName", names[0] ?? ""); set("hostUserId", ""); }}
                        tree={hostTree} byId={hostById} onDictChanged={onHostChanged}
                        isSuperAdmin={true}
                        placeholder="请选择主接待人（可多选）" />
                    </Field>
                  );
                  case "dressCode": return (
                    <Field key="dressCode" label={field.label}>
                      <EditableCreatableSelect category="dressCode" value={form.dressCode}
                        onChange={v => set("dressCode", v)}
                        options={dicts.dressCode ?? []}
                        rows={dressCodeRows}
                        onOptionAdded={onOptionAdded}
                        onDictChanged={onDressCodeChanged}
                        placeholder="请选择或新增着装要求" />
                    </Field>
                  );
                  case "formats": return (
                    <Field key="formats" label={field.label}>
                      <HierarchicalFormatSelect
                        value={form.formats}
                        onChange={v => set("formats", v)}
                        tree={formatTree}
                        byId={formatById}
                        onDictChanged={onDictChanged}
                        isSuperAdmin={true}
                        placeholder="请选择接待形式（可多选）"
                      />
                    </Field>
                  );
                  case "purpose": return (
                    <Field key="purpose" label={field.label}>
                      <EditableCreatableSelect category="purpose" value={form.purpose}
                        onChange={v => set("purpose", v)}
                        options={dicts.purpose ?? []}
                        rows={purposeRows}
                        onOptionAdded={onOptionAdded}
                        onDictChanged={onPurposeChanged}
                        placeholder="请选择或新增来访/会议目的" />
                    </Field>
                  );
                  case "background": return (
                    <Field key="background" label={field.label}>
                      <textarea value={form.background} onChange={e => set("background", e.target.value)} placeholder="请填写来访/会议背景（可选）" rows={3} style={{ ...iS, resize: "vertical" }} />
                    </Field>
                  );
                  case "address": return (
                    <Field key="address" label={field.label}>
                      <input value={form.address} onChange={e => set("address", e.target.value)} placeholder="详细地址（含楼层、大厅等，展示给用户看）" style={{ ...iS }} />
                      <input value={form.navigationAddress} onChange={e => set("navigationAddress", e.target.value)}
                        placeholder="地图搜索词（可选）" style={{ ...iS, marginTop: 6 }} />
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                        可选。若详细地址过长导致无法在地图定位，请在此填写用于高德导航的简略地名（如：江苏省会议中心）
                      </div>
                      {(form.navigationAddress || form.address) && (
                        <a href={generateAmapUrl(form.navigationAddress || form.address)} target="_blank" rel="noopener noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 12, color: "#2563eb", textDecoration: "underline" }}>
                          📍 {form.address || form.navigationAddress}
                        </a>
                      )}
                    </Field>
                  );
                  case "leaderIntro": return (
                    <Field key="leaderIntro" label={field.label}>
                      <textarea value={form.leaderIntroText} onChange={e => set("leaderIntroText", e.target.value)} placeholder="请填写领导介绍文字（可选）" rows={3} style={{ ...iS, resize: "vertical" }} />
                      <div style={{ marginTop: 8 }}>
                        <ClipboardImageUploader value={form.leaderIntroImages} onChange={v => set("leaderIntroImages", v)} />
                      </div>
                    </Field>
                  );
                  case "remarks": return (
                    <Field key="remarks" label={field.label}>
                      <textarea value={form.remarks} onChange={e => set("remarks", e.target.value)}
                        placeholder="请输入接待相关备注信息..." rows={3}
                        style={{ ...iS, resize: "vertical", maxHeight: 200 }} />
                    </Field>
                  );
                  default:
                    if (field.isCustom) {
                      return (
                        <Field key={field.key} label={field.label}>
                          <input
                            value={form.customData[field.key] ?? ""}
                            onChange={e => set("customData", { ...form.customData, [field.key]: e.target.value })}
                            placeholder={`请输入${field.label}`}
                            style={iS}
                          />
                        </Field>
                      );
                    }
                    return null;
                }
              })}
              {/* 固定末尾的辅助字段 */}
              <Field label="调研文件">
                <FileListEditor value={form.surveyFiles} onChange={v => set("surveyFiles", v)} />
              </Field>
              <Field label="会议纪要">
                <FileListEditor value={form.meetingMinutes} onChange={v => set("meetingMinutes", v)} />
              </Field>
              <Field label="会议照片">
                <ClipboardImageUploader value={form.meetingPhotos} onChange={v => set("meetingPhotos", v)} />
              </Field>
              <Field label="待办大类（保存后自动生成子任务）">
                <TodoCategorySelector value={form.todos} onChange={v => set("todos", v)} />
              </Field>
            </div>
            {error && <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: "10px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", color: "#dc2626", fontSize: "13px" }}>{error}</div>}
          </div>

          <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 10, justifyContent: "flex-end", flexShrink: 0 }}>
            <button type="button" onClick={onClose} style={{ padding: "10px 20px", borderRadius: "10px", border: "1px solid #e2e8f0", background: "white", fontSize: "14px", color: "#64748b", cursor: "pointer", fontWeight: 500 }}>取消</button>
            <button type="submit" disabled={saving} style={{ padding: "10px 24px", borderRadius: "10px", border: "none", background: saving ? "#93c5fd" : "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "white", fontSize: "14px", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              {saving ? <><Loader2 size={14} className="animate-spin" />保存中…</> : "创建接待"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

// ── UnsavedChangesModal ───────────────────────────────────────

function UnsavedChangesModal({ onSaveAndClose, onDiscard, onCancel, saving }: {
  onSaveAndClose: () => void;
  onDiscard:      () => void;
  onCancel:       () => void;
  saving:         boolean;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 3000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "white", borderRadius: "16px", padding: "28px 32px", width: 420, boxShadow: "0 24px 48px rgba(0,0,0,0.25)" }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1e293b", margin: "0 0 8px" }}>您有未保存的更改</h3>
        <p style={{ fontSize: 14, color: "#64748b", margin: "0 0 24px", lineHeight: 1.6 }}>
          是否在离开前保存？离开后未保存的更改将会丢失。
        </p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel}
            style={{ padding: "9px 16px", borderRadius: "9px", border: "1px solid #e2e8f0", background: "white", fontSize: "13px", color: "#64748b", cursor: "pointer" }}>
            取消
          </button>
          <button onClick={onDiscard}
            style={{ padding: "9px 16px", borderRadius: "9px", border: "1px solid #fca5a5", background: "rgba(239,68,68,0.06)", fontSize: "13px", color: "#ef4444", cursor: "pointer" }}>
            不保存直接离开
          </button>
          <button onClick={onSaveAndClose} disabled={saving}
            style={{ padding: "9px 18px", borderRadius: "9px", border: "none", background: saving ? "#93c5fd" : "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "white", fontSize: "13px", fontWeight: 600, cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {saving && <Loader2 size={12} className="animate-spin" />}保存并关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ReceptionDetailDrawer（详情 + 自动保存）──────────────────

type SaveStatus = "idle" | "saving" | "saved" | "error";

// 需要参与脏值检测的主表单字段
const MAIN_FIELDS = [
  "title", "startTime", "endTime", "level", "status",
  "hostName", "hostUserId", "hostDictId", "hostDictIds", "dressCode", "formats", "purpose", "background", "address", "navigationAddress",
  "leaderIntroText", "leaderIntroImages",
  "surveyFiles", "meetingMinutes", "meetingPhotos", "todos", "todoList", "remarks", "customData",
] as const;
type MainField = (typeof MAIN_FIELDS)[number];

function receptionEqual(a: Reception, b: Reception): boolean {
  return MAIN_FIELDS.every(k => JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

function ReceptionDetailDrawer({ reception: init, dicts, onOptionAdded, onClose, onUpdated, formatTree, formatById, onDictChanged, dressCodeRows, onDressCodeChanged, purposeRows, onPurposeChanged, hostTree, hostById, onHostChanged, currentUserRole, drawerFields }: {
  reception:         Reception;
  dicts:             DictMap;
  onOptionAdded:     (cat: string, val: string) => void;
  onClose:           () => void;
  onUpdated:         () => void;
  formatTree:        DictNode[];
  formatById:        Map<string, DictNode>;
  onDictChanged:     () => void;
  dressCodeRows:     DictRow[];
  onDressCodeChanged:() => void;
  purposeRows:       DictRow[];
  onPurposeChanged:  () => void;
  hostTree:          HostDictNode[];
  hostById:          Map<string, HostDictNode>;
  onHostChanged:     () => void;
  currentUserRole:   string;
  drawerFields:      DrawerField[];
}) {
  // 稳定的初始基线（不随 init prop 变动，用 state 以便 isDirty 响应式更新）
  const [baseline, setBaseline] = useState<Reception>(() => JSON.parse(JSON.stringify(init)) as Reception);

  // 本地草稿状态（深拷贝，与 API 解耦）
  const [draft,        setDraft]        = useState<Reception>(() => JSON.parse(JSON.stringify(init)) as Reception);
  const [saveStatus,   setSaveStatus]   = useState<SaveStatus>("idle");
  const [showUnsaved,  setShowUnsaved]  = useState(false);
  const [todoTasks,    setTodoTasks]    = useState<ReceptionTodoTask[]>(init.todoTasks ?? []);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [showShare,        setShowShare]        = useState(false);
  const [showCancelNotify, setShowCancelNotify] = useState(false);
  const [cancellingNotify, setCancellingNotify] = useState(false);
  const [selectedNotifyIds, setSelectedNotifyIds] = useState<Set<string>>(new Set());
  const [notifyToast,      setNotifyToast]      = useState<{ ok: boolean; msg: string } | null>(null);

  // 打开弹窗时全选
  function openCancelDialog() {
    const all = init.pendingNotifications ?? [];
    setSelectedNotifyIds(new Set(all.map(n => n.id)));
    setShowCancelNotify(true);
  }

  // 批量撤回选中通知
  async function handleCancelNotify() {
    if (selectedNotifyIds.size === 0) return;
    setCancellingNotify(true);
    try {
      const res  = await fetch(`/api/reception/${draft.id}/notify`, {
        method:  "DELETE",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ notificationIds: [...selectedNotifyIds] }),
      });
      const data = await res.json() as { cancelled?: number; failed?: number; message?: string; error?: string };
      if (!res.ok) {
        setNotifyToast({ ok: false, msg: data.error ?? "撤回失败，请重试" });
      } else {
        setNotifyToast({ ok: true, msg: data.message ?? "定时通知已撤回" });
        onUpdated();
      }
    } catch {
      setNotifyToast({ ok: false, msg: "网络错误，请重试" });
    } finally {
      setCancellingNotify(false);
      setShowCancelNotify(false);
    }
  }

  // 通知 toast 自动消失
  useEffect(() => {
    if (!notifyToast) return;
    const t = setTimeout(() => setNotifyToast(null), 4000);
    return () => clearTimeout(t);
  }, [notifyToast]);

  // 脏值检测：只对主表单字段做深比较，不包含 todoTasks
  // baseline 用 state 而非 ref，确保 handleSave 更新后 isDirty 能响应式归零
  const isDirty = useMemo(() => !receptionEqual(draft, baseline), [draft, baseline]);
  // 用 ref 避免 Esc 监听器中的 stale closure
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  // ── 加载 todoTasks ─────────────────────────────────────────
  async function reloadTasks() {
    setLoadingTasks(true);
    try {
      const res  = await fetch(`/api/reception/${draft.id}`);
      const data = await res.json() as { reception?: { todoTasks?: ReceptionTodoTask[] } };
      setTodoTasks(data.reception?.todoTasks ?? []);
    } finally { setLoadingTasks(false); }
  }
  useEffect(() => { void reloadTasks(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Esc 键拦截 ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (isDirtyRef.current) setShowUnsaved(true);
      else onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── 更新草稿（仅本地，不触发 API）─────────────────────────
  function upd<K extends MainField>(key: K, val: Reception[K]) {
    setDraft(prev => ({ ...prev, [key]: val }));
  }

  function updHost(userId: string, userName: string) {
    setDraft(prev => ({ ...prev, hostUserId: userId || null, hostName: userName || null }));
  }

  // ── 请求关闭（统一入口，触发拦截检查）─────────────────────
  function requestClose() {
    if (isDirtyRef.current) setShowUnsaved(true);
    else onClose();
  }

  // ── 保存 ──────────────────────────────────────────────────
  async function handleSave(): Promise<boolean> {
    setSaveStatus("saving");
    try {
      const patch: Record<string, unknown> = {};
      MAIN_FIELDS.forEach(k => { patch[k] = draft[k]; });
      const res = await fetch(`/api/reception/${draft.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { error?: string };
        console.error("[handleSave] PATCH failed:", res.status, errBody);
        setSaveStatus("error");
        return false;
      }
      // 更新基线，isDirty 归零（setBaseline 触发 useMemo 重算，确保归零）
      setBaseline(JSON.parse(JSON.stringify(draft)) as Reception);
      setSaveStatus("saved");
      onUpdated();
      // 无论 todos 是否变化都刷新一次，确保子任务列表最新
      await reloadTasks();
      setTimeout(() => setSaveStatus("idle"), 2000);
      return true;
    } catch (err) {
      console.error("[handleSave] unexpected error:", err);
      setSaveStatus("error");
      return false;
    }
  }

  const iS: React.CSSProperties = { boxSizing: "border-box", width: "100%", padding: "8px 10px", fontSize: "13px", borderRadius: "8px", border: "1px solid #e2e8f0", outline: "none", color: "#1e293b", background: "white" };
  const secTitle = (label: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 10, paddingBottom: 6, borderBottom: "1px solid #f1f5f9" }}>{label}</div>
  );

  return (
    <>
      {/* Overlay — 点击触发关闭拦截 */}
      <div onClick={requestClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 999, backdropFilter: "blur(2px)" }} />

      <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: 580, zIndex: 1000, background: "white", boxShadow: "-8px 0 40px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ background: "linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#0f172a 100%)", padding: "20px 24px 18px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>接待记录</div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "white", margin: 0, lineHeight: 1.4 }}>{draft.title}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{fmtDateTime(draft.startTime)}</span>
                {draft.endTime && <><span style={{ color: "rgba(255,255,255,0.3)" }}>→</span><span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{fmtDate(draft.endTime)}</span></>}
                {draft.level && <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: "5px", background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.7)" }}>{draft.level}</span>}
                <span style={{ fontSize: 11, padding: "1px 7px", borderRadius: "5px", background: (STATUS_META[draft.status]?.bg ?? "rgba(255,255,255,0.1)"), color: (STATUS_META[draft.status]?.color ?? "white") }}>{draft.status}</span>
              </div>
            </div>
            <button type="button" onClick={() => setShowShare(true)}
              title="发送到飞书群聊"
              style={{ height: 30, padding: "0 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", color: "rgba(255,255,255,0.85)", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>
              <Bell size={13} />发送通知
            </button>
            {/* 撤回定时通知按钮：仅当存在 PENDING 定时任务时显示 */}
            {(init.pendingNotifications?.length ?? 0) > 0 && (
              <button type="button" onClick={openCancelDialog}
                title={`撤回定时提醒（共 ${init.pendingNotifications!.length} 条待发送）`}
                style={{ height: 30, padding: "0 10px", borderRadius: "8px", border: "1px solid rgba(251,146,60,0.5)", background: "rgba(251,146,60,0.15)", display: "flex", alignItems: "center", gap: 5, cursor: "pointer", color: "rgba(251,191,36,0.95)", fontSize: 12, fontWeight: 500, flexShrink: 0 }}>
                <BellOff size={13} />撤回提醒
                {init.pendingNotifications!.length > 1 && (
                  <span style={{ background: "rgba(251,146,60,0.35)", borderRadius: "10px", padding: "0 5px", fontSize: 10, fontWeight: 700 }}>
                    {init.pendingNotifications!.length}
                  </span>
                )}
              </button>
            )}
            <button type="button" onClick={requestClose}
              style={{ width: 30, height: 30, borderRadius: "8px", border: "none", background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "rgba(255,255,255,0.7)" }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* Schema-driven 字段区（标题 / 顺序由配置决定）*/}
          <div style={{ marginBottom: 20 }}>
            {secTitle("接待信息")}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[...drawerFields].filter(f => f.visible !== false).sort((a, b) => a.order - b.order).map(field => {
                switch (field.key) {
                  case "title": return (
                    <Field key="title" label={field.label}>
                      <input value={draft.title} onChange={e => upd("title", e.target.value)} style={iS} />
                    </Field>
                  );
                  case "startTime": return (
                    <Field key="startTime" label={field.label}>
                      <input type="datetime-local" value={toDateTimeLocal(draft.startTime)} onChange={e => upd("startTime", e.target.value ? new Date(e.target.value).toISOString() : draft.startTime)} style={iS} />
                    </Field>
                  );
                  case "endTime": return (
                    <Field key="endTime" label={field.label}>
                      <input type="datetime-local" value={toDateTimeLocal(draft.endTime)} onChange={e => upd("endTime", e.target.value ? new Date(e.target.value).toISOString() : null)} style={iS} />
                    </Field>
                  );
                  case "level": return (
                    <Field key="level" label={field.label}>
                      <CreatableSelect category="level" value={draft.level} onChange={v => upd("level", v)} options={dicts.level ?? []} onOptionAdded={onOptionAdded} placeholder="选择或新增级别" />
                    </Field>
                  );
                  case "status": return (
                    <Field key="status" label={field.label}>
                      <CreatableSelect category="status" value={draft.status} onChange={v => upd("status", v)} options={dicts.status ?? []} onOptionAdded={onOptionAdded} placeholder="选择状态" />
                    </Field>
                  );
                  case "host": return (
                    <Field key="host" label={field.label}>
                      <HierarchicalHostMultiSelect
                        value={(draft.hostDictIds && draft.hostDictIds.length > 0) ? draft.hostDictIds : (draft.hostDictId ? [draft.hostDictId] : [])}
                        onChange={(ids, names) => setDraft(prev => ({
                          ...prev,
                          hostDictIds: ids,
                          hostDictId: ids[0] ?? null,
                          hostName: names[0] ?? null,
                          hostUserId: null,
                        }))}
                        tree={hostTree} byId={hostById} onDictChanged={onHostChanged}
                        isSuperAdmin={true}
                        placeholder="请选择主接待人（可多选）" />
                    </Field>
                  );
                  case "dressCode": return (
                    <Field key="dressCode" label={field.label}>
                      <EditableCreatableSelect category="dressCode" value={draft.dressCode ?? ""}
                        onChange={v => upd("dressCode", v || null)}
                        options={dicts.dressCode ?? []}
                        rows={dressCodeRows}
                        onOptionAdded={onOptionAdded}
                        onDictChanged={onDressCodeChanged}
                        placeholder="请选择或新增着装要求" />
                    </Field>
                  );
                  case "formats": return (
                    <Field key="formats" label={field.label}>
                      <HierarchicalFormatSelect
                        value={draft.formats}
                        onChange={v => upd("formats", v)}
                        tree={formatTree}
                        byId={formatById}
                        onDictChanged={onDictChanged}
                        isSuperAdmin={true}
                        placeholder="选择接待形式（可多选）"
                      />
                    </Field>
                  );
                  case "purpose": return (
                    <Field key="purpose" label={field.label}>
                      <EditableCreatableSelect category="purpose" value={draft.purpose}
                        onChange={v => upd("purpose", v)}
                        options={dicts.purpose ?? []}
                        rows={purposeRows}
                        onOptionAdded={onOptionAdded}
                        onDictChanged={onPurposeChanged}
                        placeholder="选择或新增来访/会议目的" />
                    </Field>
                  );
                  case "background": return (
                    <Field key="background" label={field.label}>
                      <textarea value={draft.background ?? ""} onChange={e => upd("background", e.target.value || null)} rows={3} style={{ ...iS, resize: "vertical" }} placeholder="来访/会议背景（可选）" />
                    </Field>
                  );
                  case "address": return (
                    <Field key="address" label={field.label}>
                      <input value={draft.address ?? ""} onChange={e => upd("address", e.target.value || null)} placeholder="详细地址（含楼层、大厅等，展示给用户看）" style={{ ...iS }} />
                      <input value={draft.navigationAddress ?? ""} onChange={e => upd("navigationAddress", e.target.value || null)}
                        placeholder="地图搜索词（可选）" style={{ ...iS, marginTop: 6 }} />
                      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                        可选。若详细地址过长导致无法在地图定位，请在此填写用于高德导航的简略地名（如：江苏省会议中心）
                      </div>
                      {(draft.navigationAddress || draft.address) && (
                        <a href={generateAmapUrl(draft.navigationAddress ?? draft.address ?? "")} target="_blank" rel="noopener noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6, fontSize: 12, color: "#2563eb", textDecoration: "underline" }}>
                          📍 {draft.address || draft.navigationAddress}
                        </a>
                      )}
                    </Field>
                  );
                  case "leaderIntro": return (
                    <Field key="leaderIntro" label={field.label}>
                      <textarea value={draft.leaderIntroText ?? ""} onChange={e => upd("leaderIntroText", e.target.value || null)} rows={3} style={{ ...iS, resize: "vertical" }} placeholder="请填写领导介绍文字（可选）" />
                      <div style={{ marginTop: 8 }}>
                        <ClipboardImageUploader value={draft.leaderIntroImages ?? []} onChange={v => upd("leaderIntroImages", v)} />
                      </div>
                    </Field>
                  );
                  case "remarks": return (
                    <Field key="remarks" label={field.label}>
                      <textarea value={draft.remarks ?? ""} onChange={e => upd("remarks", e.target.value || null)}
                        placeholder="请输入接待相关备注信息..."
                        rows={4} style={{ ...iS, resize: "vertical", maxHeight: 240 }} />
                    </Field>
                  );
                  default:
                    if (field.isCustom) {
                      return (
                        <Field key={field.key} label={field.label}>
                          <input
                            value={(draft.customData ?? {})[field.key] ?? ""}
                            onChange={e => setDraft(prev => ({
                              ...prev,
                              customData: { ...(prev.customData ?? {}), [field.key]: e.target.value },
                            }))}
                            placeholder={`请输入${field.label}`}
                            style={iS}
                          />
                        </Field>
                      );
                    }
                    return null;
                }
              })}
            </div>
          </div>

          {/* 调研文件（仅管理员可见）*/}
          <div style={{ marginBottom: 20 }}>
            {secTitle("调研文件")}
            {currentUserRole === "DEPT_CONTACT" ? (
              <div style={{ fontSize: 12, color: "#94a3b8", padding: "10px 0", fontStyle: "italic" }}>仅管理员可见</div>
            ) : (
              <FileListEditor value={draft.surveyFiles} onChange={v => upd("surveyFiles", v)} />
            )}
          </div>

          {/* 会议纪要（仅管理员可见）*/}
          <div style={{ marginBottom: 20 }}>
            {secTitle("会议纪要")}
            {currentUserRole === "DEPT_CONTACT" ? (
              <div style={{ fontSize: 12, color: "#94a3b8", padding: "10px 0", fontStyle: "italic" }}>仅管理员可见</div>
            ) : (
              <FileListEditor value={draft.meetingMinutes} onChange={v => upd("meetingMinutes", v)} />
            )}
          </div>

          {/* 会议照片 */}
          <div style={{ marginBottom: 20 }}>
            {secTitle("会议照片")}
            <ClipboardImageUploader value={draft.meetingPhotos ?? []} onChange={v => upd("meetingPhotos", v)} />
          </div>

          {/* 飞书多维表格关联（只读，有链接时展示） */}
          {draft.feishuBitableUrl && (
            <div style={{ marginBottom: 20 }}>
              {secTitle("飞书多维表格关联")}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: "10px", background: "rgba(37,99,235,0.04)", border: "1px solid rgba(37,99,235,0.15)" }}>
                <div style={{ width: 28, height: 28, borderRadius: "8px", background: "rgba(37,99,235,0.10)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Database size={13} style={{ color: "#2563eb" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#1e293b", marginBottom: 2 }}>已绑定飞书多维表格行</div>
                  {draft.feishuRecordId && (
                    <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Record ID: {draft.feishuRecordId}
                    </div>
                  )}
                </div>
                <a href={draft.feishuBitableUrl} target="_blank" rel="noopener noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: "8px", background: "rgba(37,99,235,0.08)", border: "1px solid rgba(37,99,235,0.2)", color: "#2563eb", fontSize: 12, fontWeight: 600, textDecoration: "none", flexShrink: 0, whiteSpace: "nowrap" }}>
                  <ExternalLink size={12} />在飞书中查看
                </a>
              </div>
            </div>
          )}

          {/* 待办事项（API 驱动，独立于主表单保存）*/}
          <div style={{ marginBottom: 12 }}>
            {secTitle("待办事项")}
            <TodoManagerV2
              receptionId={draft.id}
              reception={{ id: draft.id, title: draft.title, startTime: draft.startTime ?? null, address: draft.address ?? null }}
            />
          </div>
        </div>

        {/* Footer — 保存按钮区 */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10, flexShrink: 0, background: "white" }}>
          {isDirty && saveStatus !== "saving" && (
            <span style={{ fontSize: 12, color: "#f59e0b", display: "flex", alignItems: "center", gap: 4 }}>
              <AlertCircle size={12} />有未保存的更改
            </span>
          )}
          {saveStatus === "saving" && (
            <span style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4 }}>
              <Loader2 size={12} className="animate-spin" />保存中…
            </span>
          )}
          {saveStatus === "saved" && (
            <span style={{ fontSize: 12, color: "#16a34a", display: "flex", alignItems: "center", gap: 4 }}>
              <CheckCircle2 size={12} />已保存
            </span>
          )}
          {saveStatus === "error" && (
            <span style={{ fontSize: 12, color: "#ef4444", display: "flex", alignItems: "center", gap: 4 }}>
              <AlertCircle size={12} />保存失败，请重试
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button type="button" onClick={requestClose}
            style={{ padding: "9px 18px", borderRadius: "9px", border: "1px solid #e2e8f0", background: "white", fontSize: "13px", color: "#64748b", cursor: "pointer" }}>
            关闭
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={!isDirty || saveStatus === "saving"}
            style={{ padding: "9px 22px", borderRadius: "9px", border: "none", fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
              background: !isDirty || saveStatus === "saving" ? "#e2e8f0" : "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color:      !isDirty || saveStatus === "saving" ? "#94a3b8" : "white",
              cursor:     !isDirty || saveStatus === "saving" ? "not-allowed" : "pointer" }}>
            保存
          </button>
        </div>
      </div>

      {/* 未保存离开拦截弹窗 */}
      {showUnsaved && (
        <UnsavedChangesModal
          saving={saveStatus === "saving"}
          onSaveAndClose={() => void handleSave().then(ok => { if (ok) { setShowUnsaved(false); onClose(); } })}
          onDiscard={() => { setShowUnsaved(false); onClose(); }}
          onCancel={() => setShowUnsaved(false)}
        />
      )}

      {/* 飞书发送通知弹窗 */}
      {showShare && (
        <ReceptionShareDialog
          reception={draft}
          hostById={hostById}
          formatById={formatById}
          onClose={() => setShowShare(false)}
          onSent={onUpdated}
        />
      )}

      {/* 批量撤回定时通知弹窗 */}
      {showCancelNotify && (() => {
        const notifications = init.pendingNotifications ?? [];
        const allSelected   = selectedNotifyIds.size === notifications.length && notifications.length > 0;
        const someSelected  = selectedNotifyIds.size > 0 && !allSelected;
        const fmt = (iso: string) => new Intl.DateTimeFormat("zh-CN", {
          timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
          hour: "2-digit", minute: "2-digit", hour12: false,
        }).format(new Date(iso));
        function toggleAll() {
          setSelectedNotifyIds(allSelected ? new Set() : new Set(notifications.map(n => n.id)));
        }
        function toggleOne(nid: string) {
          setSelectedNotifyIds(prev => {
            const next = new Set(prev);
            next.has(nid) ? next.delete(nid) : next.add(nid);
            return next;
          });
        }
        const chkStyle = (active: boolean, indeterminate = false): React.CSSProperties => ({
          flexShrink: 0, width: 15, height: 15, borderRadius: "4px", cursor: "pointer",
          border: active || indeterminate ? "none" : "1.5px solid #cbd5e1",
          background: active ? "#f97316" : indeterminate ? "#fdba74" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
        });
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 2100, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ background: "white", borderRadius: "16px", width: 480, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 48px rgba(0,0,0,0.22)" }}>

              {/* 弹窗标题 */}
              <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: "10px", background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <BellOff size={17} style={{ color: "#f97316" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#1e293b" }}>撤回定时提醒</div>
                  <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 2 }}>
                    共 {notifications.length} 条待发送，已选 <span style={{ color: "#f97316", fontWeight: 600 }}>{selectedNotifyIds.size}</span> 条
                  </div>
                </div>
                <button onClick={() => setShowCancelNotify(false)} style={{ width: 28, height: 28, borderRadius: "8px", border: "none", background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                  <X size={14} style={{ color: "#64748b" }} />
                </button>
              </div>

              {/* 全选行 */}
              <div
                onClick={toggleAll}
                style={{ padding: "10px 24px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", borderBottom: "1px solid #f1f5f9", background: "#fafafa" }}
              >
                <div style={chkStyle(allSelected, someSelected)}>
                  {(allSelected || someSelected) && <Check size={9} style={{ color: "white" }} />}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>全选 / 全不选</span>
              </div>

              {/* 通知列表 */}
              <div style={{ overflowY: "auto", flex: 1 }}>
                {notifications.map((n) => {
                  const isSel = selectedNotifyIds.has(n.id);
                  return (
                    <div key={n.id} onClick={() => toggleOne(n.id)}
                      style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "12px 24px", cursor: "pointer", borderBottom: "1px solid #f8fafc", background: isSel ? "rgba(249,115,22,0.03)" : undefined, transition: "background 0.1s" }}>
                      <div style={{ ...chkStyle(isSel), marginTop: 2 }}>
                        {isSel && <Check size={9} style={{ color: "white" }} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          <span style={{ fontSize: 11, background: "#fff7ed", color: "#ea580c", padding: "1px 7px", borderRadius: "6px", fontWeight: 600 }}>
                            {fmt(n.scheduledAt)}
                          </span>
                          <span style={{ fontSize: 10, color: "#94a3b8" }}>北京时间</span>
                        </div>
                        <div style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                          <span style={{ color: "#94a3b8" }}>目标：</span>
                          {n.targetIds.length > 0
                            ? n.targetIds.map((tid, i) => (
                                <span key={i} style={{ background: "#f1f5f9", borderRadius: "5px", padding: "1px 6px", fontSize: 11, fontFamily: "monospace" }}>{tid}</span>
                              ))
                            : <span style={{ color: "#cbd5e1" }}>（默认推送群）</span>
                          }
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 底部操作栏 */}
              <div style={{ padding: "14px 24px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
                <p style={{ flex: 1, fontSize: 12, color: "#94a3b8", margin: 0 }}>
                  撤回后接收方将不会收到飞书提醒，此操作不可恢复。
                </p>
                <button onClick={() => setShowCancelNotify(false)} disabled={cancellingNotify}
                  style={{ padding: "8px 16px", borderRadius: "9px", border: "1px solid #e2e8f0", background: "white", fontSize: 13, color: "#64748b", cursor: cancellingNotify ? "not-allowed" : "pointer", flexShrink: 0 }}>
                  取消
                </button>
                <button
                  onClick={() => void handleCancelNotify()}
                  disabled={cancellingNotify || selectedNotifyIds.size === 0}
                  style={{ padding: "8px 18px", borderRadius: "9px", border: "none", background: cancellingNotify || selectedNotifyIds.size === 0 ? "#fdba74" : "linear-gradient(135deg,#f97316,#ea580c)", color: "white", fontSize: 13, fontWeight: 600, cursor: cancellingNotify || selectedNotifyIds.size === 0 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  {cancellingNotify && <Loader2 size={13} className="animate-spin" />}
                  {cancellingNotify ? "撤回中…" : `撤回选定的 ${selectedNotifyIds.size} 条提醒`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 撤回结果 Toast */}
      {notifyToast && (
        <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 2200, padding: "12px 18px", borderRadius: "12px", background: notifyToast.ok ? "#16a34a" : "#dc2626", color: "white", fontSize: 12, fontWeight: 500, boxShadow: "0 8px 32px rgba(0,0,0,0.22)", display: "flex", alignItems: "center", gap: 8, maxWidth: 400 }}>
          {notifyToast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {notifyToast.msg}
        </div>
      )}
    </>
  );
}

// ── FeishuRecordPicker（多选 + 批量导入）────────────────────

function FeishuRecordPicker({ records, onBulkImported, onClose }: {
  records:        ParsedReception[];
  onBulkImported: () => void;
  onClose:        () => void;
}) {
  const [selected,  setSelected]  = useState<Set<number>>(
    () => new Set(Array.from({ length: records.length }, (_, i) => i)),
  );
  const [importing,       setImporting]       = useState(false);
  const [importProgress,  setImportProgress]  = useState(0); // 已导入条数（用于分批进度显示）
  const [error,           setError]           = useState("");

  const allSelected  = selected.size === records.length;
  const someSelected = selected.size > 0 && selected.size < records.length;

  function toggleAll() {
    setSelected(allSelected
      ? new Set()
      : new Set(Array.from({ length: records.length }, (_, i) => i)),
    );
  }

  function toggle(i: number) {
    const next = new Set(selected);
    if (next.has(i)) next.delete(i); else next.add(i);
    setSelected(next);
  }

  async function handleImport() {
    const toImport = [...selected].sort((a, b) => a - b).map(i => {
      // 剥离 _rawFields，避免请求体过大导致 Vercel 413 / 超时
      const { _rawFields: _r, ...rest } = records[i] as typeof records[number] & { _rawFields?: unknown };
      void _r;
      return rest;
    });
    if (toImport.length === 0) return;

    // 切片：每批 20 条，串行提交，避免 Vercel 10s 超时 / 413
    const CHUNK_SIZE = 20;
    const chunks: typeof toImport[] = [];
    for (let i = 0; i < toImport.length; i += CHUNK_SIZE) {
      chunks.push(toImport.slice(i, i + CHUNK_SIZE));
    }

    setImporting(true); setError(""); setImportProgress(0);
    try {
      let totalImported = 0;
      for (const chunk of chunks) {
        const res = await fetch("/api/reception/bulk-import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: chunk }),
        });

        // 防御拦截：超时或崩溃时服务器返回 HTML，绝不调用 res.json()
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const textError = await res.text();
          console.error("[bulk-import] Server HTML Response:", textError);
          throw new Error(`服务器响应超时或异常 (状态码: ${res.status})，请重试`);
        }

        const data = await res.json() as { count?: number; error?: string };
        if (!res.ok) throw new Error(data.error ?? "该批次导入失败");

        totalImported += chunk.length;
        setImportProgress(totalImported);
      }
      onBulkImported();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "网络错误，请重试");
    } finally {
      setImporting(false);
      setImportProgress(0);
    }
  }

  const checkboxStyle = (active: boolean, indeterminate = false): React.CSSProperties => ({
    flexShrink: 0, width: 16, height: 16, borderRadius: "4px", cursor: "pointer",
    border: active || indeterminate ? "none" : "1.5px solid #cbd5e1",
    background: active ? "#2563eb" : indeterminate ? "#93c5fd" : "transparent",
    display: "flex", alignItems: "center", justifyContent: "center",
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ background: "white", borderRadius: "16px", width: "100%", maxWidth: 640, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 48px rgba(0,0,0,0.2)" }}>

        {/* 表头 */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={checkboxStyle(allSelected, someSelected)} onClick={toggleAll}>
            {(allSelected || someSelected) && <Check size={10} style={{ color: "white" }} />}
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: "#1e293b", margin: 0 }}>选择要批量导入的记录</h3>
            <p style={{ fontSize: 12, color: "#94a3b8", margin: "3px 0 0" }}>
              共解析到 <strong style={{ color: "#1e293b" }}>{records.length}</strong> 条，已勾选 <strong style={{ color: "#2563eb" }}>{selected.size}</strong> 条
            </p>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* 记录列表 */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {records.map((rec, i) => {
            const isSel = selected.has(i);
            return (
              <div key={i} onClick={() => toggle(i)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 24px", cursor: "pointer", borderBottom: i < records.length - 1 ? "1px solid #f8fafc" : undefined, background: isSel ? "rgba(37,99,235,0.03)" : undefined, transition: "background 0.1s" }}>
                <div style={checkboxStyle(isSel)}>
                  {isSel && <Check size={10} style={{ color: "white" }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {rec.title}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                    {rec.startTime && (
                      <span style={{ fontSize: 11, color: "#64748b" }}>{fmtDate(rec.startTime)}</span>
                    )}
                    {rec.level && (
                      <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: "4px", background: LEVEL_BG[rec.level] ?? "rgba(100,116,139,0.1)", color: LEVEL_COLOR[rec.level] ?? "#64748b" }}>{rec.level}</span>
                    )}
                    {rec.hostName && (
                      <span style={{ fontSize: 11, color: "#64748b" }}>接待: {rec.hostName}</span>
                    )}
                    {Array.isArray(rec.formats) && rec.formats.length > 0 && (
                      <span style={{ fontSize: 11, color: "#64748b" }}>{rec.formats.join("、")}</span>
                    )}
                    {rec.purpose && (
                      <span style={{ fontSize: 11, color: "#94a3b8" }}>{rec.purpose}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 底部操作栏 */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10 }}>
          {error
            ? <span style={{ fontSize: 12, color: "#ef4444", flex: 1 }}>{error}</span>
            : <span style={{ fontSize: 12, color: "#94a3b8", flex: 1 }}>勾选后直接写入数据库，无需逐条填写表单</span>
          }
          <button onClick={onClose}
            style={{ padding: "9px 18px", borderRadius: "9px", border: "1px solid #e2e8f0", background: "white", fontSize: "14px", color: "#64748b", cursor: "pointer" }}>
            取消
          </button>
          <button onClick={() => void handleImport()} disabled={importing || selected.size === 0}
            style={{ padding: "9px 22px", borderRadius: "9px", border: "none", background: importing || selected.size === 0 ? "#93c5fd" : "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "white", fontSize: "14px", fontWeight: 600, cursor: importing || selected.size === 0 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {importing
              ? <><Loader2 size={13} className="animate-spin" />{importProgress > 0 ? `正在导入 ${importProgress} / ${selected.size}` : "准备中…"}</>
              : `批量导入 ${selected.size} 条记录`
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ── DeleteDialog ──────────────────────────────────────────────

function DeleteDialog({ title, onCancel, onConfirm, loading }: {
  title: string; onCancel: () => void; onConfirm: () => void; loading: boolean;
}) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "white", borderRadius: "16px", padding: "28px 32px", width: 380, boxShadow: "0 24px 48px rgba(0,0,0,0.2)" }}>
        <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: "0 0 8px" }}>确认删除</h3>
        <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 24px", lineHeight: 1.5 }}>
          确定要删除「<strong style={{ color: "#1e293b" }}>{title}</strong>」吗？此操作不可恢复。
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "9px 18px", borderRadius: "9px", border: "1px solid #e2e8f0", background: "white", fontSize: "14px", color: "#64748b", cursor: "pointer" }}>取消</button>
          <button onClick={onConfirm} disabled={loading}
            style={{ padding: "9px 18px", borderRadius: "9px", border: "none", background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "white", fontSize: "14px", fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {loading && <Loader2 size={13} className="animate-spin" />}删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TableView ──────────────────────────────────────────────────

function TableView({
  receptions, total, page, limit, loading, filters, dicts,
  onFiltersChange, onNew, onDelete, onRowClick, onParseFeishu, onSyncDone,
}: {
  receptions: Reception[]; total: number; page: number; limit: number; loading: boolean;
  filters: Filters; dicts: DictMap;
  onFiltersChange: (p: Partial<Filters>) => void; onNew: () => void;
  onDelete: (r: Reception) => void; onRowClick: (r: Reception) => void;
  onParseFeishu: (url: string) => void; onSyncDone: () => void;
}) {
  const [bitableUrl,   setBitableUrl]   = useState("");
  const [parsing,      setParsing]      = useState(false);
  const [parseErr,     setParseErr]     = useState("");
  const [selectedIds,     setSelectedIds]     = useState<Set<string>>(new Set());
  const [syncingIds,      setSyncingIds]      = useState<Set<string>>(new Set());
  const [toast,           setToast]           = useState<{ ok: boolean; msg: string } | null>(null);
  const [showFilters,     setShowFilters]     = useState(false);
  const [confirmBatchDel, setConfirmBatchDel] = useState(false);
  const [batchDeleting,   setBatchDeleting]   = useState(false);

  // 选中状态辅助
  const allOnPage  = receptions.length > 0 && receptions.every(r => selectedIds.has(r.id));
  const someOnPage = receptions.some(r => selectedIds.has(r.id)) && !allOnPage;

  function toggleAll() {
    setSelectedIds(allOnPage ? new Set() : new Set(receptions.map(r => r.id)));
  }
  function toggleRow(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // Toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  async function handleBatchDelete() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    setBatchDeleting(true);
    try {
      const res  = await fetch("/api/reception", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json() as { deleted?: number; error?: string };
      if (!res.ok) { setToast({ ok: false, msg: data.error ?? "删除失败" }); return; }
      setToast({ ok: true, msg: `已删除 ${data.deleted ?? ids.length} 条接待记录` });
      setSelectedIds(new Set());
      setConfirmBatchDel(false);
      onSyncDone(); // 复用刷新列表回调
    } catch {
      setToast({ ok: false, msg: "网络错误，删除失败" });
    } finally {
      setBatchDeleting(false);
    }
  }

  async function handleSync(ids: string[]) {
    const pending = ids.filter(id => !syncingIds.has(id));
    if (pending.length === 0) return;
    setSyncingIds(prev => { const n = new Set(prev); pending.forEach(id => n.add(id)); return n; });
    try {
      const res  = await fetch("/api/reception/sync-feishu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: pending }),
      });
      const data = await res.json() as { synced?: number; failed?: number; error?: string; errors?: Array<{ id: string; title: string; error: string }> };
      if (!res.ok) { setToast({ ok: false, msg: data.error ?? "同步失败" }); return; }
      const synced   = data.synced ?? 0;
      const failed   = data.failed ?? 0;
      const firstErr = data.errors?.[0]?.error ?? "";
      setToast({ ok: failed === 0, msg: `已同步 ${synced} 条到飞书${failed > 0 ? `，${failed} 条失败：${firstErr.slice(0, 120)}` : ""}` });
      setSelectedIds(new Set());
      onSyncDone();
    } catch {
      setToast({ ok: false, msg: "网络错误，同步失败" });
    } finally {
      setSyncingIds(prev => { const n = new Set(prev); pending.forEach(id => n.delete(id)); return n; });
    }
  }
  const totalPages = Math.max(1, Math.ceil(total / limit));

  async function handleParse() {
    const parsed = parseBitableUrl(bitableUrl.trim());
    if (!parsed) { setParseErr("无法识别 URL，格式应为 .../base/{token}?table={tableId}"); return; }
    setParsing(true); setParseErr("");
    try {
      const res  = await fetch("/api/reception/parse-feishu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
      const data = await res.json() as { records?: ParsedReception[]; error?: string };
      if (!res.ok) { setParseErr(data.error ?? "解析失败"); return; }
      const records = data.records ?? [];
      if (records.length === 0) { setParseErr("未解析到任何记录"); return; }
      onParseFeishu(JSON.stringify(records));
      setBitableUrl("");
    } finally { setParsing(false); }
  }

  const levelBadge = (level: string) => level
    ? <span style={{ padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 600, background: LEVEL_BG[level] ?? "rgba(100,116,139,0.10)", color: LEVEL_COLOR[level] ?? "#64748b" }}>{level}</span>
    : <span style={{ color: "#cbd5e1" }}>—</span>;

  const statusBadge = (status: string) => {
    const m = STATUS_META[status];
    return <span style={{ padding: "2px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: 600, background: m?.bg ?? "rgba(100,116,139,0.10)", color: m?.color ?? "#64748b" }}>{status || "—"}</span>;
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* 操作栏 */}
      <div className="flex flex-col gap-2 px-4 py-3 md:px-6" style={{ borderBottom: "1px solid #e2e8f0", background: "#f8fafc", flexShrink: 0 }}>

        {/* 主操作行：始终可见 */}
        <div className="flex items-center gap-2">
          <button onClick={onNew} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "white", border: "none", cursor: "pointer" }}>
            <Plus size={14} />新建接待
          </button>
          <input value={filters.q} onChange={e => onFiltersChange({ q: e.target.value, page: 1 })}
            placeholder="搜索名称…"
            className="flex-1 min-w-0 px-3 py-1.5 rounded-lg text-sm outline-none" style={{ border: "1px solid #e2e8f0" }} />
          {/* 展开筛选（仅移动端） */}
          <button onClick={() => setShowFilters(v => !v)}
            className="md:hidden flex-shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium"
            style={{ border: "1px solid #e2e8f0", background: showFilters ? "#e8edf4" : "white", color: "#475569", cursor: "pointer" }}>
            {showFilters ? "▲ 收起" : "▼ 筛选"}
          </button>
          <span className="text-xs flex-shrink-0" style={{ color: "#94a3b8" }}>共 {total} 条</span>
        </div>

        {/* 筛选区：移动端折叠，PC 端始终显示 */}
        <div className={`items-center gap-2 flex-wrap ${showFilters ? "flex" : "hidden"} md:flex`}>
          {/* 批量同步按钮 */}
          <button
            onClick={() => void handleSync([...selectedIds])}
            disabled={selectedIds.size === 0 || syncingIds.size > 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold flex-shrink-0 transition-all"
            style={selectedIds.size > 0
              ? { background: "linear-gradient(135deg,#0891b2,#0e7490)", color: "white", border: "none", cursor: "pointer" }
              : { background: "white", color: "#94a3b8", border: "1px solid #e2e8f0", cursor: "not-allowed" }}>
            {syncingIds.size > 0 && selectedIds.size > 0
              ? <><Loader2 size={14} className="animate-spin" />同步中…</>
              : <><UploadCloud size={14} />同步到飞书{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</>}
          </button>
          {/* 批量删除按钮（仅选中时激活） */}
          <button
            onClick={() => selectedIds.size > 0 && setConfirmBatchDel(true)}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold flex-shrink-0 transition-all"
            style={selectedIds.size > 0
              ? { background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "white", border: "none", cursor: "pointer" }
              : { background: "white", color: "#94a3b8", border: "1px solid #e2e8f0", cursor: "not-allowed" }}>
            <Trash2 size={14} />批量删除{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}
          </button>
          {/* 日期范围 */}
          <div className="flex items-center gap-1">
            <CalendarDays size={13} style={{ color: "#94a3b8" }} />
            <input type="date" value={filters.startFrom} onChange={e => onFiltersChange({ startFrom: e.target.value, page: 1 })}
              className="px-2 py-1.5 rounded-lg text-sm outline-none" style={{ border: "1px solid #e2e8f0", width: 122 }} />
            <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>
            <input type="date" value={filters.startTo} onChange={e => onFiltersChange({ startTo: e.target.value, page: 1 })}
              className="px-2 py-1.5 rounded-lg text-sm outline-none" style={{ border: "1px solid #e2e8f0", width: 122 }} />
          </div>
          {/* 级别下拉 */}
          <select value={filters.level} onChange={e => onFiltersChange({ level: e.target.value, page: 1 })}
            className="px-3 py-1.5 rounded-lg text-sm outline-none" style={{ border: "1px solid #e2e8f0" }}>
            <option value="">全部级别</option>
            {(dicts.level?.length ? dicts.level : Object.keys(LEVEL_COLOR)).map(l => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          {/* 来访目的下拉 */}
          <select value={filters.purpose} onChange={e => onFiltersChange({ purpose: e.target.value, page: 1 })}
            className="px-3 py-1.5 rounded-lg text-sm outline-none" style={{ border: "1px solid #e2e8f0", maxWidth: 140 }}>
            <option value="">全部目的</option>
            {(dicts.purpose ?? []).map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {/* 状态下拉（大屏跳转时精准过滤同步） */}
          <select value={filters.status} onChange={e => onFiltersChange({ status: e.target.value, page: 1 })}
            className="px-3 py-1.5 rounded-lg text-sm outline-none"
            style={{
              border: filters.status ? "1.5px solid #ef4444" : "1px solid #e2e8f0",
              background: filters.status ? "rgba(239,68,68,0.06)" : "white",
              color: filters.status ? "#dc2626" : undefined,
              fontWeight: filters.status ? 600 : undefined,
            }}>
            <option value="">全部状态</option>
            {(dicts.status?.length ? dicts.status : ["正常", "取消"]).map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {/* 主接待搜索 */}
          <input value={filters.hostName} onChange={e => onFiltersChange({ hostName: e.target.value, page: 1 })}
            placeholder="主接待人…"
            className="px-3 py-1.5 rounded-lg text-sm outline-none" style={{ border: "1px solid #e2e8f0", width: 110 }} />
          {/* 接待形式激活态标签（大屏图表点击跳转时显示） */}
          {filters.format && (
            <button
              onClick={() => onFiltersChange({ format: "", page: 1 })}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium flex-shrink-0"
              style={{ color: "#7c3aed", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.25)" }}>
              形式: {filters.format} ✕
            </button>
          )}
          {/* 清除筛选（覆盖所有字段，含 status / format） */}
          {(filters.q || filters.level || filters.purpose || filters.status || filters.hostName || filters.startFrom || filters.startTo || filters.format) && (
            <button onClick={() => onFiltersChange({ q: "", level: "", purpose: "", status: "", hostName: "", startFrom: "", startTo: "", format: "", page: 1 })}
              className="text-xs px-2.5 py-1.5 rounded-lg font-medium flex-shrink-0"
              style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
              ✕ 清除
            </button>
          )}
          {/* 飞书解析区 */}
          {parseErr && <span style={{ fontSize: 11, color: "#ef4444" }}>{parseErr}</span>}
          <input value={bitableUrl} onChange={e => { setBitableUrl(e.target.value); setParseErr(""); }}
            onKeyDown={e => { if (e.key === "Enter") void handleParse(); }}
            placeholder="粘贴飞书多维表格链接…"
            style={{ width: 210, padding: "5px 10px", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: 12, outline: "none" }} />
          <button onClick={() => void handleParse()} disabled={parsing || !bitableUrl.trim()}
            style={{ padding: "5px 12px", borderRadius: "8px", border: "1px solid #e2e8f0", background: "white", fontSize: 12, color: "#475569", cursor: parsing || !bitableUrl.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            {parsing ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}解析导入
          </button>
        </div>
      </div>

      {/* 表格 */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <div className="flex items-center justify-center py-24" style={{ color: "#94a3b8" }}><Loader2 size={24} className="animate-spin" /></div>
        ) : receptions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <CalendarDays size={40} style={{ color: "#cbd5e1" }} />
            <p style={{ color: "#94a3b8", fontSize: 14 }}>暂无接待记录</p>
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 700 }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                {/* 全选 checkbox */}
                <th style={{ padding: "10px 12px", width: 36 }} onClick={e => e.stopPropagation()}>
                  <div onClick={toggleAll}
                    style={{ width: 15, height: 15, borderRadius: "4px", cursor: "pointer", border: allOnPage || someOnPage ? "none" : "1.5px solid #cbd5e1", background: allOnPage ? "#2563eb" : someOnPage ? "#93c5fd" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {(allOnPage || someOnPage) && <Check size={10} style={{ color: "white" }} />}
                  </div>
                </th>
                {["日期", "会议名称", "级别", "接待形式", "主接待", "着装要求", "来访目的", "状态", "操作"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.02em", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {receptions.map(r => (
                <tr key={r.id} className="group" style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer" }}
                  onClick={() => onRowClick(r)}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f8fafc")}
                  onMouseLeave={e => (e.currentTarget.style.background = "")}>
                  {/* 行 checkbox */}
                  <td style={{ padding: "12px 12px" }} onClick={e => e.stopPropagation()}>
                    <div onClick={() => toggleRow(r.id)}
                      style={{ width: 15, height: 15, borderRadius: "4px", cursor: "pointer", border: selectedIds.has(r.id) ? "none" : "1.5px solid #cbd5e1", background: selectedIds.has(r.id) ? "#2563eb" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {selectedIds.has(r.id) && <Check size={10} style={{ color: "white" }} />}
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap", color: "#475569" }}>
                    <div style={{ fontSize: 12 }}>{fmtDateTime(r.startTime)}</div>
                    {r.endTime && <div style={{ fontSize: 11, color: "#94a3b8" }}>→ {fmtDate(r.endTime)}</div>}
                  </td>
                  <td style={{ padding: "12px 16px", maxWidth: 200 }}>
                    <span style={{ fontWeight: 500, color: "#1e293b", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.title}</span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>{levelBadge(r.level)}</td>
                  <td style={{ padding: "12px 16px", maxWidth: 150 }}>
                    {(r.formatsDisplay ?? []).length > 0
                      ? (() => { const fd = r.formatsDisplay ?? []; return (
                        <div className="flex flex-wrap gap-1">
                          {fd.slice(0, 3).map(f => <span key={f} style={{ padding: "1px 6px", borderRadius: "4px", fontSize: "11px", background: "rgba(6,182,212,0.08)", color: "#0891b2", border: "1px solid rgba(6,182,212,0.15)" }}>{f}</span>)}
                          {fd.length > 3 && <span style={{ fontSize: 11, color: "#94a3b8" }}>+{fd.length - 3}</span>}
                        </div>); })()

                      : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap", color: "#475569" }}>
                    {formatReceiversDisplay(r.hostDisplay ?? r.hostUser?.name ?? r.hostName) || <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                    {r.dressCode
                      ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, background: "rgba(139,92,246,0.08)", color: "#7c3aed", border: "1px solid rgba(139,92,246,0.18)" }}>
                          <Shirt size={11} />{r.dressCode}
                        </span>
                      : <span style={{ color: "#cbd5e1" }}>—</span>}
                  </td>
                  <td style={{ padding: "12px 16px", maxWidth: 130 }}>
                    <span style={{ color: "#475569", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.purpose || <span style={{ color: "#cbd5e1" }}>—</span>}</span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>{statusBadge(r.status)}</td>
                  <td style={{ padding: "12px 16px" }} onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1 transition-opacity"
                      style={{ opacity: syncingIds.has(r.id) ? 1 : 0 }}
                      onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                      onMouseLeave={e => (e.currentTarget.style.opacity = syncingIds.has(r.id) ? "1" : "0")}>
                      {/* 飞书同步按钮：已同步显蓝，未同步显灰 */}
                      <button
                        onClick={() => void handleSync([r.id])}
                        disabled={syncingIds.has(r.id)}
                        title={r.feishuRecordId ? "重新同步到飞书" : "同步到飞书"}
                        style={{ padding: "4px 8px", borderRadius: "6px", border: "none", background: "transparent", cursor: syncingIds.has(r.id) ? "not-allowed" : "pointer", display: "flex", alignItems: "center", color: r.feishuRecordId ? "#0891b2" : "#94a3b8" }}>
                        {syncingIds.has(r.id)
                          ? <Loader2 size={13} className="animate-spin" />
                          : <UploadCloud size={13} />}
                      </button>
                      <button onClick={() => onDelete(r)}
                        style={{ padding: "4px 8px", borderRadius: "6px", border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", color: "#ef4444" }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>

      {/* 分页 */}
      {total > 0 && (
        <div style={{ padding: "16px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "white", borderTop: "1px solid #e2e8f0", flexShrink: 0 }}>
          <div className="flex items-center gap-4">
            <div style={{ fontSize: 13, color: "#64748b" }}>
              共 {total} 条记录，当前第 {page} 页 / 共 {totalPages} 页
            </div>
            {/* 每页条数选择 */}
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 13, color: "#64748b" }}>每页</span>
              <select
                value={limit}
                onChange={e => onFiltersChange({ limit: Number(e.target.value), page: 1 })}
                style={{ padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, background: "white", cursor: "pointer" }}
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </select>
              <span style={{ fontSize: 13, color: "#64748b" }}>条</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* 跳转输入 */}
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 13, color: "#64748b" }}>跳至</span>
              <input
                type="number"
                min="1"
                max={totalPages}
                placeholder={String(page)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    const val = Number((e.target as HTMLInputElement).value);
                    if (val >= 1 && val <= totalPages) {
                      onFiltersChange({ page: val });
                      (e.target as HTMLInputElement).value = "";
                    }
                  }
                }}
                onBlur={e => {
                  const val = Number(e.target.value);
                  if (val >= 1 && val <= totalPages) {
                    onFiltersChange({ page: val });
                    e.target.value = "";
                  }
                }}
                style={{ width: 48, height: 32, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, textAlign: "center" }}
              />
              <span style={{ fontSize: 13, color: "#64748b" }}>页</span>
            </div>
            {/* 上一页 / 下一页 */}
            <button
              onClick={() => onFiltersChange({ page: Math.max(1, page - 1) })}
              disabled={page === 1}
              style={{ padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, background: "white", cursor: page === 1 ? "not-allowed" : "pointer", opacity: page === 1 ? 0.5 : 1 }}
            >
              上一页
            </button>
            <button
              onClick={() => onFiltersChange({ page: page + 1 })}
              disabled={page * limit >= total}
              style={{ padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, background: "white", cursor: page * limit >= total ? "not-allowed" : "pointer", opacity: page * limit >= total ? 0.5 : 1 }}
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* Toast 同步结果通知 */}
      {toast && (
        <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 9999, padding: "12px 18px", borderRadius: "12px", background: toast.ok ? "#16a34a" : "#dc2626", color: "white", fontSize: 12, fontWeight: 500, boxShadow: "0 8px 32px rgba(0,0,0,0.22)", display: "flex", alignItems: "flex-start", gap: 8, maxWidth: 520, lineHeight: 1.5 }}>
          {toast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}

      {/* 批量删除二次确认弹窗 */}
      {confirmBatchDel && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "white", borderRadius: "16px", padding: "28px 32px", width: 400, boxShadow: "0 24px 48px rgba(0,0,0,0.2)" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: "0 0 8px" }}>确认批量删除</h3>
            <p style={{ fontSize: "14px", color: "#64748b", margin: "0 0 24px", lineHeight: 1.5 }}>
              确定要删除选中的 <strong style={{ color: "#ef4444" }}>{selectedIds.size}</strong> 条接待记录吗？此操作不可恢复。
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmBatchDel(false)} style={{ padding: "9px 18px", borderRadius: "9px", border: "1px solid #e2e8f0", background: "white", fontSize: "14px", color: "#64748b", cursor: "pointer" }}>取消</button>
              <button onClick={() => void handleBatchDelete()} disabled={batchDeleting}
                style={{ padding: "9px 18px", borderRadius: "9px", border: "none", background: "linear-gradient(135deg,#ef4444,#dc2626)", color: "white", fontSize: "14px", fontWeight: 600, cursor: batchDeleting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                {batchDeleting && <Loader2 size={13} className="animate-spin" />}删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ReceptionCard ─────────────────────────────────────────────

function ReceptionCard({ r, onClick, onDelete }: { r: Reception; onClick: () => void; onDelete?: () => void }) {
  const totalTodos     = r.todoTasks?.length ?? 0;
  const completedTodos = r.todoTasks?.filter(t => t.isCompleted).length ?? 0;
  const todoPct        = totalTodos > 0 ? Math.round((completedTodos / totalTodos) * 100) : 0;
  const allDone        = totalTodos > 0 && completedTodos === totalTodos;

  // 背景图：优先用会议照片第一张
  const bgImageUrl = (r.meetingPhotos?.length ?? 0) > 0 ? r.meetingPhotos[0] : null;
  // 无图时的首字剪影水印
  const firstChar  = r.title?.charAt(0) ?? "接";

  // 水晶质感 Badge（浅色半透明 + 级别染色）
  const LEVEL_CRYSTAL: Record<string, React.CSSProperties> = {
    "国家级": { background: "rgba(254,226,226,0.65)", borderColor: "#fecaca", color: "#b91c1c" },
    "省级":   { background: "rgba(219,234,254,0.65)", borderColor: "#bfdbfe", color: "#1d4ed8" },
    "市级":   { background: "rgba(237,233,254,0.65)", borderColor: "#ddd6fe", color: "#6d28d9" },
    "区级":   { background: "rgba(207,250,254,0.65)", borderColor: "#a5f3fc", color: "#0e7490" },
  };
  const crystalBase: React.CSSProperties = {
    fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
    backdropFilter: "blur(4px)", borderWidth: 1, borderStyle: "solid",
    boxShadow: "0 2px 4px rgba(0,0,0,0.04)",
  };
  const levelBadgeStyle: React.CSSProperties = {
    ...crystalBase,
    ...(LEVEL_CRYSTAL[r.level ?? ""] ?? {
      background: "rgba(255,255,255,0.65)", borderColor: "rgba(255,255,255,0.85)", color: "#475569",
    }),
  };
  const statusBadgeStyle: React.CSSProperties = {
    ...crystalBase,
    background: "rgba(255,255,255,0.65)", borderColor: "rgba(255,255,255,0.85)", color: "#475569",
  };

  return (
    <div
      onClick={onClick}
      className="rounded-xl cursor-pointer group relative overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg border border-white/60 shadow-sm shadow-blue-900/5"
    >
      {/* ── 背景层 z-0 ── */}
      {bgImageUrl ? (
        <img
          src={bgImageUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover z-0"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-sky-50 via-blue-50/50 to-indigo-50 z-0 overflow-hidden">
          <span
            className="absolute -right-4 -bottom-6 font-black text-blue-900/5 select-none leading-none"
            style={{ fontSize: 100 }}
          >
            {firstChar}
          </span>
        </div>
      )}

      {/* ── 遮罩层 z-10 ── */}
      {/* 有图：三明治渐变（顶部/底部护住文字，中间透明露出照片）；无图：轻薄白雾 */}
      <div className={`absolute inset-0 z-10 transition-opacity duration-300 ${
        bgImageUrl
          ? "bg-gradient-to-b from-white/90 via-white/20 to-white/95 group-hover:opacity-80"
          : "bg-white/30"
      }`} />

      {/* ── 前景内容层 z-20 ── */}
      <div className="relative z-20 flex flex-col min-h-[152px] p-3">
        {/* 顶部：级别 + 状态 badge + 日期（月/日）+ 删除按钮 */}
        <div className="flex items-center gap-1 flex-wrap">
          {r.level && <span style={levelBadgeStyle}>{r.level}</span>}
          <span style={statusBadgeStyle}>{r.status}</span>
          <span className="ml-auto text-slate-400" style={{ fontSize: 10 }}>
            {fmtDateShort(r.startTime)}
          </span>
          {onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
              style={{ padding: "2px 4px", borderRadius: 4, border: "none", background: "rgba(239,68,68,0.12)", cursor: "pointer", display: "flex", alignItems: "center", color: "#ef4444" }}
              title="删除此记录">
              <Trash2 size={11} />
            </button>
          )}
        </div>

        {/* 主标题 */}
        <h3 className="text-sm font-bold text-slate-800 group-hover:text-blue-700 transition-colors leading-tight mt-1.5 mb-1 line-clamp-2">
          {r.title}
        </h3>

        {/* 时间段 */}
        {r.startTime && (
          <p className="text-xs text-blue-600 font-medium mb-1.5">
            {fmtTime(r.startTime)}{r.endTime ? ` → ${fmtTime(r.endTime)}` : ""}
          </p>
        )}

        {/* 次要信息（单列紧凑，截断） */}
        <div className="flex flex-col space-y-0.5 flex-1 min-w-0">
          {!!formatReceiversDisplay(r.hostDisplay ?? r.hostUser?.name ?? r.hostName) && (
            <div className="flex items-center gap-1 min-w-0">
              <User2 size={9} className="text-slate-400 flex-shrink-0" />
              <span className="text-slate-500 truncate" style={{ fontSize: 10 }}>
                {formatReceiversDisplay(r.hostDisplay ?? r.hostUser?.name ?? r.hostName)}
              </span>
            </div>
          )}
          {r.purpose && (
            <div className="flex items-center gap-1 min-w-0">
              <Tag size={9} className="text-slate-400 flex-shrink-0" />
              <span className="text-slate-500 truncate" style={{ fontSize: 10 }}>{r.purpose}</span>
            </div>
          )}
          {r.address && (
            <a
              href={generateAmapUrl(r.navigationAddress || r.address)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 min-w-0 text-blue-500 hover:underline"
              style={{ fontSize: 10 }}
            >
              <span className="flex-shrink-0">📍</span>
              <span className="truncate">{r.address}</span>
            </a>
          )}
        </div>

        {/* 底部：形式 chips + 待办进度 + 箭头 */}
        <div className="border-t border-slate-100/80 pt-1.5 mt-1.5 flex justify-between items-center">
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            {(r.formatsDisplay ?? []).length > 0 && (
              <div className="flex flex-wrap gap-0.5">
                {(r.formatsDisplay ?? []).slice(0, 2).map(f => (
                  <span key={f} style={{ fontSize: 9, padding: "0px 4px", borderRadius: 3,
                    background: "rgba(255,255,255,0.65)", color: "#64748b",
                    border: "1px solid rgba(255,255,255,0.85)", backdropFilter: "blur(4px)" }}>
                    {f}
                  </span>
                ))}
                {(r.formatsDisplay ?? []).length > 2 && (
                  <span style={{ fontSize: 9, color: "#94a3b8" }}>
                    +{(r.formatsDisplay ?? []).length - 2}
                  </span>
                )}
              </div>
            )}
            {totalTodos > 0 && (
              <div className="flex items-center gap-1.5">
                <div style={{ height: 2, borderRadius: 1, background: "#e2e8f0", flex: 1 }}>
                  <div style={{ height: "100%", borderRadius: 1, width: `${todoPct}%`,
                    background: allDone ? "#22c55e" : "#3b82f6",
                    transition: "width 0.3s", minWidth: todoPct > 0 ? 3 : 0 }} />
                </div>
                <span className="text-slate-400 flex-shrink-0" style={{ fontSize: 9 }}>
                  {completedTodos}/{totalTodos}
                </span>
              </div>
            )}
          </div>
          <ArrowRight size={12} className="text-slate-400 group-hover:text-blue-500 transition-colors flex-shrink-0 ml-2" />
        </div>
      </div>
    </div>
  );
}

// ── CardView ──────────────────────────────────────────────────

function CardView({ receptions, loading, onRowClick, onDelete, total, page, limit, onFiltersChange, filters }: {
  receptions:      Reception[];
  loading:         boolean;
  onRowClick:      (r: Reception) => void;
  onDelete:        (r: Reception) => void;
  total:           number;
  page:            number;
  limit:           number;
  onFiltersChange: (p: Partial<Filters>) => void;
  filters:         Filters;
}) {
  const [groupBy, setGroupBy] = useState<"month" | "level" | "purpose" | "line">("month");
  const [visible, setVisible] = useState(true);

  // 按级别/目的时，一次性全量拉取（绕过后端分页截断）
  const [allReceptions, setAllReceptions] = useState<Reception[]>([]);
  const [allLoading,    setAllLoading]    = useState(false);

  useEffect(() => {
    if (groupBy === "month" || groupBy === "line") return;
    setAllLoading(true);
    const sp = new URLSearchParams({ fetchAll: "true" });
    if (filters.q)         sp.set("q",         filters.q);
    if (filters.status)    sp.set("status",    filters.status);
    if (filters.level)     sp.set("level",     filters.level);
    if (filters.purpose)   sp.set("purpose",   filters.purpose);
    if (filters.hostName)  sp.set("hostName",  filters.hostName);
    if (filters.format)    sp.set("format",    filters.format);
    if (filters.startFrom) sp.set("startFrom", filters.startFrom);
    if (filters.startTo)   sp.set("startTo",   filters.startTo);
    fetch(`/api/reception?${sp.toString()}`)
      .then(r => r.json() as Promise<{ receptions?: Reception[] }>)
      .then(data => setAllReceptions(data.receptions ?? []))
      .catch(() => {})
      .finally(() => setAllLoading(false));
  }, [groupBy, filters.q, filters.status, filters.level, filters.purpose, filters.hostName, filters.format, filters.startFrom, filters.startTo]);

  const displayReceptions = (groupBy === "month" || groupBy === "line") ? receptions : allReceptions;
  const isLoading = (groupBy === "month" || groupBy === "line") ? loading : allLoading;

  const switchGroup = (next: "month" | "level" | "purpose" | "line") => {
    if (next === groupBy) return;
    setVisible(false);
    setTimeout(() => { setGroupBy(next); setVisible(true); }, 150);
  };

  const totalPages = Math.max(1, Math.ceil(total / limit));

  // ── 单维度扁平化分组（必须在所有 early return 之前，遵守 React Hooks 规则） ──
  const { grouped, sortedKeys, displayLabel } = useMemo(() => {
    // 防御：数据未就绪时直接返回空，避免崩溃
    if (!Array.isArray(displayReceptions) || displayReceptions.length === 0) {
      return { grouped: {} as Record<string, Reception[]>, sortedKeys: [] as string[], displayLabel: (k: string) => k };
    }
    try {
      const g: Record<string, Reception[]> = {};
      for (const r of displayReceptions) {
        if (!r) continue; // 防御单条为 undefined
        let key = "其他/未指定";
        if (groupBy === "month") {
          if (!r.startTime) {
            key = "未定时间";
          } else {
            const dt = new Date(r.startTime);
            key = isNaN(dt.getTime())
              ? "未定时间"
              : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
          }
        } else if (groupBy === "level") {
          key = r.level?.trim() || "未指定级别";
        } else if (groupBy === "purpose") {
          key = r.purpose?.trim() || "未指定目的";
        }
        if (!g[key]) g[key] = [];
        g[key].push(r);
      }

      // 每组内部按 startTime 严格降序（最近 → 最远）
      Object.values(g).forEach(items => {
        items.sort((a, b) => {
          const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
          const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
          return tb - ta;
        });
      });

      // 大标题排序
      const FALLBACK_KEY = groupBy === "level" ? "未指定级别" : groupBy === "purpose" ? "未指定目的" : "未定时间";
      const sk = Object.keys(g).sort((a, b) => {
        if (a === FALLBACK_KEY) return 1;
        if (b === FALLBACK_KEY) return -1;
        if (groupBy === "month") return b.localeCompare(a);
        if (groupBy === "level") {
          const ia = LEVEL_ORDER.indexOf(a);
          const ib = LEVEL_ORDER.indexOf(b);
          return (ia === -1 ? LEVEL_ORDER.length : ia) - (ib === -1 ? LEVEL_ORDER.length : ib);
        }
        return g[b].length - g[a].length;
      });

      // 月份 key 转为可读中文标题
      const dl = (k: string): string => {
        if (groupBy !== "month") return k;
        if (k === "未定时间") return "未定时间";
        const m = k.match(/^(\d{4})-(\d{2})$/);
        return m ? `${m[1]}年${Number(m[2])}月` : k;
      };

      return { grouped: g, sortedKeys: sk, displayLabel: dl };
    } catch (err) {
      console.error("[CardView] 分组计算异常:", err);
      return { grouped: {} as Record<string, Reception[]>, sortedKeys: [] as string[], displayLabel: (k: string) => k };
    }
  }, [displayReceptions, groupBy]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24" style={{ color: "#94a3b8" }}>
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }
  if (displayReceptions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <CalendarDays size={40} style={{ color: "#cbd5e1" }} />
        <p style={{ color: "#94a3b8", fontSize: 14 }}>暂无接待记录</p>
      </div>
    );
  }

  const TABS: { key: "month" | "level" | "purpose" | "line"; label: string }[] = [
    { key: "month",   label: "按月份" },
    { key: "level",   label: "按级别" },
    { key: "purpose", label: "按目的" },
    { key: "line",    label: "按条线 (敬请期待)" },
  ];

  return (
    <div className="p-6">
      {/* 分组切换器 */}
      <div className="flex items-center justify-end mb-6">
        <div className="bg-slate-100 p-1 flex rounded-lg space-x-1">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => switchGroup(key)}
              className={`px-3 py-1.5 rounded-md text-sm transition-all ${
                groupBy === key
                  ? "bg-white shadow-sm text-blue-600 font-medium"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区（渐隐渐显过渡） */}
      <div className={`transition-opacity duration-300 ${visible ? "opacity-100" : "opacity-0"}`}>
        {groupBy === "line" ? (
          /* 条线预览：模糊骨架 + 毛玻璃遮罩 */
          <div className="relative min-h-96">
            <div className="opacity-40 select-none pointer-events-none" style={{ filter: "blur(1px)" }}>
              <h2 className="text-xl font-bold text-slate-800 mb-4">🏢 科技条线</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 mb-8">
                {[
                  { title: "某科技局来访调研", date: "07/01", level: "市级", time: "10:00 → 12:00" },
                  { title: "高新技术产业对接会", date: "06/20", level: "省级", time: "14:00 → 16:00" },
                  { title: "智慧城市项目汇报", date: "06/08", level: "区级", time: "09:00 → 10:30" },
                ].map((mock, i) => (
                  <div key={i} className="rounded-xl p-3 bg-white border border-slate-200">
                    <div className="flex items-center gap-1 mb-1">
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                        background: LEVEL_BG[mock.level] ?? "rgba(100,116,139,0.10)", color: LEVEL_COLOR[mock.level] ?? "#64748b" }}>
                        {mock.level}
                      </span>
                      <span className="ml-auto text-slate-500" style={{ fontSize: 10 }}>{mock.date}</span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-800 leading-tight mt-1.5 mb-1">{mock.title}</h3>
                    <span className="text-xs text-blue-600 font-medium">{mock.time}</span>
                  </div>
                ))}
              </div>
              <h2 className="text-xl font-bold text-slate-800 mb-4">📊 统计条线</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                {[
                  { title: "统计局年度数据汇报", date: "07/03", level: "省级", time: "09:30 → 11:00" },
                  { title: "经济普查对接会", date: "06/15", level: "国家级", time: "14:30 → 16:00" },
                ].map((mock, i) => (
                  <div key={i} className="rounded-xl p-3 bg-white border border-slate-200">
                    <div className="flex items-center gap-1 mb-1">
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                        background: LEVEL_BG[mock.level] ?? "rgba(100,116,139,0.10)", color: LEVEL_COLOR[mock.level] ?? "#64748b" }}>
                        {mock.level}
                      </span>
                      <span className="ml-auto text-slate-500" style={{ fontSize: 10 }}>{mock.date}</span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-800 leading-tight mt-1.5 mb-1">{mock.title}</h3>
                    <span className="text-xs text-blue-600 font-medium">{mock.time}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/60 backdrop-blur-sm rounded-xl border border-slate-200 shadow-inner">
              <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-xs font-semibold mb-4 border border-blue-200">
                🚧 敬请期待 (Coming Soon)
              </span>
              <h3 className="text-xl font-bold text-slate-800 mb-2">所属条线智能聚合</h3>
              <p className="text-sm text-slate-500 max-w-md text-center">
                待开发：该功能将与 ODC（组织数据中心）模块深度联动。未来系统将打破行政级别限制，自动将跨级别的相关接待任务智能归类至业务条线，提供更宏观的管控视角。
              </p>
            </div>
          </div>
        ) : (
          <>
            {sortedKeys.map((key, idx) => (
              <div key={key}>
                <h2 className={`text-xl font-bold text-slate-800 mb-4${idx === 0 ? "" : " mt-8"}`}>{displayLabel(key)}</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
                  {grouped[key].map(r => (
                    <ReceptionCard key={r.id} r={r} onClick={() => onRowClick(r)} onDelete={() => onDelete(r)} />
                  ))}
                </div>
              </div>
            ))}

            {/* 翻页器（仅月份分组下显示） */}
            {groupBy === "month" && total > 0 && (
              <div style={{ padding: "16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #e2e8f0", marginTop: 24 }}>
                <div className="flex items-center gap-4">
                  <div style={{ fontSize: 13, color: "#64748b" }}>
                    共 {total} 条记录，当前第 {page} 页 / 共 {totalPages} 页
                  </div>
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 13, color: "#64748b" }}>每页</span>
                    <select
                      value={limit}
                      onChange={e => onFiltersChange({ limit: Number(e.target.value), page: 1 })}
                      style={{ padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, background: "white", cursor: "pointer" }}
                    >
                      <option value="10">10</option>
                      <option value="20">20</option>
                      <option value="50">50</option>
                      <option value="100">100</option>
                    </select>
                    <span style={{ fontSize: 13, color: "#64748b" }}>条</span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 13, color: "#64748b" }}>跳至</span>
                    <input
                      type="number"
                      min="1"
                      max={totalPages}
                      placeholder={String(page)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          const val = Number((e.target as HTMLInputElement).value);
                          if (val >= 1 && val <= totalPages) {
                            onFiltersChange({ page: val });
                            (e.target as HTMLInputElement).value = "";
                          }
                        }
                      }}
                      onBlur={e => {
                        const val = Number(e.target.value);
                        if (val >= 1 && val <= totalPages) {
                          onFiltersChange({ page: val });
                          e.target.value = "";
                        }
                      }}
                      style={{ width: 48, height: 32, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, textAlign: "center" }}
                    />
                    <span style={{ fontSize: 13, color: "#64748b" }}>页</span>
                  </div>
                  <button
                    onClick={() => onFiltersChange({ page: Math.max(1, page - 1) })}
                    disabled={page === 1}
                    style={{ padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, background: "white", cursor: page === 1 ? "not-allowed" : "pointer", opacity: page === 1 ? 0.5 : 1 }}
                  >
                    上一页
                  </button>
                  <button
                    onClick={() => onFiltersChange({ page: page + 1 })}
                    disabled={page * limit >= total}
                    style={{ padding: "6px 12px", border: "1px solid #e2e8f0", borderRadius: 6, fontSize: 13, background: "white", cursor: page * limit >= total ? "not-allowed" : "pointer", opacity: page * limit >= total ? 0.5 : 1 }}
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── FilterChip ─────────────────────────────────────────────────

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium flex-shrink-0"
      style={{ background: "rgba(59,130,246,0.1)", color: "#2563eb", border: "1px solid rgba(59,130,246,0.22)" }}>
      {label}
      <button onClick={onRemove} className="opacity-60 hover:opacity-100 flex-shrink-0 ml-0.5">✕</button>
    </span>
  );
}

// ── DashboardView ─────────────────────────────────────────────

type TrendRange = "week" | "30days" | "by-month" | "by-year";

interface PendingTodo {
  id:            string;
  title:         string;
  receptionId:   string;
  receptionName: string;
}

interface ReceptionStats {
  total:        number;
  byLevel:      Array<{ name: string; value: number }>;
  byStatus:     Array<{ name: string; value: number }>;
  byHost:       Array<{ name: string; value: number }>;
  byFormat:     Array<{ name: string; count: number }>;
  byPurpose:    Array<{ name: string; count: number }>;
  trend:        Array<{ label: string; count: number }>;
  todoTotal:    number;
  todoDone:     number;
  pendingTodos: PendingTodo[];
}

function DashboardView({ filters, onFilterChange }: {
  filters:        Filters;
  onFilterChange: (p: Partial<Filters>) => void;
}) {
  const [trendRange,        setTrendRange]        = useState<TrendRange>("by-month");
  const [stats,             setStats]             = useState<ReceptionStats | null>(null);
  const [loading,           setLoading]           = useState(true);
  const [showPendingTodos,  setShowPendingTodos]  = useState(false);
  const [completedTodoIds,  setCompletedTodoIds]  = useState<Set<string>>(new Set());
  const [completingId,      setCompletingId]      = useState<string | null>(null);
  const [pendingTodoToast,  setPendingTodoToast]  = useState<{ ok: boolean; msg: string } | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ range: trendRange });
      if (filters.q)         sp.set("q",         filters.q);
      if (filters.level)     sp.set("level",     filters.level);
      if (filters.status)    sp.set("status",    filters.status);
      if (filters.purpose)   sp.set("purpose",   filters.purpose);
      if (filters.hostName)  sp.set("hostName",  filters.hostName);
      if (filters.format)    sp.set("format",    filters.format);
      if (filters.startFrom) sp.set("startFrom", filters.startFrom);
      if (filters.startTo)   sp.set("startTo",   filters.startTo);
      const res  = await fetch(`/api/reception/statistics?${sp.toString()}`);
      const data = await res.json() as ReceptionStats;
      setStats(data);
    } finally { setLoading(false); }
  }, [trendRange, filters.q, filters.level, filters.status, filters.purpose, filters.hostName, filters.format, filters.startFrom, filters.startTo]);

  useEffect(() => { void fetchStats(); }, [fetchStats]);

  // 当弹窗关闭时重置已完成 ID 集合
  useEffect(() => {
    if (!showPendingTodos) setCompletedTodoIds(new Set());
  }, [showPendingTodos]);

  // Toast 自动消失
  useEffect(() => {
    if (!pendingTodoToast) return;
    const t = setTimeout(() => setPendingTodoToast(null), 4000);
    return () => clearTimeout(t);
  }, [pendingTodoToast]);

  async function toggleTodo(todo: PendingTodo) {
    if (completingId || completedTodoIds.has(todo.id)) return;
    setCompletingId(todo.id);
    try {
      const res = await fetch(
        `/api/reception/${todo.receptionId}/todo-tasks/${todo.id}`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isCompleted: true }) },
      );
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setPendingTodoToast({ ok: false, msg: d.error ?? "操作失败" });
      } else {
        setCompletedTodoIds(prev => new Set([...prev, todo.id]));
        setPendingTodoToast({ ok: true, msg: `已完成：${todo.title}` });
        void fetchStats();
      }
    } catch {
      setPendingTodoToast({ ok: false, msg: "网络错误，请重试" });
    } finally {
      setCompletingId(null);
    }
  }

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-24" style={{ color: "#94a3b8" }}>
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }
  if (!stats) return null;

  const todoPct       = stats.todoTotal > 0 ? Math.round((stats.todoDone / stats.todoTotal) * 100) : 0;
  const highLevelCnt  = stats.byLevel.filter(l => l.name === "国家级" || l.name === "省级").reduce((s, l) => s + l.value, 0);

  // 趋势数据附加环比增长率
  const trendWithGrowth = stats.trend.map((item, i) => {
    const prev = i > 0 ? stats.trend[i - 1].count : null;
    const growthRate = (prev === null || prev === 0)
      ? null
      : Number(((item.count - prev) / prev * 100).toFixed(1));
    return { ...item, growthRate };
  });

  // 区间环比：前半段 vs 后半段
  const halfIdx        = Math.floor(trendWithGrowth.length / 2);
  const prevHalfTotal  = trendWithGrowth.slice(0, halfIdx).reduce((s, p) => s + p.count, 0);
  const currHalfTotal  = trendWithGrowth.slice(halfIdx).reduce((s, p) => s + p.count, 0);
  const periodGrowth: number | null = prevHalfTotal === 0
    ? null
    : Number(((currHalfTotal - prevHalfTotal) / prevHalfTotal * 100).toFixed(1));
  const hasFilter     = !!(filters.level || filters.status || filters.purpose || filters.q || filters.hostName || filters.format || filters.startFrom || filters.startTo);

  const STATUS_C: Record<string, string> = { "正常": "#22c55e", "取消": "#ef4444" };
  const HOST_C = ["#3b82f6","#8b5cf6","#22c55e","#f59e0b","#06b6d4","#ec4899","#94a3b8"];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pieTip = (({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const { name, value } = payload[0] as { name: string; value: number };
    const pct = stats.total > 0 ? ((value / stats.total) * 100).toFixed(0) : "0";
    return (
      <div className="bg-white rounded-xl shadow-lg px-3 py-2 text-xs" style={{ border: "1px solid #e2e8f0" }}>
        <span className="font-semibold text-slate-700">{name}</span>
        <span className="text-slate-500 ml-2">{value} 次</span>
        <span className="text-slate-400 ml-1">({pct}%)</span>
      </div>
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  // 趋势图专用 tooltip（含环比增长率）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendTip = (({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const count      = (payload[0]?.value as number) ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const growthRate = (payload[0]?.payload as any)?.growthRate as number | null | undefined;
    const isPos = typeof growthRate === "number" && growthRate >= 0;
    const isNeg = typeof growthRate === "number" && growthRate < 0;
    return (
      <div className="bg-white rounded-xl shadow-lg px-3 py-2.5 text-xs" style={{ border: "1px solid #e2e8f0", minWidth: 140 }}>
        <p className="font-semibold text-slate-700 mb-1.5">{String(label)}</p>
        <p className="flex justify-between gap-4">
          <span className="text-slate-500">接待量</span>
          <span className="font-bold text-slate-800">{count}</span>
        </p>
        {typeof growthRate === "number" && (
          <p className={`flex justify-between gap-4 mt-0.5 ${isPos ? "text-red-500" : isNeg ? "text-emerald-500" : "text-slate-400"}`}>
            <span>环比</span>
            <span className="font-semibold">
              {isPos ? `+${growthRate}% 🔴` : isNeg ? `${growthRate}% 🟢` : `${growthRate}%`}
            </span>
          </p>
        )}
      </div>
    );
  }) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const barTip = (({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-white rounded-xl shadow-lg px-3 py-2.5 text-xs" style={{ border: "1px solid #e2e8f0", minWidth: 130 }}>
        <p className="font-semibold text-slate-700 mb-1 truncate max-w-[160px]">{String(label)}</p>
        {(payload as Array<{ name: string; value: number; fill: string }>).map((e, i) => (
          <p key={i} className="flex justify-between gap-4">
            <span style={{ color: e.fill }}>{e.name}</span>
            <span className="font-semibold text-slate-700">{e.value}</span>
          </p>
        ))}
      </div>
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  const cardHdr = (iconBg: string, iconColor: string, icon: React.ReactNode, title: string, sub?: string) => (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-0.5">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: iconBg }}>
          <span style={{ color: iconColor }}>{icon}</span>
        </div>
        <span className="text-sm font-bold text-slate-800">{title}</span>
      </div>
      {sub && <p className="text-xs text-slate-400 pl-8">{sub}</p>}
    </div>
  );

  const donutLegend = (
    data: Array<{ name: string; value: number }>,
    colorFn: (n: string) => string,
    activeKey: string,
    onClick: (name: string) => void,
  ) => (
    <div className="flex-1 space-y-1.5">
      {data.map(e => (
        <button key={e.name} onClick={() => onClick(e.name)}
          className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-all hover:bg-slate-50"
          style={activeKey === e.name
            ? { background: colorFn(e.name) + "14", outline: `1.5px solid ${colorFn(e.name)}40` }
            : {}}>
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colorFn(e.name) }} />
          <span className="text-xs text-slate-600 flex-1">{e.name}</span>
          <span className="text-xs font-bold tabular-nums" style={{ color: colorFn(e.name) }}>{e.value}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-5 px-6 py-5" style={{ overflowY: "auto" }}>

      {/* 联动筛选横幅 */}
      {hasFilter && (
        <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 rounded-xl"
          style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.18)" }}>
          <span className="text-xs font-semibold text-blue-600 flex-shrink-0 mr-1">图表联动筛选：</span>
          {filters.level    && <FilterChip label={`级别：${filters.level}`}    onRemove={() => onFilterChange({ level:    "", page: 1 })} />}
          {filters.status   && <FilterChip label={`状态：${filters.status}`}   onRemove={() => onFilterChange({ status:   "", page: 1 })} />}
          {filters.purpose  && <FilterChip label={`目的：${filters.purpose}`}  onRemove={() => onFilterChange({ purpose:  "", page: 1 })} />}
          {filters.hostName && <FilterChip label={`接待：${filters.hostName}`} onRemove={() => onFilterChange({ hostName: "", page: 1 })} />}
          {filters.format   && <FilterChip label={`形式：${filters.format}`}   onRemove={() => onFilterChange({ format:   "", page: 1 })} />}
          {filters.startFrom && <FilterChip label={`从：${filters.startFrom}`} onRemove={() => onFilterChange({ startFrom: "", page: 1 })} />}
          {filters.startTo   && <FilterChip label={`至：${filters.startTo}`}   onRemove={() => onFilterChange({ startTo:   "", page: 1 })} />}
          {filters.q        && <FilterChip label={`搜索：${filters.q}`}        onRemove={() => onFilterChange({ q: "", page: 1 })} />}
          <button onClick={() => onFilterChange({ level: "", status: "", purpose: "", hostName: "", format: "", q: "", startFrom: "", startTo: "", page: 1 })}
            className="ml-auto text-xs font-semibold px-3 py-1 rounded-lg flex-shrink-0"
            style={{ color: "#ef4444", background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.18)" }}>
            ✕ 清除全部
          </button>
        </div>
      )}

      {/* KPI Cards — 2 列 */}
      <div className="grid grid-cols-2 gap-4">
        {([
          { label: "接待总数",   val: String(stats.total),  sub: "当前筛选结果", color: "#3b82f6", bg: "#eff6ff", icon: <Users       size={18} style={{ color: "#3b82f6" }} /> },
          { label: "高星级接待", val: String(highLevelCnt), sub: "国家级 + 省级", color: "#d97706", bg: "#fffbeb", icon: <AlertCircle size={18} style={{ color: "#d97706" }} /> },
        ] as const).map(kpi => (
          <div key={kpi.label} className="rounded-2xl p-5 flex items-start gap-4"
            style={{ background: kpi.bg, border: `1px solid ${kpi.color}22` }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: kpi.color + "14" }}>
              {kpi.icon}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-slate-500 mb-1">{kpi.label}</p>
              <p className="text-2xl font-black tabular-nums leading-none" style={{ color: kpi.color }}>{kpi.val}</p>
              <p className="text-xs mt-1.5" style={{ color: kpi.color + "88" }}>{kpi.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* 趋势折线图 */}
      <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "rgba(59,130,246,0.1)" }}>
              <CalendarDays size={13} style={{ color: "#2563eb" }} />
            </div>
            <span className="text-sm font-bold text-slate-800">接待趋势</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* DateRange 选择器 */}
            <div className="flex items-center gap-1">
              <input type="date" value={filters.startFrom}
                onChange={e => onFilterChange({ startFrom: e.target.value, page: 1 })}
                className="text-xs px-2 py-1.5 rounded-lg outline-none"
                style={{ border: "1px solid #e2e8f0", width: 120 }} />
              <span style={{ color: "#94a3b8", fontSize: 11 }}>—</span>
              <input type="date" value={filters.startTo}
                onChange={e => onFilterChange({ startTo: e.target.value, page: 1 })}
                className="text-xs px-2 py-1.5 rounded-lg outline-none"
                style={{ border: "1px solid #e2e8f0", width: 120 }} />
            </div>
            {/* 粒度切换：4 个选项 */}
            <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: "#f1f5f9" }}>
              {(["week", "30days", "by-month", "by-year"] as TrendRange[]).map(r => (
                <button key={r} onClick={() => {
                  setTrendRange(r);
                  const now = new Date();
                  const pad = (n: number) => String(n).padStart(2, "0");
                  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
                  if (r === "week") {
                    const from = new Date(now); from.setDate(now.getDate() - 6);
                    onFilterChange({ startFrom: fmt(from), startTo: fmt(now), page: 1 });
                  } else if (r === "30days") {
                    const from = new Date(now); from.setDate(now.getDate() - 29);
                    onFilterChange({ startFrom: fmt(from), startTo: fmt(now), page: 1 });
                  } else if (r === "by-month") {
                    const from = new Date(now.getFullYear(), now.getMonth(), 1);
                    const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                    onFilterChange({ startFrom: fmt(from), startTo: fmt(to), page: 1 });
                  } else {
                    onFilterChange({ startFrom: `${now.getFullYear()}-01-01`, startTo: `${now.getFullYear()}-12-31`, page: 1 });
                  }
                }}
                  className="text-xs px-3 py-1.5 rounded-md font-medium transition-all"
                  style={trendRange === r
                    ? { background: "white", color: "#2563eb", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                    : { color: "#94a3b8" }}>
                  {{ week: "近7天", "30days": "近30天", "by-month": "按月", "by-year": "按年" }[r]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-400 mb-3 pl-8">
          全局历史趋势 · 空白日期范围 = 展示所有记录 · 点击数据点→跳转表格查看明细
        </p>

        {/* ── 区间 KPI 环比 Banner ── */}
        <div className="flex items-center gap-3 mb-4 px-1">
          <div className="flex-1 rounded-xl px-4 py-2.5 flex items-center gap-3"
            style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.14)" }}>
            <span className="text-xs text-slate-500 flex-shrink-0">区间接待总量</span>
            <span className="text-xl font-black tabular-nums text-blue-600">{stats.total}</span>
          </div>
          <div className="flex-1 rounded-xl px-4 py-2.5 flex items-center gap-3"
            style={{
              background: periodGrowth === null ? "rgba(148,163,184,0.06)" : periodGrowth >= 0 ? "rgba(239,68,68,0.06)" : "rgba(16,185,129,0.06)",
              border: periodGrowth === null ? "1px solid rgba(148,163,184,0.18)" : periodGrowth >= 0 ? "1px solid rgba(239,68,68,0.18)" : "1px solid rgba(16,185,129,0.18)",
            }}>
            <span className="text-xs text-slate-500 flex-shrink-0">区间环比</span>
            {periodGrowth === null ? (
              <span className="text-lg font-black text-slate-400">—</span>
            ) : (
              <span className={`text-xl font-black tabular-nums ${periodGrowth >= 0 ? "text-red-500" : "text-emerald-500"}`}>
                {periodGrowth >= 0 ? `↑ +${periodGrowth}%` : `↓ ${periodGrowth}%`}
              </span>
            )}
          </div>
        </div>

        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={trendWithGrowth} margin={{ top: 5, right: 12, left: -20, bottom: 0 }} style={{ cursor: "pointer" }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(data: any) => {
              if (!data?.activeLabel) return;
              const label = data.activeLabel as string;
              const p     = (n: number) => String(n).padStart(2, "0");
              let sf = "", st = "";
              if (trendRange === "week" || trendRange === "30days") {
                sf = st = label;
              } else if (trendRange === "by-year") {
                sf = `${label}-01-01`;
                st = `${label}-12-31`;
              } else {
                const [y, m] = label.split("-").map(Number);
                const ld = new Date(y, m, 0).getDate();
                sf = `${y}-${p(m)}-01`;
                st = `${y}-${p(m)}-${p(ld)}`;
              }
              onFilterChange({ startFrom: sf, startTo: st, view: "table", page: 1 });
            }}>
            <defs>
              <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#2563eb" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false}
              tickFormatter={(v: string) =>
                (trendRange === "week" || trendRange === "30days")
                  ? (() => { const [, m, d] = v.split("-").map(Number); return `${m}/${d}`; })()
                  : v
              }
              interval={
                trendRange === "by-month"
                  ? Math.max(0, Math.floor(trendWithGrowth.length / 12) - 1)
                  : trendRange === "30days" ? 2
                  : 0
              } />
            <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
            <RechartTooltip content={trendTip} />
            <Area type="monotone" dataKey="count" name="接待数量" stroke="#2563eb" strokeWidth={2.5}
              fill="url(#trendGradient)"
              dot={trendWithGrowth.length <= 36 ? { r: 3, fill: "#2563eb", strokeWidth: 0 } : false}
              activeDot={{ r: 6, stroke: "#2563eb", strokeWidth: 2, fill: "white", style: { cursor: "pointer" } }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 三饼图行：级别 / 主接待 / 状态 */}
      <div className="grid grid-cols-3 gap-5">

        {/* 级别分布 CLICKABLE */}
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
          {cardHdr("rgba(59,130,246,0.1)", "#2563eb", <BarChart2 size={13} />, "级别分布", "点击图块→跳转表格筛选")}
          {stats.byLevel.length > 0 ? (
            <div className="flex items-center gap-3">
              <ResponsiveContainer width="52%" height={160}>
                <PieChart>
                  <Pie data={stats.byLevel} cx="50%" cy="50%" innerRadius={38} outerRadius={60}
                    dataKey="value" paddingAngle={3} style={{ cursor: "pointer" }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(d: any) => onFilterChange({ level: d.name === filters.level ? "" : d.name, view: "table", page: 1 })}>
                    {stats.byLevel.map(e => (
                      <Cell key={e.name} fill={LEVEL_COLOR[e.name] ?? "#64748b"}
                        opacity={filters.level && filters.level !== e.name ? 0.28 : 1}
                        strokeWidth={filters.level === e.name ? 2.5 : 0}
                        stroke={filters.level === e.name ? "#fff" : "none"} />
                    ))}
                  </Pie>
                  <RechartTooltip content={pieTip} />
                </PieChart>
              </ResponsiveContainer>
              {donutLegend(
                stats.byLevel,
                n => LEVEL_COLOR[n] ?? "#64748b",
                filters.level,
                n => onFilterChange({ level: n === filters.level ? "" : n, view: "table", page: 1 }),
              )}
            </div>
          ) : <div className="flex items-center justify-center h-36 text-slate-300 text-sm">暂无数据</div>}
        </div>

        {/* 主接待分布 CLICKABLE（"其他"除外） */}
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
          {cardHdr("rgba(6,182,212,0.1)", "#0891b2", <User2 size={13} />, "主接待分布", "点击图块→跳转表格筛选")}
          {stats.byHost.length > 0 ? (
            <div className="flex items-center gap-3">
              <ResponsiveContainer width="52%" height={160}>
                <PieChart>
                  <Pie data={stats.byHost} cx="50%" cy="50%" innerRadius={38} outerRadius={60}
                    dataKey="value" paddingAngle={3} style={{ cursor: "pointer" }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(d: any) => {
                      if (d.name === "其他") return;
                      onFilterChange({ hostName: d.name === filters.hostName ? "" : d.name, view: "table", page: 1 });
                    }}>
                    {stats.byHost.map((e, i) => (
                      <Cell key={e.name} fill={HOST_C[i % HOST_C.length]}
                        opacity={filters.hostName && filters.hostName !== e.name ? 0.28 : 1}
                        strokeWidth={filters.hostName === e.name ? 2.5 : 0}
                        stroke={filters.hostName === e.name ? "#fff" : "none"} />
                    ))}
                  </Pie>
                  <RechartTooltip content={pieTip} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {stats.byHost.map((e, i) => (
                  <button key={e.name}
                    onClick={() => e.name !== "其他" && onFilterChange({ hostName: e.name === filters.hostName ? "" : e.name, view: "table", page: 1 })}
                    className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-all hover:bg-slate-50"
                    style={filters.hostName === e.name
                      ? { background: HOST_C[i % HOST_C.length] + "14", outline: `1.5px solid ${HOST_C[i % HOST_C.length]}40` }
                      : {}}>
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: HOST_C[i % HOST_C.length] }} />
                    <span className="text-xs text-slate-600 flex-1 truncate">{e.name}</span>
                    <span className="text-xs font-bold tabular-nums" style={{ color: HOST_C[i % HOST_C.length] }}>{e.value}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : <div className="flex items-center justify-center h-36 text-slate-300 text-sm">暂无数据</div>}
        </div>

        {/* 状态分布 CLICKABLE */}
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
          {cardHdr("rgba(34,197,94,0.1)", "#16a34a", <CheckCircle2 size={13} />, "状态分布", "点击图块→跳转表格筛选")}
          {stats.byStatus.length > 0 ? (
            <div className="flex items-center gap-3">
              <ResponsiveContainer width="52%" height={160}>
                <PieChart>
                  <Pie data={stats.byStatus} cx="50%" cy="50%" innerRadius={38} outerRadius={60}
                    dataKey="value" paddingAngle={3} style={{ cursor: "pointer" }}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(d: any) => onFilterChange({ status: d.name === filters.status ? "" : d.name, view: "table", page: 1 })}>
                    {stats.byStatus.map(e => (
                      <Cell key={e.name} fill={STATUS_C[e.name] ?? "#64748b"}
                        opacity={filters.status && filters.status !== e.name ? 0.28 : 1}
                        strokeWidth={filters.status === e.name ? 2.5 : 0}
                        stroke={filters.status === e.name ? "#fff" : "none"} />
                    ))}
                  </Pie>
                  <RechartTooltip content={pieTip} />
                </PieChart>
              </ResponsiveContainer>
              {donutLegend(
                stats.byStatus,
                n => STATUS_C[n] ?? "#64748b",
                filters.status,
                n => onFilterChange({ status: n === filters.status ? "" : n, view: "table", page: 1 }),
              )}
            </div>
          ) : <div className="flex items-center justify-center h-36 text-slate-300 text-sm">暂无数据</div>}
        </div>
      </div>

      {/* 两柱状图行：接待形式横向 / 来访目的纵向 */}
      <div className="grid grid-cols-2 gap-5">

        {/* 接待形式横向柱状图 CLICKABLE */}
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
          {cardHdr("rgba(139,92,246,0.1)", "#7c3aed", <Tag size={13} />, "接待形式排行", "点击柱子→跳转表格筛选")}
          {stats.byFormat.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.byFormat} layout="vertical" barSize={14}
                margin={{ top: 0, right: 20, left: 4, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" width={72} tick={{ fontSize: 10, fill: "#475569" }} axisLine={false} tickLine={false} />
                <RechartTooltip content={barTip} />
                <Bar dataKey="count" name="次数" radius={[0, 4, 4, 0]} style={{ cursor: "pointer" }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onClick={(d: any) => onFilterChange({ format: d.name === filters.format ? "" : d.name, view: "table", page: 1 })}>
                  {stats.byFormat.map(e => (
                    <Cell key={e.name}
                      fill={filters.format && filters.format !== e.name ? "#e2e8f0" : "#8b5cf6"}
                      opacity={filters.format === e.name ? 1 : filters.format ? 0.5 : 1} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-48 text-slate-300 text-sm">暂无数据</div>}
        </div>

        {/* 来访目的纵向柱状图 CLICKABLE */}
        <div className="bg-white rounded-2xl p-5 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
          {cardHdr("rgba(245,158,11,0.1)", "#d97706", <BarChart2 size={13} />, "来访目的分布", "点击柱子→跳转表格筛选")}
          {stats.byPurpose.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.byPurpose} barSize={22}
                margin={{ top: 0, right: 4, left: -20, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                  angle={-30} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
                <RechartTooltip content={barTip} />
                <Bar dataKey="count" name="次数" radius={[4, 4, 0, 0]} style={{ cursor: "pointer" }}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onClick={(d: any) => onFilterChange({ purpose: d.name === filters.purpose ? "" : d.name, view: "table", page: 1 })}>
                  {stats.byPurpose.map((e, i) => (
                    <Cell key={e.name}
                      fill={filters.purpose && filters.purpose !== e.name ? "#e2e8f0" : `hsl(${38 + i * 18},85%,${58 - i * 3}%)`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="flex items-center justify-center h-48 text-slate-300 text-sm">暂无数据</div>}
        </div>
      </div>

      {/* 待办完成度大卡片 */}
      <div className="bg-white rounded-2xl p-6 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: "rgba(139,92,246,0.12)" }}>
              <CheckSquare size={15} style={{ color: "#7c3aed" }} />
            </div>
            <span className="text-sm font-bold text-slate-800">整体待办完成度</span>
          </div>
          <div className="flex items-center gap-3">
            {stats.pendingTodos.length > 0 && (
              <button
                onClick={() => setShowPendingTodos(true)}
                style={{ fontSize: 12, color: "#7c3aed", background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 8, padding: "4px 10px", cursor: "pointer", fontWeight: 500 }}>
                查看未完成待办 ({stats.pendingTodos.length})
              </button>
            )}
            <span className="text-3xl font-black tabular-nums" style={{ color: todoPct >= 80 ? "#16a34a" : todoPct >= 50 ? "#2563eb" : "#f59e0b" }}>
              {todoPct}%
            </span>
          </div>
        </div>
        <div className="h-4 rounded-full overflow-hidden mb-3" style={{ background: "#f1f5f9" }}>
          <div className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${todoPct}%`,
              background: todoPct >= 80
                ? "linear-gradient(90deg,#22c55e,#16a34a)"
                : todoPct >= 50
                ? "linear-gradient(90deg,#3b82f6,#2563eb)"
                : "linear-gradient(90deg,#f59e0b,#d97706)",
              minWidth: stats.todoTotal > 0 ? 8 : 0,
            }} />
        </div>
        <p className="text-sm text-slate-500">
          当前累计完成 <span className="font-bold text-slate-700">{stats.todoDone}</span> / <span className="font-bold text-slate-700">{stats.todoTotal}</span> 项待办
          {stats.todoTotal === 0 && <span className="ml-2 text-slate-400">（尚未为接待添加待办分类）</span>}
        </p>
      </div>

      {/* 未完成待办弹窗 */}
      {showPendingTodos && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
          onClick={() => setShowPendingTodos(false)}>
          <div style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 48px rgba(0,0,0,0.2)" }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(139,92,246,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <CheckSquare size={14} style={{ color: "#7c3aed" }} />
                </div>
                <span style={{ fontSize: 15, fontWeight: 700, color: "#1e293b" }}>未完成待办</span>
                <span style={{ fontSize: 12, color: "#94a3b8", background: "#f1f5f9", borderRadius: 6, padding: "2px 8px" }}>
                  {stats.pendingTodos.filter(t => !completedTodoIds.has(t.id)).length} 项待完成
                </span>
              </div>
              <button onClick={() => setShowPendingTodos(false)}
                style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "#f8fafc", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>
                <X size={14} />
              </button>
            </div>
            {/* List */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
              {stats.pendingTodos.length === 0 ? (
                <div style={{ padding: "32px 24px", textAlign: "center", color: "#94a3b8", fontSize: 14 }}>暂无未完成待办</div>
              ) : (
                stats.pendingTodos.map(todo => {
                  const done = completedTodoIds.has(todo.id);
                  const busy = completingId === todo.id;
                  return (
                    <div key={todo.id} style={{ padding: "10px 24px", display: "flex", alignItems: "center", gap: 12, transition: "background 0.15s", opacity: done ? 0.45 : 1 }}
                      onMouseEnter={e => { if (!done) (e.currentTarget as HTMLDivElement).style.background = "#f8fafc"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = ""; }}>
                      {/* Checkbox */}
                      <button
                        disabled={done || !!completingId}
                        onClick={() => void toggleTodo(todo)}
                        style={{ width: 20, height: 20, borderRadius: 6, border: done ? "none" : "1.5px solid #cbd5e1", background: done ? "#22c55e" : "white", cursor: done || !!completingId ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                        {busy ? <Loader2 size={11} className="animate-spin" style={{ color: "#7c3aed" }} /> : done ? <Check size={11} style={{ color: "white" }} /> : null}
                      </button>
                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, color: done ? "#94a3b8" : "#1e293b", textDecoration: done ? "line-through" : "none", margin: 0, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {todo.title}
                        </p>
                        <p style={{ fontSize: 11, color: "#94a3b8", margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {todo.receptionName}
                        </p>
                      </div>
                      {/* Jump link */}
                      <a href={`/dashboard/reception?id=${todo.receptionId}`} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ flexShrink: 0, color: "#94a3b8", display: "flex", alignItems: "center" }}
                        title="跳转到接待详情">
                        <ExternalLink size={13} />
                      </a>
                    </div>
                  );
                })
              )}
            </div>
            {/* Footer */}
            <div style={{ padding: "12px 24px", borderTop: "1px solid #f1f5f9", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => setShowPendingTodos(false)}
                style={{ fontSize: 13, color: "#64748b", background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: "7px 16px", cursor: "pointer" }}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 待办操作 Toast */}
      {pendingTodoToast && (
        <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 9999, padding: "12px 18px", borderRadius: 12, background: pendingTodoToast.ok ? "#16a34a" : "#dc2626", color: "white", fontSize: 12, fontWeight: 500, boxShadow: "0 8px 32px rgba(0,0,0,0.22)", display: "flex", alignItems: "center", gap: 8, maxWidth: 400 }}>
          {pendingTodoToast.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {pendingTodoToast.msg}
        </div>
      )}

    </div>
  );
}

// ── 快捷链接 ────────────────────────────────────────────────────

interface QuickLink { title: string; url: string }

const DEFAULT_QUICK_LINKS: QuickLink[] = [
  { title: "接待流程指引", url: "" },
  { title: "展厅讲解",     url: "" },
  { title: "展车讲解",     url: "" },
  { title: "接待信息备份", url: "" },
];

interface DrawerField { key: string; label: string; visible: boolean; order: number; isCustom?: boolean; type?: string }
interface PageMeta    { title: string; description: string }
interface PageConfig  { pageMeta: PageMeta; quickLinks: QuickLink[]; drawerFields: DrawerField[] }

const DEFAULT_DRAWER_FIELDS: DrawerField[] = [
  { key: "title",       label: "会议名称 / 来访人员", visible: true, order: 1  },
  { key: "startTime",   label: "开始时间",            visible: true, order: 2  },
  { key: "endTime",     label: "结束时间",             visible: true, order: 3  },
  { key: "level",       label: "接待级别",             visible: true, order: 4  },
  { key: "status",      label: "状态",                 visible: true, order: 5  },
  { key: "host",        label: "主接待人",             visible: true, order: 6  },
  { key: "dressCode",   label: "着装要求",             visible: true, order: 7  },
  { key: "formats",     label: "接待形式",             visible: true, order: 8  },
  { key: "purpose",     label: "来访/会议目的",        visible: true, order: 9  },
  { key: "background",  label: "来访/会议背景",        visible: true, order: 10 },
  { key: "address",     label: "地址",                 visible: true, order: 11 },
  { key: "leaderIntro", label: "领导介绍",             visible: true, order: 12 },
  { key: "remarks",     label: "备注",                 visible: true, order: 13 },
];

const DEFAULT_PAGE_CONFIG: PageConfig = {
  pageMeta:     { title: "政府接待", description: "接待记录管理与归档" },
  quickLinks:   DEFAULT_QUICK_LINKS,
  drawerFields: DEFAULT_DRAWER_FIELDS,
};

// ── PageConfigModal（3-Tab 页面配置面板）─────────────────────

function PageConfigModal({ config, onClose, onSaved }: {
  config:  PageConfig;
  onClose: () => void;
  onSaved: (cfg: PageConfig) => void;
}) {
  type Tab = "basics" | "links" | "fields";
  const [activeTab,     setActiveTab]     = useState<Tab>("basics");
  const [draft,         setDraft]         = useState<PageConfig>(() => JSON.parse(JSON.stringify(config)) as PageConfig);
  const [saving,        setSaving]        = useState(false);
  const [errMsg,        setErrMsg]        = useState("");
  const [addingField,   setAddingField]   = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");

  function setMeta(k: keyof PageMeta, v: string) {
    setDraft(prev => ({ ...prev, pageMeta: { ...prev.pageMeta, [k]: v } }));
  }
  function setLink(idx: number, k: keyof QuickLink, v: string) {
    setDraft(prev => {
      const links = prev.quickLinks.map((l, i) => i === idx ? { ...l, [k]: v } : l);
      return { ...prev, quickLinks: links };
    });
  }
  function addLink() {
    setDraft(prev => ({ ...prev, quickLinks: [...prev.quickLinks, { title: "", url: "" }] }));
  }
  function removeLink(idx: number) {
    setDraft(prev => ({ ...prev, quickLinks: prev.quickLinks.filter((_, i) => i !== idx) }));
  }
  function setFieldLabelByKey(key: string, label: string) {
    setDraft(prev => ({
      ...prev,
      drawerFields: prev.drawerFields.map(f => f.key === key ? { ...f, label } : f),
    }));
  }
  function toggleVisible(key: string) {
    setDraft(prev => ({
      ...prev,
      drawerFields: prev.drawerFields.map(f => f.key === key ? { ...f, visible: !f.visible } : f),
    }));
  }
  function moveVisibleField(visibleIdx: number, dir: -1 | 1) {
    setDraft(prev => {
      const visArray = [...prev.drawerFields]
        .filter(f => f.visible !== false)
        .sort((a, b) => a.order - b.order);
      const newVisIdx = visibleIdx + dir;
      if (newVisIdx < 0 || newVisIdx >= visArray.length) return prev;
      [visArray[visibleIdx], visArray[newVisIdx]] = [visArray[newVisIdx]!, visArray[visibleIdx]!];
      visArray.forEach((f, i) => { f.order = i + 1; });
      const visKeys = new Set(visArray.map(f => f.key));
      const hidden = prev.drawerFields.filter(f => !visKeys.has(f.key));
      return { ...prev, drawerFields: [...visArray, ...hidden] };
    });
  }
  function addCustomField() {
    const label = newFieldLabel.trim();
    if (!label) return;
    const visibleFields = draft.drawerFields.filter(f => f.visible !== false);
    const maxOrder = visibleFields.length > 0 ? Math.max(...visibleFields.map(f => f.order)) : 0;
    const newField: DrawerField = {
      key: `custom_${Date.now()}`,
      label,
      visible: true,
      order: maxOrder + 1,
      isCustom: true,
      type: "text",
    };
    setDraft(prev => ({ ...prev, drawerFields: [...prev.drawerFields, newField] }));
    setNewFieldLabel("");
    setAddingField(false);
  }

  async function handleSave() {
    setSaving(true); setErrMsg("");
    try {
      const draftToSave = {
        ...draft,
        quickLinks: draft.quickLinks.filter(l => l.title.trim() || l.url.trim()),
      };
      const res = await fetch("/api/reception/page-config", {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(draftToSave),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        setErrMsg(d.error ?? "保存失败"); return;
      }
      onSaved(draftToSave); onClose();
    } catch { setErrMsg("网络错误，请重试"); }
    finally { setSaving(false); }
  }

  const iS: React.CSSProperties = {
    boxSizing: "border-box", width: "100%", padding: "7px 10px", fontSize: 13,
    borderRadius: 8, border: "1px solid #e2e8f0", outline: "none", color: "#1e293b", background: "white",
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "basics", label: "基础设置" },
    { key: "links",  label: "快捷链接" },
    { key: "fields", label: "表单字段" },
  ];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 2000 }} />
      <div style={{
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: 540, maxHeight: "85vh", background: "white", borderRadius: 16,
        boxShadow: "0 20px 60px rgba(0,0,0,0.2)", zIndex: 2001,
        display: "flex", flexDirection: "column",
      }}>
        {/* 标题栏 */}
        <div style={{ padding: "20px 24px 0", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: "#1e293b" }}>⚙️ 页面配置</h2>
            <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", fontSize: 22, lineHeight: 1 }}>×</button>
          </div>
          {/* Tab 切换 */}
          <div style={{ display: "flex", gap: 0 }}>
            {TABS.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: "8px 18px", fontSize: 13, fontWeight: 500, cursor: "pointer",
                  border: "none", background: "none",
                  borderBottom: activeTab === tab.key ? "2px solid #2563eb" : "2px solid transparent",
                  color: activeTab === tab.key ? "#2563eb" : "#64748b",
                }}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab 内容 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>

          {/* Tab 1: 基础设置 */}
          {activeTab === "basics" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>修改后，页面顶部标题和副标题将即时生效。</div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#64748b", marginBottom: 6 }}>页面名称</label>
                <input value={draft.pageMeta.title} onChange={e => setMeta("title", e.target.value)} placeholder="政府接待" style={iS} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: "#64748b", marginBottom: 6 }}>标语 / 备注</label>
                <input value={draft.pageMeta.description} onChange={e => setMeta("description", e.target.value)} placeholder="接待记录管理与归档" style={iS} />
              </div>
            </div>
          )}

          {/* Tab 2: 快捷链接 */}
          {activeTab === "links" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 12, color: "#94a3b8" }}>链接 URL 留空则该按钮自动隐藏；标题可自定义。可自由新增或删除。</div>
              {draft.quickLinks.map((link, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "130px 1fr auto", gap: 8, alignItems: "center" }}>
                  <input value={link.title} onChange={e => setLink(i, "title", e.target.value)} placeholder="按钮标题" style={iS} />
                  <input value={link.url}   onChange={e => setLink(i, "url",   e.target.value)} placeholder="飞书文档链接（留空则隐藏）" style={iS} />
                  <button type="button" onClick={() => removeLink(i)} title="删除此链接"
                    style={{ width: 28, height: 28, border: "1px solid #e2e8f0", borderRadius: 6, background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", flexShrink: 0, transition: "color 0.15s, border-color 0.15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "#ef4444"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#fca5a5"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#e2e8f0"; }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addLink}
                style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontSize: 13, color: "#2563eb", background: "white", border: "1px dashed #93c5fd", borderRadius: 8, cursor: "pointer", width: "fit-content" }}>
                <Plus size={14} />
                新增快捷链接
              </button>
            </div>
          )}

          {/* Tab 3: 表单字段 */}
          {activeTab === "fields" && (() => {
            const visibleFields = [...draft.drawerFields].filter(f => f.visible !== false).sort((a, b) => a.order - b.order);
            const hiddenFields  = draft.drawerFields.filter(f => f.visible === false);
            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 14 }}>
                  修改字段标题、拖动排序，或点击眼睛图标隐藏字段。保存后立即生效。
                </div>

                {/* 可见字段列表 */}
                {visibleFields.map((field, vi) => (
                  <div key={field.key}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid #f8fafc" }}>
                    <div style={{ width: 20, textAlign: "center", fontSize: 11, color: "#94a3b8", flexShrink: 0 }}>{vi + 1}</div>
                    <input value={field.label}
                      onChange={e => setFieldLabelByKey(field.key, e.target.value)}
                      style={{ ...iS, flex: 1 }} />
                    {/* 隐藏按钮（眼睛关闭图标） */}
                    <button type="button" onClick={() => toggleVisible(field.key)}
                      title="隐藏此字段"
                      style={{ width: 26, height: 26, border: "1px solid #e2e8f0", borderRadius: 5, background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", flexShrink: 0 }}>
                      <EyeOff size={12} />
                    </button>
                    {/* 上移/下移 */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
                      <button type="button" onClick={() => moveVisibleField(vi, -1)} disabled={vi === 0}
                        style={{ width: 22, height: 22, border: "1px solid #e2e8f0", borderRadius: 4, background: "white", cursor: vi === 0 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: vi === 0 ? "#cbd5e1" : "#64748b" }}>
                        <ChevronLeft size={12} style={{ transform: "rotate(90deg)" }} />
                      </button>
                      <button type="button" onClick={() => moveVisibleField(vi, 1)} disabled={vi === visibleFields.length - 1}
                        style={{ width: 22, height: 22, border: "1px solid #e2e8f0", borderRadius: 4, background: "white", cursor: vi === visibleFields.length - 1 ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: vi === visibleFields.length - 1 ? "#cbd5e1" : "#64748b" }}>
                        <ChevronRight size={12} style={{ transform: "rotate(90deg)" }} />
                      </button>
                    </div>
                  </div>
                ))}

                {/* 隐藏字段列表 */}
                {hiddenFields.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", letterSpacing: "0.05em", marginBottom: 8 }}>已隐藏的字段</div>
                    {hiddenFields.map(field => (
                      <div key={field.key}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f8fafc", opacity: 0.5 }}>
                        <div style={{ width: 20, flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: 13, color: "#94a3b8", fontStyle: "italic" }}>{field.label}</span>
                        {/* 恢复显示按钮 */}
                        <button type="button" onClick={() => toggleVisible(field.key)}
                          title="恢复显示此字段"
                          style={{ width: 26, height: 26, border: "1px solid #e2e8f0", borderRadius: 5, background: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#2563eb", flexShrink: 0 }}>
                          <Eye size={12} />
                        </button>
                        <div style={{ width: 46, flexShrink: 0 }} />
                      </div>
                    ))}
                  </div>
                )}

                {/* 新增自定义字段区域 */}
                <div style={{ marginTop: 16 }}>
                  {addingField ? (
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input
                        autoFocus
                        value={newFieldLabel}
                        onChange={e => setNewFieldLabel(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCustomField(); } if (e.key === "Escape") { setAddingField(false); setNewFieldLabel(""); } }}
                        placeholder="请输入字段名称（如：接待预算）"
                        style={{ ...iS, flex: 1 }}
                      />
                      <button type="button" onClick={addCustomField}
                        disabled={!newFieldLabel.trim()}
                        style={{ padding: "7px 14px", borderRadius: 8, border: "none", background: newFieldLabel.trim() ? "#2563eb" : "#cbd5e1", color: "white", fontSize: 12, fontWeight: 600, cursor: newFieldLabel.trim() ? "pointer" : "not-allowed" }}>
                        确认
                      </button>
                      <button type="button" onClick={() => { setAddingField(false); setNewFieldLabel(""); }}
                        style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", color: "#64748b", fontSize: 12, cursor: "pointer" }}>
                        取消
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setAddingField(true)}
                      style={{ width: "100%", padding: "8px 0", borderRadius: 8, border: "2px dashed #e2e8f0", background: "none", color: "#2563eb", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      <Plus size={14} />新增自定义字段
                    </button>
                  )}
                </div>
              </div>
            );
          })()}
        </div>

        {/* 底部操作栏 */}
        <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", flexShrink: 0 }}>
          {errMsg && <span style={{ fontSize: 12, color: "#ef4444", flex: 1 }}>{errMsg}</span>}
          <button onClick={onClose} disabled={saving}
            style={{ padding: "8px 18px", borderRadius: 8, border: "1px solid #e2e8f0", background: "white", cursor: "pointer", fontSize: 13, color: "#64748b" }}>
            取消
          </button>
          <button onClick={() => { void handleSave(); }} disabled={saving}
            style={{ padding: "8px 20px", borderRadius: 8, border: "none", background: saving ? "#93c5fd" : "#2563eb", color: "white", cursor: saving ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 600 }}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </>
  );
}

// ── PlaceholderView ────────────────────────────────────────────

function PlaceholderView({ label }: { label: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center py-24 gap-3">
      <LayoutGrid size={40} style={{ color: "#cbd5e1" }} />
      <p style={{ color: "#94a3b8", fontSize: 14 }}>{label}视图开发中，敬请期待</p>
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────

export default function ReceptionPage() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const filters = parseFilters(searchParams);

  const [receptions,   setReceptions]   = useState<Reception[]>([]);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(false);
  const [dicts,        setDicts]        = useState<DictMap>({});
  const [formatTree,   setFormatTree]   = useState<DictNode[]>([]);
  const [formatById,   setFormatById]   = useState<Map<string, DictNode>>(new Map());
  const [dressCodeRows, setDressCodeRows] = useState<DictRow[]>([]);
  const [purposeRows,   setPurposeRows]   = useState<DictRow[]>([]);
  const [hostTree,      setHostTree]      = useState<HostDictNode[]>([]);
  const [hostById,      setHostById]      = useState<Map<string, HostDictNode>>(new Map());
  const [showCreate,   setShowCreate]   = useState(false);
  const [createPrefill, setCreatePrefill] = useState<Partial<CreateForm> | undefined>();
  const [detailTarget, setDetailTarget] = useState<Reception | null>(null);
  const [delTarget,    setDelTarget]    = useState<Reception | null>(null);
  const [deleting,     setDeleting]     = useState(false);
  const [parsedRecords,   setParsedRecords]   = useState<ParsedReception[] | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string>("");
  const [pageConfig,      setPageConfig]      = useState<PageConfig>(DEFAULT_PAGE_CONFIG);
  const [showPageConfig,  setShowPageConfig]  = useState(false);

  // ── 加载当前用户角色（供文件区块权限守卫使用）────────────────
  useEffect(() => {
    fetch("/api/me")
      .then(r => r.json())
      .then((d: { role?: string }) => { if (d.role) setCurrentUserRole(d.role); })
      .catch(() => {});
  }, []);

  // ── 加载页面配置（pageMeta + quickLinks + drawerFields）──────
  useEffect(() => {
    fetch("/api/reception/page-config")
      .then(r => r.json())
      .then((d: PageConfig) => {
        if (d.pageMeta && d.quickLinks && d.drawerFields) setPageConfig(d);
      })
      .catch(() => {});
  }, []);

  // ── 移动端首次加载默认切换到卡片视图 ──────────────────────
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 768 && !searchParams.get("view")) {
      setFilters({ view: "card" });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 加载字典 ──────────────────────────────────────────────────
  const reloadFormatTree = useCallback(() => {
    fetch("/api/reception/dicts?category=format")
      .then((r) => r.json() as Promise<{ values?: string[]; tree?: DictNode[]; allRows?: { id: string; value: string; parentId: string | null; isActive: boolean; isDefault: boolean; sortOrder: number }[] }>)
      .then((d) => {
        const tree = d.tree ?? [];
        setFormatTree(tree);
        // byId 必须用全量 allRows（含已停用项）构建，
        // 确保历史 Reception.formats 中的旧 ID 能翻译成名称显示在 chip 上
        if (d.allRows && d.allRows.length > 0) {
          const fullMap = new Map<string, DictNode>();
          // 先建节点（不含 children）
          for (const r of d.allRows) {
            fullMap.set(r.id, { id: r.id, value: r.value, parentId: r.parentId, isDefault: r.isDefault, sortOrder: r.sortOrder, children: [] });
          }
          // 挂 children（仅 active tree 需要树结构，byId 平铺即可，children 留空不影响 chip 解析）
          setFormatById(fullMap);
        } else {
          setFormatById(buildByIdMap(tree));
        }
        setDicts((prev) => ({ ...prev, format: d.values ?? [] }));
      })
      .catch(() => {});
  }, []);

  const reloadHostTree = useCallback(() => {
    fetch("/api/reception/dicts?category=host")
      .then((r) => r.json() as Promise<{ tree?: HostDictNode[]; allRows?: { id: string; value: string; parentId: string | null; isActive: boolean; isDefault: boolean; sortOrder: number }[] }>)
      .then((d) => {
        const tree = d.tree ?? [];
        setHostTree(tree);
        setHostById(buildHostByIdMap(tree));
      })
      .catch(() => {});
  }, []);

  const reloadPurposeDicts = useCallback(() => {
    fetch("/api/reception/dicts?category=purpose")
      .then((r) => r.json() as Promise<{ values?: string[]; rows?: DictRow[] }>)
      .then((d) => {
        setDicts((prev) => ({ ...prev, purpose: d.values ?? [] }));
        setPurposeRows(d.rows ?? []);
      })
      .catch(() => {});
  }, []);

  const reloadDressCodeDicts = useCallback(() => {
    fetch("/api/reception/dicts?category=dressCode")
      .then((r) => r.json() as Promise<{ values?: string[]; rows?: DictRow[] }>)
      .then((d) => {
        setDicts((prev) => ({ ...prev, dressCode: d.values ?? [] }));
        setDressCodeRows(d.rows ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const nonFormat = ["level", "status"] as const;
    Promise.all(nonFormat.map((c) =>
      fetch(`/api/reception/dicts?category=${c}`).then((r) => r.json() as Promise<{ values?: string[] }>),
    ))
      .then((results) => {
        const map: DictMap = {};
        nonFormat.forEach((c, i) => { map[c] = results[i].values ?? []; });
        setDicts((prev) => ({ ...prev, ...map }));
      })
      .catch(() => {});
    reloadFormatTree();
    reloadDressCodeDicts();
    reloadPurposeDicts();
    reloadHostTree();
  }, [reloadFormatTree, reloadDressCodeDicts, reloadPurposeDicts, reloadHostTree]);

  // ── 加载列表 ──────────────────────────────────────────────────
  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const sp = new URLSearchParams({ page: String(filters.page), limit: String(filters.limit) });
      if (filters.q)         sp.set("q",         filters.q);
      if (filters.status)    sp.set("status",    filters.status);
      if (filters.level)     sp.set("level",     filters.level);
      if (filters.purpose)   sp.set("purpose",   filters.purpose);
      if (filters.hostName)  sp.set("hostName",  filters.hostName);
      if (filters.format)    sp.set("format",    filters.format);
      if (filters.startFrom) sp.set("startFrom", filters.startFrom);
      if (filters.startTo)   sp.set("startTo",   filters.startTo);
      const res  = await fetch(`/api/reception?${sp.toString()}`);
      const data = await res.json() as { receptions?: Reception[]; total?: number };
      setReceptions(data.receptions ?? []);
      setTotal(data.total ?? 0);
    } finally { setLoading(false); }
  }, [filters.page, filters.limit, filters.q, filters.status, filters.level, filters.purpose, filters.hostName, filters.format, filters.startFrom, filters.startTo]);

  useEffect(() => { void fetchList(); }, [fetchList]);

  // 列表刷新后将 detailTarget 同步到最新版本，避免定时通知按钮状态残留
  useEffect(() => {
    setDetailTarget(prev => {
      if (!prev) return prev;
      const updated = receptions.find(r => r.id === prev.id);
      return updated ?? prev;
    });
  }, [receptions]);

  // ── URL 更新 ──────────────────────────────────────────────────
  function setFilters(patch: Partial<Filters>) {
    startTransition(() => {
      const sp = new URLSearchParams(searchParams.toString());
      const merged = { ...filters, ...patch };
      (Object.keys(merged) as (keyof Filters)[]).forEach(k => {
        const v = merged[k];
        if (v === "" || v === 0) sp.delete(k);
        else sp.set(k, String(v));
      });
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    });
  }

  function handleOptionAdded(category: string, val: string) {
    setDicts(prev => ({ ...prev, [category]: [...(prev[category] ?? []), val] }));
  }

  async function handleDelete() {
    if (!delTarget) return;
    setDeleting(true);
    try {
      await fetch(`/api/reception/${delTarget.id}`, { method: "DELETE" });
      setDelTarget(null);
      void fetchList();
    } finally { setDeleting(false); }
  }

  // 飞书解析回调：无论几条都走 Picker
  function handleParseFeishu(recordsJson: string) {
    const records = JSON.parse(recordsJson) as ParsedReception[];
    setParsedRecords(records);
  }

  function openCreateWithPrefill(rec: ParsedReception) {
    setCreatePrefill({
      title:      rec.title,
      startTime:  rec.startTime ? toDateTimeLocal(rec.startTime) : "",
      endTime:    rec.endTime   ? toDateTimeLocal(rec.endTime)   : "",
      level:      rec.level,
      hostName:   rec.hostName,
      formats:    rec.formats,
      purpose:    rec.purpose,
      status:     rec.status || "正常",
      background: rec.background,
    });
    setParsedRecords(null);
    setShowCreate(true);
  }

  return (
    <div className="flex-1 flex flex-col min-h-full overflow-hidden" style={{ background: "#f0f4f8" }}>

      {/* 页头 */}
      <div style={{ background: "linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#0f172a 100%)", flexShrink: 0 }}>
        <div className="px-8 pt-6 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Users size={18} style={{ color: "rgba(255,255,255,0.6)" }} />
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", letterSpacing: "0.05em" }}>政府关系</span>
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: "white", margin: 0, letterSpacing: "-0.01em" }}>{pageConfig.pageMeta.title}</h1>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 4 }}>{pageConfig.pageMeta.description}</p>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: "white" }}>{total}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>接待总数</div>
            </div>
          </div>

          {/* 快捷链接行 */}
          <div className="w-full overflow-x-auto mt-4" style={{ scrollbarWidth: "none" }}>
            <div className="flex items-center gap-2 py-1">
              {pageConfig.quickLinks.filter(l => l.url).map((link, i) => (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all font-medium backdrop-blur-sm"
                  style={{ whiteSpace: "nowrap", fontSize: 12, color: "rgba(255,255,255,0.9)",
                    background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.1)", textDecoration: "none" }}>
                  <ExternalLink size={11} />
                  {link.title}
                </a>
              ))}
              <button onClick={() => setShowPageConfig(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all backdrop-blur-sm"
                style={{ whiteSpace: "nowrap", fontSize: 12, color: "rgba(255,255,255,0.4)",
                  border: "1px dashed rgba(255,255,255,0.2)", background: "transparent", cursor: "pointer" }}>
                ⚙️ 配置链接
              </button>
            </div>
          </div>

          <div className="mt-4 pb-1">
            <ViewSwitcher current={filters.view} onChange={v => setFilters({ view: v, page: 1 })} />
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {filters.view === "table" && (
          <TableView
            receptions={receptions} total={total} page={filters.page} limit={filters.limit}
            loading={loading} filters={filters} dicts={dicts}
            onFiltersChange={setFilters}
            onNew={() => { setCreatePrefill(undefined); setShowCreate(true); }}
            onDelete={r => setDelTarget(r)}
            onRowClick={r => setDetailTarget(r)}
            onParseFeishu={handleParseFeishu}
            onSyncDone={() => void fetchList()}
          />
        )}
        {filters.view === "card" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <CardView
              receptions={receptions}
              loading={loading}
              onRowClick={r => setDetailTarget(r)}
              onDelete={r => setDelTarget(r)}
              total={total}
              page={filters.page}
              limit={filters.limit}
              onFiltersChange={setFilters}
              filters={filters}
            />
          </div>
        )}
        {filters.view === "kanban" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <DashboardView filters={filters} onFilterChange={setFilters} />
          </div>
        )}
      </div>

      {/* 新建 Drawer */}
      {showCreate && (
        <CreateDrawer
          dicts={dicts} onOptionAdded={handleOptionAdded} prefill={createPrefill}
          onClose={() => { setShowCreate(false); setCreatePrefill(undefined); }}
          onCreated={() => void fetchList()}
          formatTree={formatTree} formatById={formatById} onDictChanged={reloadFormatTree}
          dressCodeRows={dressCodeRows} onDressCodeChanged={reloadDressCodeDicts}
          purposeRows={purposeRows} onPurposeChanged={reloadPurposeDicts}
          hostTree={hostTree} hostById={hostById} onHostChanged={reloadHostTree}
          drawerFields={pageConfig.drawerFields}
        />
      )}

      {/* 详情 Drawer */}
      {detailTarget && (
        <ReceptionDetailDrawer
          reception={detailTarget} dicts={dicts} onOptionAdded={handleOptionAdded}
          onClose={() => setDetailTarget(null)}
          onUpdated={() => void fetchList()}
          formatTree={formatTree} formatById={formatById} onDictChanged={reloadFormatTree}
          dressCodeRows={dressCodeRows} onDressCodeChanged={reloadDressCodeDicts}
          purposeRows={purposeRows} onPurposeChanged={reloadPurposeDicts}
          hostTree={hostTree} hostById={hostById} onHostChanged={reloadHostTree}
          currentUserRole={currentUserRole}
          drawerFields={pageConfig.drawerFields}
        />
      )}

      {/* 飞书解析 - 多选批量导入 */}
      {parsedRecords && (
        <FeishuRecordPicker
          records={parsedRecords}
          onBulkImported={() => void fetchList()}
          onClose={() => setParsedRecords(null)}
        />
      )}

      {/* 删除确认 */}
      {delTarget && (
        <DeleteDialog
          title={delTarget.title}
          onCancel={() => setDelTarget(null)}
          onConfirm={() => void handleDelete()}
          loading={deleting}
        />
      )}

      {/* 页面配置弹窗 */}
      {showPageConfig && (
        <PageConfigModal
          config={pageConfig}
          onClose={() => setShowPageConfig(false)}
          onSaved={saved => setPageConfig(saved)}
        />
      )}
    </div>
  );
}
