"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { generateAmapUrl } from "@/lib/mapUtils";
import { X, Send, Loader2, Check, Bell, MessageSquare, User, Clock, ChevronDown } from "lucide-react";

// ── 类型 ──────────────────────────────────────────────────────────────────────

export interface NotifyField { label: string; value: string }

interface SavedTarget { id: string; name: string; type: string }

interface TodoNode {
  id: string; title: string; isCompleted: boolean; children?: TodoNode[];
}

interface FileItem { name: string; url?: string; type?: string }

interface DictNodeLike { id: string; value: string; parentId: string | null }

interface ReceptionLike {
  id: string; title: string; startTime: string | null; endTime: string | null;
  level: string; status: string; hostDictId?: string | null; hostDictIds?: string[];
  hostName: string | null; hostDisplay?: string | null; dressCode: string | null;
  purpose: string; background: string | null; address?: string | null; navigationAddress?: string | null; remarks: string | null; formats: string[];
  formatsDisplay?: string[]; surveyFiles: FileItem[] | unknown[];
  meetingMinutes: FileItem[] | unknown[]; meetingPhotos?: string[];
  leaderIntroText?: string | null; leaderIntroImages?: string[];
}

// （localStorage 已移除，通知目标改为从全局 API /api/admin/feishu-targets 读取）

// ── 字段提取工具 ──────────────────────────────────────────────────────────────

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}
function fmtTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtTimeRange(s: string | null, e: string | null) {
  if (!s) return "";
  const sd = fmtDate(s), st = fmtTime(s);
  if (!e) return `${sd} ${st}`;
  const ed = fmtDate(e), et = fmtTime(e);
  return sd === ed ? `${sd}  ${st} - ${et}` : `${sd} ${st} → ${ed} ${et}`;
}
function resolveFullHostName(hostDictId: string | null | undefined, hostName: string | null | undefined, hostById: Map<string, DictNodeLike>): string | null {
  if (hostDictId) {
    const n = hostById.get(hostDictId);
    if (n) { const p = n.parentId ? hostById.get(n.parentId) : null; return p ? `${p.value} · ${n.value}` : n.value; }
  }
  return hostName ?? null;
}
function resolveFullHostNames(ids: string[], hostById: Map<string, DictNodeLike>): string[] {
  return ids.flatMap(id => {
    const n = hostById.get(id);
    if (!n) return [];
    const p = n.parentId ? hostById.get(n.parentId) : null;
    return [p ? `${p.value} · ${n.value}` : n.value];
  });
}
function resolveFullFormatNames(ids: string[], formatById: Map<string, DictNodeLike>): string[] {
  return ids.flatMap(id => {
    const n = formatById.get(id);
    if (!n) return [];
    const p = n.parentId ? formatById.get(n.parentId) : null;
    return [p ? `${p.value} · ${n.value}` : n.value];
  });
}
function todosToMarkdown(todos: TodoNode[]): string {
  return todos.flatMap(p => [`**${p.title}**`, ...(p.children ?? []).map(c => `- ${c.title}`)]).join("\n");
}
function filesToMarkdown(files: FileItem[]): string {
  return files.filter(f => f.name).map(f => f.url ? `[${f.name}](${f.url})` : f.name).join("\n");
}
function extractFields(r: ReceptionLike, hostById: Map<string, DictNodeLike>, formatById: Map<string, DictNodeLike>): NotifyField[] {
  const effectiveIds = (r.hostDictIds && r.hostDictIds.length > 0)
    ? r.hostDictIds
    : r.hostDictId ? [r.hostDictId] : [];
  const hostNames = effectiveIds.length > 0
    ? resolveFullHostNames(effectiveIds, hostById)
    : [];
  const hostFull    = hostNames.length > 0 ? hostNames.join("、") : (r.hostName ?? null);
  const formatsFull = resolveFullFormatNames(r.formats, formatById);
  const survey      = (r.surveyFiles  as FileItem[]).filter(f => f?.name);
  const minutes     = (r.meetingMinutes as FileItem[]).filter(f => f?.name);
  return ([
    r.startTime    ? { label: "接待时间", value: fmtTimeRange(r.startTime, r.endTime) } : null,
    r.level        ? { label: "接待级别", value: r.level }    : null,
    r.status       ? { label: "状态",     value: r.status }   : null,
    hostFull       ? { label: "主接待人", value: hostFull }   : null,
    r.dressCode    ? { label: "着装要求", value: r.dressCode }: null,
    formatsFull.length ? { label: "接待形式", value: formatsFull.join("、") } : null,
    r.purpose      ? { label: "来访/会议目的", value: r.purpose }  : null,
    r.background   ? { label: "来访/会议背景", value: r.background}: null,
    r.address      ? { label: "地址", value: `[📍 ${r.address}](${generateAmapUrl(r.navigationAddress || r.address)})` } : null,
    (r.leaderIntroText || (r.leaderIntroImages?.length ?? 0) > 0)
      ? { label: "领导介绍", value: [
            r.leaderIntroText ?? "",
            (r.leaderIntroImages?.length ?? 0) > 0 ? `（附 ${r.leaderIntroImages!.length} 张图片）` : "",
          ].filter(Boolean).join("\n") }
      : null,
    r.remarks      ? { label: "备注",     value: r.remarks }  : null,
    survey.length  ? { label: "调研文件", value: filesToMarkdown(survey) }  : null,
    minutes.length ? { label: "会议纪要", value: filesToMarkdown(minutes) } : null,
    (r.meetingPhotos?.length ?? 0) > 0 ? { label: "会议照片", value: `共 ${r.meetingPhotos!.length} 张（将转换为飞书图片折叠展示）` } : null,
  ] as (NotifyField | null)[]).filter((f): f is NotifyField => f !== null);
}

