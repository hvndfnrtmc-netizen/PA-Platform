"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { verifyReceiptMonth } from "@/app/actions/party-transfer";
import {
  Upload, CheckCircle2, Clock, Lock, Settings,
  FileText, AlertCircle, Star, Users, Archive,
  CreditCard, ArrowLeftRight, ClipboardList,
  X, Check, Info, ExternalLink, Phone, AlertTriangle,
} from "lucide-react";

// ── 党建主题色 ────────────────────────────────────────────────────
const R  = "#CC0000";
const RD = "#8B0000";
const G  = "#D4AF37";
const RL = "rgba(204,0,0,0.07)";

// ── 转入 6 阶段定义 ───────────────────────────────────────────────
const STAGES = [
  { id: 1, label: "档案上传",   icon: FileText,       short: "转入前准备：上传党员档案材料。该阶段审核通过后进入正式转入流程" },
  { id: 2, label: "党费标准",   icon: CreditCard,     short: "确认党费已交至转接流程发起当月，填写党费标准及金额" },
  { id: 3, label: "转接引导",   icon: ArrowLeftRight, short: "确认组织关系转出方式" },
  { id: 4, label: "信息采集",   icon: ClipboardList,  short: "填写党员基本信息表" },
  { id: 5, label: "入群确认",   icon: Users,          short: "加入 瑞启深空 党员群" },
  { id: 6, label: "审核归档",   icon: Archive,        short: "材料齐全后正式存档" },
];

// ── 阶段一：档案材料清单 ─────────────────────────────────────────
const DOCS = [
  { name: "入党申请书",           required: true,  hint: "手写版，须有本人亲笔签名及日期" },
  { name: "转正申请书",           required: true,  hint: "需与入党志愿书配套，日期须在志愿书之后" },
  { name: "政审材料",             required: true,  hint: "由原党支部出具，需加盖公章" },
  { name: "入党志愿书",           required: true,  hint: "最核心材料，往往多页，请上传彩扫PDF" },
  { name: "确定为积极分子的材料", required: true,  hint: "含支委会讨论记录及决议" },
  { name: "确定为发展对象的材料", required: true,  hint: "含支委会讨论记录及决议" },
  { name: "入党培训材料",         required: true,  hint: "党校结业证书或培训合格证明" },
  { name: "党员承诺书",           required: true,  hint: "__template__" }, // 动态替换
  { name: "预审材料",             required: false, hint: "部分情况需要，如有请上传" },
  { name: "其他档案材料",         required: false, hint: "如有补充材料可在此上传" },
];

// ── 阶段四：台账字段类型 ─────────────────────────────────────────
interface CollectedInfo {
  name: string;
  gender: string;
  idCard: string;
  birthYear: string;
  birthMonth: string;
  hometown: string;
  education: string;
  educationOther: string;
  joinPartyDate: string;
  company: string;
  companyOther: string;
  position: string;
  branch: string;
  phone: string;
  transferInYear: string;
  transferInMonth: string;
  partyFee: string;
  transferOutDate: string;
  remarks: string;
}

const COMPANY_OPTIONS = [
  "魔门塔（苏州）科技有限公司",
  "初速度（苏州）科技有限公司",
  "初速度（上海）汽车有限公司",
  "魔门塔（苏州）科技有限公司杭州分公司",
  "北京魔门塔科技有限公司",
  "其他",
];
const BRANCH_OPTIONS = [
  "初速度（苏州）科技有限公司第一党支部",
  "初速度（苏州）科技有限公司第二党支部",
  "初速度（苏州）科技有限公司第三党支部",
  "苏州高铁新城商会党委",
];
const EDUCATION_OPTIONS = ["本科", "硕士", "博士", "其他"];

// ── 类型 ─────────────────────────────────────────────────────────
interface Stage2Data {
  phone:            string;
  receiptUrl:       string | null;
  receiptOcrPassed: boolean;
  feeBaseType:      "year" | "salary" | null;
  feeBaseValue:     string;
  calculatedFee:    number | null;
}

interface UploadedFile {
  name: string;
  url: string;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason?: string;
}
interface TransferRecordData {
  id: string;
  status: string;
  currentStage: string;
  transferType: string;
  materials: Record<string, UploadedFile[]>;
  draftData?: {
    uploadedFiles?: Record<string, UploadedFile[]>;
    currentStage?: number;
    targetBranchName?: string;
    realName?: string;
    idCardNumber?: string;
  } | null;
  rejectReason?: string | null;
  targetBranchName?: string | null;
  realName?: string | null;
  idCardNumber?: string | null;
  partyFeeData?: Stage2Data | null;
  collectedInfo?: Record<string, string> | null;
  stage4ModifyRequested?: boolean;
  stage1WithdrawRequested?: boolean;
  createdAt: string;
  updatedAt: string;
}
interface FeishuTarget { feishuId: string; name: string; type: string }
interface PartyCustomConfig {
  announcement?:   string;
  templateUrl?:    string;
  feishuGroupLink?:string;
  pageTitle?:      string;
  pageSubtitle?:   string;
  shortcutLinks?:  { label: string; url: string }[];
  contacts?: { archives?: string[]; partyFee?: string[] };
}

// Task 7：DEFAULT_ANNOUNCEMENT 保留给配置弹窗作 placeholder，但不再展示在页面上
const DEFAULT_ANNOUNCEMENT =
  "2024 年新入职党员请注意：请先完成档案整理，再发起转入申请。如有特殊情况（档案在外省人才市场），请先联系 @顾毅潇 获取查档函后再操作。";

const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── 状态是否处于"锁定（已提交/审核中）"状态 ──────────────────────
const LOCKED_STATUSES = new Set([
  "STAGE1_SUBMITTED", "STAGE1_COMPANY_APPROVED",
  "SUBMITTED",
]);
// 审核通过（解锁全部阶段）
const FULLY_UNLOCKED_STATUSES = new Set([
  "STAGE1_COMMITTEE_APPROVED", "COMPLETED",
]);

