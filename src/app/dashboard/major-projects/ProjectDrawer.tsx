"use client";

/**
 * 重大项目详情 Drawer（Phase 5）
 *
 * 包含：
 * 1. 基础信息（立项名称 + 飞书负责人卡片）
 * 2. 证明材料（拖拽/粘贴上传 + 图片预览）
 * 3. 项目生命周期管理（4 节点 + 状态预警 + 附件 + 嵌套KPI）
 *    - 考核指标嵌套在START/MID_CHECK/END节点内
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import {
  X, ChevronDown, ChevronRight, Plus, Trash2, Loader2,
  Check, AlertTriangle, Flag, Calendar, Save, User,
  ClipboardList, Paperclip, Target, Pencil, Flame,
  ExternalLink, Upload, Link2,
} from "lucide-react";
import { FeishuUserSelect, type FeishuUser } from "./FeishuUserSelect";
import { type FeishuIdTag } from "@/components/FeishuIdTagInput";
import { FileUploader, type FileItem as OriginalFileItem } from "./FileUploader";
import { DictSelect, DictMultiSelect } from "./DictSelect";

// 扩展 FileItem 以支持飞书云文档
interface FileItem {
  id?: string;
  type?: "local" | "feishu" | "image" | "pdf" | "doc" | "other";
  name: string;
  url: string;
  size?: number;
  uploadedAt?: string;
}

// ── 类型 ──────────────────────────────────────────────────────────────

type MilestoneType = "APPLY" | "START" | "MID_CHECK" | "END";
type MilestoneStatus = "PENDING" | "DONE";

interface DefenseDetails {
  defenseDate?: string;
  defenseFormat?: string; // 线下现场 / 线上会议 / 其他
  defenseLocation?: string;
  presenterFeishu?: FeishuIdTag[]; // 主讲人（飞书ID标签数组）
  committee?: string;
  defenseResult?: string; // 待答辩 / 顺利通过 / 需整改 / 未通过
  attachments?: FileItem[];
  remarks?: string;
}

interface Milestone {
  id?: string;
  type: MilestoneType;
  startDate: string | null;
  endDate: string | null;
  date: string | null;
  status: MilestoneStatus;
  notes: string;
  attachments: FileItem[];
  kpis?: KPI[]; // KPI嵌套在节点内
  hasDefense?: boolean; // 是否需要答辩
  defenseDetails?: DefenseDetails | null; // 答辩详情
}

interface KPI {
  id?: string;
  name: string;
  content: string;
  ownerFeishuOpenId: string | null;
  ownerName: string | null; // 显示用，不入库
  isCustom: boolean;
  sortOrder: number;
}

interface CommunicationGroup {
  platform: "feishu" | "wechat";
  name: string;
  targetIdOrUrl: string;
}

interface PaymentRecord {
  id?: string;
  amount: number;
  paymentDate: string;
  remark: string;
}

interface ProjectDetail {
  id: string;
  name: string;
  projectCode: string | null;
  ownerFeishuOpenId: string | null;
  proofMaterials: FileItem[];
  milestones: Milestone[];
  kpis: KPI[];
  remark: string | null;
  isWeekFocus: boolean;
  // 新增字段（从列表中整合）
  categoryDictId: string | null;
  companyEntityDictId: string | null;
  companyEntityNames: string[];          // 多选收款公司主体（名称数组）
  levelDictId: string | null;
  totalAmount: number | null;
  receivedAmount: number; // 废弃，由 paymentRecords 计算
  receivedDate: string | null; // 废弃
  affiliation: string | null;
  progress: string | null;
  todoItems: string | null;
  communicationGroups: CommunicationGroup[];
  paymentRecords: PaymentRecord[];
  // 层级归属
  parentId: string | null;
  parent?: { id: string; name: string } | null;
  children?: { id: string; totalAmount: number | null; receivedAmount: number }[];
  // 金额模式
  isAmountAutoSum: boolean;
  // 字典对象（用于显示）
  categoryDict?: { id: string; value: string } | null;
  companyEntityDict?: { id: string; value: string } | null;
  levelDict?: { id: string; value: string } | null;
}

export interface ProjectDrawerProps {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onSaved?: () => void;
  onAmountsUpdated?: () => void; // 汇总成功后通知外层刷新列表
}

// ── 常量 ──────────────────────────────────────────────────────────────

const MILESTONE_META: Record<MilestoneType, { label: string; color: string; isRange: boolean; hasKpis: boolean }> = {
  APPLY:     { label: "项目申报", color: "#6366f1", isRange: true, hasKpis: false },
  START:     { label: "开始/立项", color: "#0ea5e9", isRange: false, hasKpis: true },
  MID_CHECK: { label: "中期验收", color: "#f59e0b", isRange: false, hasKpis: true },
  END:       { label: "结项时间", color: "#22c55e", isRange: false, hasKpis: true },
};
const MILESTONE_ORDER: MilestoneType[] = ["APPLY", "START", "MID_CHECK", "END"];

const DEFAULT_KPI_NAMES = [
  "项目投入指标（万元）",
  "项目新增收入指标（万元）",
  "IP 考核指标",
  "技术考核指标",
  "其他指标",
];

function emptyMilestones(): Milestone[] {
  return MILESTONE_ORDER.map((type) => ({
    type, startDate: null, endDate: null, date: null,
    status: "PENDING", notes: "", attachments: [],
    kpis: MILESTONE_META[type].hasKpis ? defaultKPIs() : [],
    hasDefense: false,
    defenseDetails: null,
  }));
}

function defaultKPIs(): KPI[] {
  return DEFAULT_KPI_NAMES.map((name, i) => ({
    name, content: "", ownerFeishuOpenId: null, ownerName: null,
    isCustom: false, sortOrder: i,
  }));
}

// ── 工具 ──────────────────────────────────────────────────────────────

function isOverdue(m: Milestone): boolean {
  if (m.status === "DONE") return false;
  const today = new Date();
  const refDate = m.type === "APPLY" ? m.endDate : m.date;
  if (!refDate) return false;
  return new Date(refDate) < today;
}

function fmtDate(d: string | null) {
  if (!d) return "";
  // 直接截取 YYYY-MM-DD 部分，避免 new Date() 的 UTC→Local 时区转换导致日期偏移一天
  const s = d.slice(0, 10);
  const [y, m, day] = s.split("-");
  if (!y || !m || !day) return "";
  return `${y}/${m}/${day}`;
}

function getFeishuAppLink(id: string): string {
  // 群聊（oc_）使用 chatId 参数
  if (id.startsWith("oc_")) {
    return `https://applink.feishu.cn/client/chat/open?chatId=${id}`;
  }
  // 个人（ou_ 或 on_）使用 openId 参数
  if (id.startsWith("ou_") || id.startsWith("on_")) {
    return `https://applink.feishu.cn/client/chat/open?openId=${id}`;
  }
  // 兜底：返回空字符串
  return "";
}

// ── Accordion 区块 ────────────────────────────────────────────────────

function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          {icon}{title}
        </div>
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
      </button>
      {open && <div className="px-5 py-4">{children}</div>}
    </div>
  );
}

// ── 混合附件上传组件（本地文件 + 飞书云文档）────────────────────

function FileMixedUploader({ value, onChange, uploadEndpoint = "/api/major-projects/upload" }: {
  value: FileItem[];
  onChange: (v: FileItem[]) => void;
  uploadEndpoint?: string;
}) {
  const [addingFeishu, setAddingFeishu] = useState(false);
  const [feishuName, setFeishuName] = useState("");
  const [feishuUrl, setFeishuUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  // 上传文件到云端
  async function uploadFileToCloud(file: File): Promise<FileItem> {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(uploadEndpoint, { method: "POST", body: fd });
    const data = await res.json() as { type?: string; name?: string; url?: string; size?: number; error?: string };
    if (!res.ok) {
      throw new Error(data.error ?? "上传失败");
    }
    return {
      type: "local" as const,
      name: data.name ?? file.name,
      url: data.url ?? "",
      size: data.size
    };
  }

  // 处理文件上传（支持单个或多个文件）
  async function handleFiles(files: FileList | File[]) {
    if (uploading) return;
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    setUploading(true);
    setUploadErr("");
    try {
      // 并行上传所有文件
      const uploadPromises = fileArray.map(f => uploadFileToCloud(f));
      const newFiles = await Promise.all(uploadPromises);
      onChange([...value, ...newFiles]);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // 点击上传
  async function handleLocalUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) await handleFiles(e.target.files);
  }

  // 拖拽上传
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  }

  // 剪贴板粘贴上传
  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  }

  function addFeishuDoc() {
    if (!feishuUrl.trim()) return;
    const name = feishuName.trim() || "飞书文档";
    onChange([...value, { type: "feishu", name, url: feishuUrl.trim() }]);
    setAddingFeishu(false);
    setFeishuName("");
    setFeishuUrl("");
  }

  return (
    <div onPaste={handlePaste} tabIndex={0} style={{ outline: "none" }}>
      {/* 已上传文件列表 */}
      {value.map((f, i) => (
        <div
          key={i}
          className="flex items-center gap-2 p-2 rounded-lg bg-gray-50 border border-gray-200 mb-2"
        >
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded ${
              f.type === "feishu"
                ? "bg-blue-50 text-blue-700 border border-blue-200"
                : "bg-cyan-50 text-cyan-700 border border-cyan-200"
            }`}
            title={f.type === "feishu" ? "飞书链接" : "云存储"}
          >
            {f.type === "feishu" ? "飞书链接" : "云存储"}
          </span>
          <span className="flex-1 text-sm text-gray-800 truncate">{f.name}</span>
          {f.size !== undefined && (
            <span className="text-xs text-gray-400">{(f.size / 1024 / 1024).toFixed(1)}MB</span>
          )}
          <a
            href={f.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-blue-600 hover:text-blue-700"
          >
            <ExternalLink size={12} />
          </a>
          <button
            type="button"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="flex items-center text-gray-400 hover:text-red-600"
          >
            <X size={12} />
          </button>
        </div>
      ))}

      {/* 紧凑型拖拽/粘贴感应区 */}
      <div className="flex items-stretch gap-2 w-full">
        <div
          ref={dropzoneRef}
          onClick={() => !uploading && fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={`flex items-center flex-1 h-14 px-4 border-2 border-dashed rounded-lg transition-all cursor-pointer outline-none ${
            dragging
              ? "border-blue-500 bg-blue-50"
              : uploading
              ? "border-gray-200 bg-gray-50 cursor-wait"
              : "border-gray-300 hover:border-blue-500 hover:bg-blue-50"
          }`}
        >
          <input
            type="file"
            ref={fileRef}
            onChange={handleLocalUpload}
            multiple
            className="hidden"
          />
          {uploading ? (
            <div className="flex items-center gap-2 text-blue-600">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm font-medium">正在同步到云端...</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-500">
              <Upload size={16} className={dragging ? "text-blue-600" : ""} />
              <span className={`text-sm ${dragging ? "text-blue-600 font-medium" : ""}`}>
                点击选择文件，或将文件拖拽 / 粘贴 (Ctrl+V) 至此处
              </span>
            </div>
          )}
        </div>

        {/* 添加飞书云文档按钮 */}
        <button
          type="button"
          onClick={() => setAddingFeishu(v => !v)}
          className={`flex items-center gap-1.5 px-4 h-14 text-sm border-2 border-dashed rounded-lg transition-colors whitespace-nowrap ${
            addingFeishu
              ? "text-blue-600 border-blue-500 bg-blue-50"
              : "text-gray-600 border-gray-300 hover:border-blue-500 hover:bg-blue-50 hover:text-blue-600"
          }`}
        >
          <Link2 size={16} />
          添加飞书云文档
        </button>
      </div>

      {uploadErr && <p className="text-xs text-red-500 mt-2">{uploadErr}</p>}

      {/* 飞书云文档输入面板 */}
      {addingFeishu && (
        <div className="mt-3 p-3 bg-blue-50/50 border border-blue-200 rounded-lg">
          <input
            value={feishuName}
            onChange={e => setFeishuName(e.target.value)}
            placeholder="文件名称（可选，默认「飞书文档」）"
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none mb-2"
          />
          <input
            value={feishuUrl}
            onChange={e => setFeishuUrl(e.target.value)}
            placeholder="飞书文档 URL（必填）"
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none mb-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addFeishuDoc}
              disabled={!feishuUrl.trim()}
              className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              确认添加
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingFeishu(false);
                setFeishuName("");
                setFeishuUrl("");
              }}
              className="px-3 py-1.5 bg-white text-gray-700 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 节点卡片 ────────────────────────────────────────────────────

function MilestoneCard({ milestone, onChange, isEditing, userTargets }: {
  milestone: Milestone;
  onChange: (m: Milestone) => void;
  isEditing: boolean;
  userTargets: { feishuId: string; name: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = MILESTONE_META[milestone.type];
  const overdue = isOverdue(milestone);

  return (
    <div className={`border rounded-xl overflow-hidden ${overdue ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"}`}>
      {/* 节点主行 */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* 状态圆点 */}
        <div
          className="w-4 h-4 rounded-full flex-shrink-0 border-2"
          style={{
            borderColor: meta.color,
            backgroundColor: milestone.status === "DONE" ? meta.color : "white",
          }}
        />

        {/* 节点名称 */}
        <span className="font-medium text-sm text-gray-900 flex-1">{meta.label}</span>

        {/* 日期展示 */}
        <span className="text-xs text-gray-500">
          {meta.isRange
            ? (() => {
                const s = fmtDate(milestone.startDate);
                const e = fmtDate(milestone.endDate);
                if (s && e) return `${s} - ${e}`;
                if (s) return `${s} 起`;
                if (e) return `截至 ${e}`;
                return "时间未定";
              })()
            : fmtDate(milestone.date) || "时间未定"}
        </span>

        {/* 逾期警告 */}
        {overdue && (
          <span className="flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-600 text-xs rounded-full">
            <AlertTriangle size={12} />逾期
          </span>
        )}

        {/* 状态 - 编辑态可切换，阅读态只显示 */}
        {isEditing ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onChange({ ...milestone, status: milestone.status === "DONE" ? "PENDING" : "DONE" });
            }}
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              milestone.status === "DONE"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {milestone.status === "DONE" ? "已完成" : "待推进"}
          </button>
        ) : (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              milestone.status === "DONE"
                ? "bg-green-100 text-green-700"
                : "bg-gray-100 text-gray-600"
            }`}
          >
            {milestone.status === "DONE" ? "已完成" : "待推进"}
          </span>
        )}

        {expanded ? <ChevronDown size={14} className="text-gray-400" /> : <ChevronRight size={14} className="text-gray-400" />}
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {/* 日期 - 阅读/编辑态 */}
          {isEditing ? (
            meta.isRange ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">开始日期</label>
                  <input
                    type="date"
                    value={milestone.startDate?.slice(0, 10) ?? ""}
                    onChange={(e) => onChange({ ...milestone, startDate: e.target.value || null })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">结束日期</label>
                  <input
                    type="date"
                    value={milestone.endDate?.slice(0, 10) ?? ""}
                    onChange={(e) => onChange({ ...milestone, endDate: e.target.value || null })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  <Calendar size={12} className="inline mr-1" />日期
                </label>
                <input
                  type="date"
                  value={milestone.date?.slice(0, 10) ?? ""}
                  onChange={(e) => onChange({ ...milestone, date: e.target.value || null })}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            )
          ) : (
            <div>
              <label className="block text-xs text-gray-500 mb-1">日期</label>
              <p className="text-sm text-gray-700">
                {meta.isRange
                  ? milestone.startDate
                    ? `${fmtDate(milestone.startDate)} ~ ${fmtDate(milestone.endDate)}`
                    : "未设置"
                  : fmtDate(milestone.date) || "未设置"}
              </p>
            </div>
          )}

          {/* 备注 - 阅读/编辑态 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">备注</label>
            {isEditing ? (
              <textarea
                value={milestone.notes}
                onChange={(e) => onChange({ ...milestone, notes: e.target.value })}
                rows={2}
                placeholder="此节点的备注信息..."
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
              />
            ) : (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{milestone.notes || "无"}</p>
            )}
          </div>

          {/* 附件 - 阅读/编辑态 */}
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              <Paperclip size={12} className="inline mr-1" />附件
            </label>
            {isEditing ? (
              <FileMixedUploader
                value={milestone.attachments}
                onChange={(files) => onChange({ ...milestone, attachments: files })}
              />
            ) : milestone.attachments.length > 0 ? (
              <div className="space-y-1">
                {milestone.attachments.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    {file.type === "feishu" && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                        飞书
                      </span>
                    )}
                    <Paperclip size={12} className="text-gray-500" />
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {file.name}
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">无附件</p>
            )}
          </div>

          {/* 考核指标（仅START、MID_CHECK、END节点显示） */}
          {meta.hasKpis && (
            <div className="pt-3 border-t border-gray-200">
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs text-gray-700 font-semibold">
                  <Target size={12} className="inline mr-1 text-green-500" />考核指标
                </label>
                {/* 编辑态：一键生成默认指标 */}
                {isEditing && (!milestone.kpis || milestone.kpis.length === 0) && (
                  <button
                    onClick={() => onChange({ ...milestone, kpis: defaultKPIs() })}
                    className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                  >
                    <Plus size={12} />生成默认模板
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {(milestone.kpis || []).map((kpi, idx) => (
                  <KpiRow
                    key={idx}
                    kpi={kpi}
                    isEditing={isEditing}
                    userTargets={userTargets}
                    onChange={(updated) => {
                      const nextKpis = [...(milestone.kpis || [])];
                      nextKpis[idx] = updated;
                      onChange({ ...milestone, kpis: nextKpis });
                    }}
                    onDelete={
                      isEditing
                        ? () => {
                            const nextKpis = (milestone.kpis || []).filter((_, i) => i !== idx);
                            onChange({ ...milestone, kpis: nextKpis });
                          }
                        : undefined
                    }
                  />
                ))}

                {/* 编辑态：添加自定义指标按钮 */}
                {isEditing && (
                  <button
                    onClick={() => {
                      const nextKpis = [
                        ...(milestone.kpis || []),
                        {
                          name: "",
                          content: "",
                          ownerFeishuOpenId: null,
                          ownerName: null,
                          isCustom: true,
                          sortOrder: (milestone.kpis || []).length,
                        },
                      ];
                      onChange({ ...milestone, kpis: nextKpis });
                    }}
                    className="w-full flex items-center justify-center gap-1 px-3 py-2 text-xs text-gray-600 border border-dashed border-gray-300 rounded-lg hover:border-gray-400 hover:text-gray-700 transition-colors"
                  >
                    <Plus size={12} />添加自定义指标
                  </button>
                )}
              </div>

              {/* 阅读态：无指标时的提示 */}
              {!isEditing && (!milestone.kpis || milestone.kpis.length === 0) && (
                <p className="text-sm text-gray-500">无考核指标</p>
              )}
            </div>
          )}

          {/* 答辩管理 */}
          <div className="pt-3 border-t border-gray-200">
            {isEditing ? (
              /* 编辑态：开关 + 表单 */
              <div>
                <label className="flex items-center gap-2 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={milestone.hasDefense ?? false}
                    onChange={(e) => {
                      const hasDefense = e.target.checked;
                      onChange({
                        ...milestone,
                        hasDefense,
                        defenseDetails: hasDefense ? (milestone.defenseDetails || {}) : null,
                      });
                    }}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-xs text-gray-700 font-semibold">🔔 本节点包含答辩环节</span>
                </label>

                {milestone.hasDefense && (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    {/* 答辩时间 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">答辩时间</label>
                      <input
                        type="datetime-local"
                        value={milestone.defenseDetails?.defenseDate?.slice(0, 16) ?? ""}
                        onChange={(e) =>
                          onChange({
                            ...milestone,
                            defenseDetails: { ...milestone.defenseDetails, defenseDate: e.target.value },
                          })
                        }
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    {/* 答辩形式 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">答辩形式</label>
                      <select
                        value={milestone.defenseDetails?.defenseFormat ?? ""}
                        onChange={(e) =>
                          onChange({
                            ...milestone,
                            defenseDetails: { ...milestone.defenseDetails, defenseFormat: e.target.value },
                          })
                        }
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="">请选择</option>
                        <option value="线下现场">线下现场</option>
                        <option value="线上会议">线上会议</option>
                        <option value="其他">其他</option>
                      </select>
                    </div>

                    {/* 答辩地点/会议号 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">答辩地点/会议号</label>
                      <input
                        type="text"
                        value={milestone.defenseDetails?.defenseLocation ?? ""}
                        onChange={(e) =>
                          onChange({
                            ...milestone,
                            defenseDetails: { ...milestone.defenseDetails, defenseLocation: e.target.value },
                          })
                        }
                        placeholder="输入地点或会议号"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    {/* 主讲人/答辩人（飞书ID标签） */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">主讲人/答辩人</label>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {userTargets.length > 0 ? (
                          userTargets.map(user => {
                            const isSelected = (milestone.defenseDetails?.presenterFeishu ?? []).some((t: FeishuIdTag) => t.id === user.feishuId);
                            return (
                              <button
                                key={user.feishuId}
                                type="button"
                                onClick={() => {
                                  const current = milestone.defenseDetails?.presenterFeishu ?? [];
                                  const updated: FeishuIdTag[] = isSelected
                                    ? current.filter((t: FeishuIdTag) => t.id !== user.feishuId)
                                    : [...current, { id: user.feishuId, name: user.name }];
                                  onChange({
                                    ...milestone,
                                    defenseDetails: { ...milestone.defenseDetails, presenterFeishu: updated },
                                  });
                                }}
                                className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${isSelected ? "bg-blue-500 text-white border-blue-500" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"}`}
                              >
                                👤 {user.name}
                              </button>
                            );
                          })
                        ) : (
                          <span className="text-xs text-slate-400">暂无配置，请前往超级后台分配人员</span>
                        )}
                      </div>
                    </div>

                    {/* 答辩委员会组成 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">答辩委员会组成</label>
                      <textarea
                        value={milestone.defenseDetails?.committee ?? ""}
                        onChange={(e) =>
                          onChange({
                            ...milestone,
                            defenseDetails: { ...milestone.defenseDetails, committee: e.target.value },
                          })
                        }
                        rows={2}
                        placeholder="输入委员会成员信息"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    {/* 答辩结果 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">答辩结果</label>
                      <select
                        value={milestone.defenseDetails?.defenseResult ?? ""}
                        onChange={(e) =>
                          onChange({
                            ...milestone,
                            defenseDetails: { ...milestone.defenseDetails, defenseResult: e.target.value },
                          })
                        }
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      >
                        <option value="">请选择</option>
                        <option value="待答辩">待答辩</option>
                        <option value="顺利通过">顺利通过</option>
                        <option value="需整改">需整改</option>
                        <option value="未通过">未通过</option>
                      </select>
                    </div>

                    {/* 答辩材料附件 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">答辩材料附件</label>
                      <FileMixedUploader
                        value={milestone.defenseDetails?.attachments ?? []}
                        onChange={(files) =>
                          onChange({
                            ...milestone,
                            defenseDetails: { ...milestone.defenseDetails, attachments: files },
                          })
                        }
                      />
                    </div>

                    {/* 备注 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">备注</label>
                      <textarea
                        value={milestone.defenseDetails?.remarks ?? ""}
                        onChange={(e) =>
                          onChange({
                            ...milestone,
                            defenseDetails: { ...milestone.defenseDetails, remarks: e.target.value },
                          })
                        }
                        rows={2}
                        placeholder="输入答辩备注"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* 阅读态：答辩信息展示 */
              milestone.hasDefense && (() => {
                const dd = milestone.defenseDetails;
                return (
                  <div>
                    <p className="text-xs text-gray-700 font-semibold mb-3 flex items-center gap-1">
                      🎙️ 答辩信息
                    </p>
                    <div className="grid grid-cols-2 gap-y-4 gap-x-4 pt-3 border-t border-gray-100">
                      {/* 答辩时间 */}
                      <div>
                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩时间</p>
                        <p className="text-base font-medium text-foreground">
                          {dd?.defenseDate
                            ? new Date(dd.defenseDate).toLocaleString("zh-CN")
                            : <span className="text-gray-400 italic">暂未确定</span>}
                        </p>
                      </div>

                      {/* 答辩形式 */}
                      <div>
                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩形式</p>
                        <p className="text-base font-medium text-foreground">
                          {dd?.defenseFormat || <span className="text-gray-400 italic">暂未确定</span>}
                        </p>
                      </div>

                      {/* 答辩地点/会议号 */}
                      <div className="col-span-2">
                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩地点/会议号</p>
                        <p className="text-base font-medium text-foreground">
                          {dd?.defenseLocation || <span className="text-gray-400 italic">暂未确定</span>}
                        </p>
                      </div>

                      {/* 主讲人/答辩人 */}
                      <div className="col-span-2">
                        <p className="text-sm font-normal text-muted-foreground mb-1">主讲人/答辩人</p>
                        {dd?.presenterFeishu && dd.presenterFeishu.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {dd.presenterFeishu.map((presenter) => (
                              <a
                                key={presenter.id}
                                href={getFeishuAppLink(presenter.id)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-1 text-sm font-medium rounded-md cursor-pointer hover:opacity-80 transition-opacity"
                                style={{ background: "#f0fdf4", color: "#047857" }}
                              >
                                {presenter.name}
                                <span className="text-xs opacity-70">↗</span>
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">暂未确定</span>
                        )}
                      </div>

                      {/* 答辩委员会组成 */}
                      <div className="col-span-2">
                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩委员会组成</p>
                        <p className="text-base font-medium text-foreground whitespace-pre-wrap">
                          {dd?.committee || <span className="text-gray-400 italic">暂未确定</span>}
                        </p>
                      </div>

                      {/* 答辩结果 */}
                      <div>
                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩结果</p>
                        <p className="text-base font-medium text-foreground">
                          {dd?.defenseResult || <span className="text-gray-400 italic">暂未确定</span>}
                        </p>
                      </div>

                      {/* 答辩材料附件 */}
                      <div className="col-span-2">
                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩材料附件</p>
                        {dd?.attachments && dd.attachments.length > 0 ? (
                          <div className="space-y-1">
                            {dd.attachments.map((file, idx) => (
                              <div key={idx} className="flex items-center gap-2 text-sm">
                                {file.type === "feishu" && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                    飞书
                                  </span>
                                )}
                                <Paperclip size={12} className="text-gray-400" />
                                <a
                                  href={file.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {file.name}
                                </a>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="text-gray-400 italic">暂未确定</span>
                        )}
                      </div>

                      {/* 备注 */}
                      <div className="col-span-2">
                        <p className="text-sm font-normal text-muted-foreground mb-1">备注</p>
                        <p className="text-base font-medium text-foreground whitespace-pre-wrap">
                          {dd?.remarks || <span className="text-gray-400 italic">暂未确定</span>}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── KPI 行 ────────────────────────────────────────────────────────────

function KpiRow({ kpi, onChange, onDelete, isEditing, userTargets }: {
  kpi: KPI;
  onChange: (k: KPI) => void;
  onDelete?: () => void;
  isEditing: boolean;
  userTargets: { feishuId: string; name: string }[];
}) {
  if (!isEditing) {
    // 阅读态：只读显示
    return (
      <div className="p-3 bg-gray-50 rounded-lg">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <span className="text-xs text-gray-500">指标名称</span>
            <p className="font-medium text-gray-800">{kpi.name || "无"}</p>
          </div>
          <div>
            <span className="text-xs text-gray-500">指标值/描述</span>
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{kpi.content || "无"}</p>
          </div>
          <div className="col-span-2">
            <span className="text-xs text-gray-500">负责人</span>
            {kpi.ownerFeishuOpenId && kpi.ownerName ? (
              <a
                href={getFeishuAppLink(kpi.ownerFeishuOpenId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 text-sm font-medium rounded-md cursor-pointer hover:opacity-80 transition-opacity"
                style={{
                  background: "#f0fdf4",
                  color: "#047857",
                }}
              >
                {kpi.ownerName}
                <span className="text-xs opacity-70">↗</span>
              </a>
            ) : (
              <p className="text-gray-700">{kpi.ownerName || "未指定"}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 编辑态：表单输入
  return (
    <div className="flex items-start gap-2 p-3 bg-gray-50 rounded-lg">
      <div className="flex-1 grid grid-cols-2 gap-2">
        {/* 指标名称 */}
        <input
          value={kpi.name}
          onChange={(e) => onChange({ ...kpi, name: e.target.value })}
          placeholder="指标名称"
          className="px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        {/* 指标内容 - 升级为 Textarea 支持换行 */}
        <textarea
          value={kpi.content}
          onChange={(e) => onChange({ ...kpi, content: e.target.value })}
          placeholder="指标值/描述 (支持回车换行)"
          rows={3}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none resize-y"
        />
        {/* 负责人选择 - 使用飞书通知配置人员下拉 */}
        <div className="col-span-2">
          <select
            value={kpi.ownerFeishuOpenId ?? ""}
            onChange={(e) => {
              const target = userTargets.find(t => t.feishuId === e.target.value);
              onChange({
                ...kpi,
                ownerFeishuOpenId: e.target.value || null,
                ownerName: target?.name ?? null,
              });
            }}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
          >
            <option value="">@负责人（选择）</option>
            {userTargets.map(t => (
              <option key={t.feishuId} value={t.feishuId}>{t.name}</option>
            ))}
          </select>
        </div>
      </div>
      {/* 删除按钮（编辑态所有指标均可删除） */}
      {onDelete && (
        <button onClick={onDelete} className="mt-1 p-1 hover:bg-gray-200 rounded flex-shrink-0" title="删除此指标">
          <Trash2 size={14} className="text-red-500" />
        </button>
      )}
    </div>
  );
}

// ── 主 Drawer 组件 ────────────────────────────────────────────────────

export function ProjectDrawer({ projectId, projectName, onClose, onSaved, onAmountsUpdated }: ProjectDrawerProps) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false); // 阅读/编辑模式切换

  // 编辑态
  const [projectCode, setProjectCode] = useState("");
  const [owners, setOwners] = useState<FeishuIdTag[]>([]); // 飞书ID标签数组
  const [isWeekFocus, setIsWeekFocus] = useState(false);
  const [proofMaterials, setProofMaterials] = useState<FileItem[]>([]);
  const [milestones, setMilestones] = useState<Milestone[]>(emptyMilestones());
  const [remark, setRemark] = useState("");
  // 新增字段
  const [categoryDictId, setCategoryDictId] = useState<string | null>(null);
  const [companyEntityNames, setCompanyEntityNames] = useState<string[]>([]);
  const [levelDictId, setLevelDictId] = useState<string | null>(null);
  const [totalAmount, setTotalAmount] = useState("");
  const [receivedAmount, setReceivedAmount] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [progress, setProgress] = useState("未开始");
  const [todoItems, setTodoItems] = useState("");
  const [communicationGroups, setCommunicationGroups] = useState<CommunicationGroup[]>([]);
  const [paymentRecords, setPaymentRecords] = useState<PaymentRecord[]>([]);
  const [userTargets, setUserTargets] = useState<{ feishuId: string; name: string }[]>([]);
  const [groupTargets, setGroupTargets] = useState<{ feishuId: string; name: string }[]>([]);
  // 层级归属
  const [isSubProject, setIsSubProject] = useState(false);
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null);
  const [parentProjects, setParentProjects] = useState<{ id: string; name: string }[]>([]);
  const [parentSearchQuery, setParentSearchQuery] = useState("");
  const [parentDropdownOpen, setParentDropdownOpen] = useState(false);
  const parentDropdownRef = useRef<HTMLDivElement>(null);
  // 金额模式
  const [isAmountAutoSum, setIsAmountAutoSum] = useState(false);
  // 汇总按钮 loading 状态
  const [isExtractingTotal, setIsExtractingTotal] = useState(false);
  const [isExtractingReceived, setIsExtractingReceived] = useState(false);

  // 子项目金额汇总（useMemo，仅主项目有效）
  const childrenTotalAmount = useMemo(
    () => (detail?.children ?? []).reduce((sum, c) => sum + (c.totalAmount ?? 0), 0),
    [detail?.children]
  );
  const childrenReceivedAmount = useMemo(
    () => (detail?.children ?? []).reduce((sum, c) => sum + (c.receivedAmount ?? 0), 0),
    [detail?.children]
  );
  const [activeMilestoneType, setActiveMilestoneType] = useState<MilestoneType>("APPLY"); // 横向时间线当前选中节点
  const [saveToast, setSaveToast] = useState<{ ok: boolean; msg: string } | null>(null);

  // Toast 自动消失
  useEffect(() => {
    if (!saveToast) return;
    const t = setTimeout(() => setSaveToast(null), 4500);
    return () => clearTimeout(t);
  }, [saveToast]);

  // 加载可选主项目列表（parentId=null 的顶层项目，排除自身）
  useEffect(() => {
    async function fetchParentProjects() {
      try {
        const res = await fetch("/api/major-projects?parentId=null&limit=100");
        const data = await res.json();
        const list = (data.projects ?? []) as { id: string; name: string }[];
        setParentProjects(list.filter((p) => p.id !== projectId));
      } catch {
        // ignore
      }
    }
    fetchParentProjects();
  }, [projectId]);

  // 加载飞书通知配置目标（USER 和 GROUP）
  useEffect(() => {
    async function fetchFeishuTargets() {
      try {
        const res = await fetch('/api/admin/feishu-targets?module=major-project');
        const data = await res.json();
        const targets: { feishuId: string; name: string; type: string }[] = data.targets ?? [];
        setUserTargets(targets.filter(t => t.type === 'USER'));
        setGroupTargets(targets.filter(t => t.type === 'GROUP'));
      } catch { /* ignore */ }
    }
    fetchFeishuTargets();
  }, []);

  // 点击外部关闭归属主项目下拉
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (parentDropdownRef.current && !parentDropdownRef.current.contains(e.target as Node)) {
        setParentDropdownOpen(false);
      }
    }
    if (parentDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [parentDropdownOpen]);

  // ── 加载详情 ────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/major-projects/${projectId}`);
        const data = await res.json();
        const p = data.project as ProjectDetail & {
          milestones: Array<Milestone & { attachments: unknown }>;
          kpis: Array<KPI>;
        };

        setDetail(p);
        setProjectCode(p.projectCode ?? "");

        // 解析 ownerFeishuOpenId（JSON 数组字符串）
        let loadedOwners: FeishuIdTag[] = [];
        if (p.ownerFeishuOpenId) {
          try {
            const parsed = JSON.parse(p.ownerFeishuOpenId);
            if (Array.isArray(parsed)) {
              loadedOwners = parsed;
            }
          } catch {
            // 旧格式：单个ID字符串，兼容旧数据
            loadedOwners = [{ id: p.ownerFeishuOpenId, name: "负责人" }];
          }
        }
        setOwners(loadedOwners);

        setIsWeekFocus(p.isWeekFocus ?? false);

        // 加载新增字段
        setCategoryDictId(p.categoryDictId);
        setCompanyEntityNames(Array.isArray(p.companyEntityNames) ? p.companyEntityNames : []);
        setLevelDictId(p.levelDictId);
        setTotalAmount(p.totalAmount ? String(p.totalAmount) : "");
        setReceivedAmount(String(p.receivedAmount || 0));
        setReceivedDate(p.receivedDate?.slice(0, 10) ?? "");
        setAffiliation(p.affiliation ?? "");
        setProgress(p.progress ?? "未开始");
        setTodoItems(p.todoItems ?? "");
        setIsSubProject(!!p.parentId);
        setSelectedParentId(p.parentId ?? null);
        setIsAmountAutoSum(p.isAmountAutoSum ?? false);
        setProofMaterials(
          Array.isArray(p.proofMaterials) ? p.proofMaterials as FileItem[] : []
        );
        setRemark(p.remark ?? "");
        setCommunicationGroups(
          Array.isArray(p.communicationGroups) ? p.communicationGroups as CommunicationGroup[] : []
        );
        setPaymentRecords(
          Array.isArray(p.paymentRecords) ? p.paymentRecords.map((r: any) => ({
            id: r.id,
            amount: r.amount,
            paymentDate: r.paymentDate?.slice(0, 10) ?? "",
            remark: r.remark ?? "",
          })) : []
        );

        // 里程碑：按固定顺序合并数据库数据，KPI嵌套在节点内
        const dbMs = p.milestones ?? [];
        setMilestones(
          MILESTONE_ORDER.map((type) => {
            const found = dbMs.find((m) => m.type === type);
            if (found) {
              return {
                ...found,
                attachments: Array.isArray(found.attachments) ? found.attachments as FileItem[] : [],
                kpis: found.kpis || (MILESTONE_META[type].hasKpis ? defaultKPIs() : []),
              };
            }
            return {
              type,
              startDate: null,
              endDate: null,
              date: null,
              status: "PENDING",
              notes: "",
              attachments: [],
              kpis: MILESTONE_META[type].hasKpis ? defaultKPIs() : [],
              hasDefense: false,
              defenseDetails: null,
            };
          })
        );
      } catch (err) {
        console.error("加载项目详情失败:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [projectId]);

  // ── 保存 ────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`/api/major-projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectCode: projectCode || null,
          ownerFeishuOpenId: owners.length > 0 ? JSON.stringify(owners) : null,
          isWeekFocus,
          proofMaterials,
          remark: remark || null,
          // 新增字段
          categoryDictId,
          companyEntityNames,
          levelDictId,
          totalAmount: totalAmount === "" ? null : Number(totalAmount),
          // 自动从到账明细计算 receivedAmount，确保与主表数据同步
          receivedAmount: paymentRecords.length > 0
            ? paymentRecords.reduce((acc, r) => acc + (Number(r.amount) || 0), 0)
            : (receivedAmount === "" ? 0 : Number(receivedAmount)),
          receivedDate: receivedDate || null,
          affiliation: affiliation || null,
          progress: progress || null,
          todoItems: todoItems || null,
          communicationGroups,
          isAmountAutoSum: false,
          parentId: isSubProject ? selectedParentId : null,
          paymentRecords: paymentRecords.map(r => ({
            amount: Number(r.amount),
            paymentDate: r.paymentDate,
            remark: r.remark || null,
          })),
          milestones: milestones.map((m) => ({
            type: m.type,
            startDate: m.startDate,
            endDate: m.endDate,
            date: m.date,
            status: m.status,
            notes: m.notes || null,
            attachments: m.attachments,
            hasDefense: m.hasDefense ?? false,
            defenseDetails: m.defenseDetails ?? null,
            kpis: (m.kpis || [])
              .filter((k) => k.name.trim())
              .map((k, i) => ({
                name: k.name.trim(),
                content: k.content.trim() || null,
                ownerFeishuOpenId: k.ownerFeishuOpenId,
                isCustom: k.isCustom,
                sortOrder: i,
              })),
          })),
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || "保存失败");
      }
      setSaveToast({ ok: true, msg: "保存成功" });
      setIsEditing(false); // 保存成功后切回阅读态
      onSaved?.();
    } catch (err) {
      console.error("保存失败:", err);
      setSaveToast({ ok: false, msg: `保存失败：${(err as Error).message || "请重试"}` });
    } finally {
      setSaving(false);
    }
  }

  // ── 取消编辑 ────────────────────────────────────────────────────────

  function handleCancel() {
    if (!detail) return;
    // 恢复原始值
    setProjectCode(detail.projectCode ?? "");

    // 恢复 owners
    let restoredOwners: FeishuIdTag[] = [];
    if (detail.ownerFeishuOpenId) {
      try {
        const parsed = JSON.parse(detail.ownerFeishuOpenId);
        if (Array.isArray(parsed)) restoredOwners = parsed;
      } catch {
        restoredOwners = [{ id: detail.ownerFeishuOpenId, name: "负责人" }];
      }
    }
    setOwners(restoredOwners);

    setIsWeekFocus(detail.isWeekFocus ?? false);
    setProofMaterials(Array.isArray(detail.proofMaterials) ? detail.proofMaterials as FileItem[] : []);
    setRemark(detail.remark ?? "");

    // 恢复新增字段
    setCategoryDictId(detail.categoryDictId);
    setCompanyEntityNames(Array.isArray(detail.companyEntityNames) ? detail.companyEntityNames : []);
    setLevelDictId(detail.levelDictId);
    setTotalAmount(detail.totalAmount ? String(detail.totalAmount) : "");
    setReceivedAmount(String(detail.receivedAmount || 0));
    setReceivedDate(detail.receivedDate?.slice(0, 10) ?? "");
    setAffiliation(detail.affiliation ?? "");
    setProgress(detail.progress ?? "未开始");
    setTodoItems(detail.todoItems ?? "");
    setIsSubProject(!!(detail.parentId));
    setSelectedParentId(detail.parentId ?? null);
    setIsAmountAutoSum(detail.isAmountAutoSum ?? false);
    setCommunicationGroups(
      Array.isArray(detail.communicationGroups) ? detail.communicationGroups as CommunicationGroup[] : []
    );
    setPaymentRecords(
      Array.isArray(detail.paymentRecords) ? detail.paymentRecords.map((r: any) => ({
        id: r.id,
        amount: r.amount,
        paymentDate: r.paymentDate?.slice(0, 10) ?? "",
        remark: r.remark ?? "",
      })) : []
    );
    const dbMs = detail.milestones ?? [];
    setMilestones(
      MILESTONE_ORDER.map((type) => {
        const found = dbMs.find((m) => m.type === type);
        if (found) {
          return {
            ...found,
            attachments: Array.isArray(found.attachments) ? found.attachments as FileItem[] : [],
            kpis: found.kpis || (MILESTONE_META[type].hasKpis ? defaultKPIs() : []),
          };
        }
        return {
          type,
          startDate: null,
          endDate: null,
          date: null,
          status: "PENDING",
          notes: "",
          attachments: [],
          kpis: MILESTONE_META[type].hasKpis ? defaultKPIs() : [],
        };
      })
    );
    setIsEditing(false);
  }

  // ── 渲染 ────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose}>
      <div
        className="absolute right-0 top-0 bottom-0 w-[720px] max-w-full bg-white shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{projectName}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {isEditing ? "编辑模式 · 修改后点击保存" : "项目详情 · 点击右侧编辑按钮可修改"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving || loading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  保存
                </button>
                <button
                  onClick={handleCancel}
                  disabled={saving || loading}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-300 disabled:opacity-50"
                >
                  取消
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50"
              >
                <Pencil size={14} />
                编辑
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 主体内容 */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={32} className="animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* 1. 基础信息 */}
              <Section title="基础信息" icon={<Flag size={15} className="text-blue-500" />}>
                {isEditing ? (
                  <div className="grid grid-cols-2 gap-4">
                    {/* 项目名称（只读，从 projectName prop 获取） */}
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">项目名称</label>
                      <input
                        value={projectName}
                        readOnly
                        disabled
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-gray-50 text-gray-500 cursor-not-allowed"
                      />
                    </div>
                    {/* 立项名称/编号 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">立项名称/编号</label>
                      <input
                        value={projectCode}
                        onChange={(e) => setProjectCode(e.target.value)}
                        placeholder="请输入立项名称或编号"
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                    {/* 项目类别 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">项目类别</label>
                      <DictSelect
                        category="category"
                        value={categoryDictId}
                        onChange={setCategoryDictId}
                        placeholder="选择项目类别"
                        canEdit
                      />
                    </div>
                    {/* 项目级别 */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">项目级别</label>
                      <DictSelect
                        category="level"
                        value={levelDictId}
                        onChange={setLevelDictId}
                        placeholder="选择项目级别"
                        canEdit
                      />
                    </div>
                    {/* 收款公司主体（多选） */}
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">收款公司主体</label>
                      <DictMultiSelect
                        category="companyEntity"
                        value={companyEntityNames}
                        onChange={setCompanyEntityNames}
                        placeholder="选择收款公司主体（可多选）"
                        canEdit
                      />
                    </div>
                    {/* 待办事项 */}
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">待办事项</label>
                      <textarea
                        value={todoItems}
                        onChange={(e) => setTodoItems(e.target.value)}
                        rows={2}
                        placeholder="待办事项..."
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>
                    {/* 归属 */}
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">归属</label>
                      <div className="flex items-center gap-4 py-1">
                        {(["个人", "公司"] as const).map((opt) => (
                          <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="affiliation"
                              value={opt}
                              checked={affiliation === opt}
                              onChange={() => setAffiliation(opt)}
                              className="accent-blue-500"
                            />
                            <span className="text-sm text-gray-700">{opt}</span>
                          </label>
                        ))}
                        {affiliation && (
                          <button
                            type="button"
                            onClick={() => setAffiliation("")}
                            className="text-xs text-gray-400 hover:text-gray-600 ml-2"
                          >
                            清除
                          </button>
                        )}
                      </div>
                    </div>
                    {/* 项目进度 */}
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">项目进度</label>
                      <div className="flex items-center gap-4 py-1">
                        {(["未开始", "进行中", "已结束"] as const).map((opt) => (
                          <label key={opt} className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="progress"
                              value={opt}
                              checked={progress === opt}
                              onChange={() => setProgress(opt)}
                              className="accent-blue-500"
                            />
                            <span className="text-sm text-gray-700">{opt}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                    {/* 项目负责人 */}
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">
                        <User size={12} className="inline mr-1" />项目负责人（飞书）
                      </label>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {userTargets.length > 0 ? (
                          userTargets.map(user => {
                            const isSelected = owners.some(o => o.id === user.feishuId);
                            return (
                              <button
                                key={user.feishuId}
                                type="button"
                                onClick={() => setOwners(isSelected
                                  ? owners.filter(o => o.id !== user.feishuId)
                                  : [...owners, { id: user.feishuId, name: user.name }]
                                )}
                                className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${isSelected ? "bg-blue-500 text-white border-blue-500" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"}`}
                              >
                                👤 {user.name}
                              </button>
                            );
                          })
                        ) : (
                          <span className="text-xs text-slate-400">暂无配置，请前往超级后台分配人员</span>
                        )}
                      </div>
                    </div>
                    {/* 周重点开关 */}
                    <div className="col-span-2">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <div
                          onClick={() => setIsWeekFocus(!isWeekFocus)}
                          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${isWeekFocus ? "bg-orange-500" : "bg-gray-300"}`}
                        >
                          <div
                            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isWeekFocus ? "translate-x-5" : "translate-x-0.5"}`}
                          />
                        </div>
                        <span className="text-sm text-gray-700 font-normal">
                          标记为本周重点项目
                        </span>
                        {isWeekFocus && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-orange-100 text-orange-600">
                            <Flame size={11} />周重点
                          </span>
                        )}
                      </label>
                    </div>
                    {/* 备注 */}
                    <div className="col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">备注</label>
                      <textarea
                        value={remark}
                        onChange={(e) => setRemark(e.target.value)}
                        rows={2}
                        placeholder="项目备注..."
                        className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      />
                    </div>

                    {/* 层级归属 */}
                    <div className="col-span-2">
                      <label className="flex items-center justify-between cursor-pointer select-none">
                        <div>
                          <span className="text-sm text-gray-700 font-medium">设为子项目</span>
                          <p className="text-xs text-gray-400 mt-0.5">开启后，当前项目将作为子项目挂载到指定主项目下</p>
                        </div>
                        <div
                          onClick={() => {
                            const next = !isSubProject;
                            setIsSubProject(next);
                            if (!next) setSelectedParentId(null);
                          }}
                          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${isSubProject ? "bg-blue-500" : "bg-gray-300"}`}
                        >
                          <div
                            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isSubProject ? "translate-x-5" : "translate-x-0.5"}`}
                          />
                        </div>
                      </label>
                      {isSubProject && (
                        <div className="mt-3" ref={parentDropdownRef}>
                          <label className="block text-xs text-gray-500 mb-1">归属主项目</label>
                          <div className="relative">
                            <button
                              type="button"
                              onClick={() => {
                                setParentDropdownOpen(!parentDropdownOpen);
                                setParentSearchQuery("");
                              }}
                              className="w-full flex items-center justify-between px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:border-gray-400 focus:ring-2 focus:ring-blue-500 focus:outline-none"
                            >
                              <span className={selectedParentId ? "text-gray-900" : "text-gray-400"}>
                                {selectedParentId
                                  ? parentProjects.find((p) => p.id === selectedParentId)?.name ?? "未知项目"
                                  : "请选择归属主项目"}
                              </span>
                              <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
                            </button>
                            {parentDropdownOpen && (
                              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-hidden">
                                <div className="p-2 border-b border-gray-100">
                                  <input
                                    autoFocus
                                    value={parentSearchQuery}
                                    onChange={(e) => setParentSearchQuery(e.target.value)}
                                    placeholder="搜索项目名称..."
                                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                  />
                                </div>
                                <div className="overflow-y-auto max-h-44">
                                  {parentProjects
                                    .filter((p) =>
                                      p.name.toLowerCase().includes(parentSearchQuery.toLowerCase())
                                    )
                                    .map((p) => (
                                      <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => {
                                          setSelectedParentId(p.id);
                                          setParentDropdownOpen(false);
                                          setParentSearchQuery("");
                                        }}
                                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-blue-50 ${
                                          selectedParentId === p.id ? "bg-blue-50 text-blue-700" : "text-gray-700"
                                        }`}
                                      >
                                        <span>{p.name}</span>
                                        {selectedParentId === p.id && (
                                          <Check size={14} className="text-blue-500 flex-shrink-0" />
                                        )}
                                      </button>
                                    ))}
                                  {parentProjects.filter((p) =>
                                    p.name.toLowerCase().includes(parentSearchQuery.toLowerCase())
                                  ).length === 0 && (
                                    <div className="px-3 py-4 text-sm text-gray-400 text-center">
                                      无匹配结果
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 沟通群组配置 */}
                    <div className="col-span-2 pt-4 border-t border-gray-200">
                      <label className="block text-sm font-medium text-gray-700 mb-3">💬 沟通群组配置</label>
                      <div className="space-y-3">
                        {communicationGroups.map((group, idx) => (
                          <div key={idx} className="flex gap-2 items-start p-3 bg-gray-50 rounded-lg">
                            <div className="flex-1 flex gap-2">
                              <select
                                value={group.platform}
                                onChange={(e) => {
                                  const next = [...communicationGroups];
                                  next[idx].platform = e.target.value as "feishu" | "wechat";
                                  setCommunicationGroups(next);
                                }}
                                className="w-32 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                              >
                                <option value="feishu">飞书群</option>
                                <option value="wechat">微信(企微)群</option>
                              </select>
                              {group.platform === "feishu" ? (
                                <select
                                  value={group.targetIdOrUrl}
                                  onChange={(e) => {
                                    const selectedFeishuId = e.target.value;
                                    const selectedGroup = groupTargets.find(g => g.feishuId === selectedFeishuId);
                                    if (selectedGroup) {
                                      const next = [...communicationGroups];
                                      next[idx].name = selectedGroup.name;
                                      next[idx].targetIdOrUrl = selectedGroup.feishuId;
                                      setCommunicationGroups(next);
                                    }
                                  }}
                                  className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                >
                                  <option value="">请选择飞书群聊...</option>
                                  {groupTargets.map(g => (
                                    <option key={g.feishuId} value={g.feishuId}>{g.name}</option>
                                  ))}
                                </select>
                              ) : (
                                <>
                                  <input
                                    value={group.name}
                                    onChange={(e) => {
                                      const next = [...communicationGroups];
                                      next[idx].name = e.target.value;
                                      setCommunicationGroups(next);
                                    }}
                                    placeholder="群名称"
                                    className="w-36 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                  />
                                  <div className="flex-1 flex gap-2 items-center">
                                    <input
                                      value={group.targetIdOrUrl}
                                      onChange={(e) => {
                                        const next = [...communicationGroups];
                                        next[idx].targetIdOrUrl = e.target.value.trim();
                                        setCommunicationGroups(next);
                                      }}
                                      placeholder="请输入企微链接"
                                      className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    />
                                    <label className="flex items-center gap-1 px-2 py-1.5 text-xs text-blue-600 border border-blue-300 rounded cursor-pointer hover:bg-blue-50 whitespace-nowrap">
                                      <Paperclip size={12} />
                                      上传二维码
                                      <input
                                        type="file"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={async (e) => {
                                          const file = e.target.files?.[0];
                                          if (!file) return;

                                          if (file.size > 5 * 1024 * 1024) {
                                            alert("图片大小不能超过 5MB");
                                            return;
                                          }

                                          const formData = new FormData();
                                          formData.append("file", file);

                                          try {
                                            const res = await fetch("/api/major-projects/upload", {
                                              method: "POST",
                                              body: formData,
                                            });
                                            if (!res.ok) throw new Error("上传失败");
                                            const data = await res.json();

                                            const next = [...communicationGroups];
                                            next[idx].targetIdOrUrl = data.url;
                                            setCommunicationGroups(next);
                                          } catch (err) {
                                            console.error("上传失败:", err);
                                            alert("上传失败，请重试");
                                          }
                                        }}
                                      />
                                    </label>
                                    {group.targetIdOrUrl && group.targetIdOrUrl.match(/\.(png|jpg|jpeg|gif|webp)$/i) && (
                                      <span className="text-xs text-green-600 whitespace-nowrap">✅ 已上传图</span>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setCommunicationGroups(communicationGroups.filter((_, i) => i !== idx));
                              }}
                              className="p-1.5 hover:bg-gray-200 rounded flex-shrink-0"
                            >
                              <Trash2 size={14} className="text-red-500" />
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => {
                            setCommunicationGroups([
                              ...communicationGroups,
                              { platform: "feishu", name: "", targetIdOrUrl: "" },
                            ]);
                          }}
                          className="w-full flex items-center justify-center gap-1 px-3 py-2 text-sm text-gray-600 border border-dashed border-gray-300 rounded-lg hover:border-gray-400 hover:text-gray-700 transition-colors"
                        >
                          <Plus size={14} />
                          添加沟通群组
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    {/* 周重点 Badge（阅读态顶部显示） */}
                    {isWeekFocus && (
                      <div className="mb-4">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-orange-100 text-orange-600 border border-orange-200">
                          <Flame size={14} />周重点项目
                        </span>
                      </div>
                    )}
                    {/* Grid 排版 */}
                    <div className="grid grid-cols-2 gap-y-4 gap-x-4">
                      {/* 第1行 - 全宽：项目名称 */}
                      <div className="col-span-2">
                        <p className="text-sm font-normal text-muted-foreground mb-1">项目名称</p>
                        <p className="text-base font-medium text-foreground">
                          {projectName || <span className="text-gray-400 italic">暂无</span>}
                        </p>
                      </div>
                      {/* 分割线 */}
                      <div className="col-span-2 my-2 border-b border-gray-100"></div>
                      {/* 第2行 - 全宽：立项名称/编号 */}
                      <div className="col-span-2">
                        <p className="text-sm font-normal text-muted-foreground mb-1">立项名称/编号</p>
                        <p className="text-base font-medium text-foreground">
                          {projectCode || <span className="text-gray-400 italic">暂无</span>}
                        </p>
                      </div>
                      {/* 归属主项目（仅子项目显示） */}
                      {detail?.parentId && (
                        <div className="col-span-2">
                          <p className="text-sm font-normal text-muted-foreground mb-1">归属主项目</p>
                          <p className="text-base font-medium text-foreground">
                            {detail.parent?.name || <span className="text-gray-400 italic">未知主项目</span>}
                          </p>
                        </div>
                      )}
                      {/* 第3行 - 双列：项目级别 | 项目类别 */}
                      <div>
                        <p className="text-sm font-normal text-muted-foreground mb-1">项目级别</p>
                        <p className="text-base font-medium text-foreground">
                          {detail?.levelDict?.value || <span className="text-gray-400 italic">暂无</span>}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-normal text-muted-foreground mb-1">项目类别</p>
                        <p className="text-base font-medium text-foreground">
                          {detail?.categoryDict?.value || <span className="text-gray-400 italic">暂无</span>}
                        </p>
                      </div>
                      <div>
                        <p className="text-sm font-normal text-muted-foreground mb-1">收款公司主体</p>
                        {detail?.companyEntityNames?.length ? (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {detail.companyEntityNames.map((name) => (
                              <span
                                key={name}
                                className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        ) : detail?.companyEntityDict?.value ? (
                          <p className="text-base font-medium text-foreground">{detail.companyEntityDict.value}</p>
                        ) : (
                          <span className="text-gray-400 italic">暂无</span>
                        )}
                      </div>
                      {/* 归属 */}
                      <div>
                        <p className="text-sm font-normal text-muted-foreground mb-1">归属</p>
                        <p className="text-base font-medium text-foreground">
                          {affiliation ? (
                            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                              affiliation === "公司" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"
                            }`}>
                              {affiliation}
                            </span>
                          ) : (
                            <span className="text-gray-400 italic">暂无</span>
                          )}
                        </p>
                      </div>
                      {/* 项目进度 */}
                      <div>
                        <p className="text-sm font-normal text-muted-foreground mb-1">项目进度</p>
                        <p className="text-base font-medium text-foreground">
                          {progress ? (() => {
                            const styles: Record<string, string> = {
                              "未开始": "bg-slate-100 text-slate-600 border border-slate-200",
                              "进行中": "bg-blue-50 text-blue-600 border border-blue-200",
                              "已结束": "bg-emerald-50 text-emerald-600 border border-emerald-200",
                            };
                            const cls = styles[progress] ?? "bg-slate-100 text-slate-600 border border-slate-200";
                            return (
                              <span className={`inline-flex items-center justify-center px-2 py-0.5 text-[10px] rounded-full whitespace-nowrap ${cls}`}>
                                {progress}
                              </span>
                            );
                          })() : (
                            <span className="text-gray-400 italic">暂无</span>
                          )}
                        </p>
                      </div>
                      {/* 分割线 */}
                      <div className="col-span-2 my-2 border-b border-gray-100"></div>
                      {/* 第5行 - 双列：项目负责人 | 待办事项 */}
                      <div>
                        <p className="text-sm font-normal text-muted-foreground mb-1">项目负责人</p>
                        {owners.length > 0 ? (
                          <div className="flex flex-wrap gap-1.5">
                            {owners.map((owner) => {
                              const isChat = owner.id.startsWith("oc_");
                              const appLink = getFeishuAppLink(owner.id);
                              return (
                                <a
                                  key={owner.id}
                                  href={appLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 text-sm font-medium rounded-md cursor-pointer hover:opacity-80 transition-opacity"
                                  style={{
                                    background: isChat ? "#eff6ff" : "#f0fdf4",
                                    color: isChat ? "#1d4ed8" : "#047857",
                                  }}
                                >
                                  {owner.name}
                                  <span className="text-xs opacity-70">↗</span>
                                </a>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-base font-medium text-foreground">
                            <span className="text-gray-400 italic">暂无</span>
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-normal text-muted-foreground mb-1">待办事项</p>
                        <p className="text-base font-medium text-foreground whitespace-pre-wrap">
                          {detail?.todoItems || <span className="text-gray-400 italic">暂无</span>}
                        </p>
                      </div>
                      {/* 分割线 */}
                      <div className="col-span-2 my-2 border-b border-gray-100"></div>
                      {/* 第6行 - 全宽：备注 */}
                      <div className="col-span-2">
                        <p className="text-sm font-normal text-muted-foreground mb-1">备注</p>
                        <p className="text-base font-medium text-foreground whitespace-pre-wrap">
                          {remark || <span className="text-gray-400 italic">暂无</span>}
                        </p>
                      </div>

                      {/* 沟通群组 */}
                      {communicationGroups.length > 0 && (
                        <div className="col-span-2 pt-4 border-t border-gray-200">
                          <p className="text-sm font-normal text-muted-foreground mb-2">💬 沟通群组</p>
                          <div className="flex flex-wrap gap-2">
                            {communicationGroups.map((group, idx) => {
                              const isFeishu = group.platform === "feishu";
                              // 判断微信群的 targetIdOrUrl 是否为图片
                              const isWechatImage = !isFeishu && (group.targetIdOrUrl ?? "").match(/\.(png|jpg|jpeg|gif|webp)$/i);

                              // 智能链接解析：强制清洗 + 多格式 oc_ ID 提取 + 群聊/单聊分流
                              const getFeishuLink = (inputVal: string | undefined | null): string => {
                                // 1. 清除所有空白字符（包含换行、零宽空格等不可见字符）
                                const rawInput = (inputVal || "").replace(/\s+/g, "");
                                if (!rawInput) return "#";

                                // 2. 多模式提取 oc_ ID（oc_ ID 可含连字符 -）
                                //   模式A: 路径格式      /chat/oc_xxx          (飞书网页版 messenger 链接)
                                //   模式B: 查询参数      openChatId=oc_xxx     (飞书网页版 messages 页面，最常见！)
                                //                       chatId=oc_xxx          (AppLink 格式)
                                //                       chat_id / open_chat_id (其他变体)
                                const OC_ID = "oc_[a-zA-Z0-9_-]+";
                                const extractPatterns = [
                                  new RegExp(`\\/chat\\/(${OC_ID})`),
                                  new RegExp(`[?&](?:openChatId|chatId|chat_id|open_chat_id|chat)=(${OC_ID})`),
                                ];

                                let extractedId: string | null = null;
                                for (const pattern of extractPatterns) {
                                  const m = rawInput.match(pattern);
                                  if (m) { extractedId = m[1]; break; }
                                }

                                // 3. 分流处理：群聊使用 openChatId 参数，单聊用 openId
                                if (extractedId || rawInput.startsWith("oc_")) {
                                  // 群聊 (oc_)：使用 openChatId 参数（官方支持的群聊参数名）
                                  const validId = extractedId || rawInput;
                                  return `https://applink.feishu.cn/client/chat/open?openChatId=${validId}`;
                                } else if (rawInput.startsWith("ou_") || rawInput.startsWith("on_")) {
                                  // 单聊/机器人 (ou_/on_)：使用 openId 参数
                                  return `https://applink.feishu.cn/client/chat/open?openId=${rawInput}`;
                                } else if (rawInput.startsWith("http")) {
                                  return rawInput;
                                }
                                return "#";
                              };

                              const href = isFeishu
                                ? getFeishuLink(group.targetIdOrUrl)
                                : ((group.targetIdOrUrl || "").replace(/\s+/g, "") || "#");

                              const isDisabled = href === "#";
                              const sharedClassName = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all";
                              const sharedStyle = {
                                background: isFeishu ? "#eff6ff" : "#f0fdf4",
                                color: isFeishu ? "#1d4ed8" : "#047857",
                                border: `1.5px solid ${isFeishu ? "#2563eb" : "#059669"}`,
                              };

                              // chatId 为空时渲染为不可点击的 span，避免无效跳转
                              if (isDisabled) {
                                return (
                                  <span
                                    key={idx}
                                    className={`${sharedClassName} opacity-40 cursor-not-allowed`}
                                    style={sharedStyle}
                                    title="群组 ID 未填写"
                                  >
                                    {isFeishu ? "📱" : "💬"}
                                    {group.name}
                                  </span>
                                );
                              }

                              return (
                                <a
                                  key={idx}
                                  href={href}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`${sharedClassName} hover:shadow-md`}
                                  style={sharedStyle}
                                  title={isWechatImage ? "点击查看二维码" : href}
                                >
                                  {isFeishu ? "📱" : isWechatImage ? "🖼️" : "💬"}
                                  {group.name}
                                  {isWechatImage && <span className="text-xs opacity-70">二维码</span>}
                                </a>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Section>

              {/* 2. 资金与到账管理 */}
              <Section
                title="💰 资金与到账管理"
                icon={<>💰</>}
                defaultOpen={true}
              >
                {isEditing ? (
                  /* ─── 编辑态：总金额 + 动态明细 ─── */
                  <div className="space-y-4">
                    {/* 总金额输入 */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm font-medium text-gray-700">
                          总金额（万元）
                        </label>
                        {/* 从子项目提取汇总按钮（仅主项目显示） */}
                        {!isSubProject && (
                          <button
                            type="button"
                            disabled={isExtractingTotal}
                            onClick={async () => {
                              if (!detail?.id) return;
                              setIsExtractingTotal(true);
                              try {
                                const res = await fetch("/api/major-projects/aggregate-amounts", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ projectIds: [detail.id], target: "total" }),
                                });
                                const data = await res.json() as { results?: { totalAmount?: number }[]; error?: string };
                                if (!res.ok) throw new Error(data.error);
                                const val = data.results?.[0]?.totalAmount;
                                if (val !== undefined) setTotalAmount(String(val));
                                setSaveToast({ ok: true, msg: "提取汇总成功，已更新金额" });
                                onAmountsUpdated?.();
                              } catch (e) {
                                setSaveToast({ ok: false, msg: "提取失败，请重试" });
                                console.error(e);
                              } finally {
                                setIsExtractingTotal(false);
                              }
                            }}
                            className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 disabled:opacity-50"
                          >
                            {isExtractingTotal
                              ? <Loader2 size={12} className="animate-spin" />
                              : <span>↓</span>
                            }
                            从子项目提取汇总
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <input
                          type="number"
                          step="0.01"
                          value={totalAmount}
                          onChange={(e) => setTotalAmount(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="请输入项目总金额"
                        />
                      </div>
                    </div>

                    {/* 汇总已到账金额动作按钮（仅主项目显示） */}
                    {!isSubProject && (
                      <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-gray-200 bg-gray-50">
                        <div>
                          <span className="text-sm font-medium text-gray-700">已到账金额（汇总）</span>
                          <p className="text-xs text-gray-400 mt-0.5">点击按钮从子项目实时提取汇总到账金额</p>
                        </div>
                        <button
                          type="button"
                          disabled={isExtractingReceived}
                          onClick={async () => {
                            if (!detail?.id) return;
                            setIsExtractingReceived(true);
                            try {
                              const res = await fetch("/api/major-projects/aggregate-amounts", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ projectIds: [detail.id], target: "received" }),
                              });
                              const data = await res.json() as { results?: { receivedAmount?: number }[]; error?: string };
                              if (!res.ok) throw new Error(data.error);
                              const val = data.results?.[0]?.receivedAmount;
                              if (val !== undefined) setReceivedAmount(String(val));
                              setSaveToast({ ok: true, msg: "提取汇总成功，已更新金额" });
                              onAmountsUpdated?.();
                            } catch (e) {
                              setSaveToast({ ok: false, msg: "提取失败，请重试" });
                              console.error(e);
                            } finally {
                              setIsExtractingReceived(false);
                            }
                          }}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg bg-white transition-colors flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {isExtractingReceived
                            ? <Loader2 size={12} className="animate-spin" />
                            : <span>↓</span>
                          }
                          从子项目提取汇总
                        </button>
                      </div>
                    )}

                    {/* 到账明细列表 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        到账明细节点
                      </label>
                      <div className="space-y-2 bg-slate-50 rounded-lg p-3 border border-slate-200">
                        {paymentRecords.length === 0 ? (
                          <p className="text-sm text-gray-400 text-center py-2">
                            暂无到账记录，点击下方按钮添加
                          </p>
                        ) : (
                          paymentRecords.map((rec, idx) => (
                            <div key={idx} className="flex gap-2 items-start bg-white rounded-lg p-2 border border-slate-200">
                              <div className="flex-1 grid grid-cols-3 gap-2">
                                <div>
                                  <input
                                    type="date"
                                    value={rec.paymentDate}
                                    onChange={(e) => {
                                      const next = [...paymentRecords];
                                      next[idx].paymentDate = e.target.value;
                                      setPaymentRecords(next);
                                    }}
                                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                    placeholder="到账日期"
                                  />
                                </div>
                                <div>
                                  <input
                                    type="number"
                                    step="0.01"
                                    value={rec.amount}
                                    onChange={(e) => {
                                      const next = [...paymentRecords];
                                      next[idx].amount = Number(e.target.value) || 0;
                                      setPaymentRecords(next);
                                    }}
                                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                    placeholder="金额(万)"
                                  />
                                </div>
                                <div>
                                  <input
                                    type="text"
                                    value={rec.remark}
                                    onChange={(e) => {
                                      const next = [...paymentRecords];
                                      next[idx].remark = e.target.value;
                                      setPaymentRecords(next);
                                    }}
                                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                    placeholder="款项备注"
                                  />
                                </div>
                              </div>
                              <button
                                onClick={() => {
                                  setPaymentRecords(paymentRecords.filter((_, i) => i !== idx));
                                }}
                                className="px-2 py-1.5 text-red-600 hover:bg-red-50 rounded transition-colors text-sm"
                                title="删除此节点"
                              >
                                ✕
                              </button>
                            </div>
                          ))
                        )}
                        {/* 新增节点按钮 */}
                        <button
                          onClick={() => {
                            setPaymentRecords([
                              ...paymentRecords,
                              { amount: 0, paymentDate: "", remark: "" },
                            ]);
                          }}
                          className="w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all flex items-center justify-center gap-1.5"
                        >
                          <span className="text-lg">➕</span>
                          新增到账节点
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* ─── 阅读态：总览 + 进度条 + 时间轴 ─── */
                  <div className="bg-slate-50 rounded-xl p-4 space-y-4">
                    {/* 上半部分：资金总览 */}
                    <div className="grid grid-cols-3 gap-4">
                      <div className="text-center">
                        <p className="text-sm text-gray-500 mb-1">总金额</p>
                        <p className="text-2xl font-bold text-gray-800">
                          {totalAmount ? `${Number(totalAmount).toFixed(2)} 万` : "未设置"}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-gray-500 mb-1">已到账</p>
                        <p className="text-2xl font-bold text-green-600">
                          {(() => {
                            const sum = paymentRecords.reduce((acc, r) => acc + (r.amount || 0), 0);
                            // 兼容旧数据：若无明细记录则降级显示 receivedAmount 字段
                            const display = paymentRecords.length > 0 ? sum : Number(receivedAmount) || 0;
                            return `${display.toFixed(2)} 万`;
                          })()}
                        </p>
                      </div>
                      <div className="text-center">
                        <p className="text-sm text-gray-500 mb-1">待到账</p>
                        <p className="text-2xl font-bold text-orange-600">
                          {(() => {
                            const sum = paymentRecords.reduce((acc, r) => acc + (r.amount || 0), 0);
                            const displayReceived = paymentRecords.length > 0 ? sum : Number(receivedAmount) || 0;
                            const total = totalAmount ? Number(totalAmount) : 0;
                            const remain = total - displayReceived;
                            return `${Math.max(0, remain).toFixed(2)} 万`;
                          })()}
                        </p>
                      </div>
                    </div>

                    {/* 横向里程碑进度条 */}
                    {(() => {
                      const total = totalAmount ? Number(totalAmount) : 0;
                      const sum = paymentRecords.reduce((acc, r) => acc + (r.amount || 0), 0);
                      // 兼容旧数据：无明细记录时降级用 receivedAmount 字段
                      const displaySum = paymentRecords.length > 0 ? sum : Number(receivedAmount) || 0;
                      const pct = total > 0 ? Math.min(100, (displaySum / total) * 100) : 0;
                      const isFull = pct >= 99.9;

                      // 按时间升序排序，计算每笔的累计百分比
                      const sorted = paymentRecords
                        .slice()
                        .sort((a, b) => (a.paymentDate || "").localeCompare(b.paymentDate || ""));
                      let cumulative = 0;
                      const markers = sorted.map((rec) => {
                        cumulative += rec.amount || 0;
                        const markerPct = total > 0 ? Math.min(100, (cumulative / total) * 100) : 0;
                        return { ...rec, markerPct };
                      });

                      return (
                        <TooltipPrimitive.Provider delayDuration={100}>
                          <div>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-xs font-medium text-gray-600">到账进度</span>
                              <span className="text-xs font-bold" style={{ color: isFull ? "#059669" : "#2563eb" }}>
                                {pct.toFixed(1)}%
                              </span>
                            </div>
                            {/* 进度条容器 */}
                            <div className="relative w-full mt-6 mb-4">
                              {/* 轨道 + 进度高亮 */}
                              <div className="relative w-full h-3 bg-gray-200 rounded-full flex items-center">
                                <div
                                  className="absolute left-0 h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${pct}%`,
                                    background: isFull
                                      ? "linear-gradient(90deg, #059669 0%, #10b981 100%)"
                                      : "linear-gradient(90deg, #2563eb 0%, #3b82f6 100%)",
                                  }}
                                />
                                {/* 里程碑节点 */}
                                {total > 0 && markers.map((rec, idx) => (
                                  <TooltipPrimitive.Root key={idx}>
                                    <TooltipPrimitive.Trigger asChild>
                                      <div
                                        className="absolute z-10 w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-pointer hover:scale-125 transition-transform"
                                        style={{ left: `calc(${rec.markerPct}% - 8px)` }}
                                      />
                                    </TooltipPrimitive.Trigger>
                                    <TooltipPrimitive.Portal>
                                      <TooltipPrimitive.Content
                                        side="top"
                                        align="center"
                                        avoidCollisions
                                        sideOffset={10}
                                        style={{
                                          zIndex: 9999,
                                          background: "white",
                                          border: "1px solid #e2e8f0",
                                          borderRadius: "12px",
                                          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
                                          padding: "10px 14px",
                                          minWidth: "160px",
                                        }}
                                      >
                                        <p style={{ fontSize: "11px", color: "#9ca3af", marginBottom: "4px", fontFamily: "monospace" }}>
                                          {rec.paymentDate || "未填日期"}
                                        </p>
                                        <p style={{ fontSize: "15px", fontWeight: 700, color: "#059669", marginBottom: "4px" }}>
                                          {rec.amount.toFixed(2)} 万
                                        </p>
                                        {rec.remark && (
                                          <p style={{ fontSize: "11px", color: "#6b7280", display: "flex", alignItems: "center", gap: "4px" }}>
                                            <span>💬</span>{rec.remark}
                                          </p>
                                        )}
                                        <TooltipPrimitive.Arrow style={{ fill: "white", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.1))" }} />
                                      </TooltipPrimitive.Content>
                                    </TooltipPrimitive.Portal>
                                  </TooltipPrimitive.Root>
                                ))}
                              </div>
                            </div>
                            {paymentRecords.length === 0 && (
                              <p className="text-sm text-gray-400 text-center py-2">暂无到账记录</p>
                            )}
                          </div>
                        </TooltipPrimitive.Provider>
                      );
                    })()}
                  </div>
                )}
              </Section>

              {/* 3. 证明材料 */}
              <Section
                title="证明材料"
                icon={<Paperclip size={15} className="text-purple-500" />}
                defaultOpen={false}
              >
                {isEditing ? (
                  <FileMixedUploader value={proofMaterials} onChange={setProofMaterials} />
                ) : proofMaterials.length > 0 ? (
                  <div className="space-y-2">
                    {proofMaterials.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-gray-200">
                        {file.type === "image" ? (
                          <a href={file.url} target="_blank" rel="noopener noreferrer" className="flex-shrink-0">
                            <img
                              src={file.url}
                              alt={file.name}
                              className="w-10 h-10 object-cover rounded border border-gray-200"
                            />
                          </a>
                        ) : (
                          <>
                            {file.type === "feishu" && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                                飞书链接
                              </span>
                            )}
                            <Paperclip size={14} className="text-gray-500 flex-shrink-0" />
                          </>
                        )}
                        <a
                          href={file.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline flex-1 truncate"
                        >
                          {file.name}
                        </a>
                        {file.size && (
                          <span className="text-xs text-gray-400">{(file.size / 1024 / 1024).toFixed(1)}MB</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">无证明材料</p>
                )}
              </Section>

              {/* 4. 项目生命周期管理 */}
              <Section title="项目生命周期管理" icon={<Calendar size={15} className="text-orange-500" />}>
                {isEditing ? (
                  /* 编辑态：保持垂直列表 */
                  <div className="space-y-4">
                    {milestones.map((m, i) => (
                      <MilestoneCard
                        key={m.type}
                        milestone={m}
                        isEditing={true}
                        userTargets={userTargets}
                        onChange={(updated) => {
                          const next = [...milestones];
                          next[i] = updated;
                          setMilestones(next);
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  /* 阅读态：横向时间线 + 详情面板 */
                  <div>
                    {/* 横向时间线 Stepper */}
                    <div className="flex items-center justify-between mb-6">
                      {MILESTONE_ORDER.map((type, idx) => {
                        const meta = MILESTONE_META[type];
                        const milestone = milestones.find(m => m.type === type);
                        const isActive = activeMilestoneType === type;
                        const isDone = milestone?.status === "DONE";

                        return (
                          <React.Fragment key={type}>
                            {/* 连线（第一个节点前不显示） */}
                            {idx > 0 && (
                              <div className="flex-1 h-px bg-gray-200 mx-2" />
                            )}

                            {/* 节点 */}
                            <div
                              onClick={() => setActiveMilestoneType(type)}
                              className={`flex flex-col items-center cursor-pointer transition-all ${
                                isActive ? "transform scale-105" : "hover:scale-105"
                              }`}
                            >
                              {/* 圆点 */}
                              <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                                  isActive
                                    ? "border-blue-500 bg-blue-50 shadow-md"
                                    : isDone
                                    ? "border-green-500 bg-green-50"
                                    : "border-gray-300 bg-white hover:border-gray-400"
                                }`}
                                style={{
                                  borderColor: isActive ? meta.color : undefined,
                                  background: isActive ? `${meta.color}15` : undefined,
                                }}
                              >
                                {isDone ? (
                                  <span className="text-green-600 font-bold text-lg">✓</span>
                                ) : (
                                  <Calendar size={16} style={{ color: isActive ? meta.color : "#94a3b8" }} />
                                )}
                              </div>

                              {/* 节点名称 */}
                              <p
                                className={`mt-2 text-xs font-medium whitespace-nowrap ${
                                  isActive ? "text-gray-900" : "text-gray-500"
                                }`}
                                style={{ color: isActive ? meta.color : undefined }}
                              >
                                {meta.label}
                              </p>

                              {/* 状态标记 */}
                              {!isActive && (
                                <span className="text-[10px] text-gray-400 mt-0.5">
                                  {isDone ? "已完成" : "待推进"}
                                </span>
                              )}
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </div>

                    {/* 详情面板：只渲染当前选中节点 */}
                    <div className="mt-6 p-4 bg-slate-50/50 rounded-lg border border-gray-200">
                      {(() => {
                        const milestone = milestones.find(m => m.type === activeMilestoneType);
                        const meta = MILESTONE_META[activeMilestoneType];
                        if (!milestone) return <p className="text-sm text-gray-500">节点数据未找到</p>;

                        return (
                          <div className="space-y-4">
                            {/* 节点标题 */}
                            <div className="flex items-center gap-2 pb-3 border-b border-gray-200">
                              <div
                                className="w-3 h-3 rounded-full"
                                style={{ background: meta.color }}
                              />
                              <h3 className="text-base font-semibold text-gray-800">{meta.label}</h3>
                              <span
                                className={`ml-auto px-2 py-0.5 text-xs rounded-full ${
                                  milestone.status === "DONE"
                                    ? "bg-green-100 text-green-700"
                                    : "bg-yellow-100 text-yellow-700"
                                }`}
                              >
                                {milestone.status === "DONE" ? "已完成" : "待推进"}
                              </span>
                            </div>

                            {/* 详情内容：复用 Grid 双列布局 */}
                            <div className="grid grid-cols-2 gap-y-4 gap-x-4">
                              {/* 日期 */}
                              <div className={meta.isRange ? "col-span-2" : ""}>
                                <p className="text-sm font-normal text-muted-foreground mb-1">日期</p>
                                <p className="text-base font-medium text-foreground">
                                  {meta.isRange
                                    ? (() => {
                                        const s = fmtDate(milestone.startDate);
                                        const e = fmtDate(milestone.endDate);
                                        if (s && e) return `${s} - ${e}`;
                                        if (s) return `${s} 起`;
                                        if (e) return `截至 ${e}`;
                                        return "时间未定";
                                      })()
                                    : fmtDate(milestone.date) || "时间未定"}
                                </p>
                              </div>

                              {/* 备注 */}
                              <div className="col-span-2">
                                <p className="text-sm font-normal text-muted-foreground mb-1">备注</p>
                                <p className="text-base font-medium text-foreground whitespace-pre-wrap">
                                  {milestone.notes || <span className="text-gray-400 italic">暂无</span>}
                                </p>
                              </div>

                              {/* 附件 */}
                              {milestone.attachments && milestone.attachments.length > 0 && (
                                <div className="col-span-2">
                                  <p className="text-sm font-normal text-muted-foreground mb-1">附件</p>
                                  <div className="space-y-1">
                                    {milestone.attachments.map((file, idx) => (
                                      <div key={idx} className="flex items-center gap-2 text-sm">
                                        <Paperclip size={12} className="text-gray-400" />
                                        <a
                                          href={file.url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-600 hover:underline"
                                        >
                                          {file.name}
                                        </a>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* 考核指标（仅 START/MID_CHECK/END） */}
                              {meta.hasKpis && milestone.kpis && milestone.kpis.length > 0 && (
                                <div className="col-span-2 pt-3 border-t border-gray-200">
                                  <p className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1">
                                    <Target size={14} className="text-green-500" />
                                    考核指标
                                  </p>
                                  <div className="space-y-2">
                                    {milestone.kpis.map((kpi, idx) => (
                                      <div key={idx} className="p-3 bg-white rounded-lg border border-gray-100">
                                        <div className="grid grid-cols-2 gap-2 text-sm">
                                          <div>
                                            <span className="text-xs text-gray-500">指标名称</span>
                                            <p className="font-medium text-gray-800">{kpi.name || "无"}</p>
                                          </div>
                                          <div>
                                            <span className="text-xs text-gray-500">指标值/描述</span>
                                            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{kpi.content || "无"}</p>
                                          </div>
                                          <div className="col-span-2">
                                            <span className="text-xs text-gray-500">负责人</span>
                                            {kpi.ownerFeishuOpenId && kpi.ownerName ? (
                                              <a
                                                href={getFeishuAppLink(kpi.ownerFeishuOpenId)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1 px-2 py-1 text-sm font-medium rounded-md cursor-pointer hover:opacity-80 transition-opacity"
                                                style={{
                                                  background: "#f0fdf4",
                                                  color: "#047857",
                                                }}
                                              >
                                                {kpi.ownerName}
                                                <span className="text-xs opacity-70">↗</span>
                                              </a>
                                            ) : (
                                              <p className="text-gray-700">{kpi.ownerName || "未指定"}</p>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* ── 答辩详细信息 ─────────────────────────── */}
                              {milestone.hasDefense && milestone.defenseDetails && (() => {
                                const dd = milestone.defenseDetails;

                                // 答辩结果语义色
                                const resultStyle: Record<string, { bg: string; text: string }> = {
                                  "顺利通过": { bg: "#dcfce7", text: "#15803d" },
                                  "需整改":   { bg: "#ffedd5", text: "#c2410c" },
                                  "未通过":   { bg: "#fee2e2", text: "#b91c1c" },
                                  "待答辩":   { bg: "#f1f5f9", text: "#64748b" },
                                };
                                const rs = dd.defenseResult
                                  ? (resultStyle[dd.defenseResult] ?? { bg: "#f1f5f9", text: "#64748b" })
                                  : null;

                                return (
                                  <div className="col-span-2 my-4 border-t border-dashed border-gray-200 pt-4">
                                    {/* 区块标题 */}
                                    <h4 className="text-base font-semibold text-slate-800 flex items-center gap-2 mb-4">
                                      🎙️ 答辩详细信息
                                    </h4>

                                    <div className="grid grid-cols-2 gap-y-5 gap-x-4">
                                      {/* 第一行：答辩时间 + 答辩形式 */}
                                      <div>
                                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩时间</p>
                                        <p className="text-base font-medium text-foreground">
                                          {dd.defenseDate
                                            ? new Date(dd.defenseDate).toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
                                            : <span className="text-gray-400 italic">暂无</span>}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩形式</p>
                                        {dd.defenseFormat ? (
                                          <span
                                            className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold"
                                            style={{ background: "#eff6ff", color: "#1d4ed8" }}
                                          >
                                            {dd.defenseFormat}
                                          </span>
                                        ) : (
                                          <p className="text-base font-medium text-gray-400 italic">暂无</p>
                                        )}
                                      </div>

                                      {/* 第二行：答辩地点 + 答辩结果 */}
                                      <div>
                                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩地点/会议号</p>
                                        <p className="text-base font-medium text-foreground">
                                          {dd.defenseLocation || <span className="text-gray-400 italic">暂无</span>}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩结果</p>
                                        {rs && dd.defenseResult ? (
                                          <span
                                            className="inline-block px-3 py-1 rounded-full text-sm font-semibold"
                                            style={{ background: rs.bg, color: rs.text }}
                                          >
                                            {dd.defenseResult}
                                          </span>
                                        ) : (
                                          <span
                                            className="inline-block px-3 py-1 rounded-full text-sm font-semibold"
                                            style={{ background: "#f1f5f9", color: "#64748b" }}
                                          >
                                            待答辩
                                          </span>
                                        )}
                                      </div>

                                      {/* 第三行：主讲人/答辩人（飞书AppLink标签） */}
                                      <div className="col-span-2">
                                        <p className="text-sm font-normal text-muted-foreground mb-1">主讲人/答辩人</p>
                                        {dd.presenterFeishu && dd.presenterFeishu.length > 0 ? (
                                          <div className="flex flex-wrap gap-1.5">
                                            {dd.presenterFeishu.map((presenter) => (
                                              <a
                                                key={presenter.id}
                                                href={getFeishuAppLink(presenter.id)}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-lg hover:opacity-80 transition-opacity"
                                                style={{ background: "#f0fdf4", color: "#047857", border: "1px solid #bbf7d0" }}
                                              >
                                                {presenter.name}
                                                <span className="text-xs opacity-60">↗</span>
                                              </a>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="text-base font-medium text-gray-400 italic">暂无</p>
                                        )}
                                      </div>

                                      {/* 第四行：答辩委员会 */}
                                      <div className="col-span-2">
                                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩委员会组成</p>
                                        <p className="text-base font-medium text-foreground whitespace-pre-wrap">
                                          {dd.committee || <span className="text-gray-400 italic">暂无</span>}
                                        </p>
                                      </div>

                                      {/* 第五行：答辩备注 */}
                                      <div className="col-span-2">
                                        <p className="text-sm font-normal text-muted-foreground mb-1">答辩备注</p>
                                        <p className="text-base font-medium text-foreground whitespace-pre-wrap">
                                          {dd.remarks || <span className="text-gray-400 italic">暂无</span>}
                                        </p>
                                      </div>

                                      {/* 第六行：答辩材料附件 */}
                                      <div className="col-span-2">
                                        <p className="text-sm font-normal text-muted-foreground mb-2">答辩材料附件</p>
                                        {dd.attachments && dd.attachments.length > 0 ? (
                                          <div className="space-y-2">
                                            {dd.attachments.map((file, idx) => (
                                              <a
                                                key={idx}
                                                href={file.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50/40 transition-colors group"
                                              >
                                                {file.type === "feishu" ? (
                                                  <span
                                                    className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                                                    style={{ background: "#e0f2fe", color: "#0369a1", border: "1px solid #bae6fd" }}
                                                  >
                                                    飞书
                                                  </span>
                                                ) : (
                                                  <Paperclip size={13} className="flex-shrink-0 text-gray-400" />
                                                )}
                                                <span className="text-sm text-blue-700 group-hover:underline truncate flex-1">
                                                  {file.name}
                                                </span>
                                              </a>
                                            ))}
                                          </div>
                                        ) : (
                                          <p className="text-base font-medium text-gray-400 italic">暂无</p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </Section>
            </>
          )}
        </div>
      </div>

      {/* 保存结果 Toast */}
      {saveToast && (
        <div
          style={{
            position: "fixed", bottom: 28, right: 28, zIndex: 9999,
            padding: "12px 18px", borderRadius: 12,
            background: saveToast.ok ? "#16a34a" : "#dc2626",
            color: "white", fontSize: 13, fontWeight: 500,
            boxShadow: "0 8px 32px rgba(0,0,0,0.22)",
            display: "flex", alignItems: "center", gap: 8,
            maxWidth: 400, lineHeight: 1.5,
          }}
        >
          {saveToast.ok ? <Check size={15} /> : <AlertTriangle size={15} />}
          {saveToast.msg}
        </div>
      )}
    </div>
  );
}