// ── 发送时间配置 ──────────────────────────────────────────────────────────────

type SendTimeOption = "now" | "before_1d" | "before_1h" | "before_30m" | "before_10m" | "custom";

interface SendTimeConfig {
  option:    SendTimeOption;
  customISO: string; // datetime-local 输入值（仅 custom 时有效）
}

const SEND_TIME_OPTIONS: { value: SendTimeOption; label: string }[] = [
  { value: "now",       label: "立即发送" },
  { value: "before_1d", label: "会前 1 天" },
  { value: "before_1h", label: "会前 1 小时" },
  { value: "before_30m",label: "会前 30 分钟" },
  { value: "before_10m",label: "会前 10 分钟" },
  { value: "custom",    label: "自定义时间" },
];

function resolveScheduledAt(config: SendTimeConfig, meetingStart: string | null): Date | null {
  if (config.option === "now") return null;
  if (config.option === "custom") {
    if (!config.customISO) return null;
    // datetime-local 返回 "YYYY-MM-DDTHH:mm"（无时区标识）。
    // 直接 new Date() 在某些运行时会按 UTC 解析导致偏差；
    // 拼接 +08:00 明确声明为北京时间，确保跨环境一致。
    const iso8 = config.customISO.length === 16
      ? `${config.customISO}:00+08:00`   // "2026-06-05T15:00" → "2026-06-05T15:00:00+08:00"
      : config.customISO;                 // 已带时区信息则直接用
    return new Date(iso8);
  }
  if (!meetingStart) return null;
  const base = new Date(meetingStart).getTime();
  const offsets: Record<string, number> = {
    before_1d:  24 * 60 * 60 * 1000,
    before_1h:  60 * 60 * 1000,
    before_30m: 30 * 60 * 1000,
    before_10m: 10 * 60 * 1000,
  };
  return new Date(base - (offsets[config.option] ?? 0));
}

/** datetime-local 输入格式：YYYY-MM-DDTHH:mm */
function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 地址簿选择器组件（多选下拉框） ──────────────────────────────────────────

const MAX_VISIBLE_TAGS = 3;

