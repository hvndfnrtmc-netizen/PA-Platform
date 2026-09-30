"use client";

import { useState } from "react";
import type React from "react";
import useSWR from "swr";
import {
  Clock, CheckCircle2, Users, Eye, X,
  FileText, Package, AlertTriangle, Pencil, RotateCcw, Check,
  BarChart2, Inbox,
} from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// ── 类型 ─────────────────────────────────────────────────────────
interface FileItem {
  name: string;
  url: string;
  status?: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason?: string;
}

interface TransferRecord {
  id:                    string;
  userName:              string;
  transferType:          string;
  currentStage:          string;
  status:                string;
  materials:             Record<string, FileItem[]>;
  draftData?:            { uploadedFiles?: Record<string, FileItem[]> } | null;
  rejectReason?:         string | null;
  targetBranchName?:     string | null;
  realName?:             string | null;
  idCardNumber?:         string | null;
  collectedInfo?:        Record<string, string> | null;
  stage4ModifyRequested?:  boolean;
  stage1WithdrawRequested?: boolean;
  rejectionHistory?:     { round: number; rejectedAt: string; files: { category: string; fileName: string; reason: string }[] }[] | null;
  createdAt:             string;
  updatedAt:             string;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── 材料绝对排序字典 ──────────────────────────────────────────────
const CATEGORY_ORDER = [
  "入党申请书",
  "转正申请书",
  "政审材料",
  "预审材料",
  "入党志愿书",
  "确定为积极分子材料",
  "确定为发展对象材料",
  "入党培训材料",
  "党员承诺书",
  "其他档案材料",
];

function getCategoryIndex(category: string): number {
  const idx = CATEGORY_ORDER.indexOf(category);
  return idx === -1 ? 99 : idx;
}

// ── 状态标签 ──────────────────────────────────────────────────────
const STATUS_MAP: Record<string, { label: string; bg: string; color: string }> = {
  SUBMITTED:                 { label: "已提交",       bg: "rgba(245,158,11,0.1)",  color: "#d97706" },
  STAGE1_SUBMITTED:          { label: "阶段一待审核", bg: "rgba(245,158,11,0.1)",  color: "#d97706" },
  STAGE1_REJECTED:           { label: "阶段一待修改", bg: "rgba(239,68,68,0.1)",   color: "#dc2626" },
  STAGE1_COMPANY_APPROVED:   { label: "单位审核通过", bg: "rgba(59,130,246,0.1)",  color: "#2563eb" },
  STAGE1_COMMITTEE_APPROVED: { label: "党委审核通过", bg: "rgba(34,197,94,0.1)",   color: "#16a34a" },
  REJECTED:                  { label: "已驳回",       bg: "rgba(239,68,68,0.1)",   color: "#dc2626" },
  COMPLETED:                 { label: "已完成",       bg: "rgba(34,197,94,0.1)",   color: "#16a34a" },
};

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, bg: "#f1f5f9", color: "#64748b" };
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

