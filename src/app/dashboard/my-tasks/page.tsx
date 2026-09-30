"use client";

/**
 * /dashboard/my-tasks — 业务部门填报工作台（DEPT_CONTACT 专属）
 *
 * 极简设计原则：
 *   - 只展示本部门被分配的任务，绝不显示其他部门数据
 *   - 界面聚焦"去填报"→"标记已提交"两步核心动作
 *   - 数据来源全部走 /api/my-tasks，后端强制 departmentId 过滤
 */

import { useState, useEffect, useCallback } from "react";
import {
  ClipboardCheck,
  Clock,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  CalendarClock,
  FileText,
  Inbox,
  Send,
} from "lucide-react";

// ──────────────────────────────────────────────
// 类型
// ──────────────────────────────────────────────

interface Task {
  id: string;
  title: string;
  description: string | null;
  type: "PERIODIC" | "SPECIAL";
  status: string;
  deadline: string | null;
  feishuSheetUrl: string | null;
}

interface Assignment {
  id: string;
  status: "PENDING_SEND" | "PENDING_FILL" | "SUBMITTED" | "REJECTED" | "ARCHIVED";
  submittedAt:   string | null;
  rejectNote:    string | null;
  assigneeName:  string | null;
  task:          Task;
  permLevel:     "edit" | "view";
}

interface Stats {
  total:       number;
  pendingSend: number;
  pendingFill: number;
  submitted:   number;
  rejected:    number;
  archived:    number;
  urgent:      number;
}

// ──────────────────────────────────────────────
// 状态配置
// ──────────────────────────────────────────────

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; icon: React.ElementType }> = {
  PENDING_SEND: { label: "待发送",  color: "#94a3b8", bg: "rgba(148,163,184,0.1)", icon: Clock          },
  PENDING_FILL: { label: "待填报",  color: "#ef4444", bg: "rgba(239,68,68,0.1)",   icon: Clock          },
  SUBMITTED:    { label: "已提交",  color: "#3b82f6", bg: "rgba(59,130,246,0.1)",  icon: ClipboardCheck },
  REJECTED:     { label: "已打回",  color: "#f59e0b", bg: "rgba(245,158,11,0.1)",  icon: XCircle        },
  ARCHIVED:     { label: "已归档",  color: "#22c55e", bg: "rgba(34,197,94,0.1)",   icon: CheckCircle2   },
};

// ──────────────────────────────────────────────
// 工具函数
// ──────────────────────────────────────────────

function daysLeft(deadline: string | null): number | null {
  if (!deadline) return null;
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400000);
}

function DeadlineBadge({ deadline }: { deadline: string | null }) {
  if (!deadline) return <span className="text-xs text-slate-400">无截止</span>;
  const days = daysLeft(deadline);
  const dateStr = new Date(deadline).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  if (days === null) return null;
  if (days < 0)  return <span className="text-xs font-medium" style={{ color: "#ef4444" }}>已逾期 {Math.abs(days)} 天</span>;
  if (days === 0) return <span className="text-xs font-semibold" style={{ color: "#ef4444" }}>今日截止</span>;
  if (days <= 3)  return <span className="text-xs font-medium" style={{ color: "#f59e0b" }}>⚡ 剩余 {days} 天（{dateStr}）</span>;
  return <span className="text-xs" style={{ color: "#64748b" }}>{dateStr} 截止（剩 {days} 天）</span>;
}

// ──────────────────────────────────────────────
// 任务卡片
// ──────────────────────────────────────────────