// ── 进度条组件 ───────────────────────────────────────────────────
function StageProgressBar({
  currentStage,
  onSelect,
}: {
  currentStage: number;
  onSelect: (s: number) => void;
}) {
  return (
    <div className="flex items-center gap-0 px-6 py-5 overflow-x-auto"
      style={{ background: "white", borderBottom: "1px solid #f1f0f0" }}>
      {STAGES.map((s, idx) => {
        const Icon   = s.icon;
        const done   = currentStage > s.id;
        const active = currentStage === s.id;

        return (
          <div key={s.id} className="flex items-center flex-shrink-0">
            <button
              onClick={() => onSelect(s.id)}
              className="flex flex-col items-center gap-1.5 group"
              style={{ cursor: "pointer", minWidth: 72 }}
            >
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all"
                style={{
                  background: done   ? R
                            : active ? `linear-gradient(135deg, ${R}, ${RD})`
                            : "#f1f0f0",
                  border: active ? `2px solid ${G}` : "2px solid transparent",
                  boxShadow: active ? `0 0 0 3px rgba(204,0,0,0.2)` : "none",
                }}
              >
                {done ? (
                  <Check size={16} color="white" />
                ) : (
                  <Icon size={16} color={active ? "white" : "#666"} />
                )}
              </div>
              <span className="text-xs font-medium text-center leading-tight"
                style={{ color: done ? R : active ? R : "#aaa", whiteSpace: "nowrap" }}>
                {s.label}
              </span>
            </button>
            {idx < STAGES.length - 1 && (
              <div className="flex-1 mx-1" style={{ minWidth: 20, maxWidth: 40 }}>
                <div className="h-0.5 w-full"
                  style={{ background: done ? R : "#e5e5e5" }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── 阶段一：档案上传 ─────────────────────────────────────────────
function Stage1({
  uploadedFiles,
  uploading,
  archiveContacts,
  feishuTargets,
  templateUrl,
  targetBranchName,
  realName,
  idCardNumber,
  onChangeBasicInfo,
  onBlurBasicInfo,
  onFileSelect,
  onRemoveFile,
  previewOnly,
  stageLockMode,
}: {
  uploadedFiles:     Record<string, UploadedFile[]>;
  uploading:         Record<string, boolean>;
  archiveContacts:   string[];
  feishuTargets:     FeishuTarget[];
  templateUrl?:      string;
  targetBranchName:  string;
  realName:          string;
  idCardNumber:      string;
  onChangeBasicInfo:  (field: "targetBranchName" | "realName" | "idCardNumber", val: string) => void;
  onBlurBasicInfo?:   () => void;
  onFileSelect:       (category: string, file: File) => Promise<void>;
  onRemoveFile:       (category: string, idx: number) => void;
  previewOnly?:       boolean;
  stageLockMode?:     boolean;
}) {
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const requiredDone = DOCS.filter(d => d.required && (uploadedFiles[d.name]?.length ?? 0) > 0).length;
  const requiredTotal = DOCS.filter(d => d.required).length;

  // Task 7：重构联系人区
  const contactButtons: Array<{ label: string; feishuId?: string }> =
    archiveContacts.length > 0
      ? archiveContacts.map(fid => {
          const t = feishuTargets.find(t => t.feishuId === fid);
          return { label: t ? t.name : fid, feishuId: fid };
        })
      : [{ label: "顾毅潇" }];

  return (
    <div className="space-y-4">

      {/* Task 8：基础信息采集区（文件上传之前） */}
      <div className="rounded-xl p-4 space-y-3"
        style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
        <p className="text-xs font-semibold text-slate-600">基础信息（必填）</p>
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "#333" }}>
              党支部名称 <span style={{ color: R }}>*</span>
            </label>
            <input
              value={targetBranchName}
              onChange={e => onChangeBasicInfo("targetBranchName", e.target.value)}
              onBlur={onBlurBasicInfo}
              placeholder="如：瑞启深空 第一党支部"
              disabled={previewOnly}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ border: "1px solid #e2e8f0" }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#333" }}>
                姓名 <span style={{ color: R }}>*</span>
              </label>
              <input
                value={realName}
                onChange={e => onChangeBasicInfo("realName", e.target.value)}
                onBlur={onBlurBasicInfo}
                placeholder="真实姓名"
                disabled={previewOnly}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ border: "1px solid #e2e8f0" }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#333" }}>
                身份证号 <span style={{ color: R }}>*</span>
              </label>
              <input
                value={idCardNumber}
                onChange={e => onChangeBasicInfo("idCardNumber", e.target.value)}
                onBlur={onBlurBasicInfo}
                placeholder="18位身份证号"
                disabled={previewOnly}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ border: "1px solid #e2e8f0" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Task 7：重构档案获取指引 */}
      <div className="rounded-xl p-4 text-sm leading-relaxed"
        style={{ background: "rgba(212,175,55,0.08)", border: `1px solid rgba(212,175,55,0.35)` }}>
        <p className="font-semibold mb-2" style={{ color: "#92620a" }}>
          📋 如何获取党员档案？
        </p>
        <div className="text-xs space-y-2" style={{ color: "#78500a" }}>
          <p>1. 联系人才市场档案室明确查档所需材料；</p>
          <p>2. 将档案室需求反馈至{" "}
            {contactButtons.map((c, i) => (
              <a
                key={i}
                href={c.feishuId ? `https://applink.feishu.cn/client/chat/open?openId=${c.feishuId}` : "#"}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium mx-0.5 hover:underline"
                style={{ color: R }}
              >
                @{c.label}
              </a>
            ))}
            {" "}出具查档函
          </p>
        </div>
      </div>

      {/* 进度提示 */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium" style={{ color: "#333" }}>必填材料上传进度</span>
        <span className="text-sm font-semibold tabular-nums"
          style={{ color: requiredDone === requiredTotal ? "#22c55e" : R }}>
          {requiredDone} / {requiredTotal}
        </span>
      </div>

      {/* 进度条 */}
      <div className="h-2 rounded-full overflow-hidden" style={{ background: "#f1f0f0" }}>
        <div className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${(requiredDone / requiredTotal) * 100}%`,
            background: `linear-gradient(90deg, ${R}, ${RD})`,
          }} />
      </div>

      {/* 材料列表 */}
      <div className="space-y-3">
        {DOCS.map((doc) => {
          const files  = uploadedFiles[doc.name] || [];
          const done   = files.length > 0;
          const busy   = uploading[doc.name] ?? false;

          // Task 7：动态承诺书提示
          const hint = doc.hint === "__template__"
            ? undefined // 渲染特殊的模板下载提示
            : doc.hint;

          // Task 9：若文件有个别被驳回，显示红框
          const hasRejectedFile = files.some(f => f.status === "REJECTED");
          const allApproved     = done && files.every(f => f.status === "APPROVED");
          // 任务二：stageLockMode 下，未被驳回的文件分类同样锁定（不论是否显式 APPROVED）
          const isStageLocked   = (stageLockMode ?? false) && done && !hasRejectedFile;
          const showLockBadge   = allApproved || isStageLocked;

          return (
            <div key={doc.name}
              className="rounded-xl overflow-hidden"
              style={{
                border: `1px solid ${
                  hasRejectedFile ? "rgba(239,68,68,0.5)"
                  : allApproved   ? "rgba(34,197,94,0.4)"
                  : done          ? "rgba(34,197,94,0.4)"
                  : doc.required  ? "rgba(204,0,0,0.25)" : "#e5e5e5"
                }`,
                background: hasRejectedFile ? "rgba(239,68,68,0.04)"
                           : allApproved    ? "rgba(34,197,94,0.04)"
                           : done           ? "rgba(34,197,94,0.04)" : "white",
              }}>
              <div className="flex items-start gap-3 px-4 py-3">
                {/* 状态图标 */}
                <div className="mt-0.5 flex-shrink-0">
                  {allApproved ? (
                    <CheckCircle2 size={18} color="#22c55e" />
                  ) : hasRejectedFile ? (
                    <AlertCircle size={18} color="#ef4444" />
                  ) : done ? (
                    <CheckCircle2 size={18} color="#22c55e" />
                  ) : (
                    <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${doc.required ? R : "#ccc"}`, background: "white" }} />
                  )}
                </div>

                {/* 内容 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium" style={{ color: "#1a1a1a" }}>{doc.name}</span>
                    {doc.required && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-semibold" style={{ background: RL, color: R }}>必填</span>
                    )}
                    {!doc.required && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: "#f5f5f5", color: "#888" }}>选填</span>
                    )}
                    {showLockBadge && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a" }}>
                        {allApproved ? "✅ 已通过锁定" : "✅ 已通过，无需修改"}
                      </span>
                    )}
                  </div>
                  {/* Task 7：承诺书使用模板下载链接 */}
                  {doc.hint === "__template__" ? (
                    <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "#888" }}>
                      若无党员承诺书，可点击{" "}
                      {templateUrl ? (
                        <a
                          href={templateUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 mx-1 hover:underline font-medium"
                        >
                          获取模板
                        </a>
                      ) : (
                        <span className="mx-1 font-medium" style={{ color: "#aaa" }}>
                          获取模板（管理员尚未上传）
                        </span>
                      )}
                      ，打印签字后上传
                    </p>
                  ) : (
                    <p className="text-xs mt-0.5 leading-relaxed" style={{ color: "#888" }}>{hint}</p>
                  )}
                </div>

                {/* 上传按钮（previewOnly 时禁用，APPROVED 状态锁定） */}
                <input
                  ref={el => { fileInputRefs.current[doc.name] = el; }}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,.png,.pdf"
                  className="hidden"
                  disabled={previewOnly}
                  onChange={async (e) => {
                    const selected = Array.from(e.target.files || []);
                    for (const file of selected) await onFileSelect(doc.name, file);
                    e.target.value = "";
                  }}
                />
                {showLockBadge ? (
                  <span className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium flex-shrink-0 cursor-not-allowed"
                    style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}>
                    <Check size={12} />{allApproved ? "已锁定" : "已通过，无需修改"}
                  </span>
                ) : (
                  <button
                    onClick={() => !previewOnly && fileInputRefs.current[doc.name]?.click()}
                    disabled={busy || previewOnly}
                    className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium flex-shrink-0 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      background: done ? "rgba(34,197,94,0.1)" : RL,
                      color:      done ? "#22c55e" : R,
                      border:     `1px solid ${done ? "rgba(34,197,94,0.3)" : "rgba(204,0,0,0.25)"}`,
                      opacity: (busy || previewOnly) ? 0.5 : 1,
                    }}>
                    {busy ? "上传中..." : done ? <><Check size={12} />继续上传</> : <><Upload size={12} />上传文件</>}
                  </button>
                )}
              </div>

              {/* 已上传文件列表 */}
              {done ? (
                <div className="mx-4 mb-3 space-y-1">
                  {files.map((f, idx) => (
                    <div key={idx}
                      className="rounded-lg overflow-hidden"
                      style={{
                        background: f.status === "REJECTED" ? "rgba(239,68,68,0.06)" : "rgba(34,197,94,0.06)",
                        border: `1px solid ${f.status === "REJECTED" ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.2)"}`,
                      }}>
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-xs text-slate-600 truncate max-w-[65%]">📄 {f.name}</span>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {f.status === "REJECTED" ? (
                            /* 被驳回：显示"重新上传"按钮，点击先移除旧文件再打开文件选择器 */
                            <button
                              onClick={() => {
                                if (previewOnly) return;
                                onRemoveFile(doc.name, idx);
                                setTimeout(() => fileInputRefs.current[doc.name]?.click(), 50);
                              }}
                              disabled={previewOnly}
                              className="text-xs px-2 py-1 rounded-lg font-medium flex-shrink-0"
                              style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fca5a5" }}>
                              重新上传
                            </button>
                          ) : f.status !== "APPROVED" ? (
                            <button onClick={() => onRemoveFile(doc.name, idx)} className="p-1 rounded hover:bg-red-50">
                              <X size={12} color="#ef4444" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                      {/* 驳回原因展示（逐条，申请人专属） */}
                      {f.status === "REJECTED" && f.rejectReason && (
                        <div className="px-3 pb-2 text-xs" style={{ color: "#b91c1c" }}>
                          驳回原因：{f.rejectReason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mx-4 mb-3">
                  <div className="flex items-center justify-center py-4 rounded-lg text-xs"
                    style={{ border: `1.5px dashed ${doc.required ? "rgba(204,0,0,0.3)" : "#ddd"}`, background: doc.required ? RL : "#fafafa", color: "#aaa" }}>
                    <Upload size={14} className="mr-2 opacity-60" />
                    点击上方"上传文件"按钮（JPG / PNG / PDF，≤ 50 MB）
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 阶段二：党费标准 ─────────────────────────────────────────────
const YEAR_FEE_TABLE: { label: string; fee: number }[] = [
  { label: "0年",       fee: 76  },
  { label: "1年",       fee: 80  },
  { label: "2年",       fee: 85  },
  { label: "3年",       fee: 90  },
  { label: "4年",       fee: 95  },
  { label: "5年",       fee: 100 },
  { label: "6年",       fee: 105 },
  { label: "7年",       fee: 110 },
  { label: "8年",       fee: 115 },
  { label: "9年",       fee: 120 },
  { label: "10年",      fee: 125 },
  { label: "11年",      fee: 130 },
  { label: "12年",      fee: 130 },
  { label: "13年",      fee: 140 },
  { label: "14年",      fee: 145 },
  { label: "15年及以上", fee: 150 },
];

function calcSalaryFee(salary: number): number {
  if (salary <= 3000)  return Math.round(salary * 0.005 * 100) / 100;
  if (salary <= 5000)  return Math.round(salary * 0.01  * 100) / 100;
  if (salary <= 10000) return Math.round(salary * 0.015 * 100) / 100;
  return Math.round(salary * 0.02 * 100) / 100;
}

function Stage2({
  initialData,
  onDataChange,
  previewOnly,
}: {
  initialData?: Partial<Stage2Data>;
  onDataChange: (data: Stage2Data) => void;
  previewOnly?: boolean;
}) {
  const [phone,            setPhone]           = useState(initialData?.phone            ?? "");
  const [receiptUrl,       setReceiptUrl]       = useState<string | null>(initialData?.receiptUrl ?? null);
  const [receiptOcrPassed, setReceiptOcrPassed] = useState(initialData?.receiptOcrPassed ?? false);
  const [feeBaseType,      setFeeBaseType]      = useState<"year" | "salary" | null>(initialData?.feeBaseType ?? null);
  const [feeBaseValue,     setFeeBaseValue]     = useState(initialData?.feeBaseValue    ?? "");
  const [calculatedFee,    setCalculatedFee]    = useState<number | null>(initialData?.calculatedFee ?? null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [showMismatchDialog, setShowMismatchDialog] = useState(false);
  const [mismatchMsg,      setMismatchMsg]      = useState("");
  const [ocrNote,          setOcrNote]          = useState<string | null>(null);
  const receiptInputRef = useRef<HTMLInputElement>(null);

  // 通知父组件数据变化
  useEffect(() => {
    onDataChange({ phone, receiptUrl, receiptOcrPassed, feeBaseType, feeBaseValue, calculatedFee });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, receiptUrl, receiptOcrPassed, feeBaseType, feeBaseValue, calculatedFee]);

  const handleReceiptUpload = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { alert("图片大小不超过 10MB"); return; }
    setUploadingReceipt(true);
    setOcrNote(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", "party_fee_receipt");
      const res = await fetch("/api/party-transfer/upload", { method: "POST", body: fd });
      if (!res.ok) { setOcrNote("图片上传失败，请重试"); return; }
      const { url } = await res.json() as { url: string };
      setReceiptUrl(url);

      // OCR 核验
      const result = await verifyReceiptMonth(url);

      if (result.error) {
        // 技术性失败 → 放行并显示说明
        setOcrNote(`ℹ ${result.error}`);
        setReceiptOcrPassed(true);
        return;
      }

      if (!result.passed) {
        // 月份不符 → 弹窗并清空图片
        const curr = result.currentMonth.replace("-", "");
        setMismatchMsg(
          `OCR 识别收据缴费月份为【${result.detectedMonth ?? "未知"}】，当前流程月份为【${result.currentMonth}】。\n\n请将党费交至转接流程发起当月\n\n例：如小王计划${curr}发起线上转接流程，按属地党委要求，小王必须在原单位党费交至${result.currentMonth}，并提供缴纳凭证（截图或收据）`
        );
        setShowMismatchDialog(true);
        setReceiptUrl(null);
        setReceiptOcrPassed(false);
        return;
      }

      setReceiptOcrPassed(true);
    } catch {
      setOcrNote("OCR 核验出现异常，请重试");
    } finally {
      setUploadingReceipt(false);
      if (receiptInputRef.current) receiptInputRef.current.value = "";
    }
  };

  const isComplete =
    receiptOcrPassed &&
    phone.trim() !== "" &&
    feeBaseType !== null &&
    (
      (feeBaseType === "year"   && feeBaseValue !== "") ||
      (feeBaseType === "salary" && feeBaseValue !== "" && calculatedFee !== null)
    );

  return (
    <div className="space-y-5">
      {/* 说明区 */}
      <div className="rounded-xl p-4 text-sm" style={{ background: RL, border: `1px solid rgba(204,0,0,0.2)` }}>
        <p className="font-semibold mb-1" style={{ color: R }}>党费缴纳核验</p>
        <p className="text-xs leading-relaxed" style={{ color: "#555" }}>
          请上传最新一期的党费缴费收据图片，系统将通过 OCR 自动核验，若识别结果为流程所处当月则自动进入正式转接流程。
        </p>
      </div>

      {/* 收据上传区 */}
      <div>
        <label className="block text-xs font-semibold mb-2" style={{ color: "#333" }}>
          党费收据照片 <span style={{ color: R }}>*</span>
        </label>
        <input
          ref={receiptInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={previewOnly || uploadingReceipt}
          onChange={e => { const f = e.target.files?.[0]; if (f) void handleReceiptUpload(f); }}
        />
        {receiptUrl && receiptOcrPassed ? (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.3)" }}>
            <CheckCircle2 size={18} color="#22c55e" className="flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold" style={{ color: "#16a34a" }}>
                {ocrNote ? `⚠ 收据已上传（${ocrNote}）` : "✅ OCR 核验通过 — 收据月份已确认为当月"}
              </p>
            </div>
            {!previewOnly && (
              <button type="button"
                onClick={() => { setReceiptUrl(null); setReceiptOcrPassed(false); setOcrNote(null); }}
                className="p-1.5 rounded-lg hover:bg-red-50 flex-shrink-0">
                <X size={13} color="#ef4444" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            disabled={previewOnly || uploadingReceipt}
            onClick={() => receiptInputRef.current?.click()}
            className="w-full flex items-center justify-center py-10 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ border: `2px dashed rgba(204,0,0,0.3)`, background: RL }}>
            <div className="text-center">
              {uploadingReceipt ? (
                <>
                  <div className="w-7 h-7 mx-auto border-2 border-red-200 border-t-red-600 rounded-full animate-spin mb-2" />
                  <p className="text-sm font-medium" style={{ color: R }}>OCR 核验中，请稍候…</p>
                </>
              ) : (
                <>
                  <Upload size={28} style={{ color: R, margin: "0 auto 8px" }} />
                  <p className="text-sm font-medium" style={{ color: R }}>点击上传收据照片</p>
                  <p className="text-xs mt-1" style={{ color: "#999" }}>支持 JPG / PNG，建议正面拍摄清晰</p>
                </>
              )}
            </div>
          </button>
        )}
      </div>

      {/* 党费标准区 */}
      <div className="rounded-xl p-4 space-y-4" style={{ background: "white", border: "1px solid #e5e5e5" }}>
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: R }}>确认党费标准</p>
          <p className="text-xs leading-relaxed" style={{ color: "#888" }}>
            接上级党委通知，经党委调研，了解我司员工薪酬普遍较高，要求公司统一调整党费金额。几经协商，我们制定了两种方案供大家选择。请按照以下指引登记党费标准：
          </p>
        </div>

        {/* 手机号 */}
        <div>
          <label className="block text-xs font-semibold mb-1.5" style={{ color: "#333" }}>
            手机号 <span style={{ color: R }}>*</span>
          </label>
          <input
            type="tel"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="请输入本人手机号"
            disabled={previewOnly}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ border: "1px solid #e5e5e5" }}
          />
        </div>

        {/* 缴纳依据单选 */}
        <div>
          <label className="block text-xs font-semibold mb-2" style={{ color: "#333" }}>
            缴纳金额依据方式 <span style={{ color: R }}>*</span>
          </label>
          <div className="flex gap-3">
            {(["year", "salary"] as const).map(type => (
              <button
                key={type}
                type="button"
                disabled={previewOnly}
                onClick={() => { setFeeBaseType(type); setFeeBaseValue(""); setCalculatedFee(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  border:     `2px solid ${feeBaseType === type ? R : "#e5e5e5"}`,
                  background: feeBaseType === type ? RL : "white",
                  color:      feeBaseType === type ? R : "#555",
                }}>
                {type === "year" ? "📅 工作年限" : "💰 薪酬比例"}
              </button>
            ))}
          </div>
        </div>

        {/* 分支 A：工作年限 */}
        {feeBaseType === "year" && (
          <div>
            <label className="block text-xs font-semibold mb-2" style={{ color: "#333" }}>
              选择工作年限 <span style={{ color: R }}>*</span>
            </label>
            <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
              {YEAR_FEE_TABLE.map(item => (
                <button
                  key={item.label}
                  type="button"
                  disabled={previewOnly}
                  onClick={() => { setFeeBaseValue(item.label); setCalculatedFee(item.fee); }}
                  className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl text-sm transition-all disabled:opacity-50"
                  style={{
                    border:     `1.5px solid ${feeBaseValue === item.label ? R : "#e5e5e5"}`,
                    background: feeBaseValue === item.label ? RL : "white",
                  }}>
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ border: `2px solid ${feeBaseValue === item.label ? R : "#ccc"}`, background: feeBaseValue === item.label ? R : "white" }}>
                      {feeBaseValue === item.label && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span style={{ color: feeBaseValue === item.label ? R : "#333" }}>{item.label}</span>
                  </div>
                  <span className="font-semibold tabular-nums" style={{ color: feeBaseValue === item.label ? R : "#555" }}>
                    ¥{item.fee}/月
                  </span>
                </button>
              ))}
            </div>
            {feeBaseValue && (
              <div className="mt-2 px-4 py-2.5 rounded-xl flex items-center justify-between"
                style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.25)" }}>
                <span className="text-xs font-medium" style={{ color: "#555" }}>党费金额：</span>
                <span className="text-sm font-bold" style={{ color: "#16a34a" }}>¥{calculatedFee}/月</span>
              </div>
            )}
          </div>
        )}

        {/* 分支 B：薪酬比例 */}
        {feeBaseType === "salary" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "#333" }}>
                  税后薪资（元）
                </label>
                <input
                  type="number"
                  min={0}
                  value={feeBaseValue}
                  onChange={e => {
                    const v = e.target.value;
                    setFeeBaseValue(v);
                    const n = parseFloat(v);
                    setCalculatedFee(isNaN(n) || n <= 0 ? null : calcSalaryFee(n));
                  }}
                  placeholder="请输入税后月薪"
                  disabled={previewOnly}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ border: "1px solid #e5e5e5" }}
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs font-semibold mb-1.5" style={{ color: "#333" }}>党费金额（元）</label>
                <input
                  type="text"
                  readOnly
                  value={calculatedFee !== null ? `${calculatedFee}` : ""}
                  placeholder="自动计算"
                  className="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-50 outline-none"
                  style={{ border: "1px solid #e5e5e5" }}
                />
              </div>
            </div>
            {/* 阶梯说明 */}
            <div className="rounded-xl p-3 text-xs space-y-1"
              style={{ background: "#f8fafc", border: "1px solid #e2e8f0", color: "#64748b" }}>
              <p className="font-semibold text-slate-600 mb-1">党费阶梯公式</p>
              <p>≤ 3000 元：薪资 × 0.5%</p>
              <p>3001 ~ 5000 元：薪资 × 1%</p>
              <p>5001 ~ 10000 元：薪资 × 1.5%</p>
              <p>＞ 10000 元：薪资 × 2%</p>
            </div>
          </div>
        )}
      </div>

      {/* 完成/未完成提示 */}
      {!isComplete && (
        <p className="text-xs text-center" style={{ color: "#aaa" }}>
          {!receiptOcrPassed
            ? "上传并核验通过当月党费收据后，方可填写党费标准"
            : "请完整填写手机号和党费标准后继续"}
        </p>
      )}

      {/* OCR 月份不符弹窗 */}
      {showMismatchDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                style={{ background: "rgba(239,68,68,0.1)" }}>
                <AlertCircle size={20} color="#dc2626" />
              </div>
              <p className="text-base font-bold text-red-700">党费缴纳月份不符</p>
            </div>
            <div className="rounded-xl p-4 text-sm leading-relaxed whitespace-pre-line"
              style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#7f1d1d" }}>
              {mismatchMsg}
            </div>
            <button
              type="button"
              onClick={() => setShowMismatchDialog(false)}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white"
              style={{ background: "#dc2626" }}>
              我知道了，重新上传
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 阶段三：转接引导 ─────────────────────────────────────────────
function Stage3({
  previewOnly,
  archiveContacts = [],
  feishuTargets = [],
}: {
  previewOnly?: boolean;
  archiveContacts?: string[];
  feishuTargets?: FeishuTarget[];
}) {
  const [method, setMethod] = useState<"online"|"offline"|null>(null);

  // archiveContacts 存储的是 feishuId，映射为 { name, feishuId }
  const contactLinks = archiveContacts.length > 0
    ? archiveContacts.map(feishuId => {
        const target = feishuTargets.find(t => t.feishuId === feishuId);
        return { name: target?.name ?? feishuId, feishuId };
      })
    : null; // null 表示未配置，使用兜底文本

  const renderContacts = () => {
    if (!contactLinks || contactLinks.length === 0) return <span>管理员</span>;
    return contactLinks.map((c, i) => (
      <span key={c.name}>
        {i > 0 && " "}
        {c.feishuId
          ? <a href={`https://applink.feishu.cn/client/chat/open?openId=${c.feishuId}`}
               target="_blank" rel="noopener noreferrer"
               className="text-blue-600 font-medium mx-1 hover:underline">
              @{c.name}
            </a>
          : <span className="font-medium mx-1">@{c.name}</span>
        }
      </span>
    ));
  };

  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed" style={{ color: "#555" }}>
        请根据您原所在党组织的性质，选择对应的转接方式。如有疑问请联系{renderContacts()}咨询。
      </p>
      <div className="grid grid-cols-1 gap-3">
        {[
          { key: "online" as const, title: "🖥️  线上系统转入", sub: "适用于苏州大市内及江苏省内", desc: "由前党支部在苏州平台 / 国家平台上统一操作转入" },
          { key: "offline" as const, title: "📄  线下纸质介绍信", sub: "适用于其他省市", desc: "由原党支部开具纸质介绍信，交由管理员处理" },
        ].map((opt) => (
          <button key={opt.key} onClick={() => !previewOnly && setMethod(opt.key)}
            disabled={previewOnly}
            className="text-left rounded-xl p-4 transition-all"
            style={{ border: `2px solid ${method === opt.key ? R : "#e5e5e5"}`, background: method === opt.key ? RL : "white" }}>
            <div className="flex items-start gap-3">
              <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ border: `2px solid ${method === opt.key ? R : "#ccc"}`, background: method === opt.key ? R : "white" }}>
                {method === opt.key && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
              <div>
                <p className="text-sm font-semibold" style={{ color: "#1a1a1a" }}>{opt.title}</p>
                <p className="text-xs mt-0.5" style={{ color: R }}>{opt.sub}</p>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: "#777" }}>{opt.desc}</p>
              </div>
            </div>
          </button>
        ))}
      </div>
      {method === "online" && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: RL, border: `1px solid rgba(204,0,0,0.2)` }}>
          <p className="text-sm font-semibold" style={{ color: R }}>线上转入操作指引</p>
          <div className="space-y-2 text-xs leading-relaxed" style={{ color: "#555" }}>
            <p><strong>苏州大市内：</strong>由前党支部在苏州平台和国家平台上统一转入「初速度（苏州）科技有限公司党总支第 X 支部」</p>
            <p><strong>江苏省内及部分外省：</strong>由原党支部在国家平台上统一转入「初速度（苏州）科技有限公司党总支第 X 支部」</p>
            <div className="pt-2 space-y-1" style={{ borderTop: "1px dashed rgba(204,0,0,0.2)" }}>
              <p className="font-semibold" style={{ color: "#333" }}>党组织编号参考：</p>
              <p>第三支部：032800100398</p>
              <p>党总支：032800100395</p>
              <p>苏州高铁新城商会党委：032000038526</p>
            </div>
          </div>
          {contactLinks && contactLinks.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {contactLinks.map(c => c.feishuId ? (
                <a key={c.name}
                   href={`https://applink.feishu.cn/client/chat/open?openId=${c.feishuId}`}
                   target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white"
                   style={{ background: R }}>
                  <ExternalLink size={13} />一键联系 @{c.name}（飞书）
                </a>
              ) : null)}
            </div>
          ) : (
            <button disabled={previewOnly}
              className="w-full py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: R }}>
              <ExternalLink size={13} className="inline mr-1.5" />一键联系审核员（飞书跳转）
            </button>
          )}
        </div>
      )}
      {method === "offline" && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: RL, border: `1px solid rgba(204,0,0,0.2)` }}>
          <p className="text-sm font-semibold" style={{ color: R }}>线下介绍信开具指引</p>
          <div className="text-xs leading-relaxed space-y-1.5" style={{ color: "#555" }}>
            <p>由原党支部开具纸质介绍信，抬头为：</p>
            <p className="font-mono px-3 py-2 rounded-lg text-xs" style={{ background: "white", border: "1px solid rgba(204,0,0,0.2)", color: R }}>「智驾大道街区党委」</p>
            <p className="mt-1.5">转入组织名称：</p>
            <p className="font-mono px-3 py-2 rounded-lg text-xs" style={{ background: "white", border: "1px solid rgba(204,0,0,0.2)", color: R }}>「初速度（苏州）科技有限公司党总支第 X 支部」</p>
            <p className="mt-1.5">介绍信开好后请交由{renderContacts()}处理。</p>
          </div>
          {contactLinks && contactLinks.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {contactLinks.map(c => c.feishuId ? (
                <a key={c.name}
                   href={`https://applink.feishu.cn/client/chat/open?openId=${c.feishuId}`}
                   target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white"
                   style={{ background: R }}>
                  <Phone size={13} />一键联系 @{c.name}（飞书）
                </a>
              ) : null)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── 阶段四：信息采集 ─────────────────────────────────────────────
function Stage4({
  previewOnly,
  defaultName = "",
  defaultPhone = "",
  defaultPartyFee = "",
  savedInfo,
  stage4ModifyRequested,
  recordId,
  onSaved,
}: {
  previewOnly?: boolean;
  defaultName?: string;
  defaultPhone?: string;
  defaultPartyFee?: string;
  savedInfo?: Record<string, string> | null;
  stage4ModifyRequested?: boolean;
  recordId?: string;
  onSaved?: () => void;
}) {
  const isSubmitted = !!savedInfo && Object.keys(savedInfo).length > 0;
  const [locked, setLocked] = useState(isSubmitted);
  const [saving, setSaving] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [toast, setToast] = useState<{ type: "success"|"error"; msg: string } | null>(null);

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 70 }, (_, i) => String(currentYear - i));
  const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));

  const { register, watch, handleSubmit, formState: { errors } } = useForm<CollectedInfo>({
    defaultValues: {
      name:             savedInfo?.name             ?? defaultName,
      gender:           savedInfo?.gender           ?? "",
      idCard:           savedInfo?.idCard           ?? "",
      birthYear:        savedInfo?.birthYear        ?? "",
      birthMonth:       savedInfo?.birthMonth       ?? "",
      hometown:         savedInfo?.hometown         ?? "",
      education:        savedInfo?.education        ?? "",
      educationOther:   savedInfo?.educationOther   ?? "",
      joinPartyDate:    savedInfo?.joinPartyDate    ?? "",
      company:          savedInfo?.company          ?? "",
      companyOther:     savedInfo?.companyOther     ?? "",
      position:         savedInfo?.position         ?? "",
      branch:           savedInfo?.branch           ?? "",
      phone:            savedInfo?.phone            ?? defaultPhone,
      transferInYear:   savedInfo?.transferInYear   ?? "",
      transferInMonth:  savedInfo?.transferInMonth  ?? "",
      partyFee:         savedInfo?.partyFee         ?? defaultPartyFee,
      transferOutDate:  savedInfo?.transferOutDate  ?? "",
      remarks:          savedInfo?.remarks          ?? "",
    },
  });

  const birthYear = watch("birthYear");
  const education = watch("education");
  const company   = watch("company");
  const age = birthYear ? currentYear - Number(birthYear) : null;

  const showToast = (type: "success"|"error", msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), type === "error" ? 8000 : 3000);
  };

  const onSubmit = async (data: CollectedInfo) => {
    if (!recordId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/party-transfer/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectedInfo: data }),
      });
      if (!res.ok) throw new Error("保存失败");
      setLocked(true);
      showToast("success", "台账信息已提交！");
      onSaved?.();
    } catch (e) {
      showToast("error", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async (data: CollectedInfo) => {
    if (!recordId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/party-transfer/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectedInfo: data }),
      });
      if (!res.ok) throw new Error("暂存失败");
      showToast("success", "草稿已暂存");
      onSaved?.();
    } catch (e) {
      showToast("error", (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const requestModify = async () => {
    if (!recordId) return;
    setRequesting(true);
    try {
      const res = await fetch("/api/party-transfer/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage4ModifyRequested: true }),
      });
      if (!res.ok) throw new Error("申请失败");
      showToast("success", "已发送申请，请等待管理员解锁");
      onSaved?.();
    } catch (e) {
      showToast("error", (e as Error).message);
    } finally {
      setRequesting(false);
    }
  };

  const isReadOnly = (locked || previewOnly) && !(!locked);
  const inputCls = `w-full px-3 py-2.5 rounded-xl text-sm outline-none ${isReadOnly ? "bg-slate-50 cursor-not-allowed text-slate-500" : "bg-white"}`;
  const inputStyle = { border: `1px solid ${isReadOnly ? "#e5e5e5" : "#d1d5db"}` };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      {toast && (
        <div className={`text-xs px-3 py-2 rounded-xl ${toast.type === "success" ? "bg-green-50 text-green-700 border border-green-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {toast.msg}
        </div>
      )}

      <div className="text-xs px-3 py-2.5 rounded-xl" style={{ background: RL, color: R, border: `1px solid rgba(204,0,0,0.2)` }}>
        ℹ 请准确填写下方信息，提交后将直接写入党员信息台账。
      </div>

      {isSubmitted && locked && (
        <div className="text-xs px-3 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200">
          ✓ 台账信息已提交。如需修改，请点击下方「申请修改台账」按钮。
          {stage4ModifyRequested && <span className="ml-2 font-semibold text-amber-600">（⏳ 修改申请已发出，等待管理员解锁）</span>}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3">
        {/* 姓名 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>姓名 <span style={{ color: R }}>*</span></label>
          <input {...register("name", { required: "请填写姓名" })} readOnly={isReadOnly}
            className={inputCls} style={inputStyle} />
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
        </div>

        {/* 性别 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>性别 <span style={{ color: R }}>*</span></label>
          <div className="flex gap-4">
            {["男", "女"].map(g => (
              <label key={g} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="radio" value={g} disabled={isReadOnly} {...register("gender", { required: true })} />
                {g}
              </label>
            ))}
          </div>
        </div>

        {/* 身份证号 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>身份证号 <span style={{ color: R }}>*</span></label>
          <input {...register("idCard", {
            required: "请填写身份证号",
            pattern: { value: /^[0-9]{17}[0-9Xx]$/, message: "请输入正确的 18 位身份证号" }
          })} readOnly={isReadOnly} className={inputCls} style={inputStyle} placeholder="18 位数字（末位可为 X）" />
          {errors.idCard && <p className="text-xs text-red-500 mt-1">{errors.idCard.message}</p>}
        </div>

        {/* 出生年月 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>
            出生年月 <span style={{ color: R }}>*</span>
            {age !== null && <span className="ml-2 text-xs font-normal text-slate-500">({age} 岁)</span>}
          </label>
          <div className="flex gap-2">
            <select {...register("birthYear", { required: true })} disabled={isReadOnly}
              className={`flex-1 px-3 py-2.5 rounded-xl text-sm bg-white outline-none ${isReadOnly ? "opacity-60" : ""}`} style={inputStyle}>
              <option value="">年</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select {...register("birthMonth")} disabled={isReadOnly}
              className={`w-24 px-3 py-2.5 rounded-xl text-sm bg-white outline-none ${isReadOnly ? "opacity-60" : ""}`} style={inputStyle}>
              <option value="">月</option>
              {months.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* 籍贯 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>籍贯</label>
          <input {...register("hometown")} readOnly={isReadOnly} className={inputCls} style={inputStyle} placeholder="省/市" />
        </div>

        {/* 学历 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>学历 <span style={{ color: R }}>*</span></label>
          <select {...register("education", { required: "请选择学历" })} disabled={isReadOnly}
            className={`w-full px-3 py-2.5 rounded-xl text-sm bg-white outline-none ${isReadOnly ? "opacity-60" : ""}`} style={inputStyle}>
            <option value="">请选择</option>
            {EDUCATION_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {education === "其他" && (
            <input {...register("educationOther", { required: education === "其他" })} readOnly={isReadOnly}
              className={`${inputCls} mt-2`} style={inputStyle} placeholder="请补充说明" />
          )}
        </div>

        {/* 入党时间 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>入党时间 <span style={{ color: R }}>*</span></label>
          <input type="date" {...register("joinPartyDate", { required: "请填写入党时间" })} readOnly={isReadOnly}
            className={inputCls} style={inputStyle} />
        </div>

        {/* 签约公司主体 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>签约公司主体 <span style={{ color: R }}>*</span></label>
          <select {...register("company", { required: "请选择签约公司" })} disabled={isReadOnly}
            className={`w-full px-3 py-2.5 rounded-xl text-sm bg-white outline-none ${isReadOnly ? "opacity-60" : ""}`} style={inputStyle}>
            <option value="">请选择</option>
            {COMPANY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {company === "其他" && (
            <input {...register("companyOther", { required: company === "其他" })} readOnly={isReadOnly}
              className={`${inputCls} mt-2`} style={inputStyle} placeholder="请补充公司名称" />
          )}
        </div>

        {/* 职务 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>职务</label>
          <input {...register("position")} readOnly={isReadOnly} className={inputCls} style={inputStyle} placeholder="是否初/中/高级职称" />
        </div>

        {/* 所在党支部 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>所在党支部 <span style={{ color: R }}>*</span></label>
          <select {...register("branch", { required: "请选择党支部" })} disabled={isReadOnly}
            className={`w-full px-3 py-2.5 rounded-xl text-sm bg-white outline-none ${isReadOnly ? "opacity-60" : ""}`} style={inputStyle}>
            <option value="">请选择</option>
            {BRANCH_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        {/* 联系方式 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>联系方式 <span style={{ color: R }}>*</span></label>
          <input {...register("phone", { required: "请填写联系方式" })} readOnly={isReadOnly}
            className={inputCls} style={inputStyle} placeholder="手机号" />
        </div>

        {/* 转入时间 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>转入时间</label>
          <div className="flex gap-2">
            <select {...register("transferInYear")} disabled={isReadOnly}
              className={`flex-1 px-3 py-2.5 rounded-xl text-sm bg-white outline-none ${isReadOnly ? "opacity-60" : ""}`} style={inputStyle}>
              <option value="">年</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select {...register("transferInMonth")} disabled={isReadOnly}
              className={`w-24 px-3 py-2.5 rounded-xl text-sm bg-white outline-none ${isReadOnly ? "opacity-60" : ""}`} style={inputStyle}>
              <option value="">月</option>
              {months.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        {/* 党费（只读） */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>党费（元/月）</label>
          <input readOnly value={defaultPartyFee || "—"}
            className="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-50 text-slate-400 cursor-not-allowed"
            style={{ border: "1px solid #e5e5e5" }} />
        </div>

        {/* 转出时间（只读，管理员填写） */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>转出时间</label>
          <input readOnly value={savedInfo?.transferOutDate || ""}
            placeholder="由审核员填写"
            className="w-full px-3 py-2.5 rounded-xl text-sm bg-slate-50 text-slate-400 cursor-not-allowed"
            style={{ border: "1px solid #e5e5e5" }} />
        </div>

        {/* 备注 */}
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: "#333" }}>备注</label>
          <textarea {...register("remarks")} readOnly={isReadOnly} rows={2}
            className={`${inputCls} resize-none`} style={inputStyle} placeholder="如有特殊情况请说明" />
        </div>
      </div>

      {!previewOnly && !locked && (
        <div className="flex gap-2 pt-2">
          <button type="button" disabled={saving}
            onClick={handleSubmit(saveDraft)}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-600 disabled:opacity-50"
            style={{ border: "1px solid #e5e5e5", background: "#f8f8f8" }}>
            {saving ? "暂存中..." : "暂存草稿"}
          </button>
          <button type="submit" disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${R}, ${RD})` }}>
            {saving ? "提交中..." : "提交表单"}
          </button>
        </div>
      )}

      {!previewOnly && locked && !stage4ModifyRequested && (
        <button type="button" disabled={requesting}
          onClick={requestModify}
          className="w-full py-2.5 rounded-xl text-sm font-medium text-slate-600 disabled:opacity-50"
          style={{ border: "1px solid #e5e5e5", background: "#f8f8f8" }}>
          {requesting ? "发送中..." : "✏️ 申请修改台账"}
        </button>
      )}
    </form>
  );
}