// ── 材料预览抽屉 ─────────────────────────────────────────────────
function MaterialDrawer({
  record,
  onClose,
  onRefresh,
}: {
  record: TransferRecord;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [inlineReasons,   setInlineReasons]   = useState<Record<string, Record<number, string>>>({});
  const [rejHistoryOpen,  setRejHistoryOpen]  = useState(false);
  const [actionLoading,   setActionLoading]   = useState(false);
  const [zipLoading,       setZipLoading]       = useState(false);
  const [errMsg,           setErrMsg]           = useState("");
  // 归档核对单：仅在 STAGE1_COMMITTEE_APPROVED 时显示，全部勾选后才允许结案
  const ARCHIVE_CHECKLIST = [
    "实体档案材料已全部核对并入库",
    "党员信息已录入全国党员管理系统",
    "党费缴纳基数及标准已核定",
    "确认该同志已加入 Momenta 党员飞书群",
  ] as const;
  const [archiveChecks, setArchiveChecks] = useState<Record<string, boolean>>({});
  const allArchiveChecked = ARCHIVE_CHECKLIST.every(item => archiveChecks[item]);

  // 合并 materials 和 draftData.uploadedFiles 供展示
  const rawFiles: Record<string, FileItem[]> = {
    ...(record.draftData?.uploadedFiles ?? {}),
    ...record.materials,
  };
  const entries = Object.entries(rawFiles).filter(([, files]) => files.length > 0);

  // 本地细粒度审批状态（抽屉打开时深拷贝，未提交前仅本地生效）
  const [localMaterials, setLocalMaterials] = useState<Record<string, FileItem[]>>(() =>
    JSON.parse(JSON.stringify(rawFiles)) as Record<string, FileItem[]>
  );
  const localEntries = Object.entries(localMaterials)
    .filter(([, files]) => files.length > 0)
    .sort(([a], [b]) => getCategoryIndex(a) - getCategoryIndex(b));
  const hasRejectedFile = localEntries.some(([, files]) => files.some(f => f.status === "REJECTED"));
  const allRejectedHaveReasons = localEntries.every(([cat, files]) =>
    files.every((f, idx) =>
      f.status !== "REJECTED" || (inlineReasons[cat]?.[idx]?.trim() ?? "").length > 0
    )
  );

  const setFileStatus = (category: string, idx: number, status: FileItem["status"]) => {
    setLocalMaterials(prev => ({
      ...prev,
      [category]: (prev[category] ?? []).map((f, i) => i === idx ? { ...f, status } : f),
    }));
    // 取消驳回时同步清空行内理由
    if (status !== "REJECTED") {
      setInlineReasons(prev => {
        const catReasons = { ...(prev[category] ?? {}) };
        delete catReasons[idx];
        return { ...prev, [category]: catReasons };
      });
    }
  };

  const handleAction = async (action: "company_approve" | "committee_approve" | "reject" | "complete" | "allow_stage1_withdraw") => {
    setActionLoading(true);
    setErrMsg("");
    try {
      // 驳回时将行内理由写入对应文件的 rejectReason 字段后再提交
      let materialsToSend = localMaterials;
      if (action === "reject") {
        const merged: Record<string, FileItem[]> = JSON.parse(JSON.stringify(localMaterials));
        for (const [cat, catReasons] of Object.entries(inlineReasons)) {
          for (const [idxStr, reason] of Object.entries(catReasons)) {
            const idx = Number(idxStr);
            if (merged[cat]?.[idx]) {
              merged[cat][idx] = { ...merged[cat][idx], rejectReason: reason.trim() };
            }
          }
        }
        materialsToSend = merged;
      }
      const res = await fetch("/api/party-transfer/record", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id, action, materialUpdates: materialsToSend }),
      });
      if (!res.ok) {
        const e = await res.json() as { error?: string };
        throw new Error(e.error ?? "操作失败");
      }
      onRefresh();
      onClose();
    } catch (e) {
      setErrMsg((e as Error).message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleZipDownload = async () => {
    if (!record.realName || !record.targetBranchName) {
      alert("该申请缺少【姓名】或【党支部名称】，无法生成合规包");
      return;
    }
    setZipLoading(true);
    try {
      const JSZip = (await import("jszip")).default;
      const { saveAs } = await import("file-saver");
      const zip = new JSZip();
      const rootFolder  = zip.folder(record.targetBranchName ?? "未命名支部")!;
      const personKey   = `${record.realName}_${record.idCardNumber ?? "未知身份证"}`;
      const personFolder = rootFolder.folder(personKey)!;

      // 按 CATEGORY_ORDER 排序后打包，保证 ZIP 内文件夹顺序
      const sortedEntries = [...entries].sort(([a], [b]) => getCategoryIndex(a) - getCategoryIndex(b));
      for (const [category, files] of sortedEntries) {
        const catIdx = getCategoryIndex(category);
        const folderPrefix = catIdx !== 99 ? `${catIdx + 1}.` : "99.";
        const catFolder = personFolder.folder(`${folderPrefix}${category}`)!;
        for (const file of files) {
          try {
            const resp = await fetch(file.url);
            if (!resp.ok) throw new Error(`fetch failed: ${file.url}`);
            const blob = await resp.blob();
            catFolder.file(file.name, blob);
          } catch {
            // TODO: 如需强制全图片格式，可在此处用 pdf.js 将 PDF 栅格化为图片
            console.warn(`文件下载失败，跳过: ${file.name}`);
          }
        }
      }

      const content = await zip.generateAsync({ type: "blob" });
      saveAs(content, `${record.realName}_党员档案材料.zip`);
    } catch {
      alert("打包失败，部分文件可能存在跨域限制");
    } finally {
      setZipLoading(false);
    }
  };

  // 根据状态显示不同的主操作按钮
  const renderActionButtons = () => {
    switch (record.status) {
      case "STAGE1_SUBMITTED":
      case "SUBMITTED":
        return (
          <>
            <button
              onClick={() => handleAction("reject")}
              disabled={!hasRejectedFile || !allRejectedHaveReasons || actionLoading}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
              {actionLoading ? "提交中..." : hasRejectedFile && !allRejectedHaveReasons ? "请填写驳回原因" : "驳回申请"}
            </button>
            <button
              onClick={() => handleAction("company_approve")}
              disabled={actionLoading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}>
              {actionLoading ? "处理中..." : "单位审核通过"}
            </button>
          </>
        );
      case "STAGE1_COMPANY_APPROVED":
        return (
          <>
            <button
              onClick={() => handleAction("reject")}
              disabled={!hasRejectedFile || !allRejectedHaveReasons || actionLoading}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
              {actionLoading ? "提交中..." : hasRejectedFile && !allRejectedHaveReasons ? "请填写驳回原因" : "驳回申请"}
            </button>
            <button
              onClick={() => handleAction("committee_approve")}
              disabled={actionLoading}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
              {actionLoading ? "处理中..." : "党委审核通过"}
            </button>
          </>
        );
      case "STAGE1_COMMITTEE_APPROVED":
        return (
          <div className="w-full space-y-3">
            {/* 归档核对清单 */}
            <div className="rounded-xl p-4 space-y-2.5"
              style={{ background: "rgba(22,163,74,0.05)", border: "1px solid rgba(22,163,74,0.2)" }}>
              <p className="text-xs font-semibold" style={{ color: "#15803d" }}>归档核对清单（全部勾选后方可结案）</p>
              {ARCHIVE_CHECKLIST.map(item => {
                const checked = !!archiveChecks[item];
                return (
                  <button key={item}
                    onClick={() => setArchiveChecks(c => ({ ...c, [item]: !c[item] }))}
                    className="flex items-center gap-2.5 w-full text-left text-xs"
                    style={{ color: "#374151" }}>
                    <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                      style={{ border: `2px solid ${checked ? "#16a34a" : "#d1d5db"}`, background: checked ? "#16a34a" : "white" }}>
                      {checked && <Check size={10} color="white" />}
                    </div>
                    {item}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => handleAction("complete")}
              disabled={actionLoading || !allArchiveChecked}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
              {actionLoading ? "处理中..." : "📦 确认无误，正式结案归档"}
            </button>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-[9999] flex">
        <div className="flex-1 bg-black/40" onClick={onClose} />
        <div className="w-full max-w-lg bg-white flex flex-col shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
            <div>
              <h3 className="text-base font-bold text-slate-900">{record.userName} · 材料详情</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {record.transferType} · {record.currentStage} · 提交于 {new Date(record.createdAt).toLocaleDateString("zh-CN")}
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100">
              <X size={16} color="#64748b" />
            </button>
          </div>

          {/* 撤回申请预警横幅 */}
          {record.stage1WithdrawRequested && (
            <div className="mx-6 mt-4 p-4 rounded-xl flex items-center justify-between gap-3"
              style={{ background: "#fefce8", border: "1px solid #fde68a" }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <AlertTriangle size={16} color="#d97706" className="flex-shrink-0" />
                <p className="text-sm font-semibold" style={{ color: "#92400e" }}>
                  ⚠️ 申请人请求撤回该表单进行修改。
                </p>
              </div>
              <button
                onClick={() => handleAction("allow_stage1_withdraw")}
                disabled={actionLoading}
                className="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60 whitespace-nowrap"
                style={{ background: "#d97706" }}>
                {actionLoading ? "处理中..." : "同意撤回"}
              </button>
            </div>
          )}

          {/* 基础信息 */}
          {(record.realName || record.targetBranchName) && (
            <div className="px-6 py-3 flex flex-wrap gap-4 text-xs text-slate-500"
              style={{ borderBottom: "1px solid #f1f5f9", background: "#fafafa" }}>
              {record.targetBranchName && <span>党支部：<b className="text-slate-700">{record.targetBranchName}</b></span>}
              {record.realName        && <span>姓名：<b className="text-slate-700">{record.realName}</b></span>}
              {record.idCardNumber    && <span>身份证：<b className="text-slate-700">{record.idCardNumber}</b></span>}
            </div>
          )}

          {/* 驳回原因展示 */}
          {record.rejectReason && (
            <div className="mx-6 mt-4 p-3 rounded-xl text-xs"
              style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626" }}>
              <span className="font-semibold">驳回原因：</span>{record.rejectReason}
            </div>
          )}

          {/* 一键打包按钮 */}
          <div className="px-6 pt-4">
            <button
              onClick={handleZipDownload}
              disabled={zipLoading}
              className="flex items-center gap-2 w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #2563eb, #1d4ed8)" }}>
              <Package size={14} />
              {zipLoading ? "打包中..." : "📦 一键打包下载（高铁党委合规格式）"}
            </button>
          </div>

          {/* Materials — 绝对遍历 CATEGORY_ORDER，空分类也显示占位 */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {CATEGORY_ORDER.map((category, catIdx) => {
              const displayName = `${catIdx + 1}. ${category}`;
              const files = localMaterials[category] ?? [];
              const hasFiles = files.length > 0;
              return (
                <div key={category} className="rounded-xl border overflow-hidden"
                  style={{ borderColor: hasFiles ? "#e2e8f0" : "#f1f5f9" }}>
                  <div className="px-4 py-3 flex items-center justify-between"
                    style={{ background: hasFiles ? "#f8fafc" : "#fafafa" }}>
                    <h4 className="text-sm font-semibold" style={{ color: hasFiles ? "#334155" : "#94a3b8" }}>
                      {displayName}
                    </h4>
                    <span className="text-xs" style={{ color: hasFiles ? "#64748b" : "#cbd5e1" }}>
                      {hasFiles ? `${files.length} 个文件` : "未上传"}
                    </span>
                  </div>
                  {hasFiles ? (
                    <div className="divide-y divide-slate-50">
                      {files.map((file, idx) => (
                        <div key={idx}>
                          <div
                            className="flex items-center justify-between px-4 py-3"
                            style={{
                              background: file.status === "REJECTED" ? "rgba(239,68,68,0.04)"
                                        : file.status === "APPROVED" ? "rgba(34,197,94,0.04)" : "white",
                            }}>
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <FileText size={14} color="#94a3b8" className="flex-shrink-0" />
                              <a href={file.url} target="_blank" rel="noopener noreferrer"
                                className="text-sm text-blue-600 hover:underline truncate max-w-[150px]">
                                {file.name}
                              </a>
                            </div>
                            <div className="flex gap-1.5 flex-shrink-0 ml-2">
                              <button
                                onClick={() => setFileStatus(category, idx, "APPROVED")}
                                className="text-xs px-2 py-1 rounded-lg font-medium transition-colors"
                                style={{
                                  background: file.status === "APPROVED" ? "rgba(34,197,94,0.15)" : "#f8f8f8",
                                  color: "#16a34a",
                                  border: `1px solid ${file.status === "APPROVED" ? "rgba(34,197,94,0.4)" : "#e5e5e5"}`,
                                }}>
                                ✅ 合格
                              </button>
                              <button
                                onClick={() => setFileStatus(category, idx, "REJECTED")}
                                className="text-xs px-2 py-1 rounded-lg font-medium transition-colors"
                                style={{
                                  background: file.status === "REJECTED" ? "rgba(239,68,68,0.15)" : "#f8f8f8",
                                  color: "#dc2626",
                                  border: `1px solid ${file.status === "REJECTED" ? "rgba(239,68,68,0.4)" : "#e5e5e5"}`,
                                }}>
                                ❌ 驳回
                              </button>
                              <a href={file.url} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
                                style={{ background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}>
                                <Eye size={11} />
                              </a>
                            </div>
                          </div>
                          {/* 行内驳回理由输入框（仅当文件被标为驳回时展开） */}
                          {file.status === "REJECTED" && (
                            <div className="px-4 pb-3"
                              style={{ background: "rgba(239,68,68,0.04)" }}>
                              <textarea
                                rows={2}
                                placeholder="请填写此文件的驳回原因（必填，申请人将看到此内容）..."
                                value={inlineReasons[category]?.[idx] ?? ""}
                                onChange={e => setInlineReasons(prev => ({
                                  ...prev,
                                  [category]: { ...(prev[category] ?? {}), [idx]: e.target.value },
                                }))}
                                className="w-full px-3 py-2 rounded-lg text-xs resize-none outline-none"
                                style={{ border: "1px solid #fca5a5", background: "#fff7f7" }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-3 text-xs text-slate-300 italic">未上传此类材料</div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 驳回历史记录（可折叠） */}
          {record.rejectionHistory && record.rejectionHistory.length > 0 && (
            <div className="mx-6 mb-3">
              <button
                onClick={() => setRejHistoryOpen(v => !v)}
                className="flex items-center gap-1.5 text-xs font-medium w-full py-2 px-3 rounded-lg"
                style={{ background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" }}>
                <AlertTriangle size={12} />
                {rejHistoryOpen ? "▲" : "▼"} 驳回记录（共 {record.rejectionHistory.length} 轮）
              </button>
              {rejHistoryOpen && (
                <div className="mt-2 space-y-3">
                  {record.rejectionHistory.map((round) => (
                    <div key={round.round} className="rounded-lg p-3 text-xs"
                      style={{ background: "#fff7f7", border: "1px solid #fecaca" }}>
                      <p className="font-semibold mb-1.5" style={{ color: "#991b1b" }}>
                        第 {round.round} 轮驳回 · {new Date(round.rejectedAt).toLocaleString("zh-CN")}
                      </p>
                      <ul className="space-y-1">
                        {round.files.map((f, i) => (
                          <li key={i} className="flex gap-1.5" style={{ color: "#374151" }}>
                            <span style={{ color: "#fca5a5" }} className="flex-shrink-0">·</span>
                            <span>
                              <b>{f.category}</b> — {f.fileName}：
                              <span style={{ color: "#dc2626" }}>{f.reason}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {errMsg && (
            <div className="mx-6 mb-2 text-xs text-red-500 flex items-center gap-1">
              <AlertTriangle size={12} /> {errMsg}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 px-6 py-4" style={{ borderTop: "1px solid #f1f5f9" }}>
            {renderActionButtons()}
          </div>
        </div>
      </div>
    </>
  );
}

// ── 台账编辑弹窗 ─────────────────────────────────────────────────
function LedgerEditDialog({
  record,
  onClose,
  onRefresh,
}: {
  record: TransferRecord;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const info = record.collectedInfo ?? {};
  const [form, setForm] = useState<Record<string, string>>({ ...info });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const fields = [
    "name","gender","idCard","birthYear","birthMonth","hometown",
    "education","educationOther","joinPartyDate","company","companyOther",
    "position","branch","phone","transferInYear","transferInMonth",
    "partyFee","transferOutDate","remarks",
  ];
  const LABELS: Record<string, string> = {
    name:"姓名", gender:"性别", idCard:"身份证号", birthYear:"出生年", birthMonth:"出生月",
    hometown:"籍贯", education:"学历", educationOther:"学历补充", joinPartyDate:"入党时间",
    company:"签约公司", companyOther:"公司补充", position:"职务", branch:"所在党支部",
    phone:"联系方式", transferInYear:"转入年", transferInMonth:"转入月",
    partyFee:"党费", transferOutDate:"转出时间", remarks:"备注",
  };

  const handleSave = async () => {
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/party-transfer/record", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id, action: "admin_edit_ledger", collectedInfo: form }),
      });
      if (!res.ok) throw new Error("保存失败");
      onRefresh();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">编辑台账 — {record.userName}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 grid grid-cols-2 gap-3">
          {fields.map(key => (
            <div key={key} className={key === "remarks" ? "col-span-2" : ""}>
              <label className="text-xs text-slate-500 mb-1 block">{LABELS[key] ?? key}</label>
              {key === "remarks"
                ? <textarea rows={2} value={form[key] ?? ""}
                    onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 outline-none resize-none" />
                : <input value={form[key] ?? ""} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 outline-none" />
              }
            </div>
          ))}
        </div>
        {err && <p className="px-6 text-xs text-red-500">{err}</p>}
        <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm text-slate-600" style={{ background: "#f5f5f5" }}>取消</button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)" }}>
            {saving ? "保存中..." : "保存台账"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────
export default function AdminAuditBoard() {
  const [selectedRecord, setSelectedRecord] = useState<TransferRecord | null>(null);
  const [editLedger,     setEditLedger]     = useState<TransferRecord | null>(null);
  const [activeTab,      setActiveTab]      = useState<"audit"|"ledger"|"dashboard">("audit");
  const [auditFilter,    setAuditFilter]    = useState<"all"|"pending"|"inProgress"|"completed">("all");

  const { data, isLoading, mutate } = useSWR<{ records: TransferRecord[] }>(
    "/api/party-transfer/record",
    fetcher,
    { refreshInterval: 30_000 }
  );

  const records  = data?.records ?? [];

  // Task 6: 严格过滤 DRAFT，统计数字也同样过滤
  const pending  = records.filter(r => ["SUBMITTED", "STAGE1_SUBMITTED"].includes(r.status)).length;
  const inProgress = records.filter(r => ["STAGE1_COMPANY_APPROVED"].includes(r.status)).length;
  const approved = records.filter(r => ["STAGE1_COMMITTEE_APPROVED", "COMPLETED"].includes(r.status)).length;

  const displayRecords  = records;
  const displayPending  = pending;
  const displayProgress = inProgress;
  const displayApproved = approved;

  // 根据 auditFilter 过滤审批列表
  const filteredRecords = displayRecords.filter(r => {
    if (auditFilter === "pending")    return ["SUBMITTED", "STAGE1_SUBMITTED"].includes(r.status);
    if (auditFilter === "inProgress") return ["STAGE1_COMPANY_APPROVED"].includes(r.status);
    if (auditFilter === "completed")  return ["STAGE1_COMMITTEE_APPROVED", "COMPLETED"].includes(r.status);
    return true;
  });

  const handleUnlockStage4 = async (id: string) => {
    await fetch("/api/party-transfer/record", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "unlock_stage4" }),
    });
    mutate();
  };

  const LEDGER_COLS = [
    { key: "userName",       label: "姓名" },
    { key: "name",           label: "台账姓名" },
    { key: "gender",         label: "性别" },
    { key: "idCard",         label: "身份证号" },
    { key: "birthYear",      label: "出生年" },
    { key: "education",      label: "学历" },
    { key: "joinPartyDate",  label: "入党时间" },
    { key: "company",        label: "签约公司" },
    { key: "position",       label: "职务" },
    { key: "branch",         label: "党支部" },
    { key: "phone",          label: "联系方式" },
    { key: "transferInYear", label: "转入年" },
    { key: "partyFee",       label: "党费" },
    { key: "transferOutDate",label: "转出时间" },
    { key: "remarks",        label: "备注" },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* 顶部 Tab 切换 */}
      <div className="flex gap-2">
        {([
          { key: "audit",     label: "🛡️ 档案审核" },
          { key: "ledger",    label: "📊 信息台账" },
          { key: "dashboard", label: "📈 数据大屏" },
        ] as { key: "audit"|"ledger"|"dashboard"; label: string }[]).map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className="px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
            style={{
              background: activeTab === t.key ? "linear-gradient(135deg,#2563eb,#1d4ed8)" : "white",
              color: activeTab === t.key ? "white" : "#64748b",
              border: activeTab === t.key ? "none" : "1px solid #e2e8f0",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === "audit" && (
        <>
          {/* 智能状态筛选器 */}
          <div className="flex gap-2">
            {([
              { key: "all",        label: "全部",   count: displayRecords.length },
              { key: "pending",    label: "待审核", count: displayPending },
              { key: "inProgress", label: "转接中", count: displayProgress },
              { key: "completed",  label: "已完成", count: displayApproved },
            ] as { key: "all"|"pending"|"inProgress"|"completed"; label: string; count: number }[]).map(f => (
              <button key={f.key} onClick={() => setAuditFilter(f.key)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all"
                style={{
                  background: auditFilter === f.key ? "#1e40af" : "white",
                  color:      auditFilter === f.key ? "white" : "#64748b",
                  border: auditFilter === f.key ? "none" : "1px solid #e2e8f0",
                }}>
                {f.label}
                <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs"
                  style={{ background: auditFilter === f.key ? "rgba(255,255,255,0.2)" : "#f1f5f9" }}>
                  {f.count}
                </span>
              </button>
            ))}
          </div>

          {/* 顶部数据看板 */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: "待审核",  count: displayPending,   icon: Clock,         bg: "rgba(245,158,11,0.08)",  color: "#d97706", border: "rgba(245,158,11,0.2)" },
              { label: "转接中",  count: displayProgress,  icon: Users,         bg: "rgba(59,130,246,0.08)",  color: "#2563eb", border: "rgba(59,130,246,0.2)" },
              { label: "已完成",  count: displayApproved,  icon: CheckCircle2,  bg: "rgba(34,197,94,0.08)",   color: "#16a34a", border: "rgba(34,197,94,0.2)"  },
            ].map(({ label, count, icon: Icon, bg, color, border }: { label: string; count: number; icon: React.ElementType; bg: string; color: string; border: string }) => (
              <div key={label} className="rounded-2xl p-5 flex items-center gap-4"
                style={{ background: bg, border: `1px solid ${border}` }}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "white" }}>
                  <Icon size={20} style={{ color }} />
                </div>
                <div>
                  <p className="text-2xl font-bold" style={{ color }}>{count}</p>
                  <p className="text-xs font-medium text-slate-500 mt-0.5">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* 申请列表 */}
          <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #f1f5f9" }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ background: "white", borderBottom: "1px solid #f1f5f9" }}>
              <h3 className="text-sm font-semibold text-slate-800">申请列表</h3>
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-400 text-sm bg-white">加载中...</div>
            ) : filteredRecords.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 bg-slate-50">
                <Inbox size={48} className="text-slate-300" />
                <div className="text-slate-500 font-medium mt-4">暂无待处理的申请记录</div>
                <div className="text-sm text-slate-400 mt-1">当有员工提交转接申请时，这里将会显示数据。</div>
              </div>
            ) : (
              <table className="w-full" style={{ background: "white" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                    {["姓名", "申请类型", "当前阶段", "提交时间", "状态", "操作"].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredRecords.map(record => (
                    <tr key={record.id}
                      className="transition-colors hover:bg-slate-50"
                      style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td className="px-5 py-3.5 text-sm font-medium text-slate-800">{record.userName}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-600">{record.transferType}</td>
                      <td className="px-5 py-3.5 text-sm text-slate-600">{record.currentStage}</td>
                      <td className="px-5 py-3.5 text-xs text-slate-400">
                        {new Date(record.createdAt).toLocaleDateString("zh-CN")}
                      </td>
                      <td className="px-5 py-3.5"><StatusBadge status={record.status} /></td>
                      <td className="px-5 py-3.5">
                        <button
                          onClick={() => setSelectedRecord(record)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                          style={{ background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}>
                          <Eye size={11} /> 审核详情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {activeTab === "ledger" && (
        <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid #f1f5f9" }}>
          <div className="px-5 py-4" style={{ background: "white", borderBottom: "1px solid #f1f5f9" }}>
            <h3 className="text-sm font-semibold text-slate-800">党员信息台账</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ background: "white", minWidth: "1200px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #f1f5f9", background: "#fafafa" }}>
                  <th className="px-4 py-3 text-left font-semibold text-slate-500 whitespace-nowrap">操作</th>
                  {LEDGER_COLS.map(c => (
                    <th key={c.key} className="px-4 py-3 text-left font-semibold text-slate-500 whitespace-nowrap">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayRecords.map(record => {
                  const info = record.collectedInfo ?? {};
                  const hasInfo = Object.keys(info).length > 0;
                  return (
                    <tr key={record.id}
                      className="transition-colors hover:bg-slate-50"
                      style={{ borderBottom: "1px solid #f8fafc" }}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex gap-1.5">
                          {record.stage4ModifyRequested && (
                            <button
                              onClick={() => handleUnlockStage4(record.id)}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-white whitespace-nowrap"
                              style={{ background: "#dc2626" }}>
                              <RotateCcw size={10} />↩️退回修改
                            </button>
                          )}
                          <button
                            onClick={() => setEditLedger(record)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium"
                            style={{ background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}>
                            <Pencil size={10} />编辑台账
                          </button>
                        </div>
                        {record.stage4ModifyRequested && (
                          <span className="mt-1 block text-xs font-semibold" style={{ color: "#dc2626" }}>⚠️ 申请修改</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-800 whitespace-nowrap">{record.userName}</td>
                      {LEDGER_COLS.slice(1).map(c => (
                        <td key={c.key} className={`px-4 py-3 text-slate-600 ${!hasInfo ? "text-slate-300" : ""}`}>
                          {hasInfo ? (info[c.key] ?? "—") : "—"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
                {displayRecords.length === 0 && (
                  <tr>
                    <td colSpan={LEDGER_COLS.length + 1} className="px-5 py-16 text-center text-slate-400 text-sm">暂无台账记录</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "dashboard" && (() => {
        // 状态分布数据
        const statusMap: Record<string, string> = {
          STAGE1_SUBMITTED:          "待审核",
          STAGE1_COMPANY_APPROVED:   "单位已审",
          STAGE1_COMMITTEE_APPROVED: "党委已审",
          STAGE1_REJECTED:           "已驳回",
          COMPLETED:                 "已完成",
        };
        const PIE_COLORS = ["#f59e0b", "#3b82f6", "#8b5cf6", "#ef4444", "#22c55e"];
        const pieData = Object.entries(
          displayRecords.reduce<Record<string, number>>((acc, r) => {
            const label = statusMap[r.status] ?? r.status;
            acc[label] = (acc[label] ?? 0) + 1;
            return acc;
          }, {})
        ).map(([name, value]) => ({ name, value }));

        // 近 6 个月趋势
        const monthCounts: Record<string, number> = {};
        displayRecords.forEach(r => {
          const d = new Date(r.createdAt);
          const key = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}`;
          monthCounts[key] = (monthCounts[key] ?? 0) + 1;
        });
        const trendData = Object.entries(monthCounts)
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-6)
          .map(([month, count]) => ({ month, count }));

        return (
          <div className="space-y-6">
            {/* 汇总卡片 */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { label: "总申请数", value: displayRecords.length, color: "#2563eb" },
                { label: "待审核",   value: displayPending,        color: "#d97706" },
                { label: "转接中",   value: displayProgress,       color: "#7c3aed" },
                { label: "已完成",   value: displayApproved,       color: "#16a34a" },
              ].map(({ label, value, color }) => (
                <div key={label} className="bg-white rounded-2xl p-5 flex flex-col gap-1"
                  style={{ border: "1px solid #f1f5f9" }}>
                  <p className="text-3xl font-bold" style={{ color }}>{value}</p>
                  <p className="text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* 状态分布饼图 */}
              <div className="bg-white rounded-2xl p-5" style={{ border: "1px solid #f1f5f9" }}>
                <div className="flex items-center gap-2 mb-4">
                  <BarChart2 size={14} color="#2563eb" />
                  <h3 className="text-sm font-semibold text-slate-800">申请状态分布</h3>
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* 提交趋势柱状图 */}
              <div className="bg-white rounded-2xl p-5" style={{ border: "1px solid #f1f5f9" }}>
                <div className="flex items-center gap-2 mb-4">
                  <BarChart2 size={14} color="#2563eb" />
                  <h3 className="text-sm font-semibold text-slate-800">近期申请趋势</h3>
                </div>
                {trendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={trendData}>
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="count" name="申请数" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-48 text-slate-400 text-sm">暂无趋势数据</div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {selectedRecord && (
        <MaterialDrawer
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onRefresh={() => mutate()}
        />
      )}
      {editLedger && (
        <LedgerEditDialog
          record={editLedger}
          onClose={() => setEditLedger(null)}
          onRefresh={() => mutate()}
        />
      )}
    </div>
  );
}