function TaskCard({
  assignment,
  onSubmit,
  isSubmitting,
}: {
  assignment: Assignment;
  onSubmit: (id: string) => void;
  isSubmitting: boolean;
}) {
  const { task } = assignment;
  const cfg = STATUS_CFG[assignment.status] ?? STATUS_CFG.PENDING_FILL;
  const StatusIcon = cfg.icon;
  const days = daysLeft(task.deadline);
  const isUrgent   = days !== null && days <= 3 && (assignment.status === "PENDING_FILL" || assignment.status === "REJECTED");
  const isViewOnly = assignment.permLevel === "view";
  const canSubmit  = !isViewOnly && (assignment.status === "PENDING_FILL" || assignment.status === "REJECTED");

  return (
    <div
      className="bg-white rounded-2xl p-5 flex flex-col gap-4 transition-shadow hover:shadow-md"
      style={{ border: `1px solid ${isUrgent ? "rgba(239,68,68,0.3)" : "#e2e8f0"}` }}
    >
      {/* 顶栏：任务类型 + 状态 + 只读标记 */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span
          className="text-xs px-2 py-0.5 rounded-md font-medium"
          style={{
            background: task.type === "PERIODIC" ? "rgba(59,130,246,0.1)" : "rgba(139,92,246,0.1)",
            color:      task.type === "PERIODIC" ? "#2563eb"              : "#7c3aed",
          }}
        >
          {task.type === "PERIODIC" ? "📅 周期填报" : "📌 专项填报"}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isViewOnly && (
            <span className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: "rgba(107,114,128,0.1)", color: "#6b7280" }}>
              🔒 仅可查看
            </span>
          )}
          <span
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
            style={{ background: cfg.bg, color: cfg.color }}
          >
            <StatusIcon size={11} />
            {cfg.label}
          </span>
        </div>
      </div>

      {/* 任务标题 */}
      <div>
        <h3 className="text-sm font-semibold text-slate-800 leading-snug">{task.title}</h3>
        {task.description && (
          <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">{task.description}</p>
        )}
      </div>

      {/* 截止日期 */}
      <div className="flex items-center gap-2">
        <CalendarClock size={13} style={{ color: isUrgent ? "#ef4444" : "#94a3b8" }} />
        <DeadlineBadge deadline={task.deadline} />
        {isUrgent && (
          <span className="ml-auto text-xs font-medium text-red-500 flex items-center gap-1">
            <AlertTriangle size={11} />紧急
          </span>
        )}
      </div>

      {/* 已提交时间 */}
      {assignment.status === "SUBMITTED" && assignment.submittedAt && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-blue-700"
          style={{ background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.15)" }}>
          <ClipboardCheck size={12} />
          已于 {new Date(assignment.submittedAt).toLocaleString("zh-CN")} 提交，等待 LPA 审核
        </div>
      )}

      {/* PA 打回备注 */}
      {assignment.status === "REJECTED" && assignment.rejectNote && (
        <div className="px-3 py-2 rounded-xl text-xs text-amber-700 leading-relaxed"
          style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)" }}>
          <span className="font-medium">打回原因：</span>{assignment.rejectNote}
        </div>
      )}

      {/* 操作按钮区 */}
      <div className="flex flex-col gap-2 pt-1">

        {/* V1.0 MVP：统一跳转飞书文档填报 */}
        {task.feishuSheetUrl ? (
          /* ── 路径二：跳转飞书表格（无 dynamicForm，旧流程）──── */
          <>
            <a
              href={task.feishuSheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-90"
              style={
                isViewOnly
                  ? { background: "#f1f5f9", color: "#64748b", border: "1px solid #e2e8f0" }
                  : { background: "linear-gradient(135deg, #2563eb, #06b6d4)", color: "white" }
              }
            >
              <ExternalLink size={14} />
              {isViewOnly
                ? "查看表格（只读）"
                : assignment.status === "PENDING_FILL" ? "前往填报"
                : assignment.status === "REJECTED"    ? "重新填报"
                : "查看表格"}
            </a>
            {/* 旧流程需手动标记已提交 */}
            {canSubmit && (
              <button
                onClick={() => onSubmit(assignment.id)}
                disabled={isSubmitting}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
                style={{
                  background: "rgba(34,197,94,0.08)",
                  color: "#16a34a",
                  border: "1px solid rgba(34,197,94,0.25)",
                }}
              >
                {isSubmitting ? (
                  <><Loader2 size={14} className="animate-spin" />提交中...</>
                ) : (
                  <><Send size={14} />填写完成，标记已提交</>
                )}
              </button>
            )}
          </>
        ) : (
          /* ── 路径三：尚未配置 ──────────────────────────────── */
          <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm text-slate-400 bg-slate-50"
            style={{ border: "1px solid #e2e8f0" }}>
            <FileText size={14} />
            填报方式待 LPA 配置
          </div>
        )}

        {/* 只读提示（原生填报页也需要显示） */}
        {isViewOnly && (
          <div className="flex items-center justify-center gap-2 py-2 rounded-xl text-xs"
            style={{ background: "rgba(107,114,128,0.06)", color: "#6b7280", border: "1px solid rgba(107,114,128,0.15)" }}>
            {task.status === "ARCHIVED"
              ? "任务已归档，如需继续填报请联系管理员开放编辑权限"
              : "管理员已将本部门权限设为只读，如需填报请联系 LPA 专员"}
          </div>
        )}

        {/* ARCHIVED 状态：已归档徽章 */}
        {assignment.status === "ARCHIVED" && (
          <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium"
            style={{ background: "rgba(34,197,94,0.08)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}>
            <CheckCircle2 size={14} />
            任务已归档，感谢配合！
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 提交确认弹窗
// ──────────────────────────────────────────────

function SubmitConfirmDialog({
  assignment,
  onCancel,
  onConfirm,
  isLoading,
}: {
  assignment: Assignment;
  onCancel: () => void;
  onConfirm: () => void;
  isLoading: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
      <div className="bg-white rounded-2xl w-full max-w-sm mx-4 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "rgba(34,197,94,0.1)" }}>
            <Send size={16} style={{ color: "#16a34a" }} />
          </div>
          <div>
            <p className="font-semibold text-slate-800 text-sm">确认提交</p>
            <p className="text-xs text-slate-500 mt-0.5">提交后将通知 LPA 审核，确认数据已填写完毕</p>
          </div>
        </div>
        <div className="px-3 py-2.5 rounded-xl text-sm text-slate-700 mb-5"
          style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
          「{assignment.task.title}」
        </div>
        <p className="text-xs text-slate-500 mb-5">
          ⚠️ 提交前请确认已在飞书表格中完成所有数据的填写。
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl text-sm text-slate-600 bg-slate-100 font-medium disabled:opacity-50"
          >
            再检查一下
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50 flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            {isLoading ? "提交中..." : "确认提交"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// 页面主体
// ──────────────────────────────────────────────

export default function MyTasksPage() {
  const [assignments,     setAssignments]     = useState<Assignment[]>([]);
  const [stats,           setStats]           = useState<Stats | null>(null);
  const [isLoading,       setIsLoading]       = useState(true);
  const [error,           setError]           = useState("");
  const [filter,          setFilter]          = useState<"ALL" | "PENDING_FILL" | "SUBMITTED" | "REJECTED">("ALL");

  // 提交状态
  const [pendingSubmit,   setPendingSubmit]   = useState<Assignment | null>(null);
  const [isSubmitting,    setIsSubmitting]    = useState(false);
  const [submitingId,     setSubmittingId]    = useState<string | null>(null);
  const [toast,           setToast]           = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch("/api/my-tasks");
      if (res.status === 403) { setError("权限不足，请联系 LPA 管理员确认你的账号权限"); return; }
      if (res.status === 422) { setError("你的账号尚未绑定业务部门，请联系 LPA 管理员配置"); return; }
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      setAssignments(data.assignments ?? []);
      setStats(data.stats ?? null);
    } catch {
      setError("网络错误，请刷新页面重试");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // 点击卡片上"标记已提交"→ 弹确认框
  function handleSubmitClick(assignmentId: string) {
    const found = assignments.find((a) => a.id === assignmentId);
    if (found) setPendingSubmit(found);
  }

  // 确认弹窗里点"确认提交"
  async function confirmSubmit() {
    if (!pendingSubmit) return;
    setIsSubmitting(true);
    setSubmittingId(pendingSubmit.id);
    try {
      const res = await fetch(`/api/my-tasks/${pendingSubmit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SUBMITTED" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "提交失败");

      setPendingSubmit(null);
      // 乐观更新：直接把本地这条 assignment 状态改为 SUBMITTED
      setAssignments((prev) =>
        prev.map((a) =>
          a.id === pendingSubmit.id
            ? { ...a, status: "SUBMITTED", submittedAt: new Date().toISOString() }
            : a
        )
      );
      // 更新统计（重新拉取）
      fetchTasks();
      setToast("✅ 已成功提交！LPA 将尽快审核。");
      setTimeout(() => setToast(null), 4000);
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setIsSubmitting(false);
      setSubmittingId(null);
    }
  }

  const filtered = filter === "ALL"
    ? assignments
    : assignments.filter((a) => a.status === filter);

  const sorted = [...filtered].sort((a, b) => {
    const priority: Record<string, number> = { REJECTED: 0, PENDING_FILL: 1, SUBMITTED: 2, ARCHIVED: 3 };
    const pDiff = (priority[a.status] ?? 9) - (priority[b.status] ?? 9);
    if (pDiff !== 0) return pDiff;
    const da = daysLeft(a.task.deadline) ?? 9999;
    const db = daysLeft(b.task.deadline) ?? 9999;
    return da - db;
  });

  return (
    <div className="flex-1 overflow-auto" style={{ background: "#f8fafc" }}>

      {/* 提交确认弹窗 */}
      {pendingSubmit && (
        <SubmitConfirmDialog
          assignment={pendingSubmit}
          onCancel={() => setPendingSubmit(null)}
          onConfirm={confirmSubmit}
          isLoading={isSubmitting}
        />
      )}

      {/* Toast 提示 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl text-sm font-medium text-white shadow-xl"
          style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="px-8 pt-8 pb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #2563eb, #06b6d4)" }}>
              <Inbox size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">部门数据录入</h1>
              <p className="text-sm text-slate-500 mt-0.5">感谢协助完善本部门的业务数据。辛苦您在约定时间前补充，完成后点击「标记已提交」即可流转。</p>
            </div>
          </div>
          <button
            onClick={fetchTasks}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-500 bg-white disabled:opacity-50"
            style={{ border: "1px solid #e2e8f0" }}
          >
            <RefreshCw size={13} className={isLoading ? "animate-spin" : ""} />
            刷新
          </button>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="mx-8 mb-5 flex items-center gap-3 px-5 py-4 rounded-2xl text-red-600"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <AlertTriangle size={16} />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {/* 操作指引 */}
      <div className="px-8 mb-5">
        <div className="flex items-start gap-4 px-5 py-4 rounded-2xl"
          style={{ background: "rgba(37,99,235,0.04)", border: "1px solid rgba(37,99,235,0.12)" }}>
          <div className="flex-shrink-0 mt-0.5">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#2563eb" }}>1</div>
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-slate-700">点击「前往填报」→ 在飞书表格中完成数据录入</p>
          </div>
          <div className="flex-shrink-0 mt-0.5">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#16a34a" }}>2</div>
          </div>
          <div className="flex-1">
            <p className="text-xs font-semibold text-slate-700">回到此页，点击「填写完成，标记已提交」→ 通知 LPA 审核</p>
          </div>
        </div>
      </div>

      {/* 统计卡片 */}
      {stats && (
        <div className="px-8 mb-6 grid grid-cols-4 gap-4">
          {[
            { label: "全部填报",     value: stats.total,     color: "#3b82f6", icon: "📋" },
            { label: "待填报",       value: stats.pendingFill,   color: "#ef4444", icon: "🔴" },
            { label: "已提交",       value: stats.submitted, color: "#3b82f6", icon: "📤" },
            { label: "紧急（≤3天）", value: stats.urgent,    color: "#f59e0b", icon: "⚡" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl px-5 py-4 shadow-sm" style={{ border: "1px solid #e2e8f0" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xl">{s.icon}</span>
                <span className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</span>
              </div>
              <p className="text-xs text-slate-500 font-medium">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* 数据安全说明 */}
      <div className="px-8 mb-5">
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.15)" }}>
          <CheckCircle2 size={14} style={{ color: "#16a34a", flexShrink: 0 }} />
          <p className="text-xs" style={{ color: "#15803d" }}>
            本页面仅显示分配给<strong>你所在部门</strong>的任务。系统已在后端对数据进行严格隔离，你无法查看或修改其他部门的数据。
          </p>
        </div>
      </div>

      {/* 筛选标签 */}
      <div className="px-8 mb-5 flex items-center gap-2">
        {(["ALL", "PENDING_FILL", "SUBMITTED", "REJECTED"] as const).map((f) => {
          const labels: Record<string, string> = { ALL: "全部", PENDING_FILL: "待填报", SUBMITTED: "已提交", REJECTED: "已打回" };
          const active = filter === f;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-3 py-1.5 rounded-xl text-xs font-medium transition-all"
              style={{
                background: active ? "#2563eb" : "white",
                color:      active ? "white"   : "#64748b",
                border: `1px solid ${active ? "#2563eb" : "#e2e8f0"}`,
              }}
            >
              {labels[f]}
              {stats && f === "PENDING_FILL" && (stats.pendingFill ?? 0) > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-bold"
                  style={{ background: active ? "rgba(255,255,255,0.2)" : "rgba(239,68,68,0.12)", color: active ? "white" : "#ef4444" }}>
                  {stats.pendingFill}
                </span>
              )}
            </button>
          );
        })}
        <span className="ml-auto text-xs text-slate-400">{sorted.length} 项待办</span>
      </div>

      {/* 任务卡片网格 */}
      <div className="px-8 pb-10">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 size={24} className="animate-spin mr-3" />加载中...
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <ClipboardCheck size={40} className="mb-3 opacity-30" />
            <p className="text-sm font-medium text-slate-500">
              {assignments.length === 0 ? "当前暂无需要贵部门协助提供的数据" : "该状态下暂无任务"}
            </p>
            <p className="text-xs text-slate-400 mt-1">如有疑问，欢迎随时联系 LPA 运营专员</p>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {sorted.map((a) => (
              <TaskCard
                key={a.id}
                assignment={a}
                onSubmit={handleSubmitClick}
                isSubmitting={submitingId === a.id && isSubmitting}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