// ── 阶段五：入群确认 ─────────────────────────────────────────────
function Stage5({
  previewOnly,
  feishuGroupLink,
}: {
  previewOnly?: boolean;
  feishuGroupLink?: string;
}) {
  const hasLink = !!feishuGroupLink;
  return (
    <div className="space-y-5">
      {/* 飞书一键加群卡片 */}
      <a
        href={hasLink ? feishuGroupLink : "#"}
        target="_blank"
        rel="noopener noreferrer"
        className={`block rounded-2xl p-6 text-center transition-all hover:-translate-y-1 hover:shadow-lg ${!hasLink ? "pointer-events-none opacity-50" : ""}`}
        style={{ background: "linear-gradient(135deg, #1677ff, #0ea5e9)", textDecoration: "none" }}>
        <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "rgba(255,255,255,0.2)" }}>
          <Users size={32} color="white" />
        </div>
        <p className="text-base font-bold text-white mb-1">
          {hasLink ? "点击一键加入 瑞启深空 党员飞书群" : "飞书群链接未配置，请联系管理员"}
        </p>
        <p className="text-xs text-white/75">群内将发布组织生活通知及转接后续指引</p>
      </a>

      <button disabled={previewOnly}
        className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: `linear-gradient(135deg, ${R}, ${RD})` }}>
        ✓ 已完成加群，进入下一步
      </button>
    </div>
  );
}

