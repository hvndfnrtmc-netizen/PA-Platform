"use client";

import React, { useState, useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft, Pencil, Save, X, Plus, Trash2, ExternalLink,
  Link2, MessageSquare, Calendar, CheckCircle2, LayoutList,
  Building2, RotateCcw, Users, DollarSign, ChevronRight, User2,
  Check, Circle, Settings, Paperclip, BookOpen, User, Loader2,
} from "lucide-react";
import { FileUploader, FileItem } from "../../major-projects/FileUploader";
import { pinyin as toPinyin } from "pinyin-pro";
import { cleanMockChineseNames } from "@/app/actions/talent";

// ── 类型定义 ───────────────────────────────────────────────────────────────

type NodeStatus = "pending" | "in_progress" | "completed";

interface DeclarationNode {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status?: NodeStatus;
}

interface CycleRuleConfig {
  startMonth?: number;
  endMonth?: number;
  startDay?: number;
  endDay?: number;
  months?: number[];
}

interface PolicyLink { title: string; url: string; }
interface PolicySection { title: string; content: string; }
interface CloudAttachment { name: string; url: string; }
interface FeishuGroup { id: string; name: string; feishuId: string; }

interface EmbeddedTask {
  id: string;
  content: string;
  dateFrom: string | null;
  dateTo: string | null;
  isCompleted: boolean;
}

interface CycleNodeWithTasks extends DeclarationNode {
  tasks: EmbeddedTask[];
}

interface TalentProject {
  id: string;
  name: string;
  level: string;
  region: string;
  applicationUrl: string | null;
  wechatContactInfo: string | null;
  declarationFrequency: string | null;
  cycleRuleConfig: unknown;
  currentNode: string | null;
  declarationNodes: unknown;
  policyDescription: string | null;
  policySections: unknown;
  policyLinks: unknown;
  attachments: unknown;
  cloudAttachments: unknown;
  defaultOwnerId: string | null;
}

interface UserOption { id: string; name: string; englishName?: string | null; email?: string | null; feishuOpenId?: string | null; }

interface FormState {
  name: string;
  level: string;
  region: string;
  applicationUrl: string;
  wechatContactInfo: string;
  declarationFrequency: string;
  cycleRuleConfig: CycleRuleConfig;
  policyDescription: string;
  policySections: PolicySection[];
  policyLinks: PolicyLink[];
  attachments: FileItem[];
  cloudAttachments: CloudAttachment[];
  declarationNodes: DeclarationNode[];
  defaultOwnerId: string;
}

// ── 公司/周期类型 ──────────────────────────────────────────────────────────

interface CycleOwner { id: string; name: string; }

interface Cycle {
  id: string;
  companyId: string;
  name: string;
  windowStartDate: string | null;
  windowEndDate: string | null;
  declarationNodes: unknown;
  totalFunding: string | null;
  headcount: number | null;
  ownerId: string | null;
  owner: CycleOwner | null;
  feishuGroupUrl: string | null;
  sortOrder: number;
  createdAt: string;
}

interface Company {
  id: string;
  name: string;
  unifiedCode: string | null;
  cycles: Cycle[];
}

interface CycleTask {
  id: string;
  content: string;
  isCompleted: boolean;
  sortOrder: number;
}

interface FundDisbursement {
  id: string;
  awardeeId: string;
  trancheName: string;
  amount: string;
  expectedDate: string | null;
  isReceived: boolean;
  receivedDate: string | null;
  remark: string | null;
}

interface Awardee {
  id: string;
  batch: string;
  name: string;
  feishuOpenId: string | null;
  subsidy: string | null;
  approvedAmount: string | null;
  status: string;
  disbursements: FundDisbursement[];
}

interface FundStats {
  totalApproved: string;
  totalReceived: string;
}

interface CycleDetail extends Cycle {
  tasks: CycleTask[];
  awardees: Awardee[];
}

// ── 常量 ──────────────────────────────────────────────────────────────────

const LEVEL_OPTIONS    = ["国家级", "省级", "市级", "区级"];
const REGION_OPTIONS   = ["全国", "江苏省", "上海市", "深圳市", "苏州市", "相城区", "其他"];
const FREQ_OPTIONS     = ["年度申报", "月度申报", "季度申报", "常态化"];
const PRESET_NODES     = ["公司资质申报", "个人申报", "单位审核", "主管部门审核", "现场核验", "等待公示", "奖金发放"];
const AWARDEE_STATUSES = ["待确认", "已通过", "已拨付"];

const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "国家级": { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200" },
  "省级":   { bg: "bg-purple-50",  text: "text-purple-700",  border: "border-purple-200" },
  "市级":   { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200" },
  "区级":   { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
};

const INPUT_CLS = "w-full px-3 py-2 rounded-lg text-sm bg-slate-50 text-slate-800 outline-none focus:ring-2 focus:ring-blue-200 border border-slate-200";
const LABEL_CLS = "block text-xs font-medium text-slate-500 mb-1";

// ── 工具函数 ──────────────────────────────────────────────────────────────

function safeCycleRuleConfig(raw: unknown): CycleRuleConfig {
  if (!raw || typeof raw !== "object") return {};
  return raw as CycleRuleConfig;
}

function safeNodes(raw: unknown): DeclarationNode[] {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr.filter((n: unknown): n is DeclarationNode => !!n && typeof n === "object");
  } catch { return []; }
}

function safeCycleNodes(raw: unknown): CycleNodeWithTasks[] {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr.map((n: unknown) => {
      if (!n || typeof n !== "object") return null;
      const node = n as Record<string, unknown>;
      return {
        id:        String(node.id ?? newNodeId()),
        name:      String(node.name ?? ""),
        startDate: String(node.startDate ?? ""),
        endDate:   String(node.endDate ?? ""),
        status:    (node.status as NodeStatus) ?? "pending",
        tasks: Array.isArray(node.tasks) ? (node.tasks as Record<string, unknown>[]).map(t => ({
          id:          String(t.id ?? newTaskId()),
          content:     String(t.content ?? ""),
          dateFrom:    t.dateFrom ? String(t.dateFrom) : null,
          dateTo:      t.dateTo   ? String(t.dateTo)   : null,
          isCompleted: Boolean(t.isCompleted),
        })) : [],
      };
    }).filter(Boolean) as CycleNodeWithTasks[];
  } catch { return []; }
}

// ── 相对日期解析工具 ──────────────────────────────────────────────────────

function parseAnnualDate(s: string): { month: number; day: number } {
  const m = s.match(/^M(\d{1,2})-D(\d{1,2})$/);
  return m ? { month: parseInt(m[1]), day: parseInt(m[2]) } : { month: 0, day: 0 };
}

function parseDay(s: string): number {
  const m = s.match(/^D(\d{1,2})$/);
  return m ? parseInt(m[1]) : 0;
}

function parseDuration(s: string): number {
  const m = s.match(/^T(\d+)$/);
  return m ? parseInt(m[1]) : 0;
}

function safePolicyLinks(raw: unknown): PolicyLink[] {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]"));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function safeAttachments(raw: unknown): FileItem[] {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]"));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function safeCloudAttachments(raw: unknown): CloudAttachment[] {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr.filter((a: unknown): a is CloudAttachment =>
      !!a && typeof a === "object" && typeof (a as CloudAttachment).url === "string");
  } catch { return []; }
}

function safePolicySections(raw: unknown): PolicySection[] {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(String(raw ?? "[]"));
    if (!Array.isArray(arr)) return [];
    return arr.filter((s: unknown): s is PolicySection => !!s && typeof s === "object");
  } catch { return []; }
}

function projectToForm(p: TalentProject): FormState {
  return {
    name:                 p.name ?? "",
    level:                p.level ?? "国家级",
    region:               p.region ?? "",
    applicationUrl:       p.applicationUrl ?? "",
    wechatContactInfo:    p.wechatContactInfo ?? "",
    declarationFrequency: p.declarationFrequency ?? "",
    cycleRuleConfig:      safeCycleRuleConfig(p.cycleRuleConfig),
    policyDescription:    p.policyDescription ?? "",
    policySections:       safePolicySections(p.policySections),
    policyLinks:          safePolicyLinks(p.policyLinks),
    attachments:          safeAttachments(p.attachments),
    cloudAttachments:     safeCloudAttachments(p.cloudAttachments),
    declarationNodes:     safeNodes(p.declarationNodes),
    defaultOwnerId:       p.defaultOwnerId ?? "",
  };
}

function formatAmount(amount: string | number | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "—";
  const num = parseFloat(String(amount));
  if (isNaN(num)) return "—";
  if (num >= 100000000) return `${(num / 100000000).toFixed(1)} 亿元`;
  if (num >= 10000)     return `${(num / 10000).toFixed(0)} 万元`;
  return `${num.toLocaleString()} 元`;
}

function extractGroupFeishuId(url: string): string {
  if (!url) return "";
  if (url.startsWith("oc_")) return url;
  const m = url.match(/openId=(oc_[^&]+)/);
  return m ? m[1] : "";
}

function makeGroupUrl(feishuId: string): string {
  return feishuId ? `https://applink.feishu.cn/client/chat/open?openId=${feishuId}` : "";
}

