"use client";

/**
 * /dashboard/awards — 企业资质与奖项库 v4
 * 重构：category→level，移除 importanceLevel/sourceFeishuUrl，
 *       地域自动计算，卡片→抽屉，筛选栏升级，大盘→数据大屏
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Award, BadgeCheck, Building2, Calendar, ImageIcon,
  Search, Filter, Download, X, ChevronDown, Sparkles, Plus, Pencil, Trash2,
  Save, Loader2, AlertTriangle, Eye, EyeOff,
  Upload, LayoutGrid, Rows3,
  FileSpreadsheet, Link2, CheckCircle2, AlertCircle, BarChart2, MapPin,
} from "lucide-react";
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import * as XLSX from "xlsx";
import PageHeaderWithConfig from "@/components/shared/PageHeaderWithConfig";

// ─────────────────────────────────────────────
// 类型定义
// ─────────────────────────────────────────────

interface Attachment {
  name: string; url: string; feishuFileToken: string; type: "image" | "pdf";
}

interface AwardRecord {
  id: string;
  awardedAt: string;
  awardedAtYear: number;
  awardedBy: string;
  awardeeEntity: string;
  title: string;
  level: string;          // 级别（国家级/省级/市级/区级/行业级）
  description?: string | null;
  attachments: Attachment[];
}

interface DeptPerm {
  departmentId: string; departmentName: string; departmentCode: string;
  permId: string | null; permLevel: "VIEW" | "EDIT" | null;
}

// ─────────────────────────────────────────────
// 常量 & 工具函数
// ─────────────────────────────────────────────

const LEVEL_COLOR_MAP: Record<string, { color: string; bg: string }> = {
  "国家级": { color: "#ef4444", bg: "rgba(239,68,68,0.10)" },
  "省级":   { color: "#f59e0b", bg: "rgba(245,158,11,0.10)" },
  "市级":   { color: "#3b82f6", bg: "rgba(59,130,246,0.10)" },
  "区级":   { color: "#06b6d4", bg: "rgba(6,182,212,0.10)" },
  "行业级": { color: "#8b5cf6", bg: "rgba(139,92,246,0.10)" },
};
const PIE_COLORS = ["#ef4444", "#f59e0b", "#3b82f6", "#06b6d4", "#8b5cf6", "#22c55e", "#ec4899", "#84cc16"];

function levelMeta(level: string) {
  return LEVEL_COLOR_MAP[level] ?? { color: "#64748b", bg: "rgba(100,116,139,0.08)" };
}

const ENTITY_COLORS: Record<string, string> = {
  "北京初速度科技有限公司":     "#06b6d4",
  "魔门塔（苏州）科技有限公司": "#22c55e",
};
function entityColor(entity: string) { return ENTITY_COLORS[entity] ?? "#64748b"; }
function entityShort(entity: string) {
  if (entity.includes("初速度")) return "初速度";
  if (entity.includes("魔门塔")) return "魔门塔";
  return entity.slice(0, 4);
}

/** 根据授予单位自动识别地域标签 */
function computeRegionLabel(awardedBy: string): string {
  if (!awardedBy) return "";
  const nationalKws = [
    "国家", "全国", "国务院", "中央", "工业和信息化部", "国家发展和改革",
    "科学技术部", "教育部", "交通运输部", "住房和城乡建设部", "财政部",
    "商务部", "生态环境部", "工信部", "中国汽车工业协会", "中华人民共和国",
    "中国智能网联", "中关村",
  ];
  for (const kw of nationalKws) { if (awardedBy.includes(kw)) return "国家级"; }
  const provinces = [
    "北京", "上海", "天津", "重庆", "广东", "江苏", "浙江", "山东",
    "湖北", "湖南", "四川", "河南", "河北", "陕西", "福建", "江西",
    "安徽", "黑龙江", "吉林", "辽宁", "山西", "贵州", "云南", "广西",
    "内蒙古", "新疆", "西藏", "青海", "甘肃", "宁夏", "海南",
  ];
  for (const prov of provinces) { if (awardedBy.includes(prov)) return prov; }
  const m = awardedBy.match(/([^\s，,、（(]{2,5}[市区县])/);
  return m ? m[1] : "";
}

function useDebounce<T>(value: T, delay = 300): T {
  const [d, setD] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return d;
}

const AWARD_OPTION_DEFAULTS = {
  entity:    ["北京初速度科技有限公司", "魔门塔（苏州）科技有限公司"],
  level:     ["国家级", "省级", "市级", "区级", "行业级"],
  awardedBy: ["工业和信息化部", "国家发展和改革委员会", "科学技术部", "交通运输部", "住房和城乡建设部", "中国汽车工业协会"],
};

function useLocalOptions(storageKey: string, defaults: string[]): [string[], (opts: string[]) => void] {
  const [opts, setOpts] = useState<string[]>(() => {
    if (typeof window === "undefined") return defaults;
    try { const s = localStorage.getItem(storageKey); return s ? (JSON.parse(s) as string[]) : defaults; } catch { return defaults; }
  });
  function updateOpts(next: string[]) { setOpts(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {} }
  return [opts, updateOpts];
}

function exportCSV(records: AwardRecord[]) {
  if (!records.length) { alert("当前筛选结果为空，无可导出数据"); return; }
  const headers = ["奖项/资质名称", "资质主体", "授予单位", "授予时间", "级别", "地域", "奖项简介"];
  const rows = records.map(r => [r.title, r.awardeeEntity, r.awardedBy, r.awardedAt, r.level, computeRegionLabel(r.awardedBy), r.description ?? ""]);
  const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(row => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: `企业资质与奖项清单_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.csv` });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────
// CreatableSelect
// ─────────────────────────────────────────────

function CreatableSelect({ value, onChange, options, onOptionsChange, placeholder = "请选择或输入…" }: {
  value: string; onChange: (v: string) => void; options: string[];
  onOptionsChange: (opts: string[]) => void; placeholder?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
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
    const handler = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropRef.current?.contains(e.target as Node)) return;
      setIsOpen(false); setSearch(""); setEditIdx(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase().trim()));
  const canCreate = search.trim() !== "" && !options.some(o => o.toLowerCase() === search.trim().toLowerCase());

  function select(opt: string) { onChange(opt); setIsOpen(false); setSearch(""); }
  function create() { const v = search.trim(); if (!v) return; onOptionsChange([...options, v]); onChange(v); setIsOpen(false); setSearch(""); }
  function doDelete(idx: number) {
    if (!window.confirm(`确认删除选项「${options[idx]}」？`)) return;
    const next = options.filter((_, i) => i !== idx);
    onOptionsChange(next);
    if (value === options[idx]) onChange("");
  }
  function doEdit(idx: number) {
    const v = editText.trim(); if (!v) { setEditIdx(null); return; }
    const next = options.map((o, i) => i === idx ? v : o);
    onOptionsChange(next);
    if (value === options[idx]) onChange(v);
    setEditIdx(null);
  }

  const S: React.CSSProperties = { boxSizing: "border-box" };

  return (
    <>
      <button type="button" ref={triggerRef} onClick={() => setIsOpen(o => !o)}
        style={{ ...S, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", fontSize: "14px", borderRadius: "12px", border: "1px solid #e2e8f0", background: "white", cursor: "pointer", textAlign: "left" }}>
        <span style={{ color: value ? "#1e293b" : "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{value || placeholder}</span>
        <ChevronDown size={13} style={{ color: "#94a3b8", flexShrink: 0, marginLeft: 4, transition: "transform 0.15s", transform: isOpen ? "rotate(180deg)" : "none" }} />
      </button>
      {isOpen && (
        <div ref={dropRef} style={{ position: "fixed", top: dropRect.top, left: dropRect.left, width: dropRect.width, zIndex: 9999, background: "white", border: "1px solid #e2e8f0", borderRadius: "12px", boxShadow: "0 8px 32px rgba(0,0,0,0.14)", maxHeight: "240px", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "7px 8px 6px", borderBottom: "1px solid #f1f5f9" }}>
            <input ref={searchRef} value={search} onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); canCreate ? create() : (filtered.length === 1 && select(filtered[0])); } if (e.key === "Escape") setIsOpen(false); }}
              placeholder="搜索或输入新选项，按 Enter 创建…"
              style={{ ...S, width: "100%", padding: "5px 9px", fontSize: "13px", border: "1px solid #e2e8f0", borderRadius: "8px", outline: "none" }} />
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {filtered.length === 0 && !canCreate && (
              <div style={{ padding: "12px", fontSize: "12px", color: "#94a3b8", textAlign: "center" }}>无匹配选项，输入内容后按 Enter 创建</div>
            )}
            {filtered.map(opt => {
              const idx = options.indexOf(opt);
              const isSelected = value === opt;
              return (
                <div key={opt} style={{ display: "flex", alignItems: "center", gap: "2px", padding: "5px 8px", background: isSelected ? "rgba(37,99,235,0.06)" : undefined }}>
                  {editIdx === idx ? (
                    <div style={{ display: "flex", flex: 1, gap: "4px", alignItems: "center" }}>
                      <input autoFocus value={editText} onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); doEdit(idx); } if (e.key === "Escape") setEditIdx(null); }}
                        onMouseDown={e => e.stopPropagation()}
                        style={{ ...S, flex: 1, padding: "3px 7px", fontSize: "13px", border: "1px solid #2563eb", borderRadius: "6px", outline: "none" }} />
                      <button type="button" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); doEdit(idx); }} style={{ padding: "3px 7px", fontSize: "11px", background: "#2563eb", color: "white", border: "none", borderRadius: "5px", cursor: "pointer" }}>保存</button>
                      <button type="button" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setEditIdx(null); }} style={{ padding: "3px 7px", fontSize: "11px", background: "#f1f5f9", color: "#475569", border: "none", borderRadius: "5px", cursor: "pointer" }}>取消</button>
                    </div>
                  ) : (
                    <>
                      <span onMouseDown={() => select(opt)} style={{ flex: 1, fontSize: "13px", color: isSelected ? "#2563eb" : "#1e293b", fontWeight: isSelected ? 500 : 400, cursor: "pointer", padding: "2px 2px", userSelect: "none" }}>{opt}</span>
                      <button type="button" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); setEditIdx(idx); setEditText(opt); }} style={{ padding: "3px", border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8", borderRadius: "4px", display: "flex", alignItems: "center" }}><Pencil size={11} /></button>
                      <button type="button" onMouseDown={e => { e.preventDefault(); e.stopPropagation(); doDelete(idx); }} style={{ padding: "3px", border: "none", background: "transparent", cursor: "pointer", color: "#94a3b8", borderRadius: "4px", display: "flex", alignItems: "center" }}><Trash2 size={11} /></button>
                    </>
                  )}
                </div>
              );
            })}
            {canCreate && (
              <div onMouseDown={create} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 10px", cursor: "pointer", borderTop: filtered.length > 0 ? "1px solid #f1f5f9" : undefined, color: "#2563eb", fontSize: "13px" }}>
                <Plus size={12} />创建「{search.trim()}」
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────
// FlexibleDateInput
// ─────────────────────────────────────────────

function FlexibleDateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isValid = !value.trim() || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value.trim());
  return (
    <div style={{ position: "relative" }}>
      <input value={value} onChange={e => onChange(e.target.value)}
        placeholder="2023 / 2023-09 / 2023-09-15"
        style={{ boxSizing: "border-box", width: "100%", padding: "10px 36px 10px 12px", fontSize: "14px", borderRadius: "12px", border: `1px solid ${!isValid && value ? "#fca5a5" : "#e2e8f0"}`, outline: "none", color: "#1e293b" }}
        onFocus={e => { if (isValid) e.target.style.borderColor = "#3b82f6"; }}
        onBlur={e => { e.target.style.borderColor = !isValid && value ? "#fca5a5" : "#e2e8f0"; }} />
      <Calendar size={14} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", pointerEvents: "none" }} />
      {!isValid && value && <p style={{ fontSize: "11px", color: "#ef4444", marginTop: 4 }}>格式须为 YYYY、YYYY-MM 或 YYYY-MM-DD</p>}
    </div>
  );
}