function AddressBook({
  selected, onToggle,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  const [targets,   setTargets]   = useState<SavedTarget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open,      setOpen]      = useState(false);
  const [search,    setSearch]    = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/admin/feishu-targets?module=reception")
      .then(r => r.json())
      .then((d: { targets?: Array<{ id: string; feishuId: string; name: string; type: string }> }) => {
        setTargets((d.targets ?? []).map(t => ({ id: t.feishuId, name: t.name, type: t.type })));
      })
      .catch(() => setTargets([]))
      .finally(() => setIsLoading(false));
  }, []);

  // 点击外部关闭下拉
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // 搜索过滤 + 分组
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? targets.filter(t => t.name.toLowerCase().includes(q)) : targets;
    return {
      groups:  list.filter(t => t.type === "GROUP"),
      persons: list.filter(t => t.type !== "GROUP"),
    };
  }, [targets, search]);

  const selectedTargets = targets.filter(t => selected.has(t.id));

  return (
    <div style={{ padding: "10px 20px 12px", borderBottom: "1px solid #f1f5f9", background: "#f8faff" }}>
      {/* 区域标题 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div style={{ width: 20, height: 20, borderRadius: 5, background: "linear-gradient(135deg,#2563eb,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <MessageSquare size={11} style={{ color: "white" }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>通知目标</span>
        {selected.size > 0 && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "white", background: "#2563eb", borderRadius: 10, padding: "1px 8px", fontWeight: 600 }}>
            已选 {selected.size}
          </span>
        )}
      </div>

      {/* 下拉容器 */}
      <div ref={wrapRef} style={{ position: "relative" }}>
        {/* 触发器 */}
        <div
          onClick={() => { if (!isLoading) setOpen(v => !v); }}
          style={{
            minHeight: 36, border: `1.5px solid ${open ? "#2563eb" : "#e2e8f0"}`,
            borderRadius: 8, padding: "4px 8px 4px 10px", background: "white",
            cursor: isLoading ? "default" : "pointer",
            display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4,
            boxShadow: open ? "0 0 0 3px rgba(37,99,235,0.12)" : "none",
            transition: "border-color 0.12s, box-shadow 0.12s",
          }}
        >
          {isLoading ? (
            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#94a3b8" }}>
              <Loader2 size={12} className="animate-spin" />加载中…
            </span>
          ) : selectedTargets.length === 0 ? (
            <span style={{ fontSize: 12, color: "#94a3b8", lineHeight: "26px" }}>点击选择通知目标…</span>
          ) : (
            <>
              {selectedTargets.slice(0, MAX_VISIBLE_TAGS).map(t => (
                <span key={t.id} style={{
                  display: "inline-flex", alignItems: "center", gap: 3,
                  padding: "2px 8px 2px 6px", borderRadius: 12, fontSize: 11, fontWeight: 500,
                  background: t.type === "GROUP" ? "#eff6ff" : "#f0fdf4",
                  color:      t.type === "GROUP" ? "#1d4ed8" : "#047857",
                  border: `1px solid ${t.type === "GROUP" ? "#bfdbfe" : "#bbf7d0"}`,
                  whiteSpace: "nowrap",
                }}>
                  {t.type === "GROUP"
                    ? <MessageSquare size={9} />
                    : <User size={9} />}
                  {t.name}
                </span>
              ))}
              {selectedTargets.length > MAX_VISIBLE_TAGS && (
                <span style={{ fontSize: 11, color: "#64748b", padding: "2px 7px", borderRadius: 10, background: "#f1f5f9", whiteSpace: "nowrap" }}>
                  +{selectedTargets.length - MAX_VISIBLE_TAGS} 个
                </span>
              )}
            </>
          )}
          <div style={{ marginLeft: "auto", color: "#94a3b8", flexShrink: 0, display: "flex", alignItems: "center" }}>
            <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
          </div>
        </div>

        {/* 下拉面板 */}
        {open && (
          <div style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
            background: "white", border: "1.5px solid #e2e8f0", borderRadius: 10,
            boxShadow: "0 8px 32px rgba(0,0,0,0.14)", zIndex: 9999,
            maxHeight: 260, display: "flex", flexDirection: "column",
          }}>
            {/* 搜索框 */}
            <div style={{ padding: "7px 10px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="搜索…"
                style={{
                  width: "100%", fontSize: 12, padding: "4px 8px",
                  border: "1px solid #e2e8f0", borderRadius: 6, outline: "none",
                  boxSizing: "border-box", color: "#1e293b",
                }}
              />
            </div>

            {/* 选项列表 */}
            <div style={{ overflowY: "auto", flex: 1 }}>
              {targets.length === 0 ? (
                <div style={{ padding: 16, fontSize: 12, color: "#94a3b8", textAlign: "center", fontStyle: "italic" }}>
                  暂无通知目标，请前往「超级后台 → 飞书通知配置」添加
                </div>
              ) : filtered.groups.length === 0 && filtered.persons.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>无匹配结果</div>
              ) : (
                <>
                  {/* 群聊分组 */}
                  {filtered.groups.length > 0 && (
                    <div>
                      <div style={{ padding: "7px 12px 3px", fontSize: 10, color: "#94a3b8", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        群聊
                      </div>
                      {filtered.groups.map(t => {
                        const isSel = selected.has(t.id);
                        return (
                          <div key={t.id}
                            onClick={() => onToggle(t.id)}
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "7px 12px", cursor: "pointer",
                              background: isSel ? "#eff6ff" : "white",
                            }}
                            onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f8fafc"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isSel ? "#eff6ff" : "white"; }}
                          >
                            <div style={{
                              width: 15, height: 15, borderRadius: 3, flexShrink: 0,
                              border: isSel ? "none" : "1.5px solid #cbd5e1",
                              background: isSel ? "#2563eb" : "transparent",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {isSel && <Check size={9} style={{ color: "white" }} />}
                            </div>
                            <MessageSquare size={12} style={{ color: isSel ? "#2563eb" : "#94a3b8", flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: isSel ? "#1d4ed8" : "#374151", fontWeight: isSel ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 个人分组 */}
                  {filtered.persons.length > 0 && (
                    <div>
                      <div style={{ padding: "7px 12px 3px", fontSize: 10, color: "#94a3b8", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                        个人
                      </div>
                      {filtered.persons.map(t => {
                        const isSel = selected.has(t.id);
                        return (
                          <div key={t.id}
                            onClick={() => onToggle(t.id)}
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "7px 12px", cursor: "pointer",
                              background: isSel ? "#f0fdf4" : "white",
                            }}
                            onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLDivElement).style.background = "#f8fafc"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = isSel ? "#f0fdf4" : "white"; }}
                          >
                            <div style={{
                              width: 15, height: 15, borderRadius: 3, flexShrink: 0,
                              border: isSel ? "none" : "1.5px solid #cbd5e1",
                              background: isSel ? "#059669" : "transparent",
                              display: "flex", alignItems: "center", justifyContent: "center",
                            }}>
                              {isSel && <Check size={9} style={{ color: "white" }} />}
                            </div>
                            <User size={12} style={{ color: isSel ? "#059669" : "#94a3b8", flexShrink: 0 }} />
                            <span style={{ fontSize: 12, color: isSel ? "#047857" : "#374151", fontWeight: isSel ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t.name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 说明文字 */}
      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}>
        蓝色标签 = 群聊（oc_） · 绿色标签 = 个人（ou_/on_）· 在「超级后台 → 飞书通知配置」中管理
      </div>
    </div>
  );
}

// ── 发送时间选择器组件 ────────────────────────────────────────────────────────

function SendTimePicker({
  config,
  onChange,
  meetingStart,
}: {
  config:       SendTimeConfig;
  onChange:     (c: SendTimeConfig) => void;
  meetingStart: string | null;
}) {
  const preview = useMemo(() => {
    if (config.option === "now") return null;
    const d = resolveScheduledAt(config, meetingStart);
    if (!d || isNaN(d.getTime())) return null;
    return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  }, [config, meetingStart]);

  const noMeeting = meetingStart === null;

  return (
    <div style={{ padding: "10px 20px 12px", borderBottom: "1px solid #f1f5f9", background: "#fffbf0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <div style={{ width: 20, height: 20, borderRadius: 5, background: "linear-gradient(135deg,#f59e0b,#d97706)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Clock size={11} style={{ color: "white" }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}>发送时间</span>
      </div>

      {/* 选项组 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {SEND_TIME_OPTIONS.map(opt => {
          const isSel     = config.option === opt.value;
          const disabled  = opt.value !== "now" && opt.value !== "custom" && noMeeting;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...config, option: opt.value })}
              style={{
                padding: "4px 10px", borderRadius: 16, fontSize: 11, fontWeight: isSel ? 600 : 400,
                cursor: disabled ? "not-allowed" : "pointer",
                border: `1.5px solid ${isSel ? "#2563eb" : "#e2e8f0"}`,
                background: isSel ? "#eff6ff" : disabled ? "#f8fafc" : "white",
                color: isSel ? "#1d4ed8" : disabled ? "#cbd5e1" : "#374151",
                transition: "all 0.12s",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* 无会议开始时间提示 */}
      {noMeeting && config.option !== "now" && config.option !== "custom" && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#f59e0b" }}>该接待记录未设置开始时间，无法使用"会前"预设</div>
      )}

      {/* 自定义时间输入 */}
      {config.option === "custom" && (
        <div style={{ marginTop: 8 }}>
          <input
            type="datetime-local"
            value={config.customISO}
            onChange={e => onChange({ ...config, customISO: e.target.value })}
            style={{ fontSize: 12, padding: "5px 9px", border: "1px solid #e2e8f0", borderRadius: 7, outline: "none", color: "#1e293b", width: "100%", boxSizing: "border-box" }}
          />
        </div>
      )}

      {/* 预计发送时间预览 */}
      {preview && (
        <div style={{ marginTop: 6, fontSize: 11, color: "#059669", display: "flex", alignItems: "center", gap: 4 }}>
          <Clock size={10} />
          预计发送时间：{preview}
        </div>
      )}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

interface Props {
  reception:  ReceptionLike;
  hostById:   Map<string, DictNodeLike>;
  formatById: Map<string, DictNodeLike>;
  onClose:    () => void;
  /** 发送/定时设置成功后回调（父组件用来刷新列表数据） */
  onSent?:    () => void;
}

export function ReceptionShareDialog({ reception, hostById, formatById, onClose, onSent }: Props) {
  // ── 目标选中状态 ────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  function toggleTarget(id: string) {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  // ── 发送时间 ─────────────────────────────────────────────────────
  const [sendTime, setSendTime] = useState<SendTimeConfig>({
    option:    "now",
    customISO: toDateTimeLocal(reception.startTime),
  });

  // ── todos ───────────────────────────────────────────────────────
  const [todos,        setTodos]        = useState<TodoNode[]>([]);
  const [todosLoading, setTodosLoading] = useState(true);

  useEffect(() => {
    setTodosLoading(true);
    fetch(`/api/reception/${reception.id}/todos`)
      .then(r => r.json())
      .then((d: { todos?: TodoNode[] }) => setTodos(d.todos ?? []))
      .catch(() => setTodos([]))
      .finally(() => setTodosLoading(false));
  }, [reception.id]);

  // 将 TodoNode[] 拍平为带 1./（1）编号的独立条目
  const flatTodos = useMemo(() => {
    const items: { key: string; display: string; isChild: boolean; isCompleted: boolean; rawTitle: string }[] = [];
    todos.forEach((node, pi) => {
      items.push({ key: `todo_p${pi}`, display: `${pi + 1}. ${node.title}`, isChild: false, isCompleted: node.isCompleted, rawTitle: node.title });
      (node.children ?? []).forEach((child, ci) => {
        items.push({ key: `todo_p${pi}_c${ci}`, display: `(${ci + 1}) ${child.title}`, isChild: true, isCompleted: child.isCompleted, rawTitle: child.title });
      });
    });
    return items;
  }, [todos]);

  // ── 字段列表（不含待办，待办单独管理） ──────────────────────────
  const allFields = useMemo<NotifyField[]>(() => {
    return extractFields(reception, hostById, formatById);
  }, [reception, hostById, formatById]);

  const [checked, setChecked] = useState<Set<number>>(new Set());
  useEffect(() => { setChecked(new Set(allFields.map((_, i) => i))); }, [allFields]);

  // 待办独立勾选状态（每条目用 key 标识）
  const [checkedTodos, setCheckedTodos] = useState<Set<string>>(new Set());
  useEffect(() => { setCheckedTodos(new Set(flatTodos.map(t => t.key))); }, [flatTodos]);

  const totalCount    = allFields.length + (todosLoading ? 0 : flatTodos.length);
  const selectedCount = checked.size + checkedTodos.size;
  const allSel  = totalCount > 0 && selectedCount === totalCount;
  const someSel = selectedCount > 0 && !allSel;
  function toggle(i: number) { setChecked(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; }); }
  function toggleTodo(key: string) { setCheckedTodos(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); }
  function toggleAllTodos() {
    const allTodosSel = flatTodos.length > 0 && flatTodos.every(t => checkedTodos.has(t.key));
    setCheckedTodos(allTodosSel ? new Set() : new Set(flatTodos.map(t => t.key)));
  }
  function toggleAll() {
    if (allSel) { setChecked(new Set()); setCheckedTodos(new Set()); }
    else { setChecked(new Set(allFields.map((_, i) => i))); setCheckedTodos(new Set(flatTodos.map(t => t.key))); }
  }

  // ── 发送 ────────────────────────────────────────────────────────
  const [sending, setSending] = useState(false);
  const [toast,   setToast]   = useState<{ ok: boolean; msg: string } | null>(null);

  async function handleSend() {
    if (checked.size === 0 && checkedTodos.size === 0) { setToast({ ok: false, msg: "请至少勾选一个字段" }); return; }
    if (selectedIds.size === 0) { setToast({ ok: false, msg: "请至少选择一个通知目标" }); return; }

    // 计算 scheduledAt
    const scheduledAt = resolveScheduledAt(sendTime, reception.startTime);
    if (sendTime.option !== "now" && scheduledAt === null) {
      setToast({ ok: false, msg: "请选择或输入有效的发送时间" }); return;
    }
    if (scheduledAt !== null && scheduledAt.getTime() <= Date.now()) {
      setToast({ ok: false, msg: "计划发送时间必须晚于当前时间，请重新选择" }); return;
    }

    setSending(true); setToast(null);
    try {
      const fields = allFields.filter((_, i) => checked.has(i));
      // 将选中的待办子项合并为一个字段，附加缩进与完成状态删除线
      // 注意：用普通空格缩进（≤3个），避免触发飞书 Markdown 代码块语法（≥4空格）
      const selectedTodoLines = flatTodos
        .filter(t => checkedTodos.has(t.key))
        .map(t => {
          const titleText = t.isCompleted ? `~~${t.rawTitle}~~` : t.rawTitle;
          if (t.isChild) {
            const numPrefix = t.display.match(/^\(\d+\)/)?.[0] ?? "";
            return `  ${numPrefix} ${titleText}`;
          } else {
            const numPrefix = t.display.match(/^\d+\./)?.[0] ?? "";
            return `${numPrefix} ${titleText}`;
          }
        });
      if (selectedTodoLines.length > 0) {
        fields.push({ label: "待办事项", value: selectedTodoLines.join("\n") });
      }
      const targetIds      = [...selectedIds];
      const includesLeader = fields.some(f => f.label === "领导介绍");
      const includesPhotos = fields.some(f => f.label === "会议照片");

      const body: Record<string, unknown> = {
        fields,
        targetIds,
        leaderIntroImages: includesLeader ? (reception.leaderIntroImages ?? []) : [],
        meetingPhotoUrls:  includesPhotos  ? (reception.meetingPhotos   ?? []) : [],
      };
      if (scheduledAt !== null) body.scheduledAt = scheduledAt.toISOString();

      const res  = await fetch(`/api/reception/${reception.id}/notify`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as {
        sent?: number; failed?: number; error?: string;
        scheduled?: boolean; scheduledAt?: string; message?: string;
      };
      if (!res.ok) { setToast({ ok: false, msg: data.error ?? "发送失败" }); return; }

      if (data.scheduled) {
        setToast({ ok: true, msg: data.message ?? "定时通知已就绪" });
      } else {
        const failNote = (data.failed ?? 0) > 0 ? `，${data.failed} 个失败` : "";
        setToast({ ok: true, msg: `已成功发送到 ${data.sent} 个目标${failNote}` });
      }
      onSent?.();
      setTimeout(() => onClose(), 1800);
    } catch {
      setToast({ ok: false, msg: "网络错误，请重试" });
    } finally { setSending(false); }
  }

  const isScheduled = sendTime.option !== "now";
  const canSend     = !sending && !todosLoading;

  // ── UI ──────────────────────────────────────────────────────────
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "white", borderRadius: 16, width: "100%", maxWidth: 500, maxHeight: "92vh", boxShadow: "0 24px 60px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ background: "linear-gradient(135deg,#0f172a,#1e3a5f)", padding: "18px 20px 14px", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: "rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Bell size={16} style={{ color: "white" }} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "white" }}>发送到飞书</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>选择收件人 · 勾选字段 · 立即或定时发送</div>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "rgba(255,255,255,0.1)", borderRadius: 7, cursor: "pointer", color: "rgba(255,255,255,0.7)", padding: "4px 6px", display: "flex" }}><X size={15} /></button>
        </div>

        {/* 接待名称 */}
        <div style={{ padding: "10px 20px 8px", borderBottom: "1px solid #f1f5f9", flexShrink: 0 }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 2 }}>接待名称</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b" }}>{reception.title}</div>
        </div>

        {/* 地址簿选择器 */}
        <AddressBook
          selected={selectedIds}
          onToggle={toggleTarget}
        />

        {/* 发送时间选择器 */}
        <SendTimePicker
          config={sendTime}
          onChange={setSendTime}
          meetingStart={reception.startTime}
        />

        {/* 全选行 */}
        <div onClick={toggleAll} style={{ padding: "8px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", background: "#fafafa", flexShrink: 0 }}>
          <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, border: allSel || someSel ? "none" : "1.5px solid #cbd5e1", background: allSel ? "#2563eb" : someSel ? "#93c5fd" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {(allSel || someSel) && <Check size={10} style={{ color: "white" }} />}
          </div>
          <span style={{ fontSize: 12, color: "#64748b" }}>全选字段 / 取消</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#2563eb", fontWeight: 600 }}>已选 {selectedCount} / {totalCount} 个字段</span>
        </div>

        {/* 字段列表 */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {todosLoading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 32, gap: 8, color: "#94a3b8" }}>
              <Loader2 size={16} className="animate-spin" /><span style={{ fontSize: 13 }}>加载待办…</span>
            </div>
          ) : allFields.length === 0 && flatTodos.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "#94a3b8" }}>该记录没有可发送的已填写字段</div>
          ) : (
            <>
              {/* 普通字段 */}
              {allFields.map((f, i) => (
                <div key={i} onClick={() => toggle(i)}
                  style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 20px", borderBottom: "1px solid #f8fafc", cursor: "pointer", background: checked.has(i) ? "rgba(37,99,235,0.03)" : "white" }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 2, border: checked.has(i) ? "none" : "1.5px solid #cbd5e1", background: checked.has(i) ? "#2563eb" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {checked.has(i) && <Check size={10} style={{ color: "white" }} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: "#64748b", marginBottom: 1, fontWeight: 500 }}>{f.label}</div>
                    <div style={{ fontSize: 12, color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.6, maxHeight: ["调研文件","会议纪要"].includes(f.label) ? 110 : undefined, overflowY: ["调研文件","会议纪要"].includes(f.label) ? "auto" : "visible" }}>
                      {f.value}
                    </div>
                  </div>
                </div>
              ))}

              {/* 待办事项：独立勾选区 */}
              {flatTodos.length > 0 && (
                <>
                  {/* 待办总行（点击全选/全不选当前模块） */}
                  <div onClick={toggleAllTodos}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 20px", borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: "#fffdf5" }}>
                    <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                      border: flatTodos.every(t => checkedTodos.has(t.key)) || flatTodos.some(t => checkedTodos.has(t.key)) ? "none" : "1.5px solid #cbd5e1",
                      background: flatTodos.every(t => checkedTodos.has(t.key)) ? "#2563eb" : flatTodos.some(t => checkedTodos.has(t.key)) ? "#93c5fd" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {(flatTodos.every(t => checkedTodos.has(t.key)) || flatTodos.some(t => checkedTodos.has(t.key))) && <Check size={10} style={{ color: "white" }} />}
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>待办事项</span>
                    <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>{checkedTodos.size} / {flatTodos.length} 项</span>
                  </div>
                  {/* 每个待办子项（子项缩进） */}
                  {flatTodos.map(item => (
                    <div key={item.key} onClick={() => toggleTodo(item.key)}
                      style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: `6px 20px 6px ${item.isChild ? 36 : 20}px`, borderBottom: "1px solid #f8fafc", cursor: "pointer", background: checkedTodos.has(item.key) ? "rgba(37,99,235,0.03)" : "white" }}>
                      <div style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, marginTop: 1,
                        border: checkedTodos.has(item.key) ? "none" : "1.5px solid #cbd5e1",
                        background: checkedTodos.has(item.key) ? "#2563eb" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center" }}>
                        {checkedTodos.has(item.key) && <Check size={10} style={{ color: "white" }} />}
                      </div>
                      <span style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{item.display}</span>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Toast */}
        {toast && (
          <div style={{ margin: "6px 20px 0", padding: "7px 12px", borderRadius: 8, background: toast.ok ? "#f0fdf4" : "#fef2f2", border: `1px solid ${toast.ok ? "#bbf7d0" : "#fecaca"}`, fontSize: 12, color: toast.ok ? "#16a34a" : "#dc2626", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {toast.ok ? <Check size={13} /> : <X size={13} />}
            {toast.msg}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "10px 20px", borderTop: "1px solid #f1f5f9", display: "flex", gap: 8, justifyContent: "flex-end", flexShrink: 0 }}>
          <button type="button" onClick={onClose} style={{ padding: "7px 16px", borderRadius: 9, border: "1px solid #e2e8f0", background: "white", fontSize: 13, color: "#64748b", cursor: "pointer" }}>取消</button>
          <button type="button" onClick={() => void handleSend()} disabled={!canSend}
            style={{ padding: "7px 20px", borderRadius: 9, border: "none", fontSize: 13, fontWeight: 600, color: "white", display: "flex", alignItems: "center", gap: 6, cursor: canSend ? "pointer" : "not-allowed", background: canSend ? (isScheduled ? "linear-gradient(135deg,#f59e0b,#d97706)" : "linear-gradient(135deg,#2563eb,#1d4ed8)") : "#93c5fd" }}>
            {sending
              ? <><Loader2 size={13} className="animate-spin" />{isScheduled ? "设置中…" : "发送中…"}</>
              : isScheduled
                ? <><Clock size={13} />定时发送{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</>
                : <><Send size={13} />发送通知{selectedIds.size > 0 ? ` (${selectedIds.size})` : ""}</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