// ── 阶段六：审核归档 ─────────────────────────────────────────────
function Stage6({
  isCompleted = false,
  collectedInfo,
}: {
  isCompleted?: boolean;
  collectedInfo?: Record<string, string> | null;
}) {
  const [showLedger, setShowLedger] = useState(false);

  if (isCompleted) {
    // 状态 B：已完成
    return (
      <div className="space-y-5 text-center py-6">
        <div className="w-24 h-24 mx-auto rounded-full flex items-center justify-center shadow-lg"
          style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
          <CheckCircle2 size={44} color="white" />
        </div>
        <div>
          <p className="text-xl font-bold" style={{ color: "#1a1a1a" }}>🎉 转接全部完成，欢迎加入！</p>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: "#777" }}>
            您的组织关系已正式转入，电子党员档案已生成。<br />
            欢迎加入 瑞启深空 党支部大家庭！
          </p>
        </div>
        {collectedInfo && (
          <button
            onClick={() => setShowLedger(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
            style={{ background: "rgba(22,163,74,0.08)", color: "#16a34a", border: "1px solid rgba(22,163,74,0.3)" }}>
            <FileText size={14} /> 预览我的电子信息台账
          </button>
        )}
        {showLedger && collectedInfo && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
                <h3 className="font-bold text-slate-900">我的电子信息台账</h3>
                <button onClick={() => setShowLedger(false)} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={16} color="#64748b" /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 py-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                  {Object.entries(collectedInfo).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-slate-400">{k}</p>
                      <p className="text-sm font-medium text-slate-800 mt-0.5">{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 状态 A：等待归档中
  return (
    <div className="space-y-5 text-center py-6">
      <div className="relative w-20 h-20 mx-auto">
        <div className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: `linear-gradient(135deg, ${R}, ${RD})` }}>
          <Clock size={32} color="white" />
        </div>
        {/* 呼吸灯效果 */}
        <span className="absolute inset-0 rounded-full animate-ping opacity-20"
          style={{ background: R }} />
      </div>
      <div>
        <p className="text-base font-bold" style={{ color: "#1a1a1a" }}>等待管理员最终归档</p>
        <p className="text-sm mt-2 leading-relaxed" style={{ color: "#777" }}>
          您的全部材料及信息已采集完毕。<br />
          党建专员正在后台为您建立电子台账及实体档案入库，请耐心等待。
        </p>
      </div>
    </div>
  );
}

// ── 转出申请表单 ─────────────────────────────────────────────────
function TransferOutView() {
  const [name,            setName]            = useState("");
  const [targetCommittee, setTargetCommittee] = useState("");
  const [targetBranch,    setTargetBranch]    = useState("");
  const [reason,          setReason]          = useState("");
  const [status,          setStatus]          = useState("DRAFT");
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);
  const [submitting,      setSubmitting]       = useState(false);
  const [msg,             setMsg]             = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { fetchTransferOutInitData } = await import("@/app/actions/party-transfer");
        const res = await fetchTransferOutInitData();
        if (res.record) {
          setName(res.record.name ?? "");
          setTargetCommittee(res.record.targetCommittee ?? "");
          setTargetBranch(res.record.targetBranch ?? "");
          setReason(res.record.reason ?? "");
          setStatus(res.record.status);
        } else {
          setName(res.initName ?? "");
        }
      } catch (e) {
        console.error("fetchTransferOutInitData error:", e);
        setMsg({ text: "加载数据失败，请刷新重试", ok: false });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const isFreezed = status === "SUBMITTED" || status === "APPROVED";
  const inputCls  = `w-full px-3 py-2.5 rounded-xl text-sm outline-none ${isFreezed ? "bg-slate-50 text-slate-400 cursor-not-allowed" : "bg-white"}`;
  const inputSt   = { border: `1px solid ${isFreezed ? "#e5e5e5" : "#d1d5db"}` };

  const handleSaveDraft = async () => {
    setSaving(true); setMsg(null);
    const { saveTransferOutDraft } = await import("@/app/actions/party-transfer");
    const res = await saveTransferOutDraft({ name, targetCommittee, targetBranch, reason });
    setSaving(false);
    setMsg({ text: res.ok ? "✅ 草稿已暂存" : (res.error ?? "保存失败"), ok: !!res.ok });
  };

  const handleSubmit = async () => {
    setSubmitting(true); setMsg(null);
    const { submitTransferOut } = await import("@/app/actions/party-transfer");
    const res = await submitTransferOut({ name, targetCommittee, targetBranch, reason });
    setSubmitting(false);
    if (res.ok) {
      setStatus("SUBMITTED");
      setMsg({ text: "✅ 转出申请已提交，等待审核", ok: true });
    } else {
      setMsg({ text: res.error ?? "提交失败", ok: false });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="inline-block w-6 h-6 border-2 border-slate-200 border-t-red-500 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <div className="rounded-2xl overflow-hidden shadow-sm" style={{ border: "1px solid #f0f0f0" }}>
        <div className="px-6 py-4" style={{ background: `linear-gradient(135deg, ${R} 0%, ${RD} 100%)` }}>
          <p className="text-base font-bold text-white">发起党组织关系转出申请</p>
          <p className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.75)" }}>
            提交后进入审核流程，请确保党费无欠缴、内部材料已抽离
          </p>
        </div>
        <div className="px-6 py-5 bg-white space-y-4">
          {/* 提交冻结横幅 */}
          {isFreezed && (
            <div className="px-4 py-3 rounded-xl flex items-center gap-2 text-sm font-medium"
              style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8" }}>
              <Lock size={14} /> 您的转出申请已提交，当前处于冻结审批状态。
            </div>
          )}
          <div className="text-xs px-3 py-2.5 rounded-xl" style={{ background: RL, color: R, border: `1px solid rgba(204,0,0,0.2)` }}>
            ⚠ 申请提交后，您的账号状态将冻结为「转出审批中」，审核期间无法修改信息。
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "#333" }}>
              姓名 <span style={{ color: R }}>*</span>
              {name && <span className="ml-2 text-green-600 font-normal">（已从台账自动提取）</span>}
            </label>
            <input value={name} onChange={e => setName(e.target.value)} disabled={isFreezed}
              className={inputCls} style={inputSt}
              placeholder="请输入您的姓名" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "#333" }}>接收方党委抬头 <span style={{ color: R }}>*</span></label>
            <input value={targetCommittee} onChange={e => setTargetCommittee(e.target.value)} disabled={isFreezed}
              className={inputCls} style={inputSt}
              placeholder="如：XX 区 XX 街道党委" type="text" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "#333" }}>具体转入党组织名称 <span style={{ color: R }}>*</span></label>
            <input value={targetBranch} onChange={e => setTargetBranch(e.target.value)} disabled={isFreezed}
              className={inputCls} style={inputSt}
              placeholder="如：XX 公司党总支第一支部" type="text" />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: "#333" }}>申请原因 <span style={{ color: R }}>*</span></label>
            <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} disabled={isFreezed}
              className={`${inputCls} resize-none`} style={inputSt}
              placeholder="请简述转出原因（如：离职、户籍变更等）" />
          </div>

          {msg && (
            <p className={`text-xs ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</p>
          )}

          {!isFreezed && (
            <div className="pt-2 flex gap-3">
              <button onClick={handleSaveDraft} disabled={saving}
                className="flex-1 py-3 rounded-xl text-sm font-medium disabled:opacity-50"
                style={{ background: "#f5f5f5", color: "#666" }}>
                {saving ? "暂存中..." : "💾 暂存草稿"}
              </button>
              <button onClick={handleSubmit} disabled={submitting}
                className="flex-1 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: `linear-gradient(135deg, ${R}, ${RD})` }}>
                {submitting ? "提交中..." : "提交转出申请"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 服务端预取数据类型（initialData props） ──────────────────────────
interface InitialRecordData {
  id?:              string;
  status?:          string;
  currentStage?:    string;
  transferType?:    string;
  materials?:       Record<string, unknown>;
  draftData?: {
    uploadedFiles?:    Record<string, unknown>;
    currentStage?:     number;
    targetBranchName?: string;
    realName?:         string;
    idCardNumber?:     string;
  } | null;
  rejectReason?:     string | null;
  targetBranchName?: string | null;
  realName?:         string | null;
  idCardNumber?:     string | null;
  partyFeeData?:     unknown;
  createdAt?:        string;
  updatedAt?:        string;
}

// ── 本地草稿持久化（政务申报方式：localStorage 即存即取，不依赖网络） ───
const DRAFT_LS_KEY = "pa-party-transfer-draft";
interface DraftLocalState {
  realName?:         string;
  idCardNumber?:     string;
  targetBranchName?: string;
  currentStage?:     number;
  uploadedFiles?:    Record<string, unknown>;
  stage2Data?:       unknown;
  tab?:              "in" | "out";
}

// ── 主门户组件 ────────────────────────────────────────────────────────
export default function UserTransferPortal({
  initialData,
}: {
  initialData?: Record<string, unknown> | null;
}) {
  // 强类型化 initialData
  const initRec = initialData as InitialRecordData | null | undefined;
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";

  // 页面配置
  const { data: pageConfigData, mutate: mutateConfig } = useSWR<{
    title: string; description: string; links: unknown[];
    customData?: PartyCustomConfig;
  }>("/api/page-config?pageId=party_transfer", fetcher);

  // 飞书人员目录
  const { data: feishuTargetsData } = useSWR<{ targets?: FeishuTarget[] }>(
    "/api/admin/feishu-targets", fetcher
  );

  // Task 4：当前用户的申请记录（含 DRAFT）
  const { data: recordResp, mutate: mutateRecord } = useSWR<{ record: TransferRecordData | null }>(
    "/api/party-transfer/record",
    fetcher,
    { refreshInterval: 15_000 }
  );

  const customConfig    = pageConfigData?.customData ?? {};
  const archiveContacts = customConfig.contacts?.archives ?? [];
  const templateUrl     = customConfig.templateUrl;
  const feishuTargets   = feishuTargetsData?.targets ?? [];
  const record          = recordResp?.record ?? null;

  const [tab,             setTab]           = useState<"in" | "out">("in");
  const [portalTab,       setPortalTab]     = useState<"guide" | "archive">("guide");
  const [currentStage,    setCurrentStage]  = useState<number>(() =>
    (initRec?.draftData?.currentStage as number | undefined) ?? 1);
  const [showConfig,      setShowConfig]    = useState(false);
  const [saving,          setSaving]        = useState(false);
  // Task 8：基础信息（从服务端预取数据直接初始化，无需等待 SWR）
  const [targetBranchName, setTargetBranchName] = useState<string>(() =>
    (initRec?.draftData?.targetBranchName as string | undefined) ?? (initRec?.targetBranchName ?? ""));
  const [realName,         setRealName]          = useState<string>(() =>
    (initRec?.draftData?.realName as string | undefined) ?? (initRec?.realName ?? ""));
  const [idCardNumber,     setIdCardNumber]       = useState<string>(() =>
    (initRec?.draftData?.idCardNumber as string | undefined) ?? (initRec?.idCardNumber ?? ""));

  // Task 4：从草稿回显（若 initialData 已提供则直接标为已水合，跳过 SWR 等待）
  const [hydrated, setHydrated] = useState<boolean>(() => !!initRec);

  const [uploadedFiles, setUploadedFiles] = useState<Record<string, UploadedFile[]>>(() => {
    // 优先使用 materials（含管理员细粒度审批状态），其次回退到 draftData.uploadedFiles
    const matFiles   = initRec?.materials   as Record<string, UploadedFile[]> | undefined;
    const draftFiles = initRec?.draftData?.uploadedFiles as Record<string, UploadedFile[]> | undefined;
    return matFiles ?? draftFiles ?? {};
  });
  const [uploading,     setUploading]     = useState<Record<string, boolean>>({});

  // 提交校验错误提示
  const [formError, setFormError] = useState<string | null>(null);

  // 💾 暂存草稿专用反馈
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftMsg,    setDraftMsg]    = useState<{ text: string; ok: boolean } | null>(null);

  // Task 5：党费阶段二数据（从服务端预取数据直接初始化）
  const [stage2Data, setStage2Data] = useState<Stage2Data | null>(() =>
    initRec?.partyFeeData ? (initRec.partyFeeData as Stage2Data) : null);

  // Task 4：SWR 水合（仅当 initialData 未提供时才从 SWR 初始化，防止覆盖用户编辑）
  useEffect(() => {
    if (hydrated || !record) return;
    const draft = record.draftData;
    // 优先使用 materials（含管理员审批状态），其次用 draftData.uploadedFiles
    const matFiles  = record.materials as Record<string, UploadedFile[]> | undefined;
    const draftFiles = draft?.uploadedFiles as Record<string, UploadedFile[]> | undefined;
    setUploadedFiles(matFiles ?? draftFiles ?? {});
    if (draft?.currentStage)     setCurrentStage(draft.currentStage as number);
    if (draft?.targetBranchName) setTargetBranchName(draft.targetBranchName as string);
    if (draft?.realName)         setRealName(draft.realName as string);
    if (draft?.idCardNumber)     setIdCardNumber(draft.idCardNumber as string);
    if (record.partyFeeData)     setStage2Data(record.partyFeeData as Stage2Data);
    setHydrated(true);
  }, [record, hydrated]);

  // 任务一：监听 initialData prop 变化，强制重新同步状态
  // 确保每次 Server Component 传入新数据（revalidatePath 触发后）都能立即回显
  useEffect(() => {
    if (!initialData) return;
    const rec  = initialData as InitialRecordData;
    const draft = rec.draftData;
    // 优先使用 materials（含管理员审批状态）
    const matFiles  = rec.materials   as Record<string, UploadedFile[]> | undefined;
    const draftFiles = draft?.uploadedFiles as Record<string, UploadedFile[]> | undefined;
    setUploadedFiles(matFiles ?? draftFiles ?? {});
    if (draft?.currentStage != null) setCurrentStage(draft.currentStage as number);
    setTargetBranchName((draft?.targetBranchName as string | undefined) ?? (rec.targetBranchName ?? ""));
    setRealName((draft?.realName as string | undefined) ?? (rec.realName ?? ""));
    setIdCardNumber((draft?.idCardNumber as string | undefined) ?? (rec.idCardNumber ?? ""));
    if (rec.partyFeeData) setStage2Data(rec.partyFeeData as Stage2Data);
    setHydrated(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialData]);

  // localStorage 恢复：仅当服务端无数据时，从浏览器本地存储恢复草稿
  // 同政务申报系统：localStorge 是同步读取，刷新页面立即可用，不依赖网络
  useEffect(() => {
    if (initialData) return; // 服务端已提供数据，优先使用
    try {
      const raw = localStorage.getItem(DRAFT_LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as DraftLocalState;
      if (saved.realName)         setRealName(saved.realName);
      if (saved.idCardNumber)     setIdCardNumber(saved.idCardNumber);
      if (saved.targetBranchName) setTargetBranchName(saved.targetBranchName);
      if (saved.currentStage)     setCurrentStage(saved.currentStage);
      if (saved.uploadedFiles)    setUploadedFiles(saved.uploadedFiles as Record<string, UploadedFile[]>);
      if (saved.stage2Data)       setStage2Data(saved.stage2Data as Stage2Data);
      if (saved.tab)              setTab(saved.tab);
      setHydrated(true);
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 草稿保存函数
  const saveDraft = useCallback(async (
    files: Record<string, UploadedFile[]>,
    stage?: number,
    info?: { targetBranchName?: string; realName?: string; idCardNumber?: string },
    status = "DRAFT",
  ) => {
    const tbn  = info?.targetBranchName ?? targetBranchName;
    const rn   = info?.realName         ?? realName;
    const idc  = info?.idCardNumber     ?? idCardNumber;
    // 阶段一：终极无菌处理 — 强行剥离所有 File/Blob/Date 等非序列化对象
    const safePayload = JSON.parse(JSON.stringify({
      transferType:     tab === "in" ? "转入申请" : "转出申请",
      materials:        files,
      currentStage:     STAGES[(stage ?? currentStage) - 1]?.label ?? "",
      status,
      draftData:        { uploadedFiles: files, currentStage: stage ?? currentStage, targetBranchName: tbn, realName: rn, idCardNumber: idc },
      targetBranchName: tbn || null,
      realName:         rn  || null,
      idCardNumber:     idc || null,
      partyFeeData:     stage2Data ?? null,
    })) as Record<string, unknown>;
    await fetch("/api/party-transfer/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safePayload),
    });
    // localStorage 同步：草稿状态写入缓存，已提交状态清除缓存（防止刷新后状态错乱）
    try {
      if (status !== "DRAFT") {
        localStorage.removeItem(DRAFT_LS_KEY);
      } else {
        localStorage.setItem(DRAFT_LS_KEY, JSON.stringify({
          realName: rn, idCardNumber: idc, targetBranchName: tbn,
          currentStage: stage ?? currentStage,
          uploadedFiles: files, stage2Data: stage2Data ?? null, tab,
        }));
      }
    } catch { /* ignore */ }
    await mutateRecord();
  }, [tab, currentStage, targetBranchName, realName, idCardNumber, stage2Data, mutateRecord]);

  // 带反馈的手动暂存入口
  const handleSaveDraft = async () => {
    if (draftSaving) return;
    setDraftSaving(true);
    setDraftMsg(null);
    try {
      // 阶段一：终极无菌处理 — 强行剥离所有 File/Blob/Date 等非序列化对象
      const safeDraftPayload = JSON.parse(JSON.stringify({
        transferType:     tab === "in" ? "转入申请" : "转出申请",
        materials:        uploadedFiles,
        currentStage:     STAGES[currentStage - 1]?.label ?? "",
        status:           "DRAFT",
        draftData:        { uploadedFiles, currentStage, targetBranchName, realName, idCardNumber },
        targetBranchName: targetBranchName || null,
        realName:         realName         || null,
        idCardNumber:     idCardNumber     || null,
        partyFeeData:     stage2Data       ?? null,
      })) as Record<string, unknown>;
      const res = await fetch("/api/party-transfer/record", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(safeDraftPayload),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "保存失败");
      }
      await mutateRecord();
      // localStorage 同步：第一层持久化，刷新页面后立即可恢复
      try {
        localStorage.setItem(DRAFT_LS_KEY, JSON.stringify({
          realName, idCardNumber, targetBranchName, currentStage,
          uploadedFiles, stage2Data: stage2Data ?? null, tab,
        }));
      } catch { /* ignore */ }
      setDraftMsg({ text: "✅ 草稿已暂存", ok: true });
    } catch (e) {
      setDraftMsg({ text: `❌ 暂存失败：${(e as Error).message}`, ok: false });
    } finally {
      setDraftSaving(false);
      setTimeout(() => setDraftMsg(null), 3000);
    }
  };

  const handleFileSelect = useCallback(async (category: string, file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      alert("文件超过 50MB 限制，请压缩后重新上传");
      return;
    }
    setUploading(prev => ({ ...prev, [category]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", category);
      const res = await fetch("/api/party-transfer/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        alert(err.error ?? "上传失败");
        return;
      }
      const { url, name: fname } = await res.json() as { url: string; name: string };
      const newFiles = {
        ...uploadedFiles,
        [category]: [...(uploadedFiles[category] ?? []), { name: fname, url }],
      };
      setUploadedFiles(newFiles);
      // Task 4：每次上传后自动存草稿
      await saveDraft(newFiles);
    } catch {
      alert("上传失败，请检查网络后重试");
    } finally {
      setUploading(prev => ({ ...prev, [category]: false }));
    }
  }, [uploadedFiles, saveDraft]);

  const handleRemoveFile = useCallback((category: string, idx: number) => {
    setUploadedFiles(prev => ({
      ...prev,
      [category]: (prev[category] ?? []).filter((_, i) => i !== idx),
    }));
  }, []);

  // 任务三 + Task 9：提交审核（仅阶段一按钮）—— 显式拦截，绝不静默失败
  const handleSubmitStage1 = async () => {
    // 🛡️ 状态守卫：已提交/审核中/已通过 不可重复提交
    const currentStatus = record?.status ?? "";
    if (["STAGE1_SUBMITTED", "STAGE1_COMPANY_APPROVED", "STAGE1_COMMITTEE_APPROVED", "COMPLETED"].includes(currentStatus)) {
      setDraftMsg({ text: "⏳ 申请已提交，请等待审核结果", ok: true });
      setTimeout(() => setDraftMsg(null), 4000);
      return;
    }
    // ── 阶段一：全面显式校验 ───────────────────────────────────────
    if (!targetBranchName.trim() || !realName.trim() || !idCardNumber.trim()) {
      setFormError("提交失败：请完善基础信息，并确保所有标红的【必填】材料均已上传！");
      setTimeout(() => setFormError(null), 5000);
      return;
    }
    const requiredDocs = DOCS.filter(d => d.required);
    const missing = requiredDocs.filter(d => !(uploadedFiles[d.name]?.length));
    if (missing.length > 0) {
      setFormError("提交失败：请完善基础信息，并确保所有标红的【必填】材料均已上传！");
      setTimeout(() => setFormError(null), 5000);
      setCurrentStage(1);
      return;
    }
    // 🛡️ 拦截：仍有未重新上传的被驳回文件
    const stillRejected = Object.values(uploadedFiles).flat().some(f => f.status === "REJECTED");
    if (stillRejected) {
      setFormError("提交失败：请先重新上传所有被驳回（标红）的材料！");
      setTimeout(() => setFormError(null), 5000);
      setCurrentStage(1);
      return;
    }
    // ── 阶段二：Loading 状态，禁用按钮防重复提交 ──────────────────
    setSaving(true);
    // 🚀 乐观更新：立即将本地状态切到"待单位审核"，UI 即时响应
    if (record) {
      await mutateRecord({ record: { ...record, status: "STAGE1_SUBMITTED" } }, false);
    }
    try {
      await saveDraft(uploadedFiles, 1, { targetBranchName, realName, idCardNumber }, "STAGE1_SUBMITTED");
      // ── 阶段四：成功闭环 ──────────────────────────────────────────
      setDraftMsg({ text: "✅ 提交成功！已流转至审核工作台", ok: true });
      setTimeout(() => setDraftMsg(null), 5000);
      // 用真实数据覆盖乐观更新
      await mutateRecord();
    } catch {
      // 回滚乐观更新
      await mutateRecord();
      setFormError("提交失败，请检查网络后重试");
      setTimeout(() => setFormError(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  // 保存并继续（阶段2-6）
  const handleSaveAndContinue = async () => {
    setSaving(true);
    try {
      await saveDraft(uploadedFiles, currentStage);
      if (currentStage < STAGES.length) {
        setCurrentStage(s => Math.min(STAGES.length, s + 1));
      }
    } catch {
      alert("保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  // 阶段一撤回申请：设置 stage1WithdrawRequested = true，等待管理员同意后才真正回退至 DRAFT
  const handleStage1Withdraw = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/party-transfer/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage1WithdrawRequested: true }),
      });
      if (!res.ok) throw new Error("申请失败");
      await mutateRecord();
      setDraftMsg({ text: "✅ 已发送撤回申请，等待管理员审批通过后可重新修改", ok: true });
      setTimeout(() => setDraftMsg(null), 5000);
    } catch (e) {
      setDraftMsg({ text: `❌ 申请失败：${(e as Error).message}`, ok: false });
      setTimeout(() => setDraftMsg(null), 4000);
    } finally {
      setSaving(false);
    }
  };

  const isLocked = LOCKED_STATUSES.has(record?.status ?? "");
  // 全局死锁：提交后所有输入禁用（用于顶部横幅展示）
  const isGloballyLocked = record?.status === "STAGE1_SUBMITTED" || record?.status === "STAGE1_COMPANY_APPROVED";
  // 阶段一完全锁定：提交/审核中/党委通过 时阶段一所有输入均不可编辑
  const isStage1Locked = ["STAGE1_SUBMITTED", "STAGE1_COMPANY_APPROVED", "STAGE1_COMMITTEE_APPROVED"].includes(record?.status ?? "");

  // 根据记录状态计算当前最大允许编辑的步骤（0 索引）
  // ── DEMO 绿灯模式：暂时注释，展示结束后取消注释恢复 ──
  // const maxAllowedStep = (() => {
  //   const s = record?.status ?? "";
  //   if (["DRAFT", "STAGE1_SUBMITTED", "STAGE1_REJECTED", "STAGE1_COMPANY_APPROVED"].includes(s)) return 0;
  //   if (s === "STAGE1_COMMITTEE_APPROVED") return 1;
  //   if (s === "COMPLETED") return 5;
  //   return 0;
  // })();

  // 当前步骤（0 索引）是否为只读预览
  // ── DEMO 绿灯模式：强行写死为 false，展示结束后恢复下方原始逻辑 ──
  // const isCurrentStepPreviewOnly = (currentStage - 1) > maxAllowedStep;
  const isCurrentStepPreviewOnly = false;

  const stage = STAGES[currentStage - 1];

  const STAGE_CONTENT: Record<number, React.ReactNode> = {
    1: <Stage1
         uploadedFiles={uploadedFiles}
         uploading={uploading}
         archiveContacts={archiveContacts}
         feishuTargets={feishuTargets}
         templateUrl={templateUrl}
         targetBranchName={targetBranchName}
         realName={realName}
         idCardNumber={idCardNumber}
         onChangeBasicInfo={(field, val) => {
           if (field === "targetBranchName") setTargetBranchName(val);
           else if (field === "realName") setRealName(val);
           else setIdCardNumber(val);
         }}
         onBlurBasicInfo={() => saveDraft(uploadedFiles, currentStage, { targetBranchName, realName, idCardNumber })}
         onFileSelect={handleFileSelect}
         onRemoveFile={handleRemoveFile}
         previewOnly={isCurrentStepPreviewOnly || isStage1Locked}
         stageLockMode={record?.status === "STAGE1_REJECTED"}
       />,
    2: <Stage2
         initialData={stage2Data ?? undefined}
         onDataChange={setStage2Data}
         previewOnly={isCurrentStepPreviewOnly}
       />,
    3: <Stage3 previewOnly={isCurrentStepPreviewOnly} archiveContacts={archiveContacts} feishuTargets={feishuTargets} />,
    4: <Stage4
         previewOnly={isCurrentStepPreviewOnly}
         defaultName={realName}
         defaultPhone={(record?.partyFeeData as Stage2Data | null)?.phone ?? ""}
         defaultPartyFee={String((record?.partyFeeData as Stage2Data | null)?.calculatedFee ?? "")}
         savedInfo={record?.collectedInfo ?? null}
         stage4ModifyRequested={record?.stage4ModifyRequested ?? false}
         recordId={record?.id}
         onSaved={() => mutateRecord()}
       />,
    5: <Stage5 previewOnly={isCurrentStepPreviewOnly} feishuGroupLink={customConfig.feishuGroupLink} />,
    6: <Stage6 isCompleted={record?.status === "COMPLETED"} collectedInfo={record?.collectedInfo} />,
  };

  return (
    <div className="flex-1 overflow-auto" style={{ background: "#f7f6f5" }}>

      {/* ── 红色主题头部 ─────────────────────────────────────────── */}
      <div style={{ background: `linear-gradient(135deg, ${R} 0%, ${RD} 100%)` }}>
        <div className="px-8 pt-7 pb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.3)" }}>
              <svg viewBox="0 0 32 32" width="28" height="28" fill="none">
                <polygon points="16,2 19.5,12 30,12 21.5,18 24.5,28 16,22 7.5,28 10.5,18 2,12 12.5,12" fill={G} />
              </svg>
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-white tracking-tight">
                {customConfig.pageTitle || "党员组织关系转接系统"}
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.75)" }}>
                {customConfig.pageSubtitle || "瑞启深空 · 初速度（苏州）科技有限公司党总支"}
              </p>
            </div>
            {isSuperAdmin && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowConfig(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={{ background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.85)", border: "1px solid rgba(255,255,255,0.25)" }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.25)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.15)"; }}>
                  <Settings size={12} /> 页面配置
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-4">
            {[...Array(5)].map((_, i) => <Star key={i} size={10} fill={G} color={G} />)}
          </div>
          {/* 快捷链接 */}
          {(customConfig.shortcutLinks?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {customConfig.shortcutLinks!.map((link, i) => (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all hover:opacity-80"
                  style={{ background: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.9)", border: "1px solid rgba(255,255,255,0.25)" }}>
                  <ExternalLink size={10} /> {link.label}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* 门户一级 Tab（流程指引 / 个人档案）*/}
        <div className="flex px-8 mt-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.15)" }}>
          {[
            { key: "guide"   as const, label: "🧭 流程指引" },
            { key: "archive" as const, label: "🗂️ 个人档案" },
          ].map(t => (
            <button key={t.key} onClick={() => setPortalTab(t.key)}
              className="px-5 py-3 text-sm font-medium transition-all relative"
              style={{ color: portalTab === t.key ? "white" : "rgba(255,255,255,0.55)" }}>
              {t.label}
              {portalTab === t.key && (
                <div className="absolute bottom-0 left-5 right-5 h-0.5 rounded-t-full" style={{ background: G }} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── 个人档案视图 ─────────────────────────────────────────── */}
      {portalTab === "archive" && (
        <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
          {/* 电子材料夹 */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #f1f5f9" }}>
            <div className="px-5 py-4" style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
              <h3 className="text-sm font-semibold text-slate-800">📁 电子材料夹</h3>
              <p className="text-xs text-slate-400 mt-0.5">阶段一上传的全部档案材料</p>
            </div>
            <div className="px-5 py-4">
              {(() => {
                const allFiles: Record<string, UploadedFile[]> = {
                  ...(record?.draftData?.uploadedFiles as Record<string, UploadedFile[]> | undefined ?? {}),
                  ...(record?.materials as Record<string, UploadedFile[]> | undefined ?? {}),
                };
                const fileEntries = Object.entries(allFiles).filter(([, f]) => f.length > 0);
                if (fileEntries.length === 0) {
                  return <p className="text-sm text-slate-400 py-4 text-center">暂未上传任何材料</p>;
                }
                return (
                  <div className="space-y-3">
                    {fileEntries.map(([category, files]) => (
                      <div key={category}>
                        <p className="text-xs font-semibold text-slate-500 mb-1.5">{category}</p>
                        <div className="flex flex-wrap gap-2">
                          {files.map((f, i) => (
                            <a key={i} href={f.url} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:opacity-80"
                              style={{ background: "#f0f9ff", color: "#0369a1", border: "1px solid #bae6fd" }}>
                              <FileText size={11} />
                              <span className="max-w-[120px] truncate">{f.name}</span>
                              <ExternalLink size={9} />
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* 信息台账卡 */}
          <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #f1f5f9" }}>
            <div className="px-5 py-4" style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
              <h3 className="text-sm font-semibold text-slate-800">📋 信息台账卡</h3>
              <p className="text-xs text-slate-400 mt-0.5">阶段四填写的党员基本信息</p>
            </div>
            <div className="px-5 py-4">
              {record?.collectedInfo && Object.keys(record.collectedInfo).length > 0 ? (
                <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                  {Object.entries(record.collectedInfo).filter(([, v]) => v).map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs text-slate-400">{k}</p>
                      <p className="text-sm font-medium text-slate-800 mt-0.5">{v}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-400 py-4 text-center">暂无数据，请先完成阶段四的信息采集</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── 流程指引视图（原有内容）─────────────────────────────── */}
      {portalTab === "guide" && (<>

      {/* 转入/转出子 Tab 导航 */}
      <div className="flex px-8 bg-white" style={{ borderBottom: "1px solid #f1f5f9" }}>
        {[
          { key: "in"  as const, label: "转入申请" },
          { key: "out" as const, label: "转出申请" },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-5 py-3 text-sm font-medium transition-all relative"
            style={{ color: tab === t.key ? R : "#94a3b8" }}>
            {t.label}
            {tab === t.key && (
              <div className="absolute bottom-0 left-5 right-5 h-0.5 rounded-t-full" style={{ background: R }} />
            )}
          </button>
        ))}
      </div>

      {/* ── 转入流程 ─────────────────────────────────────────────── */}
      {tab === "in" && (
        <div className="pb-10">

          {/* 驳回强力预警横幅（sticky，高 z-index，STAGE1_REJECTED 即显示） */}
          {record?.status === "STAGE1_REJECTED" && (
            <div className="sticky top-0 z-50 mx-0 mb-0 px-8 py-3 shadow-md"
              style={{ borderLeft: "4px solid #ef4444", background: "#fef2f2", borderBottom: "1px solid #fecaca" }}>
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} color="#dc2626" className="flex-shrink-0 mt-0.5" />
                <p className="text-sm font-bold" style={{ color: "#991b1b" }}>
                  ❌ 您的申请已被审核员驳回。请查看下方各文件的驳回原因，点击"重新上传"替换后重新提交。
                </p>
              </div>
            </div>
          )}

          {/* 🔒 全局死锁横幅：sticky 置顶，视觉强烈 */}
          {isGloballyLocked && (
            <div className="sticky top-0 z-40 px-0 shadow-md"
              style={{ background: "#1e3a5f", borderBottom: "2px solid #1d4ed8" }}>
              <div className="px-8 py-3 flex items-center gap-2.5">
                <Lock size={15} color="white" className="flex-shrink-0" />
                <p className="text-sm font-semibold text-white">
                  🔒 您的申请已提交，当前处于冻结审批状态，无法修改信息。如需修改，请使用下方「申请撤回修改」按钮。
                </p>
              </div>
            </div>
          )}
          {/* 审核中状态信息条（仅非全局死锁时显示） */}
          {isLocked && !isGloballyLocked && (
            <div className="mx-8 mt-4 px-5 py-3.5 rounded-xl flex items-center gap-2.5"
              style={{ background: "#f0f9ff", border: "1px solid #bae6fd" }}>
              <Clock size={16} color="#0284c7" className="flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-sky-700">
                  当前状态：{({
                    STAGE1_SUBMITTED:        "已提交 (等待单位审核)",
                    STAGE1_COMPANY_APPROVED: "单位审核通过 (等待党委审核)",
                    SUBMITTED:               "已提交 (审核中)",
                  } as Record<string, string>)[record?.status ?? ""] ?? "审核中"}
                </p>
                <p className="text-xs text-sky-600 mt-0.5">可点击顶部步骤条查看各阶段材料（仅供预览）</p>
              </div>
            </div>
          )}

          {/* 党委审核通过：阶段二解锁横幅 */}
          {record?.status === "STAGE1_COMMITTEE_APPROVED" && (
            <div className="mx-8 mt-4 px-5 py-3.5 rounded-xl flex items-center gap-2.5"
              style={{ background: "rgba(34,197,94,0.07)", border: "1px solid rgba(34,197,94,0.35)" }}>
              <CheckCircle2 size={16} color="#16a34a" className="flex-shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: "#15803d" }}>
                  当前状态：党委审核通过 (进入正式转接流程，阶段二已解锁)
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#16a34a" }}>请继续完成第二阶段党费核验及后续步骤</p>
              </div>
            </div>
          )}

          {/* 全阶段可导航的多步表单 */}
          <div className="mx-8 mt-4 rounded-2xl overflow-hidden shadow-sm"
            style={{ background: "white", border: "1px solid #f0f0f0" }}>
            {/* 进度条：所有阶段均可自由点击 */}
            <StageProgressBar
              currentStage={currentStage}
              onSelect={setCurrentStage}
            />

            <div className="px-6 pb-6">
              <div className="flex items-center gap-3 py-4 mb-1" style={{ borderBottom: "1px solid #f0f0f0" }}>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: RL }}>
                  {(() => { const Icon = stage.icon; return <Icon size={18} style={{ color: R }} />; })()}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-bold" style={{ color: "#1a1a1a" }}>
                      阶段 {currentStage}：{stage.label}
                    </p>
                    {currentStage === 1 && (() => {
                      const st = record?.status ?? "";
                      let label = "待提交"; let bg = "#f1f5f9"; let color = "#64748b";
                      if (st === "STAGE1_SUBMITTED")          { label = "待单位审核"; bg = "rgba(59,130,246,0.12)"; color = "#2563eb"; }
                      else if (st === "STAGE1_COMPANY_APPROVED")   { label = "待党委审核"; bg = "rgba(245,158,11,0.12)"; color = "#d97706"; }
                      else if (st === "STAGE1_COMMITTEE_APPROVED") { label = "已完成"; bg = "rgba(34,197,94,0.12)"; color = "#16a34a"; }
                      else if (st === "STAGE1_REJECTED")           { label = "待修改"; bg = "rgba(239,68,68,0.12)"; color = "#dc2626"; }
                      return (
                        <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                          style={{ background: bg, color }}>
                          [{label}]
                        </span>
                      );
                    })()}
                  </div>
                  <p className="text-xs" style={{ color: "#999" }}>{stage.short}</p>
                </div>
                <div className="ml-auto flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full"
                  style={{ background: isCurrentStepPreviewOnly ? "#f1f5f9" : RL, color: isCurrentStepPreviewOnly ? "#64748b" : R }}>
                  {isCurrentStepPreviewOnly ? <><Lock size={11} /> 仅预览</> : <><Clock size={11} /> {record?.status === "STAGE1_REJECTED" ? "待修改" : "进行中"}</>}
                </div>
              </div>

              <div className="mt-4">
                {/* 预览模式横幅 — DEMO 绿灯模式：隐藏，展示结束后去掉 hidden 恢复 */}
                {isCurrentStepPreviewOnly && (
                  <div className="hidden bg-slate-100 text-slate-500 p-3 rounded-md mb-4 flex items-center gap-2 text-sm">
                    <Lock size={14} className="flex-shrink-0" />
                    仅供预览：前置阶段尚未审批通过，当前阶段内容处于锁定状态，无法填写或上传。
                  </div>
                )}
                {STAGE_CONTENT[currentStage]}
              </div>
            </div>

            {/* 💾 暂存反馈 */}
            {draftMsg && (
              <div className="mx-6 mt-2 px-4 py-2 rounded-xl text-xs font-medium"
                style={{
                  background: draftMsg.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                  border: `1px solid ${draftMsg.ok ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}`,
                  color: draftMsg.ok ? "#16a34a" : "#dc2626",
                }}>
                {draftMsg.text}
              </div>
            )}

            {/* 提交校验错误提示 */}
            {formError && (
              <div className="mx-6 mt-2 px-4 py-2.5 rounded-xl flex items-center gap-2 text-sm"
                style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}>
                <AlertCircle size={14} className="flex-shrink-0" />
                {formError}
              </div>
            )}

            {/* 底部导航按钮 */}
            <div className="flex gap-3 px-6 py-4" style={{ borderTop: "1px solid #f0f0f0" }}>
              <button
                disabled={currentStage === 1}
                onClick={() => setCurrentStage((s) => Math.max(1, s - 1))}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40"
                style={{ background: "#f5f5f5", color: "#555" }}>
                ← 上一步
              </button>

              {/* 暂存草稿按钮（仅阶段 2-6） */}
              {/* DEMO 绿灯模式：移除 !isLocked 条件，展示结束后恢复 */}
              {!isCurrentStepPreviewOnly && currentStage !== 1 && (
                <button
                  disabled={draftSaving || saving}
                  onClick={handleSaveDraft}
                  className="px-3 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
                  style={{ background: "#f5f5f5", color: "#555", border: "1px solid #e5e5e5", minWidth: 68 }}>
                  {draftSaving
                    ? <><span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />暂存中</>
                    : "💾 暂存"}
                </button>
              )}

              {/* ── 阶段一：按钮变形引擎 ── */}
              {currentStage === 1 && (() => {
                const st = record?.status ?? "";
                const wr = record?.stage1WithdrawRequested ?? false;

                // 草稿/初始
                if (!st || st === "DRAFT") return (
                  <>
                    <button
                      disabled={draftSaving || saving}
                      onClick={handleSaveDraft}
                      className="px-3 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
                      style={{ background: "#f5f5f5", color: "#555", border: "1px solid #e5e5e5", minWidth: 68 }}>
                      {draftSaving ? <><span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />暂存中</> : "💾 暂存"}
                    </button>
                    <button
                      disabled={saving}
                      onClick={handleSubmitStage1}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                      style={{ background: `linear-gradient(135deg, ${R}, ${RD})` }}>
                      {saving ? "正在提交并通知审核员..." : "提交审核 →"}
                    </button>
                  </>
                );

                // 驳回：解锁，允许修改后重新提交
                if (st === "STAGE1_REJECTED") return (
                  <>
                    <button
                      disabled={draftSaving || saving}
                      onClick={handleSaveDraft}
                      className="px-3 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
                      style={{ background: "#f5f5f5", color: "#555", border: "1px solid #e5e5e5", minWidth: 68 }}>
                      {draftSaving ? <><span className="inline-block w-3 h-3 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />暂存中</> : "💾 暂存"}
                    </button>
                    <button
                      disabled={saving}
                      onClick={handleSubmitStage1}
                      className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                      style={{ background: "#dc2626" }}>
                      {saving ? "正在提交..." : "重新提交审核 →"}
                    </button>
                  </>
                );

                // 待单位审核
                if (st === "STAGE1_SUBMITTED") return wr ? (
                  <button disabled
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 cursor-not-allowed"
                    style={{ background: "#f5f5f5" }}>
                    撤回申请审批中...
                  </button>
                ) : (
                  <>
                    {/* 主按钮：待单位审核（disabled，不可再提交） */}
                    <button disabled
                      className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 cursor-not-allowed"
                      style={{ background: "#f5f5f5" }}>
                      ⏳ 待单位审核
                    </button>
                    {/* 副操作：申请撤回（保留功能） */}
                    <button
                      onClick={handleStage1Withdraw}
                      disabled={saving}
                      className="px-3 py-2.5 rounded-xl text-sm font-medium disabled:opacity-60"
                      style={{ background: "#fffbeb", color: "#92400e", border: "1px solid #fcd34d" }}>
                      {saving ? "发送中..." : "↩️ 撤回"}
                    </button>
                  </>
                );

                // 待党委审核
                if (st === "STAGE1_COMPANY_APPROVED") return (
                  <button disabled
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium text-slate-400 cursor-not-allowed"
                    style={{ background: "#f5f5f5" }}>
                    待党委审核中...
                  </button>
                );

                // 党委审核通过：进入下一阶段
                if (st === "STAGE1_COMMITTEE_APPROVED") return (
                  <button
                    onClick={() => setCurrentStage(2)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                    style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
                    进入下一阶段 →
                  </button>
                );

                return null;
              })()}

              {/* 阶段操作按钮（仅阶段 2-6） */}
              {/* DEMO 绿灯模式：移除 !isLocked 条件，展示结束后恢复 */}
              {!isCurrentStepPreviewOnly && currentStage !== 1 && (
                <button
                  disabled={saving || (currentStage === 2 && !(
                    stage2Data?.receiptOcrPassed &&
                    stage2Data?.phone?.trim() &&
                    stage2Data?.feeBaseType !== null &&
                    (
                      (stage2Data.feeBaseType === "year"   && stage2Data.feeBaseValue !== "") ||
                      (stage2Data.feeBaseType === "salary" && stage2Data.feeBaseValue !== "" && stage2Data.calculatedFee !== null)
                    )
                  ))}
                  onClick={handleSaveAndContinue}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: currentStage === STAGES.length ? "#22c55e" : `linear-gradient(135deg, ${R}, ${RD})` }}>
                  {saving ? "保存中..." : currentStage === STAGES.length ? "✓ 完成" : "保存并继续 →"}
                </button>
              )}

              {/* 已提交但非预览状态时，显示下一步导航（仅阶段 2-6） */}
              {!isCurrentStepPreviewOnly && isLocked && currentStage > 1 && currentStage < STAGES.length && (
                <button
                  onClick={() => setCurrentStage(s => Math.min(STAGES.length, s + 1))}
                  className="flex-1 py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: "#f5f5f5", color: "#555" }}>
                  查看下一步 →
                </button>
              )}
            </div>
          </div>

          {/* 党费自助缴纳指引（阶段二） */}
          {currentStage === 2 && (
            <div className="mx-8 mt-4 rounded-2xl p-5"
              style={{ background: `linear-gradient(135deg, rgba(204,0,0,0.04), rgba(139,0,0,0.03))`, border: `1px solid rgba(204,0,0,0.15)` }}>
              <div className="flex items-center gap-2 mb-3">
                <Star size={14} fill={G} color={G} />
                <p className="text-sm font-semibold" style={{ color: R }}>党费自助缴纳指引</p>
              </div>
              <div className="space-y-1.5 text-xs leading-relaxed" style={{ color: "#555" }}>
                <p>1. 在微信小程序中搜索 <span className="font-semibold" style={{ color: R }}>「复兴壹号党建云」</span></p>
                <p>2. 使用本人手机号码绑定登录</p>
                <p>3. 登录主界面即可看到党费交纳数额，确认后点击「我要交纳」</p>
                <p>4. 交纳完成后，实时生成党费凭证（可用于阶段二上传）</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 转出流程 ─────────────────────────────────────────────── */}
      {tab === "out" && <TransferOutView />}
      </> /* portalTab === "guide" */ )}

      {/* ── 页面配置弹窗（超管专属） ────────────────────────────── */}
      {showConfig && (
        <PartyConfigModal
          currentConfig={customConfig}
          feishuTargets={feishuTargets}
          onClose={() => setShowConfig(false)}
          onSaved={async () => {
            await mutateConfig();
            setShowConfig(false);
          }}
        />
      )}

    </div>
  );
}

// ── 党建模块配置弹窗 ─────────────────────────────────────────────
function PartyConfigModal({
  currentConfig,
  feishuTargets,
  onClose,
  onSaved,
}: {
  currentConfig: PartyCustomConfig;
  feishuTargets: FeishuTarget[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  type Tab = "basics" | "contacts";
  const [activeTab, setActiveTab] = useState<Tab>("basics");
  const [draft, setDraft]         = useState<PartyCustomConfig>(() => JSON.parse(JSON.stringify(currentConfig)) as PartyCustomConfig);
  const [saving, setSaving]       = useState(false);
  const [errMsg, setErrMsg]       = useState("");
  // 联系人 combobox 搜索状态
  const [contactSearch, setContactSearch] = useState<Record<string, string>>({});
  const [contactOpen,   setContactOpen]   = useState<Record<string, boolean>>({});

  // 任务二：Word 模板真实上传
  const templateInputRef    = useRef<HTMLInputElement>(null);
  const [templateUploading, setTemplateUploading] = useState(false);

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext !== "doc" && ext !== "docx") {
      setErrMsg("请上传 .doc 或 .docx 格式的 Word 文件");
      return;
    }
    setTemplateUploading(true);
    setErrMsg("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("category", "party_template");
      const res = await fetch("/api/party-transfer/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "上传失败");
      }
      const { url } = await res.json() as { url: string };
      setDraft(d => ({ ...d, templateUrl: url }));
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setTemplateUploading(false);
      if (templateInputRef.current) templateInputRef.current.value = "";
    }
  };

  const userTargets = feishuTargets.filter(t => t.type === "USER");

  const toggleContact = (field: "archives" | "partyFee", feishuId: string) => {
    setDraft(d => {
      const prev = d.contacts?.[field] ?? [];
      const next = prev.includes(feishuId) ? prev.filter(id => id !== feishuId) : [...prev, feishuId];
      return { ...d, contacts: { ...(d.contacts ?? {}), [field]: next } };
    });
  };

  const handleSave = async () => {
    setSaving(true); setErrMsg("");
    try {
      const res = await fetch("/api/page-config?pageId=party_transfer", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customData: draft }),
      });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? "保存失败");
      await onSaved();
    } catch (err) {
      setErrMsg((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col" style={{ width: "min(540px,95vw)", maxHeight: "82vh" }}>
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h3 className="text-base font-bold text-slate-900">党建模块页面配置</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100"><X size={16} color="#64748b" /></button>
        </div>

        <div className="flex gap-0 px-6 pt-3" style={{ borderBottom: "1px solid #f1f5f9" }}>
          {(["basics", "contacts"] as const).map(t => (
            <button key={t} onClick={() => setActiveTab(t)}
              className="px-4 py-2.5 text-sm font-medium relative"
              style={{ color: activeTab === t ? R : "#64748b" }}>
              {t === "basics" ? "基础文案" : "联系人配置"}
              {activeTab === t && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: R }} />}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {activeTab === "basics" && (
            <div className="space-y-4">
              {/* 系统标题 */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">系统标题</label>
                <input
                  type="text"
                  value={draft.pageTitle ?? ""}
                  onChange={e => setDraft(d => ({ ...d, pageTitle: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                  style={{ border: "1px solid #e2e8f0" }}
                  placeholder="默认: 党员组织关系转接系统"
                />
              </div>
              {/* 系统副标题 */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">系统副标题 / 备注</label>
                <input
                  type="text"
                  value={draft.pageSubtitle ?? ""}
                  onChange={e => setDraft(d => ({ ...d, pageSubtitle: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                  style={{ border: "1px solid #e2e8f0" }}
                  placeholder="默认: 瑞启深空 · 初速度（苏州）科技有限公司党总支"
                />
              </div>
              {/* 快捷链接配置 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-semibold text-slate-500">快捷链接配置</label>
                  <button
                    type="button"
                    onClick={() => setDraft(d => ({ ...d, shortcutLinks: [...(d.shortcutLinks ?? []), { label: "", url: "" }] }))}
                    className="text-xs px-2 py-1 rounded-md font-medium transition-all"
                    style={{ color: R, background: RL, border: `1px solid rgba(204,0,0,0.2)` }}>
                    + 添加链接
                  </button>
                </div>
                {(draft.shortcutLinks ?? []).length === 0 && (
                  <p className="text-xs text-slate-400">暂无快捷链接，点击"添加链接"新增</p>
                )}
                <div className="space-y-2">
                  {(draft.shortcutLinks ?? []).map((link, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder="链接名称"
                        value={link.label}
                        onChange={e => {
                          const next = [...(draft.shortcutLinks ?? [])];
                          next[i] = { ...next[i], label: e.target.value };
                          setDraft(d => ({ ...d, shortcutLinks: next }));
                        }}
                        className="w-24 px-2.5 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-red-300"
                        style={{ border: "1px solid #e2e8f0" }}
                      />
                      <input
                        type="text"
                        placeholder="链接 URL"
                        value={link.url}
                        onChange={e => {
                          const next = [...(draft.shortcutLinks ?? [])];
                          next[i] = { ...next[i], url: e.target.value };
                          setDraft(d => ({ ...d, shortcutLinks: next }));
                        }}
                        className="flex-1 px-2.5 py-1.5 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-red-300"
                        style={{ border: "1px solid #e2e8f0" }}
                      />
                      <button
                        type="button"
                        onClick={() => setDraft(d => ({ ...d, shortcutLinks: (d.shortcutLinks ?? []).filter((_, j) => j !== i) }))}
                        className="p-1 hover:bg-red-50 rounded transition-colors flex-shrink-0">
                        <X size={12} color="#ef4444" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                  上传《党员承诺书》空白模板 (Word格式)
                </label>
                {/* 隐藏的 file input，只接受 .doc/.docx */}
                <input
                  ref={templateInputRef}
                  type="file"
                  accept=".doc,.docx"
                  className="hidden"
                  onChange={handleTemplateUpload}
                />
                {draft.templateUrl ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg"
                    style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.3)" }}>
                    <CheckCircle2 size={14} color="#16a34a" className="flex-shrink-0" />
                    <span className="text-xs flex-1 truncate" style={{ color: "#15803d" }}>✅ 已上传新模板</span>
                    <button
                      type="button"
                      onClick={() => templateInputRef.current?.click()}
                      disabled={templateUploading}
                      className="text-xs hover:underline disabled:opacity-50"
                      style={{ color: "#2563eb" }}>
                      {templateUploading ? "上传中..." : "重新上传"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => templateInputRef.current?.click()}
                    disabled={templateUploading}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ border: "1.5px dashed #cbd5e1", background: "#f8fafc", color: "#64748b" }}>
                    {templateUploading ? (
                      <>
                        <span className="inline-block w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                        上传中...
                      </>
                    ) : (
                      <><Upload size={15} />选择 Word 文件上传</>
                    )}
                  </button>
                )}
              </div>
              {/* 飞书群链接 */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">
                  党员飞书群入群链接 (AppLink)
                </label>
                <input
                  type="text"
                  value={draft.feishuGroupLink ?? ""}
                  onChange={e => setDraft(d => ({ ...d, feishuGroupLink: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                  style={{ border: "1px solid #e2e8f0" }}
                  placeholder="例如：https://applink.feishu.cn/..."
                />
              </div>
            </div>
          )}

          {activeTab === "contacts" && (
            <div className="space-y-5">
              {(["archives", "partyFee"] as const).map(field => {
                const selected = draft.contacts?.[field] ?? [];
                const search   = contactSearch[field] ?? "";
                const isOpen   = contactOpen[field]   ?? false;
                const filtered = userTargets.filter(t =>
                  !selected.includes(t.feishuId) &&
                  t.name.toLowerCase().includes(search.toLowerCase())
                );
                return (
                  <div key={field}>
                    <label className="block text-xs font-semibold text-slate-500 mb-2">
                      {field === "archives" ? "档案查阅联系人" : "党费业务联系人"}
                    </label>
                    {/* 已选人员 chips */}
                    {selected.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {selected.map(fid => {
                          const t = userTargets.find(u => u.feishuId === fid);
                          return (
                            <span key={fid}
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                              style={{ background: RL, color: R, border: "1px solid rgba(204,0,0,0.3)" }}>
                              {t?.name ?? fid}
                              <button
                                onClick={() => toggleContact(field, fid)}
                                className="hover:opacity-70 ml-0.5">
                                <X size={9} />
                              </button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                    {/* Combobox 搜索框 */}
                    <div className="relative">
                      {userTargets.length === 0 ? (
                        <p className="text-xs text-slate-400">暂无可选人员，请先在飞书通知配置中添加人员</p>
                      ) : (
                        <>
                          <input
                            type="text"
                            value={search}
                            placeholder="搜索并选择人员..."
                            onFocus={() => setContactOpen(o => ({ ...o, [field]: true }))}
                            onBlur={() => setTimeout(() => setContactOpen(o => ({ ...o, [field]: false })), 150)}
                            onChange={e => setContactSearch(s => ({ ...s, [field]: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-300"
                            style={{ border: "1px solid #e2e8f0" }}
                          />
                          {isOpen && (
                            <div className="absolute z-20 w-full mt-1 bg-white rounded-lg shadow-lg max-h-40 overflow-y-auto"
                              style={{ border: "1px solid #e2e8f0" }}>
                              {filtered.length > 0 ? filtered.map(t => (
                                <button key={t.feishuId}
                                  onMouseDown={() => {
                                    toggleContact(field, t.feishuId);
                                    setContactSearch(s => ({ ...s, [field]: "" }));
                                  }}
                                  className="flex items-center w-full px-3 py-2 text-sm text-left hover:bg-slate-50 transition-colors"
                                  style={{ color: "#475569" }}>
                                  {t.name}
                                </button>
                              )) : (
                                <p className="px-3 py-2 text-xs text-slate-400">
                                  {search ? "无匹配人员" : "所有人员已选完"}
                                </p>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4" style={{ borderTop: "1px solid #f1f5f9" }}>
          {errMsg ? <p className="text-xs text-red-500">{errMsg}</p> : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100">取消</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: `linear-gradient(135deg, ${R}, ${RD})` }}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