// ─────────────────────────────────────────────
// SelectFilter
// ─────────────────────────────────────────────

function SelectFilter({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)}
        className="appearance-none pl-3 pr-7 py-2 text-sm rounded-xl bg-white text-slate-700 outline-none cursor-pointer"
        style={{ border: "1px solid #e2e8f0" }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
    </div>
  );
}

// ─────────────────────────────────────────────
// ImagePreviewModal
// ─────────────────────────────────────────────

function ImagePreviewModal({ attachment, onClose }: { attachment: Attachment; onClose: () => void }) {
  const [imgError, setImgError] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }} onClick={onClose}>
      <div className="relative max-w-2xl w-full mx-4 rounded-2xl overflow-hidden shadow-2xl" style={{ background: "#0f172a", border: "1px solid #1e2d45" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #1e2d45" }}>
          <p className="text-sm font-medium text-white truncate">{attachment.name}</p>
          <div className="flex items-center gap-2">
            <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-400" style={{ background: "rgba(59,130,246,0.15)" }}>查看原件</a>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white"><X size={16} /></button>
          </div>
        </div>
        <div className="flex items-center justify-center p-6" style={{ minHeight: 280 }}>
          {attachment.type === "image" && attachment.url && !imgError ? (
            <img src={attachment.url} alt={attachment.name} className="max-w-full max-h-96 rounded-xl object-contain" onError={() => setImgError(true)} />
          ) : (
            <div className="w-full rounded-xl flex flex-col items-center justify-center gap-3" style={{ height: 240, background: "#1e2d45", border: "1px dashed #334155" }}>
              <ImageIcon size={36} style={{ color: "#3b82f6" }} />
              <p className="text-sm text-slate-300">{attachment.name}</p>
              {attachment.url && <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 underline">{attachment.url.slice(0, 60)}{attachment.url.length > 60 ? "…" : ""}</a>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// AttachmentUploader
// ─────────────────────────────────────────────

function AttachmentUploader({ attachments, onChange }: { attachments: Attachment[]; onChange: (atts: Attachment[]) => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true); setUploadErr("");
    try {
      const form = new FormData(); form.append("file", file);
      const res = await fetch("/api/awards/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "上传失败");
      onChange([...attachments, { name: file.name, url: data.url as string, feishuFileToken: "", type: (file.type.startsWith("image/") ? "image" : "pdf") as "image" | "pdf" }]);
    } catch (e) { setUploadErr((e as Error).message); } finally { setUploading(false); }
  }

  return (
    <div>
      <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) upload(f); }}
        onClick={() => !uploading && fileRef.current?.click()}
        className="flex flex-col items-center justify-center py-5 rounded-xl cursor-pointer transition-all"
        style={{ border: `2px dashed ${dragging ? "#2563eb" : "#cbd5e1"}`, background: dragging ? "#eff6ff" : "#fafafa" }}>
        {uploading ? (<><Loader2 size={20} className="animate-spin text-blue-400 mb-1.5" /><p className="text-xs text-slate-500">上传中，请稍候...</p></>) : (<><Upload size={20} className="text-slate-400 mb-1.5" /><p className="text-xs text-slate-600 font-medium">拖拽文件到此处，或点击上传</p><p className="text-xs text-slate-400 mt-0.5">支持图片（JPG / PNG / WEBP）和 PDF，最大 10 MB</p></>)}
        <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      </div>
      {uploadErr && <p className="text-xs text-red-500 mt-1.5 flex items-center gap-1"><AlertTriangle size={11} className="flex-shrink-0" />{uploadErr}</p>}
      {attachments.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {attachments.map((att, i) => (
            <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
              {att.type === "image" ? <ImageIcon size={13} className="text-blue-500 flex-shrink-0" /> : <span className="text-xs font-bold text-amber-500 flex-shrink-0">PDF</span>}
              <a href={att.url} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-600 hover:text-blue-600 flex-1 truncate">{att.name}</a>
              <button type="button" onClick={() => onChange(attachments.filter((_, idx) => idx !== i))} className="p-0.5 rounded text-slate-400 hover:text-red-500 flex-shrink-0"><X size={12} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// AwardCard — 点击整张卡片打开抽屉详情
// ─────────────────────────────────────────────

function AwardCard({ record, onClick, onPreview, isSelected, onToggleSelect }: {
  record: AwardRecord; onClick: () => void; onPreview: (a: Attachment) => void;
  isSelected?: boolean; onToggleSelect?: () => void;
}) {
  const lm = levelMeta(record.level);
  const eColor = entityColor(record.awardeeEntity);
  const bgImageUrl = record.attachments.find(a => a.type === "image")?.url ?? null;
  const region = computeRegionLabel(record.awardedBy);

  return (
    <div
      onClick={onClick}
      className="rounded-2xl overflow-hidden hover:shadow-xl transition-all relative flex flex-col cursor-pointer"
      style={{ border: isSelected ? "2px solid #2563eb" : "1px solid rgba(59,130,246,0.12)", minHeight: 200 }}
    >
      {/* Checkbox */}
      {onToggleSelect !== undefined && (
        <div
          className="absolute top-2.5 left-2.5 z-20"
          onClick={e => { e.stopPropagation(); onToggleSelect(); }}
        >
          <div style={{
            width: 18, height: 18, borderRadius: 5, cursor: "pointer",
            border: isSelected ? "none" : "1.5px solid rgba(100,116,139,0.5)",
            background: isSelected ? "#2563eb" : "rgba(255,255,255,0.9)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
          }}>
            {isSelected && <svg width="11" height="11" viewBox="0 0 11 11"><polyline points="1.5,5.5 4.5,8.5 9.5,2.5" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </div>
        </div>
      )}
      {/* Layer 1: background */}
      {bgImageUrl ? (
        <div className="absolute inset-0" style={{ backgroundImage: `url('${bgImageUrl}')`, backgroundSize: "cover", backgroundPosition: "center" }} />
      ) : (
        <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #eff6ff 0%, #f0f9ff 100%)" }} />
      )}
      {/* Layer 2: gradient overlay */}
      {bgImageUrl && <div className="absolute inset-0 bg-gradient-to-b from-white/80 via-white/55 to-white/20" />}

      {/* Layer 3: content */}
      <div className="relative z-10 p-5 flex flex-col gap-3 flex-1">
        {/* 级别标签 */}
        <div className="flex items-start gap-2">
          <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: lm.bg, color: lm.color }}>
            {record.level || "未分类"}
          </span>
          {region && (
            <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: "rgba(100,116,139,0.08)", color: "#64748b" }}>
              <MapPin size={9} className="inline mr-0.5" />{region}
            </span>
          )}
        </div>

        {/* 标题 + 简介 */}
        <div>
          <h3 className="text-sm font-semibold text-slate-800 leading-snug mb-1">{record.title}</h3>
          {record.description && <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">{record.description}</p>}
        </div>

        {/* 元信息 */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Building2 size={11} style={{ color: eColor }} className="flex-shrink-0" />
            <span className="text-xs font-medium px-2 py-0.5 rounded-md" style={{ background: `${eColor}18`, color: eColor }}>{entityShort(record.awardeeEntity)}</span>
            <span className="text-xs text-slate-500 truncate">{record.awardeeEntity}</span>
          </div>
          <div className="flex items-center gap-2">
            <BadgeCheck size={11} className="flex-shrink-0 text-slate-400" />
            <span className="text-xs text-slate-600 truncate">{record.awardedBy}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar size={11} className="text-slate-400" />
            <span className="text-xs text-slate-500">{record.awardedAt}</span>
          </div>
        </div>

        {/* 附件（阻止冒泡，避免触发drawer） */}
        {record.attachments.length > 0 && (
          <div onClick={e => e.stopPropagation()}>
            <p className="text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wide">获奖证明</p>
            <div className="flex flex-wrap gap-2">
              {record.attachments.map((att, i) => (
                <button key={i} onClick={() => onPreview(att)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: att.type === "image" ? "rgba(59,130,246,0.08)" : "rgba(245,158,11,0.08)", color: att.type === "image" ? "#2563eb" : "#d97706", border: `1px solid ${att.type === "image" ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.2)"}` }}>
                  {att.type === "image" ? <ImageIcon size={11} /> : <span>PDF</span>}
                  {att.name.length > 14 ? att.name.slice(0, 14) + "…" : att.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// AwardDetailDrawer — 右侧滑出详情抽屉（所见即所得直接编辑）
// ─────────────────────────────────────────────

function AwardDetailDrawer({ record, canEdit, onClose, onSave, onDelete, onPreview }: {
  record: AwardRecord; canEdit: boolean; onClose: () => void;
  onSave: (data: Omit<AwardRecord, "id">) => Promise<void>;
  onDelete: (r: AwardRecord) => void; onPreview: (a: Attachment) => void;
}) {
  const [form, setForm] = useState<Omit<AwardRecord, "id">>(() => ({ ...record }));
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [entityOpts, setEntityOpts] = useLocalOptions("award_options_entity", AWARD_OPTION_DEFAULTS.entity);
  const [levelOpts, setLevelOpts] = useLocalOptions("award_options_level", AWARD_OPTION_DEFAULTS.level);
  const [awardedByOpts, setAwardedByOpts] = useLocalOptions("award_options_awardedBy", AWARD_OPTION_DEFAULTS.awardedBy);

  const autoRegion = computeRegionLabel(form.awardedBy);
  const lm = levelMeta(form.level);

  function setField<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function handleSubmit() {
    if (!form.title.trim()) {
      setFormError("奖项/资质名称为必填项"); return;
    }
    if (form.awardedAt.trim() && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(form.awardedAt.trim())) {
      setFormError("授予时间格式须为 YYYY、YYYY-MM 或 YYYY-MM-DD"); return;
    }
    setIsSaving(true); setFormError("");
    try {
      const year = parseInt(form.awardedAt.slice(0, 4), 10);
      await onSave({ ...form, awardedAtYear: isNaN(year) ? 0 : year });
      onClose();
    } catch (err) { setFormError((err as Error).message ?? "保存失败，请重试"); }
    finally { setIsSaving(false); }
  }

  return (
    <>
      {/* 遮罩 */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 999, backdropFilter: "blur(2px)" }} />

      {/* 抽屉 */}
      <div style={{ position: "fixed", right: 0, top: 0, bottom: 0, width: 540, zIndex: 1000, background: "white", boxShadow: "-8px 0 40px rgba(0,0,0,0.15)", display: "flex", flexDirection: "column" }}>
        {/* 头部 */}
        <div style={{ background: "linear-gradient(135deg,#0f172a 0%,#1e3a5f 60%,#0f172a 100%)", padding: "20px 24px 18px" }}>
          <div className="flex items-start justify-between gap-3 mb-2">
            <h2 className="text-base font-semibold text-white leading-snug flex-1">
              {canEdit ? "编辑奖项详情" : "奖项详情"}
            </h2>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 flex-shrink-0"><X size={16} /></button>
          </div>
          {form.level && (
            <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: lm.bg, color: lm.color }}>{form.level}</span>
          )}
        </div>

        {/* 正文（可滚动） */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="space-y-5">
            {/* 奖项名称 */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">奖项 / 资质名称 {canEdit && <span className="text-red-500">*</span>}</label>
              {canEdit ? (
                <input value={form.title} onChange={e => setField("title", e.target.value)}
                  placeholder="例：国家级专精特新「小巨人」企业"
                  className="w-full px-3 py-2.5 text-sm rounded-xl outline-none text-slate-800 placeholder-slate-400"
                  style={{ border: "1px solid #e2e8f0" }} />
              ) : (
                <p className="text-sm text-slate-800 px-3 py-2.5 rounded-xl" style={{ background: "#f8fafc", border: "1px solid #f1f5f9" }}>{form.title}</p>
              )}
            </div>

            {/* 资质主体 + 级别 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">资质主体</label>
                {canEdit ? (
                  <CreatableSelect value={form.awardeeEntity} onChange={v => setField("awardeeEntity", v)} options={entityOpts} onOptionsChange={setEntityOpts} placeholder="选择或输入主体名称…" />
                ) : (
                  <p className="text-sm text-slate-800 px-3 py-2.5 rounded-xl" style={{ background: "#f8fafc", border: "1px solid #f1f5f9" }}>{form.awardeeEntity}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">级别</label>
                {canEdit ? (
                  <CreatableSelect value={form.level} onChange={v => setField("level", v)} options={levelOpts} onOptionsChange={setLevelOpts} placeholder="选择或输入级别…" />
                ) : (
                  <p className="text-sm text-slate-800 px-3 py-2.5 rounded-xl" style={{ background: "#f8fafc", border: "1px solid #f1f5f9" }}>{form.level || "—"}</p>
                )}
              </div>
            </div>

            {/* 授予单位 + 授予时间 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">授予单位</label>
                {canEdit ? (
                  <CreatableSelect value={form.awardedBy} onChange={v => setField("awardedBy", v)} options={awardedByOpts} onOptionsChange={setAwardedByOpts} placeholder="选择或输入授予单位…" />
                ) : (
                  <p className="text-sm text-slate-800 px-3 py-2.5 rounded-xl" style={{ background: "#f8fafc", border: "1px solid #f1f5f9" }}>{form.awardedBy}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">授予时间</label>
                {canEdit ? (
                  <FlexibleDateInput value={form.awardedAt} onChange={v => setField("awardedAt", v)} />
                ) : (
                  <p className="text-sm text-slate-800 px-3 py-2.5 rounded-xl" style={{ background: "#f8fafc", border: "1px solid #f1f5f9" }}>{form.awardedAt}</p>
                )}
              </div>
            </div>

            {/* 地域标签（自动计算，只读） */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">地域标签 <span className="text-xs text-slate-400 font-normal">（根据授予单位自动识别）</span></label>
              <div className="px-3 py-2.5 rounded-xl text-sm" style={{ border: "1px solid #e2e8f0", background: "#f8fafc", color: autoRegion ? "#1e293b" : "#94a3b8" }}>
                <MapPin size={13} className="inline mr-1.5 text-slate-400" />
                {autoRegion || "将根据授予单位自动识别地域"}
              </div>
            </div>

            {/* 奖项简介 */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">奖项简介</label>
              {canEdit ? (
                <textarea value={form.description ?? ""} onChange={e => setField("description", e.target.value)}
                  rows={2} placeholder="简要描述获奖背景和意义..."
                  className="w-full px-3 py-2.5 text-sm rounded-xl outline-none text-slate-800 placeholder-slate-400 resize-none"
                  style={{ border: "1px solid #e2e8f0" }} />
              ) : (
                <p className="text-sm text-slate-600 px-3 py-2.5 rounded-xl leading-relaxed" style={{ background: "#f8fafc", border: "1px solid #f1f5f9" }}>{form.description || "—"}</p>
              )}
            </div>

            {/* 获奖证明附件 */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-2">获奖证明附件</label>
              {canEdit ? (
                <AttachmentUploader attachments={form.attachments} onChange={atts => setField("attachments", atts)} />
              ) : (
                form.attachments.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {form.attachments.map((att, i) => (
                      <button key={i} onClick={() => onPreview(att)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all"
                        style={{ background: att.type === "image" ? "rgba(59,130,246,0.08)" : "rgba(245,158,11,0.08)", color: att.type === "image" ? "#2563eb" : "#d97706", border: `1px solid ${att.type === "image" ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.2)"}` }}>
                        {att.type === "image" ? <ImageIcon size={13} /> : <span className="font-bold text-xs">PDF</span>}
                        <span className="max-w-[140px] truncate">{att.name}</span>
                      </button>
                    ))}
                  </div>
                ) : <p className="text-sm text-slate-400 px-1">暂无附件</p>
              )}
            </div>

            {formError && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-red-600" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <AlertTriangle size={14} className="flex-shrink-0" />{formError}
              </div>
            )}
          </div>
        </div>

        {/* 底部操作栏 */}
        <div className="px-6 py-4 flex items-center gap-3" style={{ borderTop: "1px solid #f1f5f9" }}>
          {canEdit && (
            <>
              <button onClick={() => void handleSubmit()} disabled={isSaving}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}>
                {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {isSaving ? "保存中..." : "保存更新"}
              </button>
              <button onClick={() => { onClose(); onDelete(record); }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                style={{ border: "1px solid rgba(239,68,68,0.25)" }}>
                <Trash2 size={14} />删除
              </button>
            </>
          )}
          <button onClick={onClose} className="ml-auto px-4 py-2.5 text-sm text-slate-500 rounded-xl hover:bg-slate-100 transition-colors">关闭</button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────
// AwardTableView — 表格视图（重构列）
// ─────────────────────────────────────────────

function AwardTableView({ records, canEdit, onEdit, onDelete, onPreview, selectedIds, onToggleSelect, onToggleAll }: {
  records: AwardRecord[]; canEdit: boolean;
  onEdit: (r: AwardRecord) => void; onDelete: (r: AwardRecord) => void; onPreview: (a: Attachment) => void;
  selectedIds: string[]; onToggleSelect: (id: string) => void; onToggleAll: () => void;
}) {
  const allSelected = records.length > 0 && records.every(r => selectedIds.includes(r.id));
  const someSelected = !allSelected && records.some(r => selectedIds.includes(r.id));

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
      <table className="w-full">
        <thead>
          <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
            <th className="px-4 py-3 w-10">
              <div onClick={onToggleAll} style={{
                width: 16, height: 16, borderRadius: 4, cursor: "pointer",
                border: (allSelected || someSelected) ? "none" : "1.5px solid #cbd5e1",
                background: allSelected ? "#2563eb" : someSelected ? "#93c5fd" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {(allSelected || someSelected) && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
            </th>
            {["奖项 / 资质名称", "资质主体", "授予单位", "时间", "级别", "地域", "奖项简介", "证明文件", ...(canEdit ? ["操作"] : [])].map(col => (
              <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {records.map(r => {
            const lm = levelMeta(r.level);
            const eColor = entityColor(r.awardeeEntity);
            const region = computeRegionLabel(r.awardedBy);
            const isChecked = selectedIds.includes(r.id);
            return (
              <tr key={r.id} className="hover:bg-slate-50 transition-colors group" style={isChecked ? { background: "rgba(37,99,235,0.04)" } : {}}>
                <td className="px-4 py-3 w-10" onClick={e => e.stopPropagation()}>
                  <div onClick={() => onToggleSelect(r.id)} style={{
                    width: 16, height: 16, borderRadius: 4, cursor: "pointer",
                    border: isChecked ? "none" : "1.5px solid #cbd5e1",
                    background: isChecked ? "#2563eb" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    {isChecked && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                </td>
                <td className="px-4 py-3 max-w-[200px]">
                  <p className="text-sm font-medium text-slate-800 line-clamp-2">{r.title}</p>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-md" style={{ background: `${eColor}18`, color: eColor }}>{entityShort(r.awardeeEntity)}</span>
                </td>
                <td className="px-4 py-3 max-w-[140px]">
                  <span className="text-sm text-slate-600 line-clamp-2">{r.awardedBy}</span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">{r.awardedAt}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: lm.bg, color: lm.color }}>{r.level || "—"}</span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-xs text-slate-500">{region || "—"}</span>
                </td>
                <td className="px-4 py-3 max-w-[160px]">
                  <p className="text-xs text-slate-500 line-clamp-2">{r.description || "—"}</p>
                </td>
                <td className="px-4 py-3">
                  {r.attachments.length === 0 ? <span className="text-xs text-slate-300">—</span> : (
                    <div className="flex flex-wrap gap-1.5">
                      {r.attachments.map((att, i) => (
                        <button key={i} onClick={() => onPreview(att)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-colors"
                          style={{ background: att.type === "image" ? "rgba(59,130,246,0.08)" : "rgba(245,158,11,0.08)", color: att.type === "image" ? "#2563eb" : "#d97706", border: `1px solid ${att.type === "image" ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.2)"}` }}>
                          {att.type === "image" ? <ImageIcon size={10} /> : <span className="font-bold">PDF</span>}
                          <span className="max-w-[60px] truncate">{att.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </td>
                {canEdit && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => onEdit(r)} className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-500" title="编辑"><Pencil size={13} /></button>
                      <button onClick={() => onDelete(r)} className="p-1.5 rounded-lg hover:bg-red-50 text-red-400" title="删除"><Trash2 size={13} /></button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────
// AwardFormModal — 编辑弹窗（级别替换类别，移除重要性/飞书链接，地域自动计算）
// ─────────────────────────────────────────────

const EMPTY_FORM: Omit<AwardRecord, "id"> = {
  awardedAt: "", awardedBy: "", awardeeEntity: "", title: "",
  level: "国家级", description: "", attachments: [], awardedAtYear: 0,
};

function AwardFormModal({ initial, onClose, onSave }: {
  initial: AwardRecord | null; onClose: () => void;
  onSave: (data: Omit<AwardRecord, "id">) => Promise<void>;
}) {
  const [form, setForm] = useState<Omit<AwardRecord, "id">>(initial ? { ...initial } : { ...EMPTY_FORM });
  const [isSaving, setIsSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [entityOpts, setEntityOpts] = useLocalOptions("award_options_entity", AWARD_OPTION_DEFAULTS.entity);
  const [levelOpts, setLevelOpts] = useLocalOptions("award_options_level", AWARD_OPTION_DEFAULTS.level);
  const [awardedByOpts, setAwardedByOpts] = useLocalOptions("award_options_awardedBy", AWARD_OPTION_DEFAULTS.awardedBy);

  // 自动计算地域标签
  const autoRegion = computeRegionLabel(form.awardedBy);

  function setField<K extends keyof typeof form>(k: K, v: typeof form[K]) {
    setForm(prev => ({ ...prev, [k]: v }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setFormError("奖项/资质名称为必填项"); return;
    }
    if (form.awardedAt.trim() && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(form.awardedAt.trim())) {
      setFormError("授予时间格式须为 YYYY、YYYY-MM 或 YYYY-MM-DD"); return;
    }
    setIsSaving(true); setFormError("");
    try {
      const year = parseInt(form.awardedAt.slice(0, 4), 10);
      await onSave({ ...form, awardedAtYear: isNaN(year) ? 0 : year });
      onClose();
    } catch (err) { setFormError((err as Error).message ?? "保存失败，请重试"); }
    finally { setIsSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[92vh] flex flex-col" style={{ border: "1px solid #e2e8f0" }}>
        <div className="flex items-center justify-between px-6 py-5 flex-shrink-0" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h2 className="text-base font-semibold text-slate-800">{initial ? "编辑奖项" : "新增奖项"}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* 奖项名称 */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">奖项 / 资质名称 <span className="text-red-500">*</span></label>
              <input value={form.title} onChange={e => setField("title", e.target.value)}
                placeholder="例：国家级专精特新「小巨人」企业"
                className="w-full px-3 py-2.5 text-sm rounded-xl outline-none text-slate-800 placeholder-slate-400"
                style={{ border: "1px solid #e2e8f0" }} />
            </div>

            {/* 资质主体 + 级别 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">资质主体</label>
                <CreatableSelect value={form.awardeeEntity} onChange={v => setField("awardeeEntity", v)} options={entityOpts} onOptionsChange={setEntityOpts} placeholder="选择或输入主体名称…" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">级别</label>
                <CreatableSelect value={form.level} onChange={v => setField("level", v)} options={levelOpts} onOptionsChange={setLevelOpts} placeholder="选择或输入级别…" />
              </div>
            </div>

            {/* 授予单位 + 授予时间 */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">授予单位</label>
                <CreatableSelect value={form.awardedBy} onChange={v => setField("awardedBy", v)} options={awardedByOpts} onOptionsChange={setAwardedByOpts} placeholder="选择或输入授予单位…" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">授予时间</label>
                <FlexibleDateInput value={form.awardedAt} onChange={v => setField("awardedAt", v)} />
              </div>
            </div>

            {/* 地域标签（自动计算，只读展示） */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">地域标签 <span className="text-xs text-slate-400 font-normal">（根据授予单位自动识别）</span></label>
              <div className="px-3 py-2.5 rounded-xl text-sm" style={{ border: "1px solid #e2e8f0", background: "#f8fafc", color: autoRegion ? "#1e293b" : "#94a3b8" }}>
                <MapPin size={13} className="inline mr-1.5 text-slate-400" />
                {autoRegion || "将根据授予单位自动识别地域"}
              </div>
            </div>

            {/* 简介 */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1.5">奖项简介</label>
              <textarea value={form.description ?? ""} onChange={e => setField("description", e.target.value)}
                rows={2} placeholder="简要描述获奖背景和意义..."
                className="w-full px-3 py-2.5 text-sm rounded-xl outline-none text-slate-800 placeholder-slate-400 resize-none"
                style={{ border: "1px solid #e2e8f0" }} />
            </div>

            {/* 获奖证明附件 */}
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-2">获奖证明附件</label>
              <AttachmentUploader attachments={form.attachments} onChange={atts => setField("attachments", atts)} />
            </div>

            {formError && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-red-600" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <AlertTriangle size={14} className="flex-shrink-0" />{formError}
              </div>
            )}
          </form>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 flex-shrink-0" style={{ borderTop: "1px solid #f1f5f9" }}>
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-600 rounded-xl hover:bg-slate-100">取消</button>
          <button onClick={handleSubmit} disabled={isSaving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium text-white rounded-xl disabled:opacity-60"
            style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}>
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// AwardsDashboard — 数据大屏（重构 KPI + 3 饼图 + 点击联动）
// ─────────────────────────────────────────────

interface PieDatum { name: string; value: number; }

function DonutPieChart({ title, subtitle, data, colors, onClick }: {
  title: string; subtitle: string; data: PieDatum[]; colors: string[];
  onClick?: (name: string) => void;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
      <p className="text-sm font-semibold text-slate-700 mb-0.5">{title}</p>
      <p className="text-xs text-slate-400 mb-4">{subtitle}</p>
      {data.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-slate-300 text-sm">暂无数据</div>
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative flex-shrink-0" style={{ width: 140, height: 140 }}>
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={data} cx="50%" cy="50%" innerRadius={44} outerRadius={64} paddingAngle={3} dataKey="value" stroke="none"
                  onClick={(d: { name?: string }) => d.name && onClick?.(d.name)}
                  style={{ cursor: onClick ? "pointer" : "default" }}>
                  {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                  formatter={(v: unknown) => [`${v} 项`, "数量"]} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-xl font-bold text-slate-800 leading-none">{total}</span>
              <span className="text-xs text-slate-400 mt-0.5">总计</span>
            </div>
          </div>
          <div className="flex-1 space-y-2 min-w-0">
            {data.slice(0, 6).map((d, i) => {
              const pct = total > 0 ? ((d.value / total) * 100).toFixed(0) : 0;
              return (
                <div key={i} className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => onClick?.(d.name)}>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: colors[i % colors.length] }} />
                  <span className="text-xs text-slate-600 flex-1 truncate">{d.name}</span>
                  <span className="text-xs font-semibold text-slate-700">{d.value}</span>
                  <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {onClick && data.length > 0 && <p className="text-xs text-slate-400 mt-3 text-center">点击图表区域或图例可筛选卡片视图</p>}
    </div>
  );
}

// ─────────────────────────────────────────────
// buildAwardTrend — 客户端趋势数据计算
// ─────────────────────────────────────────────

type TrendRange = "week" | "30days" | "by-month" | "by-year";
const _pad = (n: number) => String(n).padStart(2, "0");

function buildAwardTrend(
  awards: AwardRecord[],
  range: TrendRange,
): Array<{ label: string; count: number; growthRate: number | null }> {
  const today = new Date();
  const labels: string[] = [];
  const cntMap = new Map<string, number>();

  if (range === "week" || range === "30days") {
    const days = range === "week" ? 7 : 30;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const key = `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
      labels.push(key); cntMap.set(key, 0);
    }
    for (const a of awards) {
      const at = a.awardedAt ?? "";
      if (at.length >= 10) {
        const key = at.slice(0, 10);
        if (cntMap.has(key)) cntMap.set(key, (cntMap.get(key) ?? 0) + 1);
      }
    }
  } else if (range === "by-year") {
    const years = awards.map(a => parseInt((a.awardedAt ?? "").slice(0, 4), 10)).filter(y => y > 1990 && y <= today.getFullYear() + 1);
    if (years.length === 0) return [];
    const minY = Math.min(...years), maxY = Math.max(...years);
    for (let y = minY; y <= maxY; y++) { const key = String(y); labels.push(key); cntMap.set(key, 0); }
    for (const a of awards) {
      const y = (a.awardedAt ?? "").slice(0, 4);
      if (y && cntMap.has(y)) cntMap.set(y, (cntMap.get(y) ?? 0) + 1);
    }
  } else {
    // by-month
    const months = awards
      .map(a => (a.awardedAt ?? "").slice(0, 7))
      .filter(m => /^\d{4}-\d{2}$/.test(m));
    if (months.length === 0) return [];
    const sorted = [...new Set(months)].sort();
    const [minM, maxM] = [sorted[0], sorted[sorted.length - 1]];
    const [minY, minMo] = minM.split("-").map(Number);
    const [maxY, maxMo] = maxM.split("-").map(Number);
    let cy = minY, cm = minMo;
    while (cy < maxY || (cy === maxY && cm <= maxMo)) {
      const key = `${cy}-${_pad(cm)}`; labels.push(key); cntMap.set(key, 0);
      cm++; if (cm > 12) { cm = 1; cy++; }
    }
    for (const a of awards) {
      const m = (a.awardedAt ?? "").slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(m) && cntMap.has(m)) cntMap.set(m, (cntMap.get(m) ?? 0) + 1);
    }
  }

  const raw = labels.map(label => ({ label, count: cntMap.get(label) ?? 0 }));
  return raw.map((item, i) => {
    const prev = i > 0 ? raw[i - 1].count : null;
    const growthRate = (prev === null || prev === 0) ? null
      : Number(((item.count - prev) / prev * 100).toFixed(1));
    return { ...item, growthRate };
  });
}

function AwardsDashboard({ filteredAwards, onChartClick }: {
  filteredAwards: AwardRecord[];
  onChartClick:   (filterKey: "level" | "region" | "awardedBy", value: string) => void;
}) {
  const [trendRange, setTrendRange] = useState<TrendRange>("by-year");

  const levelDistData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of filteredAwards) { const k = a.level || "未分类"; map[k] = (map[k] ?? 0) + 1; }
    const LEVEL_ORDER = ["国家级", "省级", "市级", "区级", "板块"];
    return Object.entries(map)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => {
        const ai = LEVEL_ORDER.indexOf(a.name);
        const bi = LEVEL_ORDER.indexOf(b.name);
        if (ai !== -1 && bi !== -1) return ai - bi;   // 均在列表内：按定义顺序
        if (ai !== -1) return -1;                       // a 在列表内，b 不在：a 靠前
        if (bi !== -1) return 1;                        // b 在列表内，a 不在：b 靠前
        return b.value - a.value;                       // 均不在列表（未分类等）：按数量降序
      });
  }, [filteredAwards]);

  const issuerDistData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of filteredAwards) map[a.awardedBy] = (map[a.awardedBy] ?? 0) + 1;
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [filteredAwards]);

  const regionDistData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of filteredAwards) { const r = computeRegionLabel(a.awardedBy) || "其他"; map[r] = (map[r] ?? 0) + 1; }
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filteredAwards]);

  const highLevelCount = useMemo(
    () => filteredAwards.filter(a => a.level === "国家级" || a.level === "省级").length,
    [filteredAwards]
  );

  const trendData = useMemo(() => buildAwardTrend(filteredAwards, trendRange), [filteredAwards, trendRange]);

  // 区间环比：前半段 vs 后半段
  const halfIdx = Math.floor(trendData.length / 2);
  const prevHalfTotal = trendData.slice(0, halfIdx).reduce((s, p) => s + p.count, 0);
  const currHalfTotal = trendData.slice(halfIdx).reduce((s, p) => s + p.count, 0);
  const periodGrowth: number | null = prevHalfTotal === 0 ? null
    : Number(((currHalfTotal - prevHalfTotal) / prevHalfTotal * 100).toFixed(1));
  const intervalTotal = trendData.reduce((s, p) => s + p.count, 0);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendTip = (({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const count = (payload[0]?.value as number) ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gr = (payload[0]?.payload as any)?.growthRate as number | null | undefined;
    const isPos = typeof gr === "number" && gr >= 0;
    const isNeg = typeof gr === "number" && gr < 0;
    return (
      <div className="bg-white rounded-xl shadow-lg px-3 py-2.5 text-xs" style={{ border: "1px solid #e2e8f0", minWidth: 140 }}>
        <p className="font-semibold text-slate-700 mb-1.5">{String(label)}</p>
        <p className="flex justify-between gap-4"><span className="text-slate-500">新增荣誉</span><span className="font-bold text-slate-800">{count}</span></p>
        {typeof gr === "number" && (
          <p className={`flex justify-between gap-4 mt-0.5 ${isPos ? "text-red-500" : isNeg ? "text-emerald-500" : "text-slate-400"}`}>
            <span>环比</span>
            <span className="font-semibold">{isPos ? `+${gr}%` : `${gr}%`}</span>
          </p>
        )}
      </div>
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

  return (
    <div className="space-y-6">
      {/* KPI 汇总行 */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: "当前筛选总数", value: filteredAwards.length, unit: "项", color: "#3b82f6", bg: "rgba(59,130,246,0.06)" },
          { label: "高级别奖项",   value: highLevelCount,        unit: "项", color: "#8b5cf6", bg: "rgba(139,92,246,0.06)", hint: "国家级 + 省级" },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-2xl px-5 py-4 shadow-sm border border-gray-100">
            <p className="text-xs text-slate-400 mb-1">{kpi.label}{"hint" in kpi && kpi.hint && <span className="ml-1 text-slate-300">({kpi.hint})</span>}</p>
            <div className="flex items-end gap-1">
              <span className="text-2xl font-bold" style={{ color: kpi.color }}>{kpi.value}</span>
              <span className="text-sm pb-0.5" style={{ color: kpi.color }}>{kpi.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 荣誉增长趋势 — 升级版 */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100">
        {/* 顶部控制台 */}
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-700">荣誉增长趋势</p>
            <p className="text-xs text-slate-400 mt-0.5">历年新增奖项走势 · 点击数据点跳转卡片视图</p>
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg" style={{ background: "#f1f5f9" }}>
            {(["week", "30days", "by-month", "by-year"] as TrendRange[]).map(r => (
              <button key={r} onClick={() => setTrendRange(r)}
                className="text-xs px-3 py-1.5 rounded-md font-medium transition-all"
                style={trendRange === r
                  ? { background: "white", color: "#2563eb", boxShadow: "0 1px 3px rgba(0,0,0,0.1)" }
                  : { color: "#94a3b8" }}>
                {{ week: "近7天", "30days": "近30天", "by-month": "按月", "by-year": "按年" }[r]}
              </button>
            ))}
          </div>
        </div>

        {/* 区间 KPI 环比 Banner */}
        <div className="flex items-center gap-3 my-4 px-1">
          <div className="flex-1 rounded-xl px-4 py-2.5 flex items-center gap-3"
            style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.14)" }}>
            <span className="text-xs text-slate-500 flex-shrink-0">区间荣誉总量</span>
            <span className="text-xl font-black tabular-nums text-blue-600">{intervalTotal}</span>
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

        {trendData.length < 2 ? (
          <div className="flex items-center justify-center h-52 text-slate-300 text-sm">数据不足，至少需要 2 个时间节点</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <AreaChart data={trendData} margin={{ top: 5, right: 12, left: -20, bottom: 0 }} style={{ cursor: "pointer" }} onClick={(d: any) => { if (d?.activeLabel) onChartClick("level", ""); }}>
              <defs>
                <linearGradient id="areaGradAwards" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.22} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false}
                tickFormatter={(v: string) =>
                  (trendRange === "week" || trendRange === "30days")
                    ? (() => { const p = v.split("-"); return `${p[1]}/${p[2]}`; })()
                    : v
                }
                interval={
                  trendRange === "by-month" ? Math.max(0, Math.floor(trendData.length / 12) - 1)
                  : trendRange === "30days"  ? 2
                  : 0
                } />
              <YAxis tick={{ fontSize: 9, fill: "#94a3b8" }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip content={trendTip} />
              <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2.5} fill="url(#areaGradAwards)"
                dot={trendData.length <= 36 ? { r: 3, fill: "#3b82f6", strokeWidth: 0 } : false}
                activeDot={{ r: 6, stroke: "#3b82f6", strokeWidth: 2, fill: "white" }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 三个饼图 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <DonutPieChart title="按级别分布" subtitle="各级别奖项占比" data={levelDistData} colors={PIE_COLORS} onClick={name => onChartClick("level", name)} />
        <DonutPieChart title="按授予单位分布" subtitle="Top 发证机构占比" data={issuerDistData} colors={["#3b82f6","#10b981","#f59e0b","#8b5cf6","#06b6d4","#ef4444","#ec4899","#84cc16"]} onClick={name => onChartClick("awardedBy", name)} />
        <DonutPieChart title="按地域分布" subtitle="各地域奖项占比" data={regionDistData} colors={["#22c55e","#f59e0b","#ef4444","#3b82f6","#8b5cf6","#06b6d4","#ec4899","#84cc16"]} onClick={name => onChartClick("region", name)} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// BulkImportModal
// ─────────────────────────────────────────────

type ImportStep = "upload" | "mapping" | "preview";

interface MappedRow {
  title: string; awardedAt: string; awardedBy: string; awardeeEntity: string;
  level?: string; regionLabel?: string; description?: string; isDuplicate?: boolean;
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

function BulkImportModal({ existingAwards, onClose, onImported }: {
  existingAwards: AwardRecord[]; onClose: () => void; onImported: () => void;
}) {
  const [mode, setMode] = useState<"file" | "feishu">("file");
  const [step, setStep] = useState<ImportStep>("upload");
  const [rawColumns, setRawColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [fieldMap, setFieldMap] = useState<Record<string, string | null>>({});
  const [preview, setPreview] = useState<MappedRow[]>([]);
  const [feishuUrl, setFeishuUrl] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isMapping, setIsMapping] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [parseError, setParseError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "preview") {
      setSelectedIdx(new Set(preview.map((_, i) => i).filter(i => !preview[i].isDuplicate && preview[i].title.trim())));
    }
  }, [step, preview]);

  const selectableIdxs = preview.map((_, i) => i).filter(i => !preview[i].isDuplicate && preview[i].title.trim());
  const allSelected = selectableIdxs.length > 0 && selectableIdxs.every(i => selectedIdx.has(i));
  const someSelected = selectableIdxs.some(i => selectedIdx.has(i)) && !allSelected;

  function toggleAll() { setSelectedIdx(allSelected ? new Set() : new Set(selectableIdxs)); }
  function toggleRow(i: number) { setSelectedIdx(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; }); }

  async function handleFeishuParse() {
    const parsed = parseBitableUrl(feishuUrl.trim());
    if (!parsed) { setParseError("无法识别链接格式"); return; }
    setIsParsing(true); setParseError("");
    try {
      const res = await fetch("/api/awards/parse-feishu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(parsed) });
      const data = await res.json() as { records?: MappedRow[]; error?: string };
      if (!res.ok) { setParseError(data.error ?? "解析失败"); return; }
      const records = (data.records ?? []).map(r => ({ ...r, isDuplicate: existingAwards.some(a => a.title.trim().toLowerCase() === (r.title ?? "").trim().toLowerCase() && a.awardedAtYear === Number((r.awardedAt ?? "").match(/(\d{4})/)?.[1] ?? 0)) }));
      if (!records.length) { setParseError("未解析到任何记录"); return; }
      setPreview(records); setStep("preview");
    } catch { setParseError("网络错误，请重试"); } finally { setIsParsing(false); }
  }

  function parseFile(file: File) {
    setParseError("");
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1 });
        if (!json.length) { setParseError("文件内容为空"); return; }
        const cols = (json[0] as string[]).map(String);
        const rows = json.slice(1).map(r => (r as string[]).map(c => String(c ?? "")));
        setRawColumns(cols); setRawRows(rows);
        runAIMapping(cols, rows.slice(0, 2));
      } catch { setParseError("文件解析失败，请确认格式为 .xlsx 或 .csv"); }
    };
    reader.readAsArrayBuffer(file);
  }

  async function runAIMapping(cols: string[], sample: string[][]) {
    setIsMapping(true); setStep("mapping");
    try {
      const res = await fetch("/api/awards/import/map", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ columns: cols, sampleRows: sample }) });
      const d = await res.json();
      setFieldMap(d.mapping ?? {});
      applyMapping(cols, rawRows.length ? rawRows : sample, d.mapping ?? {});
    } catch { setParseError("AI 映射失败，已使用默认顺序映射"); } finally { setIsMapping(false); }
  }

  function applyMapping(cols: string[], rows: string[][], mapping: Record<string, string | null>) {
    const colIndex: Record<string, number> = {};
    cols.forEach((c, i) => { colIndex[c] = i; });
    const get = (row: string[], field: string): string => {
      const col = Object.entries(mapping).find(([, v]) => v === field)?.[0];
      return col !== undefined && colIndex[col] !== undefined ? (row[colIndex[col]] ?? "") : "";
    };
    const mapped: MappedRow[] = rows.filter(r => r.some(c => c.trim())).map(r => {
      const title = get(r, "title"); const awardedAt = get(r, "awardedAt");
      const awardedBy = get(r, "awardedBy"); const awardeeEntity = get(r, "awardeeEntity");
      const year = Number(awardedAt.match(/(\d{4})/)?.[1] ?? 0);
      const isDuplicate = existingAwards.some(a => a.title.trim().toLowerCase() === title.trim().toLowerCase() && a.awardedAtYear === year);
      return { title, awardedAt, awardedBy, awardeeEntity, level: get(r, "level") || get(r, "category") || undefined, description: get(r, "description") || undefined, isDuplicate };
    });
    setPreview(mapped); setStep("preview");
  }

  function handleDrop(e: React.DragEvent) { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files[0]; if (file) parseFile(file); }

  async function handleImport() {
    const toInsert = [...selectedIdx].sort((a, b) => a - b).map(i => preview[i]);
    if (!toInsert.length) return;
    setIsImporting(true);
    try {
      const res = await fetch("/api/awards/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ records: toInsert }) });
      const d = await res.json() as { inserted?: number; duplicates?: number; error?: string };
      if (!res.ok) { setParseError(d.error ?? "导入失败，请重试"); return; }
      setSuccessMsg(`成功导入 ${d.inserted ?? 0} 条` + (d.duplicates ? `，跳过重复 ${d.duplicates} 条` : ""));
      setTimeout(() => onImported(), 1500);
    } catch { setParseError("导入失败，请重试"); } finally { setIsImporting(false); }
  }

  const selectedCount = selectedIdx.size;
  const validCount = preview.filter(r => !r.isDuplicate && r.title.trim()).length;
  const dupCount = preview.filter(r => r.isDuplicate).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: "1px solid #e2e8f0" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}>
              <FileSpreadsheet size={16} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">一键批量导入</h2>
              <p className="text-xs text-slate-400">{step === "upload" ? "上传文件或粘贴飞书链接" : step === "mapping" ? "AI 正在智能映射字段..." : `预览 ${preview.length} 条记录`}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 transition-colors"><X size={16} className="text-slate-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === "upload" && (
            <div className="space-y-4">
              <div className="flex gap-2 p-1 rounded-xl" style={{ background: "#f1f5f9" }}>
                {(["file", "feishu"] as const).map(m => (
                  <button key={m} onClick={() => setMode(m)}
                    className="flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all"
                    style={mode === m ? { background: "white", color: "#1e293b", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" } : { color: "#64748b" }}>
                    {m === "file" ? <><FileSpreadsheet size={13} />本地文件</> : <><Link2 size={13} />飞书云文档</>}
                  </button>
                ))}
              </div>
              {mode === "file" ? (
                <div onDragOver={e => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  className="flex flex-col items-center justify-center py-12 rounded-2xl cursor-pointer transition-all"
                  style={{ border: `2px dashed ${isDragging ? "#2563eb" : "#cbd5e1"}`, background: isDragging ? "rgba(37,99,235,0.04)" : "#fafafa" }}>
                  <Upload size={32} className="mb-3" style={{ color: isDragging ? "#2563eb" : "#cbd5e1" }} />
                  <p className="text-sm font-medium text-slate-600">拖拽上传或点击选择文件</p>
                  <p className="text-xs text-slate-400 mt-1">支持 .xlsx / .csv 格式，首行须为列名</p>
                  <input ref={fileRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={e => { if (e.target.files?.[0]) parseFile(e.target.files[0]); }} />
                </div>
              ) : (
                <div className="space-y-3">
                  <input type="url" value={feishuUrl} onChange={e => setFeishuUrl(e.target.value)} placeholder="https://momenta.feishu.cn/sheets/..." className="w-full px-3 py-2.5 rounded-xl text-sm outline-none" style={{ border: "1px solid #e2e8f0" }} />
                  <button disabled={!feishuUrl.trim() || isParsing} onClick={() => void handleFeishuParse()}
                    className="w-full py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-40 flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}>
                    {isParsing ? <><Loader2 size={14} className="animate-spin" />解析中…</> : "读取飞书表格"}
                  </button>
                </div>
              )}
              {parseError && <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-red-600" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}><AlertCircle size={14} />{parseError}</div>}
              <div className="text-xs text-slate-400">推荐列名：奖项名称 / 获奖时间 / 颁发单位 / 获奖主体 / 级别 / 地区 / 备注</div>
            </div>
          )}

          {step === "mapping" && (
            <div className="flex flex-col items-center justify-center py-16 space-y-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.15))" }}>
                <Sparkles size={28} style={{ color: "#f59e0b" }} className={isMapping ? "animate-pulse" : ""} />
              </div>
              <p className="text-base font-semibold text-slate-700">AI 智能字段映射中...</p>
              <Loader2 size={20} className="animate-spin text-slate-300" />
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                {[{ label: "总行数", value: preview.length, color: "#2563eb" }, { label: "可导入", value: validCount, color: "#22c55e" }, { label: "重复跳过", value: dupCount, color: "#f59e0b" }].map(s => (
                  <div key={s.label} className="rounded-xl px-4 py-3 text-center" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                    <p className="text-xl font-bold" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #e2e8f0", maxHeight: "42vh", overflowY: "auto" }}>
                <table className="w-full text-sm">
                  <thead className="sticky top-0" style={{ background: "#f8fafc" }}>
                    <tr>
                      <th className="px-3 py-2.5 w-8">
                        <div onClick={toggleAll} style={{ width: 15, height: 15, borderRadius: 4, cursor: "pointer", border: allSelected || someSelected ? "none" : "1.5px solid #cbd5e1", background: allSelected ? "#2563eb" : someSelected ? "#93c5fd" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {(allSelected || someSelected) && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </div>
                      </th>
                      {["状态", "奖项名称", "时间", "授予单位", "主体"].map(h => <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">{h}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {preview.map((r, i) => {
                      const selectable = !r.isDuplicate && r.title.trim();
                      const checked = selectedIdx.has(i);
                      return (
                        <tr key={i} className={r.isDuplicate ? "bg-red-50" : checked ? "" : "hover:bg-slate-50"} style={checked && !r.isDuplicate ? { background: "rgba(37,99,235,0.04)" } : undefined} onClick={() => { if (selectable) toggleRow(i); }}>
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            {selectable && <div onClick={() => toggleRow(i)} style={{ width: 15, height: 15, borderRadius: 4, cursor: "pointer", border: checked ? "none" : "1.5px solid #cbd5e1", background: checked ? "#2563eb" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                              {checked && <svg width="10" height="10" viewBox="0 0 10 10"><polyline points="1.5,5 4,7.5 8.5,2.5" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                            </div>}
                          </td>
                          <td className="px-3 py-2">{r.isDuplicate ? <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(239,68,68,0.1)", color: "#dc2626" }}>重复</span> : <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a" }}>新增</span>}</td>
                          <td className="px-3 py-2 font-medium text-slate-800 max-w-xs truncate">{r.title || "—"}</td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.awardedAt || "—"}</td>
                          <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{r.awardedBy || "—"}</td>
                          <td className="px-3 py-2 text-slate-500">{r.awardeeEntity || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {parseError && <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-red-600" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}><AlertCircle size={14} />{parseError}</div>}
            </div>
          )}

          {successMsg && <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm text-green-700" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}><CheckCircle2 size={14} />{successMsg}</div>}
        </div>

        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: "1px solid #e2e8f0" }}>
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm text-slate-500 hover:bg-slate-100 transition-colors">取消</button>
          <div className="flex items-center gap-2">
            {step === "preview" && <button onClick={() => setStep("upload")} className="px-4 py-2 rounded-xl text-sm text-slate-500 hover:bg-slate-100 transition-colors">重新上传</button>}
            {step === "preview" && selectedCount > 0 && (
              <button onClick={() => void handleImport()} disabled={isImporting || !!successMsg}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}>
                {isImporting ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                批量导入 {selectedCount} 条记录
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// PermissionsContent — 权限分配内容（用于页面配置弹窗 Tab）
// ─────────────────────────────────────────────

function PermissionsContent() {
  const [depts, setDepts] = useState<DeptPerm[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/awards/permissions").then(r => r.json()).then(d => setDepts(d.items ?? [])).catch(console.error).finally(() => setIsLoading(false));
  }, []);

  async function handleChange(dept: DeptPerm, newLevel: "VIEW" | "EDIT" | "NONE") {
    setSaving(dept.departmentId);
    try {
      if (newLevel === "NONE") {
        if (dept.permId) await fetch(`/api/awards/permissions/${dept.permId}`, { method: "DELETE" });
        setDepts(prev => prev.map(d => d.departmentId === dept.departmentId ? { ...d, permId: null, permLevel: null } : d));
      } else {
        const res = await fetch("/api/awards/permissions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ departmentId: dept.departmentId, permLevel: newLevel }) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "授权失败");
        setDepts(prev => prev.map(d => d.departmentId === dept.departmentId ? { ...d, permId: data.id, permLevel: newLevel } : d));
      }
    } catch (err) { alert((err as Error).message); } finally { setSaving(null); }
  }

  const permBadge = (level: "VIEW" | "EDIT" | null) => {
    if (level === "EDIT") return { label: "可编辑", color: "#22c55e", icon: <Pencil size={10} /> };
    if (level === "VIEW") return { label: "可查看", color: "#3b82f6", icon: <Eye size={10} /> };
    return { label: "无权限", color: "#94a3b8", icon: <EyeOff size={10} /> };
  };

  return (
    <div className="space-y-3">
      <div className="px-4 py-3 rounded-xl text-xs text-slate-600 leading-relaxed" style={{ background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)" }}>
        <p className="font-medium text-purple-700 mb-1">权限规则说明</p>
        PA 部门管理员默认拥有全部 EDIT 权限，无需配置。下方仅展示<strong>业务配合部门</strong>，可按需授予「可查看」或「可编辑」权限。
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: "55vh" }}>
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin mr-2" />加载中...</div>
        ) : depts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-slate-400"><Building2 size={28} className="mb-2 opacity-30" /><p className="text-sm">暂无业务部门记录</p></div>
        ) : (
          <div className="space-y-2">
            {depts.map(dept => {
              const badge = permBadge(dept.permLevel);
              const isBusy = saving === dept.departmentId;
              return (
                <div key={dept.departmentId} className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50" style={{ border: "1px solid #e2e8f0" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "#f1f5f9" }}><Building2 size={13} className="text-slate-500" /></div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700 truncate">{dept.departmentName}</p>
                      <div className="flex items-center gap-1 mt-0.5">{badge.icon}<span className="text-xs" style={{ color: badge.color }}>{badge.label}</span></div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
                    {(["NONE", "VIEW", "EDIT"] as const).map(lvl => {
                      const active = (dept.permLevel ?? "NONE") === lvl;
                      const colors: Record<string, { bg: string; text: string }> = {
                        NONE: { bg: active ? "#f1f5f9" : "#f8fafc", text: active ? "#475569" : "#94a3b8" },
                        VIEW: { bg: active ? "rgba(59,130,246,0.12)" : "#f8fafc", text: active ? "#2563eb" : "#94a3b8" },
                        EDIT: { bg: active ? "rgba(34,197,94,0.12)" : "#f8fafc", text: active ? "#16a34a" : "#94a3b8" },
                      };
                      return (
                        <button key={lvl} disabled={isBusy} onClick={() => handleChange(dept, lvl)}
                          className="text-xs px-2 py-1 rounded-lg font-medium transition-all disabled:opacity-50"
                          style={{ background: colors[lvl].bg, color: colors[lvl].text, border: `1px solid ${active ? "currentColor" : "#e2e8f0"}`, opacity: active ? 1 : 0.6 }}>
                          {lvl === "NONE" ? "无" : lvl === "VIEW" ? "查看" : "编辑"}
                        </button>
                      );
                    })}
                    {isBusy && <Loader2 size={13} className="animate-spin text-slate-400 ml-1" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <p className="text-center text-xs text-slate-400 pt-1">所有权限变更实时生效，并写入审计日志</p>
    </div>
  );
}

// ─────────────────────────────────────────────
// DeleteConfirmDialog
// ─────────────────────────────────────────────

function DeleteConfirmDialog({ award, onCancel, onConfirm, isDeleting }: {
  award: AwardRecord; onCancel: () => void; onConfirm: () => void; isDeleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center"><Trash2 size={16} className="text-red-500" /></div>
          <div><p className="font-semibold text-slate-800 text-sm">确认删除</p><p className="text-xs text-slate-500">此操作将软删除该记录</p></div>
        </div>
        <p className="text-sm text-slate-600 mb-5 px-3 py-2.5 rounded-lg bg-slate-50" style={{ border: "1px solid #e2e8f0" }}>「{award.title}」</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 text-sm rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200">取消</button>
          <button onClick={onConfirm} disabled={isDeleting}
            className="flex-1 py-2.5 text-sm rounded-xl text-white font-medium disabled:opacity-60 flex items-center justify-center gap-2"
            style={{ background: "#ef4444" }}>
            {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {isDeleting ? "删除中..." : "确认删除"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// BatchDeleteConfirmDialog
// ─────────────────────────────────────────────

function BatchDeleteConfirmDialog({ count, onCancel, onConfirm, isDeleting }: {
  count: number; onCancel: () => void; onConfirm: () => void; isDeleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center"><Trash2 size={16} className="text-red-500" /></div>
          <div>
            <p className="font-semibold text-slate-800 text-sm">确认批量删除</p>
            <p className="text-xs text-slate-500">此操作不可恢复</p>
          </div>
        </div>
        <p className="text-sm text-slate-600 mb-5 px-3 py-2.5 rounded-lg bg-slate-50" style={{ border: "1px solid #e2e8f0" }}>
          确定要删除选中的 <strong>{count}</strong> 个奖项吗？此操作不可恢复。
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 text-sm rounded-xl text-slate-600 bg-slate-100 hover:bg-slate-200">取消</button>
          <button onClick={onConfirm} disabled={isDeleting}
            className="flex-1 py-2.5 text-sm rounded-xl text-white font-medium disabled:opacity-60 flex items-center justify-center gap-2"
            style={{ background: "#ef4444" }}>
            {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            {isDeleting ? "删除中..." : `删除 ${count} 个`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// 页面主体
// ─────────────────────────────────────────────

export default function AwardsPage() {
  const router = useRouter();
  const [awards, setAwards] = useState<AwardRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [apiError, setApiError] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingAward, setEditingAward] = useState<AwardRecord | null>(null);
  const [deletingAward, setDeletingAward] = useState<AwardRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [previewAtt, setPreviewAtt] = useState<Attachment | null>(null);
  const [detailTarget, setDetailTarget] = useState<AwardRecord | null>(null);
  const [showImport, setShowImport] = useState(false);

  // 多选 & 批量删除
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [isBatchDeleting, setIsBatchDeleting] = useState(false);

  const [viewMode, setViewMode] = useState<"dashboard" | "card" | "table">("card");

  // 筛选状态
  const [searchText, setSearchText]         = useState("");
  const [filterEntity, setFilterEntity]     = useState("ALL");
  const [filterLevel, setFilterLevel]       = useState("ALL");    // 级别
  const [filterRegion, setFilterRegion]     = useState("ALL");    // 地域
  const [filterAwardedBy, setFilterAwardedBy] = useState("ALL"); // 授予单位（图表点击联动）
  const [filterStartYear, setFilterStartYear] = useState("ALL"); // 开始年份
  const [filterEndYear, setFilterEndYear]   = useState("ALL");    // 结束年份

  const debouncedSearch = useDebounce(searchText, 300);

  // 从 URL 参数初始化筛选状态（用于图表点击联动）
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    if (p.get("level")) setFilterLevel(p.get("level")!);
    if (p.get("region")) setFilterRegion(p.get("region")!);
    if (p.get("awardedBy")) setFilterAwardedBy(p.get("awardedBy")!);
    if (p.get("view") === "card" || p.get("view") === "table" || p.get("view") === "dashboard") {
      setViewMode(p.get("view") as "card" | "table" | "dashboard");
    }
  }, []);

  const fetchAwards = useCallback(async () => {
    setIsLoading(true); setApiError("");
    try {
      const res = await fetch("/api/awards");
      if (res.status === 403) { router.replace("/dashboard/my-tasks"); return; }
      if (!res.ok) throw new Error("请求失败");
      const data = await res.json();
      setAwards(data.items ?? []);
      setCanEdit(data.canEdit ?? false);
      setIsAdmin(data.isAdmin ?? false);
    } catch { setApiError("加载失败，请刷新页面重试"); } finally { setIsLoading(false); }
  }, [router]);

  useEffect(() => { fetchAwards(); }, [fetchAwards]);

  async function handleSave(formData: Omit<AwardRecord, "id">, id?: string) {
    const targetId = id ?? editingAward?.id;
    const isEdit = !!targetId;
    const url = isEdit ? `/api/awards/${targetId}` : "/api/awards";
    const res = await fetch(url, { method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(formData) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "保存失败");
    await fetchAwards();
  }

  async function handleDelete() {
    if (!deletingAward) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/awards/${deletingAward.id}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "删除失败"); }
      setDeletingAward(null); await fetchAwards();
    } catch (err) { alert((err as Error).message); } finally { setIsDeleting(false); }
  }

  function toggleSelectId(id: string) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }
  function toggleSelectAll() {
    setSelectedIds(prev => prev.length === filtered.length ? [] : filtered.map(r => r.id));
  }

  async function handleBatchDelete() {
    if (!selectedIds.length) return;
    setIsBatchDeleting(true);
    try {
      const res = await fetch("/api/awards", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "批量删除失败");
      setSelectedIds([]);
      setShowBatchDeleteConfirm(false);
      await fetchAwards();
    } catch (err) { alert((err as Error).message); } finally { setIsBatchDeleting(false); }
  }

  // 图表点击联动：更新筛选 + 切换到卡片视图 + 更新 URL
  function handleChartClick(filterKey: "level" | "region" | "awardedBy", value: string) {
    if (filterKey === "level") setFilterLevel(value);
    if (filterKey === "region") setFilterRegion(value);
    if (filterKey === "awardedBy") setFilterAwardedBy(value);
    setViewMode("card");
    const params = new URLSearchParams();
    if (value) params.set(filterKey, value);
    params.set("view", "card");
    router.replace(`?${params.toString()}`);
  }

  const allYears = useMemo(
    () => [...new Set(awards.map(a => String(a.awardedAtYear)))].sort((a, b) => Number(b) - Number(a)),
    [awards]
  );

  // 过滤后记录
  const filtered = useMemo(() => {
    const kw = debouncedSearch.toLowerCase().trim();
    return awards.filter(a => {
      if (kw && !a.title.toLowerCase().includes(kw) && !a.awardedBy.toLowerCase().includes(kw) && !a.awardeeEntity.toLowerCase().includes(kw)) return false;
      if (filterEntity   !== "ALL" && !a.awardeeEntity.includes(filterEntity)) return false;
      if (filterLevel    !== "ALL" && (a.level || "未分类") !== filterLevel) return false;
      if (filterStartYear !== "ALL" && a.awardedAtYear < Number(filterStartYear)) return false;
      if (filterEndYear   !== "ALL" && a.awardedAtYear > Number(filterEndYear)) return false;
      if (filterRegion   !== "ALL" && computeRegionLabel(a.awardedBy) !== filterRegion) return false;
      if (filterAwardedBy !== "ALL" && a.awardedBy !== filterAwardedBy) return false;
      return true;
    }).sort((a, b) => b.awardedAtYear - a.awardedAtYear);
  }, [awards, debouncedSearch, filterEntity, filterLevel, filterStartYear, filterEndYear, filterRegion, filterAwardedBy]);

  // 地域数据（用于筛选下拉菜单）
  const regionDistData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of filtered) { const r = computeRegionLabel(a.awardedBy) || "其他"; map[r] = (map[r] ?? 0) + 1; }
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [filtered]);

  const hasActiveFilter = searchText || filterEntity !== "ALL" || filterLevel !== "ALL" || filterStartYear !== "ALL" || filterEndYear !== "ALL" || filterRegion !== "ALL" || filterAwardedBy !== "ALL";

  function clearFilters() {
    setSearchText(""); setFilterEntity("ALL"); setFilterLevel("ALL");
    setFilterStartYear("ALL"); setFilterEndYear("ALL"); setFilterRegion("ALL"); setFilterAwardedBy("ALL");
    router.replace("?");
  }

  // 筛选条件变化时清空已选项
  useEffect(() => { setSelectedIds([]); }, [debouncedSearch, filterEntity, filterLevel, filterStartYear, filterEndYear, filterRegion, filterAwardedBy]);
  useEffect(() => { if (viewMode === "dashboard") setSelectedIds([]); }, [viewMode]);

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      {/* Overlays */}
      {previewAtt && <ImagePreviewModal attachment={previewAtt} onClose={() => setPreviewAtt(null)} />}
      {showForm && (
        <AwardFormModal
          initial={editingAward}
          onClose={() => { setShowForm(false); setEditingAward(null); }}
          onSave={handleSave}
        />
      )}
      {deletingAward && (
        <DeleteConfirmDialog award={deletingAward} onCancel={() => setDeletingAward(null)} onConfirm={handleDelete} isDeleting={isDeleting} />
      )}
      {showBatchDeleteConfirm && (
        <BatchDeleteConfirmDialog
          count={selectedIds.length}
          onCancel={() => setShowBatchDeleteConfirm(false)}
          onConfirm={() => void handleBatchDelete()}
          isDeleting={isBatchDeleting}
        />
      )}
      {showImport && (
        <BulkImportModal existingAwards={awards} onClose={() => setShowImport(false)} onImported={() => { setShowImport(false); fetchAwards(); }} />
      )}
      {detailTarget && (
        <AwardDetailDrawer
          record={detailTarget}
          canEdit={canEdit}
          onClose={() => setDetailTarget(null)}
          onSave={(data) => handleSave(data, detailTarget.id)}
          onDelete={r => setDeletingAward(r)}
          onPreview={setPreviewAtt}
        />
      )}

      {/* Header */}
      <PageHeaderWithConfig
        pageId="honor_and_qualifications"
        defaultTitle="企业资质与奖项库"
        defaultDescription="历年政府奖项、资质认证与行业荣誉，证明附件可直接预览"
        canEdit={isAdmin}
        variant="light"
        permissionsContent={isAdmin ? <PermissionsContent /> : undefined}
        rightSlot={
          <div className="flex items-center gap-2">
            {canEdit && (
              <>
                <button onClick={() => setShowImport(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium" style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", color: "#d97706" }}>
                  <FileSpreadsheet size={14} />批量导入
                </button>
                <button onClick={() => { setEditingAward(null); setShowForm(true); }} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium text-white" style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}>
                  <Plus size={14} />新增奖项
                </button>
              </>
            )}
            <button onClick={() => exportCSV(filtered)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm text-slate-600 bg-white hover:bg-slate-50 transition-colors" style={{ border: "1px solid #e2e8f0" }}>
              <Download size={14} />导出清单（{filtered.length}）
            </button>
          </div>
        }
      />

      {/* 批量操作栏 */}
      {selectedIds.length > 0 && canEdit && viewMode !== "dashboard" && (
        <div className="px-8 mb-3">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <span className="text-sm font-medium text-red-600">已选 {selectedIds.length} 项</span>
            <button onClick={() => setShowBatchDeleteConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white"
              style={{ background: "#ef4444" }}>
              <Trash2 size={13} />批量删除
            </button>
            <button onClick={() => setSelectedIds([])} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100">取消选择</button>
          </div>
        </div>
      )}

      {/* 筛选栏 + 视图切换 */}
      <div className="px-8 mb-5 flex flex-wrap items-center gap-3">
        {/* 搜索 */}
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input type="text" placeholder="搜索奖项名称 / 授予单位..." value={searchText}
            onChange={e => setSearchText(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm rounded-xl bg-white outline-none text-slate-700 placeholder-slate-400 w-60"
            style={{ border: "1px solid #e2e8f0" }} />
        </div>

        <Filter size={14} className="text-slate-400" />

        {/* 主体 */}
        <SelectFilter value={filterEntity} onChange={setFilterEntity}
          options={[{ value: "ALL", label: "全部主体" }, { value: "初速度", label: "初速度" }, { value: "魔门塔", label: "魔门塔" }]} />

        {/* 级别 */}
        <SelectFilter value={filterLevel} onChange={setFilterLevel}
          options={[{ value: "ALL", label: "全部级别" }, ...AWARD_OPTION_DEFAULTS.level.map(l => ({ value: l, label: l }))]} />

        {/* 地域 */}
        <SelectFilter value={filterRegion} onChange={v => { setFilterRegion(v); if (v !== "ALL") router.replace(`?region=${encodeURIComponent(v)}&view=card`); }}
          options={[{ value: "ALL", label: "全部地域" }, ...regionDistData.map(r => ({ value: r.name, label: r.name }))]} />

        {/* 开始年份 */}
        <SelectFilter value={filterStartYear} onChange={setFilterStartYear}
          options={[{ value: "ALL", label: "起始年份" }, ...allYears.map(y => ({ value: y, label: `${y} 年起` }))]} />

        {/* 结束年份 */}
        <SelectFilter value={filterEndYear} onChange={setFilterEndYear}
          options={[{ value: "ALL", label: "截止年份" }, ...allYears.map(y => ({ value: y, label: `至 ${y} 年` }))]} />

        {hasActiveFilter && (
          <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100">
            <X size={12} />清除筛选
          </button>
        )}

        <span className="text-xs text-slate-400">共 {filtered.length} 条</span>

        {/* 视图切换 */}
        <div className="ml-auto flex gap-0.5 p-0.5 rounded-xl" style={{ background: "#f1f5f9" }}>
          {(["dashboard", "card", "table"] as const).map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={viewMode === mode ? { background: "white", color: "#1e293b", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" } : { color: "#64748b" }}>
              {mode === "dashboard" && <><BarChart2 size={13} />数据大屏</>}
              {mode === "card"      && <><LayoutGrid size={13} />卡片</>}
              {mode === "table"     && <><Rows3 size={13} />表格</>}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区 */}
      <div className="px-8 pb-8">
        {apiError && (
          <div className="flex items-center gap-3 px-5 py-4 rounded-2xl mb-5 text-red-600" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
            <AlertTriangle size={16} /><p className="text-sm">{apiError}</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 size={28} className="animate-spin mr-3" />加载奖项数据中...
          </div>
        ) : filtered.length === 0 && viewMode !== "dashboard" ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Award size={40} className="mb-3 opacity-30" />
            <p className="text-sm mb-3">{awards.length === 0 ? "暂无奖项记录" : "未找到匹配的奖项"}</p>
            {canEdit && awards.length === 0 && (
              <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-white" style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}>
                <Plus size={14} />新增第一条奖项记录
              </button>
            )}
          </div>
        ) : viewMode === "dashboard" ? (
          <AwardsDashboard
            filteredAwards={filtered}
            onChartClick={handleChartClick}
          />
        ) : viewMode === "card" ? (
          <div className="grid grid-cols-3 gap-4">
            {filtered.map(record => (
              <AwardCard
                key={record.id}
                record={record}
                onClick={() => setDetailTarget(record)}
                onPreview={setPreviewAtt}
                isSelected={selectedIds.includes(record.id)}
                onToggleSelect={canEdit ? () => toggleSelectId(record.id) : undefined}
              />
            ))}
          </div>
        ) : (
          <AwardTableView
            records={filtered}
            canEdit={canEdit}
            onEdit={r => { setEditingAward(r); setShowForm(true); }}
            onDelete={r => setDeletingAward(r)}
            onPreview={setPreviewAtt}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelectId}
            onToggleAll={toggleSelectAll}
          />
        )}
      </div>
    </div>
  );
}