function newNodeId(): string {
  return `n_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function newTaskId(): string {
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── 节点状态切换器 ────────────────────────────────────────────────────────

function NodeStatusToggle({ status, onChange }: { status: NodeStatus; onChange: (s: NodeStatus) => void }) {
  const options: { value: NodeStatus; label: string; active: string }[] = [
    { value: "pending",     label: "未开始", active: "bg-slate-100 text-slate-600 border-slate-300" },
    { value: "in_progress", label: "进行中", active: "bg-amber-50 text-amber-600 border-amber-300" },
    { value: "completed",   label: "已完成", active: "bg-green-50 text-green-600 border-green-300" },
  ];
  return (
    <div className="flex gap-1">
      {options.map(o => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${status === o.value ? o.active : "text-slate-400 border-slate-200 bg-white hover:bg-slate-50"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── 编辑表单 (Edit Form) — 项目基础信息 ──────────────────────────────────

function TalentEditForm({ form, setForm, feishuGroups, users }: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  feishuGroups: FeishuGroup[];
  users: UserOption[];
}) {
  function set(key: keyof FormState, value: string) {
    setForm(prev => ({ ...prev, [key]: value }));
  }
  function setCycleRule(updates: Partial<CycleRuleConfig>) {
    setForm(prev => ({ ...prev, cycleRuleConfig: { ...prev.cycleRuleConfig, ...updates } }));
  }
  function handleFreqChange(f: string) {
    const newFreq = form.declarationFrequency === f ? "" : f;
    setForm(prev => ({
      ...prev,
      declarationFrequency: newFreq,
      cycleRuleConfig: {},
      declarationNodes: prev.declarationNodes.map(n => ({ ...n, startDate: "", endDate: "" })),
    }));
  }
  // 政策段落
  function addPolicySection() {
    setForm(prev => ({ ...prev, policySections: [...prev.policySections, { title: "", content: "" }] }));
  }
  function removePolicySection(i: number) {
    setForm(prev => ({ ...prev, policySections: prev.policySections.filter((_, idx) => idx !== i) }));
  }
  function updatePolicySection(i: number, field: "title" | "content", value: string) {
    setForm(prev => ({
      ...prev,
      policySections: prev.policySections.map((s, idx) => idx === i ? { ...s, [field]: value } : s),
    }));
  }
  // 政策链接
  function addPolicyLink() {
    setForm(prev => ({ ...prev, policyLinks: [...prev.policyLinks, { title: "", url: "" }] }));
  }
  function removePolicyLink(i: number) {
    setForm(prev => ({ ...prev, policyLinks: prev.policyLinks.filter((_, idx) => idx !== i) }));
  }
  function updatePolicyLink(i: number, field: "title" | "url", value: string) {
    setForm(prev => ({
      ...prev,
      policyLinks: prev.policyLinks.map((l, idx) => idx === i ? { ...l, [field]: value } : l),
    }));
  }
  function handleImportPreset() {
    if (form.declarationNodes.length > 0 && !confirm("确认导入标准流程？当前节点列表将被替换。")) return;
    setForm(prev => ({
      ...prev,
      declarationNodes: PRESET_NODES.map(name => ({
        id: newNodeId(), name, startDate: "", endDate: "",
      })),
    }));
  }
  function addNode() {
    setForm(prev => ({
      ...prev,
      declarationNodes: [...prev.declarationNodes, { id: newNodeId(), name: "", startDate: "", endDate: "" }],
    }));
  }
  function removeNode(i: number) {
    setForm(prev => ({ ...prev, declarationNodes: prev.declarationNodes.filter((_, idx) => idx !== i) }));
  }
  function updateNode(i: number, field: "name" | "startDate" | "endDate", value: string) {
    setForm(prev => ({
      ...prev,
      declarationNodes: prev.declarationNodes.map((n, idx) => idx === i ? { ...n, [field]: value } : n),
    }));
  }
  const freq            = form.declarationFrequency;
  const isAnnual        = freq === "年度申报";
  const isMonthly       = freq === "月度申报";
  const isQuarterly     = freq === "季度申报";
  const isPerennial     = freq === "常态化";
  const isMonthlyOrQ    = isMonthly || isQuarterly;
  const months12        = Array.from({ length: 12 }, (_, k) => k + 1);
  const days31          = Array.from({ length: 31 }, (_, k) => k + 1);

  return (
    <div className="p-6 flex flex-col gap-5">
      {/* 基础信息 */}
      <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
        <h2 className="text-base font-semibold text-slate-700 mb-5">基础信息</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className={LABEL_CLS}>项目名称 <span className="text-red-500">*</span></label>
            <input className={INPUT_CLS} value={form.name} onChange={e => set("name", e.target.value)} placeholder="请输入项目全称" />
          </div>
          <div>
            <label className={LABEL_CLS}>申报级别</label>
            <select className={INPUT_CLS} value={form.level} onChange={e => set("level", e.target.value)}>
              {LEVEL_OPTIONS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL_CLS}>所属地区</label>
            <select className={INPUT_CLS} value={form.region} onChange={e => set("region", e.target.value)}>
              <option value="">— 请选择 —</option>
              {REGION_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* 申报周期规则 */}
      <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
        <h2 className="text-base font-semibold text-slate-700 mb-5">申报周期规则</h2>
        <div className="flex flex-col gap-4">
          <div>
            <label className={LABEL_CLS}>申报频次</label>
            <div className="flex flex-wrap gap-2 mt-1">
              {FREQ_OPTIONS.map(f => (
                <button key={f} type="button"
                  onClick={() => handleFreqChange(f)}
                  className={`px-4 py-2 rounded-full text-sm transition-colors border ${freq === f ? "bg-blue-50 border-blue-200 text-blue-600 font-medium" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {isAnnual && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLS}>窗口开始月份</label>
                <select className={INPUT_CLS} value={form.cycleRuleConfig.startMonth ?? ""} onChange={e => setCycleRule({ startMonth: e.target.value ? parseInt(e.target.value) : undefined })}>
                  <option value="">— 选择月份 —</option>
                  {months12.map(m => <option key={m} value={m}>{m} 月</option>)}
                </select>
              </div>
              <div>
                <label className={LABEL_CLS}>窗口结束月份</label>
                <select className={INPUT_CLS} value={form.cycleRuleConfig.endMonth ?? ""} onChange={e => setCycleRule({ endMonth: e.target.value ? parseInt(e.target.value) : undefined })}>
                  <option value="">— 选择月份 —</option>
                  {months12.map(m => <option key={m} value={m}>{m} 月</option>)}
                </select>
              </div>
            </div>
          )}

          {isMonthly && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={LABEL_CLS}>每月开始日</label>
                <input className={INPUT_CLS} type="number" min="1" max="31" placeholder="1"
                  value={form.cycleRuleConfig.startDay ?? ""}
                  onChange={e => setCycleRule({ startDay: e.target.value ? parseInt(e.target.value) : undefined })} />
              </div>
              <div>
                <label className={LABEL_CLS}>每月结束日</label>
                <input className={INPUT_CLS} type="number" min="1" max="31" placeholder="15"
                  value={form.cycleRuleConfig.endDay ?? ""}
                  onChange={e => setCycleRule({ endDay: e.target.value ? parseInt(e.target.value) : undefined })} />
              </div>
            </div>
          )}

          {isQuarterly && (
            <div className="flex flex-col gap-3">
              <div>
                <label className={LABEL_CLS}>包含月份（多选，如 1、4、7、10 月）</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {months12.map(m => {
                    const selected = (form.cycleRuleConfig.months ?? []).includes(m);
                    return (
                      <button key={m} type="button"
                        onClick={() => {
                          const cur = form.cycleRuleConfig.months ?? [];
                          const upd = selected ? cur.filter(x => x !== m) : [...cur, m].sort((a, b) => a - b);
                          setCycleRule({ months: upd });
                        }}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${selected ? "bg-blue-50 border-blue-300 text-blue-700" : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                        {m} 月
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL_CLS}>当月开始日</label>
                  <input className={INPUT_CLS} type="number" min="1" max="31" placeholder="1"
                    value={form.cycleRuleConfig.startDay ?? ""}
                    onChange={e => setCycleRule({ startDay: e.target.value ? parseInt(e.target.value) : undefined })} />
                </div>
                <div>
                  <label className={LABEL_CLS}>当月结束日</label>
                  <input className={INPUT_CLS} type="number" min="1" max="31" placeholder="15"
                    value={form.cycleRuleConfig.endDay ?? ""}
                    onChange={e => setCycleRule({ endDay: e.target.value ? parseInt(e.target.value) : undefined })} />
                </div>
              </div>
            </div>
          )}

          {isPerennial && (
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-green-50 border border-green-200 text-green-700 text-sm">
              <CheckCircle2 size={15} /> 常态化申报无固定窗口期，随时可发起实例。
            </div>
          )}
        </div>
      </div>

      {/* 申报节点模板 */}
      <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-semibold text-slate-700">申报节点模板</h2>
            <p className="text-xs text-slate-400 mt-0.5">创建申报周期时将自动复制此模板</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handleImportPreset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-purple-600 hover:bg-purple-50 border border-purple-200 transition-colors">
              <LayoutList size={13} /> 一键导入标准流程
            </button>
            <button type="button" onClick={addNode} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50 border border-blue-200 transition-colors">
              <Plus size={13} /> 新增节点
            </button>
          </div>
        </div>
        {!freq && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-xs mb-2">
            请先选择上方的「申报频次」，节点时间配置将自动联动显示
          </div>
        )}
        {form.declarationNodes.length === 0 ? (
          <p className="text-xs text-slate-400 py-6 text-center">暂无节点，点击「一键导入标准流程」快速填充</p>
        ) : (
          <div className="flex flex-col gap-3">
            {form.declarationNodes.map((node, i) => {
              const startA = isAnnual ? parseAnnualDate(node.startDate) : { month: 0, day: 0 };
              const endA   = isAnnual ? parseAnnualDate(node.endDate)   : { month: 0, day: 0 };
              const startD = isMonthlyOrQ ? parseDay(node.startDate) : 0;
              const endD   = isMonthlyOrQ ? parseDay(node.endDate)   : 0;
              const dur    = isPerennial  ? parseDuration(node.endDate) : 0;
              return (
                <div key={node.id} className="p-4 rounded-lg border border-slate-200 bg-slate-50">
                  <div className="flex items-start gap-2">
                    <span className="mt-2 w-5 h-5 rounded-full bg-slate-200 text-slate-500 text-xs flex items-center justify-center shrink-0 font-medium">{i + 1}</span>
                    <div className="flex-1 flex flex-col gap-2">
                      <input className={INPUT_CLS} value={node.name} onChange={e => updateNode(i, "name", e.target.value)} placeholder="节点名称" />

                      {isAnnual && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className={LABEL_CLS}>计划开始</label>
                            <div className="flex gap-1">
                              <select className={INPUT_CLS} value={startA.month || ""} onChange={e => updateNode(i, "startDate", `M${e.target.value}-D${startA.day || 1}`)}>
                                <option value="">月</option>
                                {months12.map(m => <option key={m} value={m}>{m} 月</option>)}
                              </select>
                              <select className={INPUT_CLS} value={startA.day || ""} onChange={e => updateNode(i, "startDate", `M${startA.month || 1}-D${e.target.value}`)}>
                                <option value="">日</option>
                                {days31.map(d => <option key={d} value={d}>{d} 日</option>)}
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>计划结束</label>
                            <div className="flex gap-1">
                              <select className={INPUT_CLS} value={endA.month || ""} onChange={e => updateNode(i, "endDate", `M${e.target.value}-D${endA.day || 1}`)}>
                                <option value="">月</option>
                                {months12.map(m => <option key={m} value={m}>{m} 月</option>)}
                              </select>
                              <select className={INPUT_CLS} value={endA.day || ""} onChange={e => updateNode(i, "endDate", `M${endA.month || 1}-D${e.target.value}`)}>
                                <option value="">日</option>
                                {days31.map(d => <option key={d} value={d}>{d} 日</option>)}
                              </select>
                            </div>
                          </div>
                        </div>
                      )}

                      {isMonthlyOrQ && (
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className={LABEL_CLS}>计划开始</label>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-slate-400 whitespace-nowrap">每月第</span>
                              <input className={INPUT_CLS} type="number" min="1" max="31" placeholder="1"
                                value={startD || ""}
                                onChange={e => updateNode(i, "startDate", `D${e.target.value}`)} />
                              <span className="text-xs text-slate-400">日</span>
                            </div>
                          </div>
                          <div>
                            <label className={LABEL_CLS}>计划结束</label>
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs text-slate-400 whitespace-nowrap">每月第</span>
                              <input className={INPUT_CLS} type="number" min="1" max="31" placeholder="15"
                                value={endD || ""}
                                onChange={e => updateNode(i, "endDate", `D${e.target.value}`)} />
                              <span className="text-xs text-slate-400">日</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {isPerennial && (
                        <div>
                          <label className={LABEL_CLS}>节点耗时</label>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">耗时</span>
                            <input className="w-24 px-3 py-2 rounded-lg text-sm bg-slate-50 text-slate-800 outline-none focus:ring-2 focus:ring-blue-200 border border-slate-200"
                              type="number" min="0" placeholder="0"
                              value={dur || ""}
                              onChange={e => {
                                updateNode(i, "startDate", "T0");
                                updateNode(i, "endDate", `T${e.target.value}`);
                              }} />
                            <span className="text-xs text-slate-400">天</span>
                          </div>
                        </div>
                      )}

                      {!freq && (
                        <p className="text-xs text-slate-400 italic">请先选择申报频次</p>
                      )}
                    </div>
                    <button type="button" onClick={() => removeNode(i)} className="mt-2 p-1.5 text-slate-400 hover:text-red-500 transition-colors shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 联络与申报入口 */}
      <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
        <h2 className="text-base font-semibold text-slate-700 mb-5">联络与申报入口</h2>
        <div className="flex flex-col gap-4">
          <div>
            <label className={LABEL_CLS}>受理网址（申报系统 URL）</label>
            <input className={INPUT_CLS} value={form.applicationUrl} onChange={e => set("applicationUrl", e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <label className={LABEL_CLS}>微信联系方式说明</label>
            <textarea className={INPUT_CLS} rows={2} value={form.wechatContactInfo} onChange={e => set("wechatContactInfo", e.target.value)} placeholder="如：添加微信 xxx，备注「申报咨询」" />
          </div>
        </div>
      </div>

      {/* 政策与附件 */}
      <div className="bg-white rounded-xl p-6 border border-slate-100 shadow-sm">
        <h2 className="text-base font-semibold text-slate-700 mb-5">政策与附件</h2>
        <div className="flex flex-col gap-6">
          {/* 政策段落（多维度） */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-500">政策说明（多维度）</label>
              <button type="button" onClick={addPolicySection}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Plus size={13} /> 新增政策维度
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {form.policySections.map((section, i) => (
                <div key={i} className="p-4 rounded-lg border border-slate-200 bg-slate-50 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-500 text-xs flex items-center justify-center shrink-0 font-medium">{i + 1}</span>
                    <input
                      className={INPUT_CLS}
                      value={section.title}
                      onChange={e => updatePolicySection(i, "title", e.target.value)}
                      placeholder="维度标题（如：申报条件、奖励标准）"
                    />
                    <button type="button" onClick={() => removePolicySection(i)}
                      className="p-1.5 text-slate-400 hover:text-red-500 transition-colors shrink-0">
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <textarea
                    className={INPUT_CLS}
                    rows={4}
                    value={section.content}
                    onChange={e => updatePolicySection(i, "content", e.target.value)}
                    placeholder="请填写该维度的详细内容..."
                  />
                </div>
              ))}
              {form.policySections.length === 0 && (
                <p className="text-xs text-slate-400 py-2">暂无政策维度，点击「新增政策维度」添加</p>
              )}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-500">政策原文链接</label>
              <button type="button" onClick={addPolicyLink} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Plus size={13} /> 新增政策链接
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {form.policyLinks.map((link, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input className={INPUT_CLS} value={link.title} onChange={e => updatePolicyLink(i, "title", e.target.value)} placeholder="链接名称 (如: 官网通知)" />
                  <input className={INPUT_CLS} value={link.url} onChange={e => updatePolicyLink(i, "url", e.target.value)} placeholder="URL 地址" />
                  <button type="button" onClick={() => removePolicyLink(i)} className="p-2 text-slate-400 hover:text-red-500 transition-colors shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {form.policyLinks.length === 0 && <p className="text-xs text-slate-400 py-2">暂无政策链接，点击"新增政策链接"添加</p>}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-slate-500">云附件 (如飞书文档)</label>
              <button type="button"
                onClick={() => setForm(prev => ({ ...prev, cloudAttachments: [...prev.cloudAttachments, { name: "", url: "" }] }))}
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
                <Plus size={13} /> 新增云附件
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {form.cloudAttachments.map((att, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input className={INPUT_CLS} value={att.name}
                    onChange={e => setForm(prev => ({ ...prev, cloudAttachments: prev.cloudAttachments.map((a, idx) => idx === i ? { ...a, name: e.target.value } : a) }))}
                    placeholder="附件名称 (如: 申报操作指南)" />
                  <input className={INPUT_CLS} value={att.url}
                    onChange={e => setForm(prev => ({ ...prev, cloudAttachments: prev.cloudAttachments.map((a, idx) => idx === i ? { ...a, url: e.target.value } : a) }))}
                    placeholder="云文档链接 URL" />
                  <button type="button"
                    onClick={() => setForm(prev => ({ ...prev, cloudAttachments: prev.cloudAttachments.filter((_, idx) => idx !== i) }))}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors shrink-0">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              {form.cloudAttachments.length === 0 && (
                <p className="text-xs text-slate-400 py-2">暂无附件，点击"新增云附件"添加</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 全局看板（仅统计） ────────────────────────────────────────────────────

function GlobalDashboard({ project, companies, fundStats }: {
  project: TalentProject;
  companies: Company[];
  fundStats: FundStats | null;
}) {
  const allCycles   = companies.flatMap(c => c.cycles);
  const totalPeople = allCycles.reduce((s, cy) => s + (cy.headcount ?? 0), 0);
  const totalCycles = allCycles.length;
  const lc = LEVEL_COLORS[project.level] ?? LEVEL_COLORS["区级"];

  const approved = parseFloat(fundStats?.totalApproved ?? "0") || 0;
  const received = parseFloat(fundStats?.totalReceived ?? "0") || 0;
  const receivedPct = approved > 0 ? Math.min(100, (received / approved) * 100) : 0;

  return (
    <div className="p-6 pb-0">
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-50 flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-lg text-xs font-bold border ${lc.bg} ${lc.text} ${lc.border}`}>{project.level}</span>
          <span className="text-sm text-slate-500">{project.region}</span>
          {project.declarationFrequency && (
            <span className="flex items-center gap-1 text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
              <Calendar size={11} /> {project.declarationFrequency}
            </span>
          )}
        </div>
        <div className="px-6 py-5 grid grid-cols-4 gap-6">
          <div>
            <p className="text-xs text-slate-400 mb-1">参与公司</p>
            <p className="text-2xl font-bold text-slate-800">{companies.length} <span className="text-sm font-normal text-slate-400">家</span></p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1">申报周期</p>
            <p className="text-2xl font-bold text-slate-800">{totalCycles} <span className="text-sm font-normal text-slate-400">个</span></p>
          </div>
          {/* 累计获批资金 */}
          <div>
            <p className="text-xs text-slate-400 mb-1">🏆 累计获批资金</p>
            <p className="text-2xl font-bold text-slate-800">
              {approved > 0 ? formatAmount(approved) : <span className="text-slate-300 text-base">未录入</span>}
            </p>
            {approved > 0 && (
              <div className="mt-1.5">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-xs text-emerald-600 font-medium">🏦 已到账 {receivedPct.toFixed(0)}%</span>
                  <span className="text-xs text-slate-400">{formatAmount(received)}</span>
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${receivedPct}%` }} />
                </div>
              </div>
            )}
          </div>
          {/* 累计覆盖人数 */}
          <div>
            <p className="text-xs text-slate-400 mb-1">累计覆盖人数</p>
            <p className="text-2xl font-bold text-slate-800">
              {totalPeople > 0 ? <>{totalPeople} <span className="text-sm font-normal text-slate-400">人</span></> : <span className="text-slate-300 text-base">未录入</span>}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 联络与政策区块（轻量，无边框卡片） ───────────────────────────────────

function ContactPolicySection({ project }: { project: TalentProject }) {
  const policyLinks       = safePolicyLinks(project.policyLinks);
  const cloudAttachments  = safeCloudAttachments(project.cloudAttachments);
  const policySections    = safePolicySections(project.policySections);
  const [isPolicyOpen,    setIsPolicyOpen]   = useState(false);
  const [policyDropdown,  setPolicyDropdown] = useState(false);
  const [attachDropdown,  setAttachDropdown] = useState(false);

  const hasLinks = project.applicationUrl || policyLinks.length > 0 || cloudAttachments.length > 0;

  return (
    <div className="px-6 pt-4 pb-2 flex flex-col gap-4">

      {/* ── 联络与操作栏 ── */}
      {(project.wechatContactInfo || hasLinks) && (
        <div className="flex flex-wrap items-center gap-3">

          {/* 联系人胶囊标签 */}
          {project.wechatContactInfo && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 text-sm rounded-full">
              <User size={14} />
              <span>微信联系人：{project.wechatContactInfo}</span>
            </div>
          )}

          {/* 受理系统链接 */}
          {project.applicationUrl && (
            <a href={project.applicationUrl} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm">
              <ExternalLink size={12} /> 前往受理系统
            </a>
          )}

          {/* 政策原文链接：单个 → 直链，多个 → 下拉菜单 */}
          {policyLinks.length === 1 && (
            <a href={policyLinks[0].url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm">
              <Link2 size={12} /> {policyLinks[0].title || "政策原文链接"}
            </a>
          )}
          {policyLinks.length > 1 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPolicyDropdown(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
              >
                <Link2 size={12} /> 政策原文链接
                <ChevronRight size={11} style={{ transform: policyDropdown ? "rotate(270deg)" : "rotate(90deg)", transition: "transform 150ms" }} />
              </button>
              {policyDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setPolicyDropdown(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 overflow-hidden">
                    {policyLinks.map((l, i) => (
                      <a key={i} href={l.url} target="_blank" rel="noopener noreferrer"
                        onClick={() => setPolicyDropdown(false)}
                        className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors">
                        <Link2 size={11} className="text-slate-400 shrink-0" />
                        {l.title || `链接 ${i + 1}`}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* 云附件：单个 → 直链，多个 → 下拉菜单 */}
          {cloudAttachments.length === 1 && (
            <a href={cloudAttachments[0].url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm">
              <Paperclip size={12} /> 相关云附件
            </a>
          )}
          {cloudAttachments.length > 1 && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setAttachDropdown(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors shadow-sm"
              >
                <Paperclip size={12} /> 相关云附件
                <ChevronRight size={11} style={{ transform: attachDropdown ? "rotate(270deg)" : "rotate(90deg)", transition: "transform 150ms" }} />
              </button>
              {attachDropdown && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAttachDropdown(false)} />
                  <div className="absolute left-0 top-full mt-1 z-50 min-w-[180px] bg-white border border-slate-200 rounded-lg shadow-lg py-1 overflow-hidden">
                    {cloudAttachments.map((att, i) => (
                      <a key={i} href={att.url} target="_blank" rel="noopener noreferrer"
                        onClick={() => setAttachDropdown(false)}
                        className="flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 transition-colors">
                        <Paperclip size={11} className="text-slate-400 shrink-0" />
                        {att.name || `附件 ${i + 1}`}
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 政策解读：全局单折叠面板 ── */}
      {policySections.length > 0 && (
        <div className="bg-slate-50/80 border border-slate-100 rounded-xl overflow-hidden mb-2">
          {/* 全局折叠触发头部 */}
          <button
            type="button"
            onClick={() => setIsPolicyOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-100/50 transition-colors text-left"
          >
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-blue-500 shrink-0" />
              <span className="font-semibold text-slate-700 text-sm">政策解读与说明</span>
            </div>
            <ChevronRight size={15} className="text-slate-400 shrink-0 transition-transform duration-200"
              style={{ transform: isPolicyOpen ? "rotate(90deg)" : "rotate(0deg)" }} />
          </button>

          {/* 展开后的全部内容（静态，不再逐条折叠） */}
          {isPolicyOpen && (
            <div className="bg-white px-6 py-5 border-t border-slate-100">
              {policySections.map((section, i) => (
                <div key={i} className={i > 0 ? "mt-4 pt-4 border-t border-slate-100" : ""}>
                  <div className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-md w-fit mb-2 tracking-wider">
                    {section.title || `政策维度 ${i + 1}`}
                  </div>
                  <div className="text-base text-slate-800 leading-loose whitespace-pre-wrap mb-6">
                    {section.content || "（暂无内容）"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {policySections.length === 0 && (
        <p className="text-xs text-slate-300 italic">暂无政策说明</p>
      )}
    </div>
  );
}

// ── 动态周期创建弹层 ──────────────────────────────────────────────────────

function DynamicCycleForm({
  frequency,
  feishuGroups,
  cycles,
  onSubmit,
  onClose,
  loading,
}: {
  frequency: string | null | undefined;
  feishuGroups: FeishuGroup[];
  cycles: Cycle[];
  onSubmit: (name: string, feishuGroupUrl: string, copyFromCycleId: string) => void;
  onClose: () => void;
  loading: boolean;
}) {
  const [yearInput,        setYearInput]        = useState(String(new Date().getFullYear()));
  const [monthInput,       setMonthInput]       = useState("");
  const [quarterSel,       setQuarterSel]       = useState<"Q1" | "Q2" | "Q3" | "Q4" | "">("");
  const [customName,       setCustomName]       = useState("");
  const [selectedGroup,    setSelectedGroup]    = useState("");
  const [copyFromCycleId,  setCopyFromCycleId]  = useState("");
  const [triedSubmit,      setTriedSubmit]      = useState(false);

  const QUARTER_LABELS: Record<string, string> = {
    Q1: "Q1（1–3月）",
    Q2: "Q2（4–6月）",
    Q3: "Q3（7–9月）",
    Q4: "Q4（10–12月）",
  };

  function buildName(): string {
    if (frequency === "年度申报") {
      return yearInput.trim() ? `${yearInput.trim()}年度` : "";
    }
    if (frequency === "月度申报") {
      if (!monthInput) return "";
      const [y, m] = monthInput.split("-");
      return `${y}年${parseInt(m)}月`;
    }
    if (frequency === "季度申报") {
      if (!yearInput.trim() || !quarterSel) return "";
      return `${yearInput.trim()}年${quarterSel}`;
    }
    return customName.trim();
  }

  const cycleName = buildName();
  const canSubmit = !!cycleName && !loading;

  function handleSubmit() {
    setTriedSubmit(true);
    console.log("[DynamicCycleForm] cycleName:", cycleName, "canSubmit:", canSubmit);
    if (canSubmit) onSubmit(cycleName, makeGroupUrl(selectedGroup), copyFromCycleId);
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">开启新申报周期</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* 年度申报：年份输入 */}
        {frequency === "年度申报" && (
          <div>
            <label className={LABEL_CLS}>申报年份</label>
            <input
              className={INPUT_CLS}
              type="number"
              min="2020"
              max="2035"
              value={yearInput}
              onChange={e => setYearInput(e.target.value)}
              placeholder="如：2025"
              autoFocus
            />
            {triedSubmit && !yearInput.trim() && (
              <p className="text-xs text-red-500 mt-1">请输入申报年份</p>
            )}
          </div>
        )}

        {/* 月度申报：月份选择器 */}
        {frequency === "月度申报" && (
          <div>
            <label className={LABEL_CLS}>申报月份</label>
            <input
              className={INPUT_CLS}
              type="month"
              value={monthInput}
              onChange={e => setMonthInput(e.target.value)}
              autoFocus
            />
            {triedSubmit && !monthInput && (
              <p className="text-xs text-red-500 mt-1">请选择申报月份</p>
            )}
          </div>
        )}

        {/* 季度申报：年份 + Q1-Q4 单选 */}
        {frequency === "季度申报" && (
          <div className="flex flex-col gap-3">
            <div>
              <label className={LABEL_CLS}>年份</label>
              <input
                className={INPUT_CLS}
                type="number"
                min="2020"
                max="2035"
                value={yearInput}
                onChange={e => setYearInput(e.target.value)}
                placeholder="如：2025"
                autoFocus
              />
            </div>
            <div>
              <label className={LABEL_CLS}>季度</label>
              <div className="grid grid-cols-2 gap-2">
                {(["Q1", "Q2", "Q3", "Q4"] as const).map(q => (
                  <button key={q} type="button"
                    onClick={() => setQuarterSel(q)}
                    className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors text-left ${
                      quarterSel === q
                        ? "bg-blue-50 border-blue-300 text-blue-700"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}>
                    {QUARTER_LABELS[q]}
                  </button>
                ))}
              </div>
              {triedSubmit && !quarterSel && (
                <p className="text-xs text-red-500 mt-1">请选择季度</p>
              )}
            </div>
          </div>
        )}

        {/* 常态化 / 无频次：自由文本 */}
        {(!frequency || frequency === "常态化") && (
          <div>
            <label className={LABEL_CLS}>周期名称</label>
            <input
              className={INPUT_CLS}
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              placeholder="如：2024第一批次"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
            />
            {triedSubmit && !customName.trim() && (
              <p className="text-xs text-red-500 mt-1">请输入周期名称</p>
            )}
          </div>
        )}

        {/* 预览 */}
        {cycleName && (
          <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
            周期名称将为：<span className="font-semibold text-slate-800">{cycleName}</span>
          </div>
        )}

        {/* 飞书沟通群（可选） */}
        {feishuGroups.length > 0 && (
          <div>
            <label className={LABEL_CLS}>飞书沟通群（可选）</label>
            <select className={INPUT_CLS} value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}>
              <option value="">— 不绑定飞书群 —</option>
              {feishuGroups.map(g => <option key={g.id} value={g.feishuId}>{g.name}</option>)}
            </select>
          </div>
        )}

        {/* 复用历史配置（可选，仅有历史周期时显示） */}
        {cycles.length > 0 && (
          <div>
            <label className={LABEL_CLS}>复用历史配置 (可选)</label>
            <select className={INPUT_CLS} value={copyFromCycleId} onChange={e => setCopyFromCycleId(e.target.value)}>
              <option value="">-- 不复用，使用项目基础模板 --</option>
              {cycles.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
            取消
          </button>
          <button type="button" onClick={handleSubmit} disabled={loading}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 transition-colors">
            {loading ? "创建中..." : "确认创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 动态日期组装 ──────────────────────────────────────────────────────────

function fmtDate(y: number, m: number, d: number): string {
  if (!y || !m || !d) return "";
  return `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`;
}

function assembleNodeDate(
  cycleName: string,
  cycleCreatedAt: string,
  node: DeclarationNode,
  nodeIndex: number,
  allNodes: DeclarationNode[],
  frequency: string | null | undefined
): string {
  try {
    if (frequency === "月度申报") {
      const m = cycleName.match(/(\d{4})年(\d{1,2})月/);
      if (!m) return "日期未定";
      const year = parseInt(m[1]), mon = parseInt(m[2]);
      const sd = parseDay(node.startDate), ed = parseDay(node.endDate);
      if (!sd && !ed) return "";
      const start = sd ? fmtDate(year, mon, sd) : "";
      const end   = ed ? fmtDate(year, mon, ed) : "";
      return start && end ? `${start} - ${end}` : start || end;
    }

    if (frequency === "年度申报") {
      const m = cycleName.match(/(\d{4})年度/);
      if (!m) return "日期未定";
      const year = parseInt(m[1]);
      const sd = parseAnnualDate(node.startDate), ed = parseAnnualDate(node.endDate);
      if (!sd.month && !ed.month) return "";
      const start = sd.month ? fmtDate(year, sd.month, sd.day) : "";
      const end   = ed.month ? fmtDate(year, ed.month, ed.day) : "";
      return start && end ? `${start} - ${end}` : start || end;
    }

    if (frequency === "季度申报") {
      const m = cycleName.match(/(\d{4})年Q([1-4])/);
      if (!m) return "日期未定";
      const year = parseInt(m[1]), qBase = (parseInt(m[2]) - 1) * 3 + 1;
      const sd = parseAnnualDate(node.startDate), ed = parseAnnualDate(node.endDate);
      if (!sd.month && !ed.month) return "";
      const start = sd.month ? fmtDate(year, qBase + sd.month - 1, sd.day) : "";
      const end   = ed.month ? fmtDate(year, qBase + ed.month - 1, ed.day) : "";
      return start && end ? `${start} - ${end}` : start || end;
    }

    if (frequency === "常态化") {
      const base = new Date(cycleCreatedAt);
      if (isNaN(base.getTime())) return "日期未定";
      // 累加前序节点的 duration，得出本节点起始偏移
      let offsetDays = 0;
      for (let i = 0; i < nodeIndex; i++) {
        offsetDays += parseDuration(allNodes[i].endDate) || 0;
      }
      const dur = parseDuration(node.endDate);
      const startDate = new Date(base); startDate.setDate(base.getDate() + offsetDays);
      const endDate   = new Date(base); endDate.setDate(base.getDate() + offsetDays + dur);
      const fmt = (d: Date) => fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
      return dur > 0 ? `${fmt(startDate)} - ${fmt(endDate)}` : fmt(startDate);
    }

    return "";
  } catch { return "日期未定"; }
}

// ── 节点步骤条（横向） ────────────────────────────────────────────────────

function NodeSteps({ nodes }: { nodes: DeclarationNode[] }) {
  if (nodes.length === 0) return <p className="text-sm text-slate-400 text-center py-4">暂无申报节点</p>;
  const currentIdx = nodes.findIndex(n => n.status !== "completed");

  return (
    <div className="flex items-start gap-0 overflow-x-auto pb-1">
      {nodes.map((node, i) => {
        const done    = node.status === "completed";
        const current = i === currentIdx;
        const future  = !done && !current;
        return (
          <div key={node.id ?? i} className="flex items-start shrink-0">
            <div className="flex flex-col items-center gap-1" style={{ minWidth: 72, maxWidth: 80 }}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center border-2 shrink-0 ${
                done ? "bg-green-500 border-green-500" :
                current ? "border-amber-400 bg-white" :
                          "border-slate-200 bg-white"
              }`}>
                {done    && <Check size={13} className="text-white" />}
                {current && <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />}
                {future  && <Circle size={10} className="text-slate-300" />}
              </div>
              <span className={`text-center leading-tight ${
                done ? "text-slate-400 line-through text-xs" :
                current ? "text-amber-700 font-semibold text-xs" :
                          "text-slate-400 text-xs"
              }`} style={{ fontSize: 10, whiteSpace: "pre-wrap", textAlign: "center", maxWidth: 68 }}>
                {node.name}
              </span>
            </div>
            {i < nodes.length - 1 && (
              <div className={`mt-3.5 h-0.5 shrink-0 ${done ? "bg-green-400" : "bg-slate-200"}`} style={{ width: 16 }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 节点任务工作台（Accordion） ──────────────────────────────────────────

function NodeStatusIcon({ status }: { status?: NodeStatus }) {
  if (status === "completed") return <CheckCircle2 size={16} className="text-green-500 shrink-0" />;
  if (status === "in_progress") return <span className="w-4 h-4 rounded-full bg-amber-400 animate-pulse inline-block shrink-0" />;
  return <Circle size={16} className="text-slate-300 shrink-0" />;
}

function NodeTaskWorkstation({
  cycle,
  projectNodes,
  cycleUrl,
  onCycleUpdated,
  frequency,
}: {
  cycle: CycleDetail;
  projectNodes: DeclarationNode[];
  cycleUrl: string;
  onCycleUpdated: (updated: CycleDetail) => void;
  frequency?: string | null;
}) {
  const initNodes = (): CycleNodeWithTasks[] => {
    const cn = safeCycleNodes(cycle.declarationNodes);
    return cn.length > 0 ? cn : projectNodes.map(n => ({ ...n, tasks: [] }));
  };

  const [nodes,         setNodes]         = useState<CycleNodeWithTasks[]>(initNodes);
  const [openNodeId,    setOpenNodeId]    = useState<string | null>(() => initNodes()[0]?.id ?? null);
  const [taskInputs,    setTaskInputs]    = useState<Record<string, { content: string; dateFrom: string; dateTo: string }>>({});
  const [editNodeId,    setEditNodeId]    = useState<string | null>(null);
  const [editNodeName,  setEditNodeName]  = useState("");
  const [editTaskId,    setEditTaskId]    = useState<string | null>(null);
  const [editTaskData,  setEditTaskData]  = useState<{ content: string; dateFrom: string; dateTo: string }>({ content: "", dateFrom: "", dateTo: "" });

  useEffect(() => {
    const reset = initNodes();
    setNodes(reset);
    setOpenNodeId(reset[0]?.id ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycle.id]);

  async function saveNodes(updated: CycleNodeWithTasks[]) {
    const res = await fetch(cycleUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ declarationNodes: updated }),
    });
    if (res.ok) {
      const data = await res.json();
      onCycleUpdated({ ...data, tasks: cycle.tasks, awardees: cycle.awardees });
    }
  }

  function updateNodeStatus(nodeId: string, status: NodeStatus) {
    const updated = nodes.map(n => n.id === nodeId ? { ...n, status } : n);
    setNodes(updated);
    saveNodes(updated);
  }

  function deleteNode(nodeId: string, name: string) {
    if (!confirm(`确认删除节点「${name}」？节点内的任务将一并删除。`)) return;
    const updated = nodes.filter(n => n.id !== nodeId);
    setNodes(updated);
    saveNodes(updated);
    if (openNodeId === nodeId) setOpenNodeId(updated[0]?.id ?? null);
  }

  function commitNodeName(nodeId: string) {
    if (!editNodeName.trim()) { setEditNodeId(null); return; }
    const updated = nodes.map(n => n.id === nodeId ? { ...n, name: editNodeName.trim() } : n);
    setNodes(updated);
    saveNodes(updated);
    setEditNodeId(null);
  }

  function addTask(nodeId: string) {
    const inp = taskInputs[nodeId] ?? { content: "", dateFrom: "", dateTo: "" };
    if (!inp.content.trim()) return;
    const t: EmbeddedTask = { id: newTaskId(), content: inp.content.trim(), dateFrom: inp.dateFrom || null, dateTo: inp.dateTo || null, isCompleted: false };
    const updated = nodes.map(n => n.id === nodeId ? { ...n, tasks: [...n.tasks, t] } : n);
    setNodes(updated);
    saveNodes(updated);
    setTaskInputs(prev => ({ ...prev, [nodeId]: { content: "", dateFrom: "", dateTo: "" } }));
  }

  function toggleTask(nodeId: string, taskId: string) {
    const updated = nodes.map(n => n.id === nodeId
      ? { ...n, tasks: n.tasks.map(t => t.id === taskId ? { ...t, isCompleted: !t.isCompleted } : t) }
      : n);
    setNodes(updated);
    saveNodes(updated);
  }

  function deleteTask(nodeId: string, taskId: string) {
    const updated = nodes.map(n => n.id === nodeId
      ? { ...n, tasks: n.tasks.filter(t => t.id !== taskId) }
      : n);
    setNodes(updated);
    saveNodes(updated);
  }

  function updateTask(nodeId: string, taskId: string) {
    if (!editTaskData.content.trim()) return;
    const updated = nodes.map(n => n.id === nodeId
      ? { ...n, tasks: n.tasks.map(t => t.id === taskId
          ? { ...t, content: editTaskData.content.trim(), dateFrom: editTaskData.dateFrom || null, dateTo: editTaskData.dateTo || null }
          : t) }
      : n);
    setNodes(updated);
    saveNodes(updated);
    setEditTaskId(null);
  }

  function addNewNode() {
    const newNode: CycleNodeWithTasks = { id: newNodeId(), name: "新节点", startDate: "", endDate: "", status: "pending", tasks: [] };
    const updated = [...nodes, newNode];
    setNodes(updated);
    saveNodes(updated);
    setOpenNodeId(newNode.id);
    setEditNodeId(newNode.id);
    setEditNodeName("新节点");
  }

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-50 flex items-center gap-2">
        <LayoutList size={14} className="text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-700">申报节点进度</h3>
      </div>

      {nodes.length > 0 && (
        <div className="px-5 pt-4 overflow-x-auto">
          <NodeSteps nodes={nodes} />
        </div>
      )}

      <div className="p-5 flex flex-col gap-2">
        {nodes.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-6">尚未配置节点，点击下方按钮添加个性化节点</p>
        )}

        {nodes.map((node, i) => {
          const isOpen = openNodeId === node.id;
          const doneTasks = node.tasks.filter(t => t.isCompleted).length;
          const inp = taskInputs[node.id] ?? { content: "", dateFrom: "", dateTo: "" };
          const dateStr = assembleNodeDate(cycle.name, String(cycle.createdAt ?? ""), node, i, nodes, frequency);

          return (
            <div key={node.id} className={`rounded-xl border transition-all ${isOpen ? "border-blue-200" : "border-slate-200"}`}>
              {/* Accordion Trigger */}
              <div
                className={`flex items-center gap-2 px-4 py-3 cursor-pointer select-none group ${isOpen ? "bg-blue-50/40 rounded-t-xl" : "hover:bg-slate-50 rounded-xl"}`}
                onClick={() => setOpenNodeId(isOpen ? null : node.id)}
              >
                <NodeStatusIcon status={node.status} />

                {editNodeId === node.id ? (
                  <input
                    className="flex-1 px-2 py-0.5 rounded border border-blue-300 text-sm bg-white outline-none"
                    value={editNodeName}
                    onChange={e => setEditNodeName(e.target.value)}
                    onBlur={() => commitNodeName(node.id)}
                    onKeyDown={e => { if (e.key === "Enter") commitNodeName(node.id); if (e.key === "Escape") setEditNodeId(null); }}
                    onClick={e => e.stopPropagation()}
                    autoFocus
                  />
                ) : (
                  <div className="flex-1 min-w-0 flex items-baseline gap-2">
                    <span className={`text-sm font-medium truncate ${node.status === "completed" ? "line-through text-slate-400" : "text-slate-700"}`}>
                      {node.name}
                    </span>
                    {dateStr && <span className="text-xs text-slate-400 shrink-0">{dateStr}</span>}
                    {node.tasks.length > 0 && (
                      <span className="text-xs text-slate-400 shrink-0">{doneTasks}/{node.tasks.length}</span>
                    )}
                  </div>
                )}

                {/* Hover action buttons */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                  <button type="button"
                    onClick={() => { setEditNodeId(node.id); setEditNodeName(node.name); }}
                    className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors">
                    <Pencil size={12} />
                  </button>
                  <button type="button"
                    onClick={() => deleteNode(node.id, node.name)}
                    className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Status toggle */}
                <div onClick={e => e.stopPropagation()}>
                  <NodeStatusToggle status={node.status ?? "pending"} onChange={s => updateNodeStatus(node.id, s)} />
                </div>

                <ChevronRight size={14} className={`text-slate-300 transition-transform shrink-0 ${isOpen ? "rotate-90" : ""}`} />
              </div>

              {/* Accordion Content */}
              {isOpen && (
                <div className="px-4 pb-4 border-t border-slate-100">
                  {/* Task list */}
                  <div className="flex flex-col gap-1 mt-3">
                    {node.tasks.length === 0 && (
                      <p className="text-xs text-slate-300 text-center py-2">暂无任务，在下方添加</p>
                    )}
                    {node.tasks.map(task => {
                      const isEditingTask = editTaskId === task.id;
                      return (
                        <div key={task.id} className="group/task py-1">
                          {isEditingTask ? (
                            /* ── 内联编辑模式 ── */
                            <div className="flex flex-col gap-1.5 bg-slate-50 rounded-lg p-2 border border-blue-200">
                              <input
                                className="w-full px-2 py-1 rounded text-sm bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-blue-200"
                                value={editTaskData.content}
                                onChange={e => setEditTaskData(prev => ({ ...prev, content: e.target.value }))}
                                onKeyDown={e => { if (e.key === "Enter") updateTask(node.id, task.id); if (e.key === "Escape") setEditTaskId(null); }}
                                autoFocus
                              />
                              <div className="flex gap-1.5 items-center flex-wrap">
                                <span className="text-xs text-slate-400 shrink-0">时间</span>
                                <input type="date"
                                  className="flex-1 min-w-[110px] px-2 py-0.5 rounded text-xs bg-white border border-slate-200 outline-none"
                                  value={editTaskData.dateFrom}
                                  onChange={e => setEditTaskData(prev => ({ ...prev, dateFrom: e.target.value }))}
                                />
                                <span className="text-xs text-slate-400">~</span>
                                <input type="date"
                                  className="flex-1 min-w-[110px] px-2 py-0.5 rounded text-xs bg-white border border-slate-200 outline-none"
                                  value={editTaskData.dateTo}
                                  onChange={e => setEditTaskData(prev => ({ ...prev, dateTo: e.target.value }))}
                                />
                              </div>
                              <div className="flex gap-1.5 justify-end">
                                <button type="button" onClick={() => setEditTaskId(null)}
                                  className="px-2.5 py-1 rounded text-xs border border-slate-200 text-slate-500 hover:bg-slate-100 transition-colors">
                                  取消
                                </button>
                                <button type="button" onClick={() => updateTask(node.id, task.id)} disabled={!editTaskData.content.trim()}
                                  className="px-2.5 py-1 rounded text-xs font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-40 transition-colors">
                                  保存
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* ── 普通显示模式 ── */
                            <div className="flex items-start gap-2">
                              <button type="button"
                                onClick={() => toggleTask(node.id, task.id)}
                                className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${task.isCompleted ? "bg-green-500 border-green-500" : "border-slate-300 bg-white hover:border-green-400"}`}>
                                {task.isCompleted && <Check size={10} className="text-white" />}
                              </button>
                              <div className="flex-1 min-w-0">
                                <span className={`text-sm ${task.isCompleted ? "line-through text-slate-400" : "text-slate-700"}`}>
                                  {task.content}
                                </span>
                                {(task.dateFrom || task.dateTo) && (
                                  <p className="text-[11px] text-slate-400 leading-tight mt-0.5">
                                    {[task.dateFrom, task.dateTo].filter(Boolean).join(" ~ ")}
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-0.5 opacity-0 group-hover/task:opacity-100 transition-opacity shrink-0">
                                <button type="button"
                                  onClick={() => { setEditTaskId(task.id); setEditTaskData({ content: task.content, dateFrom: task.dateFrom ?? "", dateTo: task.dateTo ?? "" }); }}
                                  className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors">
                                  <Pencil size={12} />
                                </button>
                                <button type="button"
                                  onClick={() => deleteTask(node.id, task.id)}
                                  className="p-1 text-slate-300 hover:text-red-500 rounded transition-colors">
                                  <X size={13} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Add task inline form */}
                  <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-2">
                    <input
                      className="w-full px-3 py-1.5 rounded-lg text-sm bg-slate-50 border border-slate-200 outline-none focus:ring-2 focus:ring-blue-200"
                      placeholder="新增任务内容..."
                      value={inp.content}
                      onChange={e => setTaskInputs(prev => ({ ...prev, [node.id]: { ...inp, content: e.target.value } }))}
                      onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addTask(node.id); } }}
                    />
                    <div className="flex gap-2 items-center flex-wrap">
                      <span className="text-xs text-slate-400 shrink-0">时间</span>
                      <input type="date"
                        className="flex-1 min-w-[120px] px-2 py-1 rounded-lg text-xs bg-slate-50 border border-slate-200 outline-none focus:ring-2 focus:ring-blue-200"
                        value={inp.dateFrom}
                        onChange={e => setTaskInputs(prev => ({ ...prev, [node.id]: { ...inp, dateFrom: e.target.value } }))}
                      />
                      <span className="text-xs text-slate-400">~</span>
                      <input type="date"
                        className="flex-1 min-w-[120px] px-2 py-1 rounded-lg text-xs bg-slate-50 border border-slate-200 outline-none focus:ring-2 focus:ring-blue-200"
                        value={inp.dateTo}
                        onChange={e => setTaskInputs(prev => ({ ...prev, [node.id]: { ...inp, dateTo: e.target.value } }))}
                      />
                      <button type="button" onClick={() => addTask(node.id)} disabled={!inp.content.trim()}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-600 hover:bg-blue-50 border border-blue-200 transition-colors disabled:opacity-40">
                        <Plus size={12} /> 添加任务
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Add new node */}
        <button type="button" onClick={addNewNode}
          className="mt-1 flex items-center justify-center gap-1.5 w-full py-2.5 rounded-xl text-xs font-medium text-slate-500 border border-dashed border-slate-200 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50 transition-colors">
          <Plus size={13} /> 为本周期新增个性化节点
        </button>
      </div>
    </div>
  );
}

// ── 入选名单卡 ────────────────────────────────────────────────────────────

// ── 个人资金拨付抽屉 ──────────────────────────────────────────────────────

function AwardeeFundDrawer({
  awardee,
  cycleUrl,
  onClose,
  onSaved,
}: {
  awardee: Awardee;
  cycleUrl: string;
  onClose: () => void;
  onSaved: (updated: Awardee) => void;
}) {
  type DraftLine = {
    id?: string;
    trancheName: string;
    amount: string;
    expectedDate: string;
    isReceived: boolean;
    receivedDate: string;
    remark: string;
  };

  const [lines, setLines]               = useState<DraftLine[]>([]);
  const [saving, setSaving]             = useState(false);
  const [loadError, setLoadError]       = useState("");
  // 核准总金额（万元单位，用户输入）；初始化时将 awardee.approvedAmount（元）÷10000
  const [approvedWan, setApprovedWan]   = useState(
    awardee.approvedAmount ? String(Math.round(parseFloat(awardee.approvedAmount) / 100) / 100) : ""
  );

  // 初始化：从 API 加载现有流水
  useEffect(() => {
    fetch(`${cycleUrl}/awardees/${awardee.id}/disbursements`)
      .then(r => r.json())
      .then((data: FundDisbursement[]) => {
        if (Array.isArray(data)) {
          setLines(data.map(d => ({
            id: d.id,
            trancheName: d.trancheName,
            amount:      d.amount,
            expectedDate: d.expectedDate ? d.expectedDate.slice(0, 10) : "",
            isReceived:  d.isReceived,
            receivedDate: d.receivedDate ? d.receivedDate.slice(0, 10) : "",
            remark:      d.remark ?? "",
          })));
        }
      })
      .catch(() => setLoadError("加载失败，请关闭后重试"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addLine() {
    setLines(prev => [...prev, { trancheName: `第${prev.length + 1}期`, amount: "", expectedDate: "", isReceived: false, receivedDate: "", remark: "" }]);
  }

  function removeLine(i: number) {
    setLines(prev => prev.filter((_, idx) => idx !== i));
  }

  function updateLine<K extends keyof DraftLine>(i: number, key: K, val: DraftLine[K]) {
    setLines(prev => prev.map((l, idx) => {
      if (idx !== i) return l;
      const next = { ...l, [key]: val };
      // 勾选已到账时自动填充 receivedDate
      if (key === "isReceived" && val === true && !l.receivedDate) {
        next.receivedDate = new Date().toISOString().slice(0, 10);
      }
      return next;
    }));
  }

  // 精确加法（避免浮点误差）
  function sumAmounts(ls: DraftLine[]): number {
    return ls.reduce((s, l) => {
      const n = parseFloat(l.amount);
      return s + (isNaN(n) ? 0 : n);
    }, 0);
  }

  const totalDisbursed   = sumAmounts(lines);
  const totalReceived    = sumAmounts(lines.filter(l => l.isReceived));
  // 分母：优先使用核准总金额（万→元），否则降级为排期总额
  const approvedAmountNum = parseFloat(approvedWan) * 10000;
  const denominator       = approvedAmountNum > 0 ? approvedAmountNum : totalDisbursed;
  const receivedPct       = denominator > 0 ? Math.min(100, (totalReceived / denominator) * 100) : 0;
  // 防呆：排期总额超出核准总额时飘红提示
  const overBudget = approvedAmountNum > 0 && totalDisbursed > approvedAmountNum;

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch(`${cycleUrl}/awardees/${awardee.id}/disbursements`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          disbursements: lines.map(l => ({
            trancheName:  l.trancheName,
            amount:       l.amount,
            expectedDate: l.expectedDate || null,
            isReceived:   l.isReceived,
            receivedDate: l.isReceived ? (l.receivedDate || null) : null,
            remark:       l.remark || null,
          })),
          // 同步保存核准总金额（万→元）
          approvedAmount: approvedAmountNum > 0 ? approvedAmountNum : undefined,
        }),
      });
      if (!res.ok) { alert("保存失败，请重试"); return; }
      // 重新拉取 disbursements，构造更新后的 awardee
      const updated: Awardee = {
        ...awardee,
        disbursements: await res.json(),
      };
      onSaved(updated);
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {/* 半透明遮罩 */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      {/* 抽屉主体 */}
      <div className="relative z-10 w-full max-w-lg h-full bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-base font-bold text-slate-800">💰 管理拨付计划</h2>
            <p className="text-xs text-slate-400 mt-0.5">{awardee.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* 核准总金额输入 + 拨付进度条 */}
        <div className="px-6 py-4 border-b border-slate-50 bg-slate-50 shrink-0 flex flex-col gap-3">
          {/* 独立核准总金额输入框 */}
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-slate-500 shrink-0">个人核准总金额</label>
            <div className="flex items-center gap-1.5 flex-1">
              <input
                type="number"
                min="0"
                step="0.01"
                value={approvedWan}
                onChange={e => setApprovedWan(e.target.value)}
                placeholder="输入总金额"
                className="w-32 px-2 py-1 rounded border border-slate-200 text-sm bg-white outline-none focus:ring-2 focus:ring-emerald-200"
              />
              <span className="text-xs text-slate-400">万元</span>
              {overBudget && (
                <span className="text-xs text-red-500 font-medium ml-1">⚠️ 排期总额已超出核准总额</span>
              )}
            </div>
          </div>

          {/* 进度条 */}
          {(denominator > 0) && (
            <>
              <div className="flex items-center justify-between">
                <span className="text-xs text-emerald-600 font-medium">实际到账 {receivedPct.toFixed(0)}%</span>
                <span className="text-xs text-slate-500">
                  {formatAmount(totalReceived)} / {formatAmount(denominator)}
                </span>
              </div>
              <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${receivedPct}%` }} />
              </div>
            </>
          )}
        </div>

        {/* 拨付明细列表 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loadError && <p className="text-sm text-red-500 mb-3">{loadError}</p>}
          {lines.length === 0 && !loadError && (
            <p className="text-sm text-slate-400 text-center py-8">暂无拨付计划，点击下方「新增一期」添加</p>
          )}
          <div className="flex flex-col gap-3">
            {lines.map((line, i) => (
              <div key={i} className={`rounded-xl border p-4 ${line.isReceived ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}>
                <div className="flex items-center justify-between mb-3">
                  <input
                    value={line.trancheName}
                    onChange={e => updateLine(i, "trancheName", e.target.value)}
                    placeholder="期数名称（如第一期/2024年度）"
                    className="flex-1 text-sm font-semibold text-slate-700 bg-transparent outline-none border-b border-slate-200 focus:border-blue-400 pb-0.5 mr-3"
                  />
                  <button onClick={() => removeLine(i)} className="text-slate-300 hover:text-red-500 transition-colors shrink-0">
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  <div>
                    <label className="text-xs text-slate-400 mb-0.5 block">金额（元）</label>
                    <input
                      type="number"
                      value={line.amount}
                      onChange={e => updateLine(i, "amount", e.target.value)}
                      placeholder="0.00"
                      className="w-full px-2 py-1 rounded text-sm border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 mb-0.5 block">预计到账时间</label>
                    <input
                      type="date"
                      value={line.expectedDate}
                      onChange={e => updateLine(i, "expectedDate", e.target.value)}
                      className="w-full px-2 py-1 rounded text-sm border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-200"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {/* 已到账开关 */}
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <button
                      type="button"
                      onClick={() => updateLine(i, "isReceived", !line.isReceived)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${line.isReceived ? "bg-emerald-500" : "bg-gray-300"}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${line.isReceived ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                    <span className={`text-xs font-medium ${line.isReceived ? "text-emerald-600" : "text-slate-400"}`}>
                      {line.isReceived ? "已到账" : "未到账"}
                    </span>
                  </label>
                  {line.isReceived && (
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-slate-400">到账日期</span>
                      <input
                        type="date"
                        value={line.receivedDate}
                        onChange={e => updateLine(i, "receivedDate", e.target.value)}
                        className="px-1.5 py-0.5 rounded text-xs border border-slate-200 bg-white outline-none"
                      />
                    </div>
                  )}
                </div>
                {!line.isReceived && (
                  <div className="mt-2">
                    <input
                      value={line.remark}
                      onChange={e => updateLine(i, "remark", e.target.value)}
                      placeholder="备注（可选）"
                      className="w-full px-2 py-1 rounded text-xs border border-slate-200 bg-slate-50 outline-none"
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <button onClick={addLine} className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors">
            <Plus size={13} /> 新增一期
          </button>
        </div>

        {/* 底部保存 */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-2 shrink-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">取消</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? "保存中…" : "保存拨付计划"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 入选名单 + 资金卡片 ────────────────────────────────────────────────────

function RosterFundingCard({
  cycle,
  users,
  cycleUrl,
  onCycleUpdated,
}: {
  cycle: CycleDetail;
  users: UserOption[];
  cycleUrl: string;
  onCycleUpdated: (updated: CycleDetail) => void;
}) {
  const [showAddForm, setShowAddForm]       = useState(false);
  const [searchQuery, setSearchQuery]       = useState("");
  const [selectedUsers, setSelectedUsers]   = useState<UserOption[]>([]);
  const [drawerAwardee, setDrawerAwardee]   = useState<Awardee | null>(null);
  const [ocrLoading, setOcrLoading]         = useState(false);
  const [addingBatch, setAddingBatch]       = useState(false);
  const [cleaningMock, setCleaningMock]     = useState(false);
  const router = useRouter();
  const ocrInputRef = React.useRef<HTMLInputElement>(null);

  // 中英双语 + 拼音乱序搜索
  const filteredUsers = useMemo(() => {
    const raw = searchQuery.trim();
    if (!raw) return [];
    const q = raw.toLowerCase();

    // 检测是否包含中文字符
    const isChinese = /[\u4e00-\u9fff]/.test(raw);

    if (isChinese) {
      // 中文 → 拼音数组（无音调），如 "高凯敬" → ["gao","kai","jing"]
      let pyArray: string[] = [];
      try {
        pyArray = toPinyin(raw, { toneType: "none", type: "array" }) as string[];
        console.log("🔤 [PinyinSearch] 中文拆分:", pyArray);
      } catch (e) {
        console.error("⚠️ 拼音库加载失败，降级为普通搜索", e);
      }

      if (pyArray.length > 0) {
        // AND 乱序：每个音节都必须出现在姓名/英文名/邮箱的某一字段中
        return users.filter(u => {
          const haystack = `${u.name} ${u.englishName ?? ""} ${u.email ?? ""}`.toLowerCase();
          return pyArray.every(py => haystack.includes(py));
        }).slice(0, 8);
      }
    }

    // 普通搜索（英文/邮箱/拼音直接匹配）
    return users.filter(u =>
      u.name.toLowerCase().includes(q)
      || (u.englishName ?? "").toLowerCase().includes(q)
      || (u.email ?? "").toLowerCase().includes(q)
    ).slice(0, 8);
  }, [users, searchQuery]);

  function toggleSelectUser(u: UserOption) {
    setSelectedUsers(prev =>
      prev.some(x => x.id === u.id)
        ? prev.filter(x => x.id !== u.id)
        : [...prev, u]
    );
  }

  async function handleBatchAddAwardees() {
    if (selectedUsers.length === 0) return;
    setAddingBatch(true);
    try {
      const newAwardees: Awardee[] = [];
      for (const u of selectedUsers) {
        const res = await fetch(`${cycleUrl}/awardees`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: u.name, feishuOpenId: u.feishuOpenId || null, status: "待确认" }),
        });
        if (res.ok) {
          const a = await res.json();
          newAwardees.push({ ...a, disbursements: a.disbursements ?? [] });
        }
      }
      if (newAwardees.length > 0) {
        onCycleUpdated({ ...cycle, awardees: [...cycle.awardees, ...newAwardees] });
      }
      setShowAddForm(false);
      setSelectedUsers([]);
      setSearchQuery("");
    } finally {
      setAddingBatch(false);
    }
  }

  async function handleOcrUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setOcrLoading(true);
    try {
      // 转 Base64
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // 去掉 data:image/xxx;base64, 前缀
          resolve(result.split(",")[1] ?? "");
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/talent-declaration/ocr-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType: file.type || "image/jpeg" }),
      });
      if (res.ok) {
        const data = await res.json();
        const matched: UserOption[] = (data.matchedUsers ?? []).map((u: UserOption) => u);
        // 将 AI 识别出的用户塞入已选列表（去重）
        setSelectedUsers(prev => {
          const merged = [...prev];
          for (const u of matched) {
            if (!merged.some(x => x.id === u.id)) merged.push(u);
          }
          return merged;
        });
        if (matched.length === 0) {
          alert(`AI 识别到人名：${(data.names ?? []).join("、") || "无"}，但未匹配到系统内用户`);
        }
      }
    } catch {
      alert("图片识别失败，请重试");
    } finally {
      setOcrLoading(false);
      if (ocrInputRef.current) ocrInputRef.current.value = "";
    }
  }

  async function handleUpdateStatus(id: string, status: string) {
    const res = await fetch(`${cycleUrl}/awardees/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      onCycleUpdated({ ...cycle, awardees: cycle.awardees.map(a => a.id === id ? { ...a, status } : a) });
    }
  }

  async function handleDeleteAwardee(id: string) {
    const res = await fetch(`${cycleUrl}/awardees/${id}`, { method: "DELETE" });
    if (res.ok) { onCycleUpdated({ ...cycle, awardees: cycle.awardees.filter(a => a.id !== id) }); }
  }

  const statusBadge: Record<string, string> = {
    "待确认": "bg-slate-100 text-slate-600",
    "已通过": "bg-blue-50 text-blue-600",
    "已拨付": "bg-green-50 text-green-700",
  };

  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-50 flex items-center gap-2">
        <Users size={14} className="text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-700">资金 & 入选名单</h3>
      </div>

      <div className="p-5">
        {/* ── 全自动资金大盘 ── */}
        {(() => {
          // 周期核准总额：优先用 awardee.approvedAmount；否则降级到 disbursements 加总
          const totalApproved = cycle.awardees.reduce((s, a) => {
            if (a.approvedAmount) {
              const v = parseFloat(a.approvedAmount);
              return s + (isNaN(v) ? 0 : v);
            }
            return s + (a.disbursements ?? []).reduce((ss, d) => {
              const v = parseFloat(d.amount); return ss + (isNaN(v) ? 0 : v);
            }, 0);
          }, 0);
          const totalReceived = cycle.awardees.reduce((s, a) =>
            s + (a.disbursements ?? []).filter(d => d.isReceived).reduce((ss, d) => {
              const v = parseFloat(d.amount); return ss + (isNaN(v) ? 0 : v);
            }, 0), 0);
          const totalAwardees = cycle.awardees.length;
          const progress = totalApproved > 0 ? Math.min(100, (totalReceived / totalApproved) * 100) : 0;
          const fmtWan = (n: number) => n >= 10000 ? `${(n / 10000).toFixed(2)}` : n.toFixed(2);
          return (
            <div className="mb-6 bg-slate-50/50 rounded-xl p-5 border border-slate-100">
              <div className="flex justify-between items-end mb-3">
                <div className="text-sm font-medium text-slate-500">周期资金拨付进度</div>
                <div className="text-sm text-slate-500 bg-white px-3 py-1 rounded-full border shadow-sm">
                  👥 本期入选: <span className="font-semibold text-slate-700">{totalAwardees}</span> 人
                </div>
              </div>
              {/* 进度条 */}
              <div className="h-3 bg-slate-200 rounded-full overflow-hidden mb-3">
                <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
              </div>
              <div className="flex justify-between items-center">
                <div className="text-lg font-bold text-slate-800">
                  核准总额 <span className="text-2xl">{fmtWan(totalApproved)}</span> <span className="text-sm font-normal text-slate-500">万元</span>
                </div>
                <div className="text-emerald-600 font-medium">
                  实际已到账 <span className="text-xl font-bold">{fmtWan(totalReceived)}</span> 万元
                  <span className="text-sm ml-1 opacity-80">({progress.toFixed(1)}%)</span>
                </div>
              </div>
            </div>
          );
        })()}
        {cycle.awardees.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-4">暂无入选人员，点击下方「添加人员」录入</p>
        ) : (
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-400 border-b border-slate-100">
                  <th className="text-left pb-2 font-medium pr-3">姓名</th>
                  <th className="text-left pb-2 font-medium pr-3">资金情况</th>
                  <th className="text-left pb-2 font-medium pr-3">状态</th>
                  <th className="text-left pb-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {cycle.awardees.map(a => {
                  // 优先使用个人核准总金额；未填则降级为 disbursements 加总
                  const approvedAmt = a.approvedAmount && parseFloat(a.approvedAmount) > 0
                    ? parseFloat(a.approvedAmount)
                    : (a.disbursements ?? []).reduce((s, d) => {
                        const v = parseFloat(d.amount); return s + (isNaN(v) ? 0 : v);
                      }, 0);
                  const receivedAmt = (a.disbursements ?? []).filter(d => d.isReceived).reduce((s, d) => {
                    const v = parseFloat(d.amount); return s + (isNaN(v) ? 0 : v);
                  }, 0);
                  return (
                    <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="py-2 pr-3 font-medium text-slate-800">{a.name}</td>
                      <td className="py-2 pr-3">
                        {approvedAmt > 0 ? (
                          <div className="text-xs leading-relaxed">
                            <span className="text-slate-600">总额: <span className="font-medium text-slate-800">{formatAmount(approvedAmt)}</span></span>
                            <span className="mx-1 text-slate-300">|</span>
                            <span className={receivedAmt > 0 ? "text-emerald-600" : "text-slate-400"}>
                              已到账: {receivedAmt > 0 ? formatAmount(receivedAmt) : "—"}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">暂无拨付计划</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          value={a.status}
                          onChange={e => handleUpdateStatus(a.id, e.target.value)}
                          className={`px-1.5 py-0.5 rounded text-xs font-medium border-0 outline-none cursor-pointer ${statusBadge[a.status] ?? "bg-slate-100 text-slate-600"}`}
                        >
                          {AWARDEE_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          {/* 管理拨付计划 */}
                          <button
                            type="button"
                            onClick={() => setDrawerAwardee(a)}
                            className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors border border-amber-200 bg-amber-50 px-1.5 py-0.5 rounded"
                          >
                            💰 拨付计划
                          </button>
                          {a.feishuOpenId && (
                            <a
                              href={`https://applink.feishu.cn/client/chat/open?openId=${a.feishuOpenId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 transition-colors"
                            >
                              <MessageSquare size={11} /> 飞书
                            </a>
                          )}
                          <button type="button" onClick={() => handleDeleteAwardee(a.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!showAddForm ? (
          <button type="button" onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors">
            <Plus size={13} /> 添加人员
          </button>
        ) : (
          <div className="border border-blue-100 rounded-xl p-4 bg-blue-50 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-slate-600">搜索并批量添加人员</p>
              {/* 图片智能识别按钮 */}
              <button
                type="button"
                disabled={ocrLoading}
                onClick={() => ocrInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium border transition-colors disabled:opacity-50"
                style={{ background: "linear-gradient(135deg,#e0f2fe,#ede9fe)", borderColor: "#a5b4fc", color: "#4f46e5" }}
              >
                {ocrLoading ? <Loader2 size={12} className="animate-spin" /> : "🖼️"}
                {ocrLoading ? "AI 识别中…" : "图片智能识别"}
              </button>
              <input ref={ocrInputRef} type="file" accept="image/*" className="hidden" onChange={handleOcrUpload} />
            </div>

            {/* 已选人员 Badge 胶囊 */}
            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedUsers.map(u => (
                  <span key={u.id} className="flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                    {u.name}{u.englishName ? ` (${u.englishName})` : ""}
                    <button type="button" onClick={() => setSelectedUsers(prev => prev.filter(x => x.id !== u.id))}
                      className="ml-0.5 text-blue-400 hover:text-blue-700 font-bold leading-none">×</button>
                  </span>
                ))}
              </div>
            )}

            {/* 搜索框：支持中文姓名 / 拼音 / 邮箱 */}
            <div className="flex items-center gap-2">
              <input
                className="flex-1 px-3 py-2 rounded-lg text-sm bg-white border border-slate-200 outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="支持输入中/英文名搜索 (自动拼音匹配)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <button
                type="button"
                disabled={cleaningMock}
                onClick={async () => {
                  setCleaningMock(true);
                  try {
                    const result = await cleanMockChineseNames();
                    if (result.success) {
                      alert(`脏数据已擦除，共清理 ${result.cleaned} 条记录`);
                      window.location.reload();
                    } else {
                      alert(`擦除失败: ${result.error}`);
                    }
                  } finally {
                    setCleaningMock(false);
                  }
                }}
                className="flex-shrink-0 text-xs px-2 py-1.5 rounded-lg border border-slate-300 text-slate-500 bg-white hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                title="擦除测试假名，恢复真实英文名"
              >
                {cleaningMock ? <Loader2 size={11} className="animate-spin inline" /> : "🧹"}
              </button>
            </div>
            {searchQuery && (
              <div className="border border-slate-200 rounded-lg bg-white overflow-hidden">
                {filteredUsers.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-3">未找到匹配人员</p>
                ) : (
                  filteredUsers.map(u => {
                    const isSelected = selectedUsers.some(x => x.id === u.id);
                    return (
                      <button key={u.id} type="button" onClick={() => toggleSelectUser(u)}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between ${isSelected ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-blue-50"}`}>
                        <span>
                          <span className="font-medium">{u.name}</span>
                          {u.englishName && <span className="ml-1 text-xs text-slate-500">({u.englishName})</span>}
                          {u.email && <span className="ml-1.5 text-xs text-slate-400">- {u.email}</span>}
                        </span>
                        {isSelected && <Check size={14} className="text-blue-600 shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end items-center">
              <button type="button"
                onClick={() => { setShowAddForm(false); setSelectedUsers([]); setSearchQuery(""); }}
                className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
                取消
              </button>
              <button type="button" onClick={handleBatchAddAwardees}
                disabled={selectedUsers.length === 0 || addingBatch}
                className="px-3 py-1.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center gap-1">
                {addingBatch && <Loader2 size={12} className="animate-spin" />}
                确认批量添加{selectedUsers.length > 0 ? `（${selectedUsers.length}人）` : ""}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 个人拨付抽屉 */}
      {drawerAwardee && (
        <AwardeeFundDrawer
          awardee={drawerAwardee}
          cycleUrl={cycleUrl}
          onClose={() => setDrawerAwardee(null)}
          onSaved={updated => {
            onCycleUpdated({ ...cycle, awardees: cycle.awardees.map(a => a.id === updated.id ? updated : a) });
            setDrawerAwardee(null);
          }}
        />
      )}
    </div>
  );
}

// ── 周期看板 ──────────────────────────────────────────────────────────────

function CycleKanban({
  cycle,
  projectNodes,
  users,
  cycleUrl,
  onCycleUpdated,
  frequency,
}: {
  cycle: CycleDetail;
  projectNodes: DeclarationNode[];
  users: UserOption[];
  cycleUrl: string;
  onCycleUpdated: (updated: CycleDetail) => void;
  frequency?: string | null;
}) {
  return (
    <div className="px-6 py-4 flex flex-col gap-4">
      {/* 节点任务工作台（全宽） */}
      <NodeTaskWorkstation
        cycle={cycle}
        projectNodes={projectNodes}
        cycleUrl={cycleUrl}
        onCycleUpdated={onCycleUpdated}
        frequency={frequency}
      />

      {/* 入选名单 */}
      <RosterFundingCard cycle={cycle} users={users} cycleUrl={cycleUrl} onCycleUpdated={onCycleUpdated} />
    </div>
  );
}

// ── 主页面 ────────────────────────────────────────────────────────────────

export default function TalentDeclarationDetailPage() {
  const params       = useParams();
  const router       = useRouter();
  const searchParams = useSearchParams();
  const id           = params.id as string;
  const isNew        = id === "new";

  const [project,    setProject]    = useState<TalentProject | null>(null);
  const [loading,    setLoading]    = useState(!isNew);
  const [isEditing,  setIsEditing]  = useState(isNew || searchParams.get("edit") === "true");
  const [saving,     setSaving]     = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [users,        setUsers]        = useState<UserOption[]>([]);
  const [feishuGroups, setFeishuGroups] = useState<FeishuGroup[]>([]);
  const [toast,        setToast]        = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const [form, setForm] = useState<FormState>({
    name: "", level: "国家级", region: "",
    applicationUrl: "", wechatContactInfo: "",
    declarationFrequency: "", cycleRuleConfig: {},
    policyDescription: "",
    policySections: [],
    policyLinks: [], attachments: [], cloudAttachments: [], declarationNodes: [],
    defaultOwnerId: "",
  });

  const [fundStats,          setFundStats]         = useState<FundStats | null>(null);
  const [companies,         setCompanies]         = useState<Company[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [selectedCycleId,   setSelectedCycleId]   = useState<string | null>(null);
  const [cycleDetail,       setCycleDetail]        = useState<CycleDetail | null>(null);
  const [cycleDetailLoading,setCycleDetailLoading] = useState(false);

  // 弹层状态
  const [showManageCompany, setShowManageCompany] = useState(false);
  const [showAddCycle,      setShowAddCycle]      = useState(false);
  const [addCompanyName,    setAddCompanyName]    = useState("");
  const [addingCompany,     setAddingCompany]     = useState(false);
  const [addingCycle,       setAddingCycle]       = useState(false);

  // 周期设置弹层状态
  const [showCycleSettings,        setShowCycleSettings]        = useState<string | null>(null);
  const [cycleSettingsName,        setCycleSettingsName]        = useState("");
  const [cycleSettingsOwnerId,     setCycleSettingsOwnerId]     = useState("");
  const [cycleSettingsFeishuGroup, setCycleSettingsFeishuGroup] = useState("");
  const [showDeleteCycleConfirm,   setShowDeleteCycleConfirm]   = useState(false);
  const [renamingCycle,            setRenamingCycle]            = useState(false);
  const [deletingCycle,            setDeletingCycle]            = useState(false);

  // ── 加载项目数据 ──
  useEffect(() => {
    if (isNew) return;
    fetch(`/api/talent-declaration/${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) { setFetchError(data.error); }
        else { setProject(data); setForm(projectToForm(data)); }
        setLoading(false);
      })
      .catch(() => { setFetchError("加载失败，请刷新重试"); setLoading(false); });
  }, [id, isNew]);

  // ── 加载全局资金统计 ──
  useEffect(() => {
    if (isNew) return;
    fetch(`/api/talent-declaration/${id}/fund-stats`)
      .then(r => r.json())
      .then(data => { if (data.totalApproved !== undefined) setFundStats(data); })
      .catch(() => {});
  }, [id, isNew]);

  // ── 加载公司列表 ──
  useEffect(() => {
    if (isNew) return;
    fetch(`/api/talent-declaration/${id}/companies`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setCompanies(data);
          if (data.length > 0 && !selectedCompanyId) {
            setSelectedCompanyId(data[0].id);
            if (data[0].cycles.length > 0) setSelectedCycleId(data[0].cycles[0].id);
          }
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew]);

  // ── 加载用户列表 ──
  useEffect(() => {
    fetch("/api/users?take=200")
      .then(r => r.json())
      .then(data => { if (Array.isArray(data.users)) setUsers(data.users); })
      .catch(() => {});
  }, []);

  // ── 加载飞书群列表 ──
  useEffect(() => {
    fetch("/api/admin/feishu-targets")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.targets)) {
          setFeishuGroups(
            data.targets
              .filter((t: { type: string }) => t.type === "GROUP")
              .map((t: { id: string; name: string; feishuId: string }) => ({ id: t.id, name: t.name, feishuId: t.feishuId }))
          );
        }
      })
      .catch(() => {});
  }, []);

  // ── 加载周期详情 ──
  useEffect(() => {
    if (!selectedCycleId || !selectedCompanyId) { setCycleDetail(null); return; }
    setCycleDetailLoading(true);
    fetch(`/api/talent-declaration/${id}/companies/${selectedCompanyId}/cycles/${selectedCycleId}`)
      .then(r => r.json())
      .then(data => { if (!data.error) setCycleDetail(data); })
      .catch(() => {})
      .finally(() => setCycleDetailLoading(false));
  }, [id, selectedCompanyId, selectedCycleId]);

  const selectedCompany = companies.find(c => c.id === selectedCompanyId);
  const cycles          = selectedCompany?.cycles ?? [];
  const cycleUrl        = selectedCompanyId && selectedCycleId
    ? `/api/talent-declaration/${id}/companies/${selectedCompanyId}/cycles/${selectedCycleId}`
    : "";

  // ── 新增公司 ──
  async function handleAddCompany() {
    const name = addCompanyName.trim();
    if (!name) return;
    setAddingCompany(true);
    try {
      const res = await fetch(`/api/talent-declaration/${id}/companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) {
        const company = await res.json();
        setCompanies(prev => [...prev, { ...company, cycles: [] }]);
        setSelectedCompanyId(company.id);
        setSelectedCycleId(null);
        setCycleDetail(null);
        setAddCompanyName("");
      }
    } finally { setAddingCompany(false); }
  }

  // ── 新增周期（接受动态生成的名称） ──
  async function handleAddCycle(cycleName: string, feishuGroupUrl = "", copyFromCycleId = "") {
    if (!cycleName || !selectedCompanyId) return;
    setAddingCycle(true);
    try {
      const res = await fetch(`/api/talent-declaration/${id}/companies/${selectedCompanyId}/cycles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cycleName,
          feishuGroupUrl: feishuGroupUrl || null,
          ...(copyFromCycleId ? { copyFromCycleId } : {}),
        }),
      });
      if (res.ok) {
        const cycle = await res.json();
        setCompanies(prev => prev.map(c =>
          c.id === selectedCompanyId ? { ...c, cycles: [...c.cycles, cycle] } : c
        ));
        setSelectedCycleId(cycle.id);
        setShowAddCycle(false);
      }
    } finally { setAddingCycle(false); }
  }

  // ── 保存周期设置（名称 + 负责人 + 飞书群） ──
  async function handleSaveCycleSettings(cycleId: string) {
    if (!cycleSettingsName.trim() || !selectedCompanyId) return;
    setRenamingCycle(true);
    try {
      const feishuGroupUrl = cycleSettingsFeishuGroup ? makeGroupUrl(cycleSettingsFeishuGroup) : null;
      const res = await fetch(
        `/api/talent-declaration/${id}/companies/${selectedCompanyId}/cycles/${cycleId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name:          cycleSettingsName.trim(),
            ownerId:       cycleSettingsOwnerId || null,
            feishuGroupUrl,
          }),
        }
      );
      if (res.ok) {
        const updated = await res.json();
        setCompanies(prev => prev.map(c =>
          c.id === selectedCompanyId
            ? { ...c, cycles: c.cycles.map(cy => cy.id === cycleId
                ? { ...cy, name: updated.name, ownerId: updated.ownerId, owner: updated.owner, feishuGroupUrl: updated.feishuGroupUrl }
                : cy) }
            : c
        ));
        if (cycleId === selectedCycleId && cycleDetail) {
          setCycleDetail(prev => prev ? { ...prev, name: updated.name, ownerId: updated.ownerId, owner: updated.owner, feishuGroupUrl: updated.feishuGroupUrl } : null);
        }
        setShowCycleSettings(null);
        setToast({ msg: "周期设置已保存", type: "success" });
        setTimeout(() => setToast(null), 3000);
      }
    } finally { setRenamingCycle(false); }
  }

  // ── 删除周期 ──
  async function handleDeleteCycle(cycleId: string) {
    if (!selectedCompanyId) return;
    setDeletingCycle(true);
    try {
      const res = await fetch(
        `/api/talent-declaration/${id}/companies/${selectedCompanyId}/cycles/${cycleId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        const remaining = cycles.filter(cy => cy.id !== cycleId);
        setCompanies(prev => prev.map(c =>
          c.id === selectedCompanyId
            ? { ...c, cycles: c.cycles.filter(cy => cy.id !== cycleId) }
            : c
        ));
        if (selectedCycleId === cycleId) {
          setSelectedCycleId(remaining[0]?.id ?? null);
          setCycleDetail(null);
        }
        setShowDeleteCycleConfirm(false);
        setShowCycleSettings(null);
        setToast({ msg: "周期已删除", type: "success" });
        setTimeout(() => setToast(null), 3000);
      }
    } finally { setDeletingCycle(false); }
  }

  // ── 保存项目基础信息 ──
  async function handleSave() {
    if (!form.name.trim()) {
      setToast({ msg: "项目名称不能为空", type: "error" });
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), level: form.level, region: form.region,
        applicationUrl:       form.applicationUrl       || null,
        wechatContactInfo:    form.wechatContactInfo     || null,
        declarationFrequency: form.declarationFrequency  || null,
        cycleRuleConfig:      Object.keys(form.cycleRuleConfig).length > 0 ? form.cycleRuleConfig : null,
        policyDescription:    form.policyDescription     || null,
        policySections:       form.policySections.filter(s => s.title.trim() || s.content.trim()),
        policyLinks:  form.policyLinks.filter(l => l.title.trim() || l.url.trim()),
        attachments:  form.attachments,
        cloudAttachments: form.cloudAttachments.filter(a => a.url.trim()),
        declarationNodes: form.declarationNodes,
        defaultOwnerId: form.defaultOwnerId || null,
      };
      const url    = isNew ? "/api/talent-declaration" : `/api/talent-declaration/${id}`;
      const method = isNew ? "POST" : "PATCH";
      const res    = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data   = await res.json();
      if (!res.ok) { setToast({ msg: data.error || "保存失败", type: "error" }); return; }

      setToast({ msg: "保存成功！", type: "success" });
      setTimeout(() => setToast(null), 3000);

      if (isNew) {
        router.replace(`/dashboard/talent-declaration/${data.id}`);
      } else {
        setProject(data);
        setForm(projectToForm(data));
        setIsEditing(false);
        router.refresh();
      }
    } catch (err) {
      console.error("保存出错:", err);
      setToast({ msg: "网络错误，请重试", type: "error" });
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    if (isNew) { router.back(); return; }
    if (project) setForm(projectToForm(project));
    setIsEditing(false);
  }

  if (loading) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50 flex items-center justify-center">
        <p className="text-slate-400 text-sm">加载中...</p>
      </div>
    );
  }

  if (fetchError && !isNew) {
    return (
      <div className="flex-1 overflow-auto bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-slate-500 mb-3">{fetchError}</p>
          <button onClick={() => router.back()} className="text-blue-600 text-sm hover:underline">← 返回列表</button>
        </div>
      </div>
    );
  }

  const displayTitle = isNew ? "新建申报项目" : (project?.name ?? "项目详情");
  const lc = LEVEL_COLORS[project?.level ?? "区级"] ?? LEVEL_COLORS["区级"];

  return (
    <div className="flex-1 overflow-auto bg-slate-50">

      {/* 页面头部（sticky） */}
      <div className="px-8 py-4 bg-white border-b border-slate-200 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors shrink-0">
            <ArrowLeft size={16} /> 返回列表
          </button>
          <span className="text-slate-200 shrink-0">|</span>
          <div className="flex items-center gap-2 min-w-0">
            {project && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium border shrink-0 ${lc.bg} ${lc.text} ${lc.border}`}>
                {project.level}
              </span>
            )}
            <h1 className="text-base font-semibold text-slate-800 truncate">{displayTitle}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isEditing ? (
            <>
              <button onClick={handleCancel} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 transition-colors border border-slate-200">
                <X size={14} /> 取消
              </button>
              <button
                type="submit"
                form="talent-edit-form"
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50">
                <Save size={14} /> {saving ? "保存中..." : "保存基础信息"}
              </button>
            </>
          ) : (
            <button onClick={() => setIsEditing(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors border border-slate-200">
              <Pencil size={14} /> 编辑基础信息
            </button>
          )}
        </div>
      </div>

      {/* 内容区 */}
      {isEditing ? (
        <form id="talent-edit-form" onSubmit={e => { e.preventDefault(); handleSave(); }}>
          <TalentEditForm form={form} setForm={setForm} feishuGroups={feishuGroups} users={users} />
        </form>
      ) : (
        <div className="pb-10">
          {/* 统计卡片 */}
          {project && <GlobalDashboard project={project} companies={companies} fundStats={fundStats} />}

          {/* 联络与政策区块 */}
          {project && <ContactPolicySection project={project} />}

          {/* 公司 Tabs — 裸胶囊 */}
          <div className="px-6 pt-5">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-slate-400 mr-1 flex items-center gap-1"><Building2 size={12} /> 参与公司</span>
              {companies.map(c => (
                <button key={c.id} type="button"
                  onClick={() => {
                    setSelectedCompanyId(c.id);
                    const firstCycle = c.cycles[0];
                    setSelectedCycleId(firstCycle?.id ?? null);
                  }}
                  className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                    selectedCompanyId === c.id
                      ? "bg-blue-50 border-blue-200 text-blue-700"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}>
                  {c.name}
                </button>
              ))}
              {companies.length === 0 && (
                <span className="text-sm text-slate-400 ml-1">暂无公司</span>
              )}
              {/* 设置/管理公司按钮 */}
              <button type="button" onClick={() => setShowManageCompany(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-slate-500 border border-slate-200 hover:border-slate-400 hover:bg-slate-50 transition-colors ml-1">
                <Settings size={12} /> 设置/管理公司
              </button>
            </div>
          </div>

          {/* 周期切换器 — 下拉 Select */}
          {selectedCompanyId && (
            <div className="px-6 pt-3 pb-1">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-slate-400 flex items-center gap-1 shrink-0">
                  <RotateCcw size={12} /> 申报周期
                </span>
                {cycles.length > 0 ? (
                  <>
                    {/* 核心下拉切换器 */}
                    <div className="relative flex items-center">
                      <Calendar size={13} className="absolute left-2.5 text-slate-400 pointer-events-none z-10" />
                      <select
                        value={selectedCycleId ?? ""}
                        onChange={e => setSelectedCycleId(e.target.value)}
                        className="pl-8 pr-7 py-1.5 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 appearance-none focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 transition-colors min-w-[160px] max-w-[240px] cursor-pointer"
                      >
                        {cycles.map(cy => (
                          <option key={cy.id} value={cy.id}>
                            {cy.name}{cy.headcount != null ? ` · ${cy.headcount}人` : ""}
                          </option>
                        ))}
                      </select>
                      <ChevronRight size={12} className="absolute right-2 text-slate-400 pointer-events-none rotate-90" />
                    </div>
                    {/* 当前周期设置按钮 */}
                    {selectedCycleId && cycles.find(c => c.id === selectedCycleId) && (
                      <button type="button"
                        onClick={() => {
                          const cy = cycles.find(c => c.id === selectedCycleId)!;
                          setShowCycleSettings(cy.id);
                          setCycleSettingsName(cy.name);
                          setCycleSettingsOwnerId(cy.ownerId ?? "");
                          setCycleSettingsFeishuGroup(extractGroupFeishuId(cy.feishuGroupUrl ?? ""));
                          setShowDeleteCycleConfirm(false);
                        }}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors rounded-lg"
                        title="周期设置"
                      >
                        <Settings size={14} />
                      </button>
                    )}
                    {/* 新建周期按钮 */}
                    <button type="button" onClick={() => setShowAddCycle(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-600 border border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50 transition-colors">
                      <Plus size={12} /> 新建周期
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-sm text-slate-400">暂无申报周期</span>
                    <button type="button" onClick={() => setShowAddCycle(true)}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 transition-colors shadow-sm">
                      <Plus size={14} /> 开启首个申报周期
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 周期看板 */}
          {selectedCycleId && cycleUrl && (
            cycleDetailLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-400 text-sm">
                加载周期数据中...
              </div>
            ) : cycleDetail ? (
              <CycleKanban
                cycle={cycleDetail}
                projectNodes={safeNodes(project?.declarationNodes)}
                users={users}
                cycleUrl={cycleUrl}
                frequency={project?.declarationFrequency}
                onCycleUpdated={updated => {
                  setCycleDetail(updated);
                  setCompanies(prev => prev.map(c =>
                    c.id === selectedCompanyId
                      ? { ...c, cycles: c.cycles.map(cy => cy.id === updated.id ? { ...cy, totalFunding: updated.totalFunding, headcount: updated.headcount, ownerId: updated.ownerId, owner: updated.owner } : cy) }
                      : c
                  ));
                }}
              />
            ) : null
          )}

          {/* 无公司空状态 */}
          {!loading && companies.length === 0 && !showManageCompany && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Building2 size={40} className="text-slate-200 mb-4" />
              <p className="text-slate-400 text-sm mb-4">尚未添加参与公司</p>
              <button type="button" onClick={() => setShowManageCompany(true)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors">
                <Plus size={15} /> 添加第一个公司
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── 管理公司弹层 ── */}
      {showManageCompany && (
        <div
          className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowManageCompany(false); }}
        >
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">设置 / 管理参与公司</h3>
              <button type="button" onClick={() => setShowManageCompany(false)} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* 现有公司列表 */}
            {companies.length > 0 && (
              <div className="flex flex-col gap-1">
                {companies.map(c => (
                  <div key={c.id} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                    <span className="text-sm text-slate-700">{c.name}</span>
                    <span className="text-xs text-slate-400">{c.cycles.length} 个周期</span>
                  </div>
                ))}
              </div>
            )}

            {/* 新增公司 */}
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-500 mb-2">新增公司</p>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-3 py-1.5 rounded-lg text-sm border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="公司名称"
                  value={addCompanyName}
                  onChange={e => setAddCompanyName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleAddCompany(); } }}
                  autoFocus
                />
                <button type="button" onClick={handleAddCompany} disabled={addingCompany || !addCompanyName.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors">
                  {addingCompany ? "添加中..." : "添加"}
                </button>
              </div>
            </div>

            <button type="button" onClick={() => setShowManageCompany(false)}
              className="w-full py-2 rounded-lg text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
              关闭
            </button>
          </div>
        </div>
      )}

      {/* ── 动态周期创建弹层 ── */}
      {showAddCycle && (
        <DynamicCycleForm
          frequency={project?.declarationFrequency}
          feishuGroups={feishuGroups}
          cycles={cycles}
          onSubmit={handleAddCycle}
          onClose={() => setShowAddCycle(false)}
          loading={addingCycle}
        />
      )}

      {/* ── 周期设置弹层 ── */}
      {showCycleSettings && (() => {
        const editingCycle = cycles.find(cy => cy.id === showCycleSettings);
        if (!editingCycle) return null;
        return (
          <div
            className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) { setShowCycleSettings(null); setShowDeleteCycleConfirm(false); } }}
          >
            {!showDeleteCycleConfirm ? (
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-800">周期设置</h3>
                  <button type="button" onClick={() => setShowCycleSettings(null)} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                    <X size={16} />
                  </button>
                </div>

                {/* 周期名称 */}
                <div>
                  <label className={LABEL_CLS}>周期名称</label>
                  <input
                    className={INPUT_CLS}
                    value={cycleSettingsName}
                    onChange={e => setCycleSettingsName(e.target.value)}
                    placeholder="周期名称"
                    autoFocus
                  />
                </div>

                {/* 本周期负责人 */}
                <div>
                  <label className={LABEL_CLS}>本周期负责人</label>
                  <select
                    className={INPUT_CLS}
                    value={cycleSettingsOwnerId}
                    onChange={e => setCycleSettingsOwnerId(e.target.value)}
                  >
                    <option value="">— 请选择负责人 —</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>

                {/* 飞书沟通群 */}
                {feishuGroups.length > 0 && (
                  <div>
                    <label className={LABEL_CLS}>飞书沟通群</label>
                    <select
                      className={INPUT_CLS}
                      value={cycleSettingsFeishuGroup}
                      onChange={e => setCycleSettingsFeishuGroup(e.target.value)}
                    >
                      <option value="">— 不绑定飞书群 —</option>
                      {feishuGroups.map(g => <option key={g.id} value={g.feishuId}>{g.name}</option>)}
                    </select>
                  </div>
                )}

                <div className="flex gap-2 justify-end">
                  <button type="button" onClick={() => setShowCycleSettings(null)}
                    className="px-4 py-2 rounded-lg text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
                    取消
                  </button>
                  <button type="button"
                    onClick={() => handleSaveCycleSettings(showCycleSettings)}
                    disabled={!cycleSettingsName.trim() || renamingCycle}
                    className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
                    {renamingCycle ? "保存中..." : "保存设置"}
                  </button>
                </div>
                <div className="border-t border-slate-100 pt-2">
                  <button type="button"
                    onClick={() => setShowDeleteCycleConfirm(true)}
                    className="w-full flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50 transition-colors">
                    <Trash2 size={12} /> 删除本周期
                  </button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
                <h3 className="text-sm font-semibold text-slate-800">确认删除</h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  确定要删除「{editingCycle.name}」吗？其包含的入选名单和任务将被一并删除，不可恢复。
                </p>
                <div className="flex gap-2 justify-end pt-1">
                  <button type="button" onClick={() => setShowDeleteCycleConfirm(false)}
                    className="px-4 py-2 rounded-lg text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">
                    取消
                  </button>
                  <button type="button"
                    onClick={() => handleDeleteCycle(showCycleSettings)}
                    disabled={deletingCycle}
                    className="px-4 py-2 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 transition-colors">
                    {deletingCycle ? "删除中..." : "确认删除"}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Toast 通知 */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium"
          style={{ background: toast.type === "error" ? "#dc2626" : "#16a34a" }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
