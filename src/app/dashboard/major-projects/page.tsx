"use client";

/**
 * 重大项目模块 - 主列表视图（完全重构版）
 *
 * 严格对齐【政府接待】设计语言：
 * 1. 三视图架构：table | card | kanban
 * 2. 精美的Badge和Tag系统
 * 3. ViewSwitcher标签页切换器
 * 4. 统一的主题色系统
 * 5. 飞书两步导入：解析预览 → 批量 Upsert
 * 6. 多选 + 同步到飞书
 */

import React, { useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Search,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Flame,
  Trash2,
  Plus,
  Loader2,
  X,
  Check,
  Table2,
  LayoutGrid,
  BarChart2,
  Building2,
  CalendarDays,
  DollarSign,
  Link2,
  Download,
  Upload,
  Cloud,
  AlertTriangle,
  Calculator,
  ExternalLink,
  Settings,
} from "lucide-react";
import type { ParsedProject } from "@/app/api/major-projects/parse-bitable/route";
import PageHeaderWithConfig from "@/components/shared/PageHeaderWithConfig";
import {
  DictSelect,
  LevelDictSelect,
  CategoryDictSelect,
} from "./DictSelect";
import { ProjectDrawer } from "./ProjectDrawer";
import { DashboardView } from "./DashboardView";

// ── 类型定义 ──────────────────────────────────────────────────────

type ViewMode = "table" | "card" | "kanban";

interface DictItem {
  id: string;
  value: string;
}

interface MajorProject {
  id: string;
  name: string;
  parentId: string | null;

  // 字典外键
  categoryDictId: string | null;
  companyEntityDictId: string | null;
  companyEntityNames: string[];          // 多选收款公司主体（名称数组）
  levelDictId: string | null;

  // 字典对象
  categoryDict: DictItem | null;
  companyEntityDict: DictItem | null;
  levelDict: DictItem | null;

  // 金额与时间
  totalAmount: number | null;
  receivedAmount: number;
  receivedDate: string | null;

  // 归属与负责人
  affiliation: string | null;
  progress: string | null;
  ownerFeishuOpenId: string | null;

  // 周重点
  isWeekFocus: boolean;
  // 金额自动汇总
  isAmountAutoSum: boolean;

  // 待办事项
  todoItems: string | null;

  // 证明材料
  proofMaterials: { url?: string; type?: string; name?: string }[];

  // 树形关系
  parent: MajorProject | null;
  children: MajorProject[];

  // 其他
  createdAt: string;
  updatedAt: string;
}

interface Filters {
  view: ViewMode;
  q: string;
  levelDictIds: string[]; // 多选项目级别
  categoryDictIds: string[]; // 多选项目类别
  companyEntityName?: string; // 收款公司主体名称筛选
  parentId: string; // "null" = 仅顶层，"" = 全部
  page: number;
  limit: number;
  orderBy?: string;
  order?: "asc" | "desc";
}

// ── PageConfig 类型（重大项目模块） ────────────────────────────────

interface QuickLink { title: string; url: string }
interface PageMeta  { title: string; description: string }
interface PageConfig { pageMeta: PageMeta; quickLinks: QuickLink[] }

const DEFAULT_PAGE_CONFIG: PageConfig = {
  pageMeta:   { title: "重大项目管理", description: "项目全生命周期管理与追踪" },
  quickLinks: [],
};

// ── Badge 样式（Tailwind Pastel 方案） ────────────────────────────

const BADGE_BASE =
  "inline-flex items-center justify-center px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap border";

// 项目级别颜色映射（bg-50 / text-700 / border-200）
const LEVEL_BADGE_CLASS: Record<string, string> = {
  国家级: "bg-purple-50 text-purple-700 border-purple-200",
  省级:   "bg-blue-50 text-blue-700 border-blue-200",
  市级:   "bg-cyan-50 text-cyan-700 border-cyan-200",
};
const LEVEL_BADGE_DEFAULT = "bg-teal-50 text-teal-700 border-teal-200";

// 项目类别颜色映射（bg-50 / text-700 / border-200）
const CATEGORY_BADGE_CLASS: Record<string, string> = {
  荣誉资质: "bg-amber-50 text-amber-700 border-amber-200",
  项目补贴: "bg-emerald-50 text-emerald-700 border-emerald-200",
  落地协议: "bg-red-50 text-red-700 border-red-200 font-semibold shadow-sm",
  政策支持: "bg-violet-50 text-violet-700 border-violet-200",
  科技专项: "bg-indigo-50 text-indigo-700 border-indigo-200",
  基础设施: "bg-sky-50 text-sky-700 border-sky-200",
};
const CATEGORY_BADGE_DEFAULT = "bg-slate-50 text-slate-700 border-slate-200";

// Kanban 列头颜色（内联样式，沿用原配色）
const LEVEL_COLOR: Record<string, string> = {
  国家级: "#7c3aed",
  省级:   "#2563eb",
  市级:   "#0891b2",
  区级:   "#0d9488",
};
const LEVEL_BG: Record<string, string> = {
  国家级: "rgba(124,58,237,0.08)",
  省级:   "rgba(37,99,235,0.08)",
  市级:   "rgba(8,145,178,0.08)",
  区级:   "rgba(13,148,136,0.08)",
};

const VIEW_TABS: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
  { key: "table", label: "数据表格", icon: <Table2 size={15} /> },
  { key: "card", label: "卡片视图", icon: <LayoutGrid size={15} /> },
  { key: "kanban", label: "数据大屏", icon: <BarChart2 size={15} /> },
];

// ── 工具函数 ──────────────────────────────────────────────────────

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function getAllProjectIds(projects: MajorProject[]): string[] {
  const ids: string[] = [];
  function collect(p: MajorProject) {
    ids.push(p.id);
    p.children?.forEach(collect);
  }
  projects.forEach(collect);
  return ids;
}

// ── Checkbox 样式工具 ──────────────────────────────────────────────

function checkboxStyle(active: boolean, indeterminate?: boolean): React.CSSProperties {
  return {
    width: 15,
    height: 15,
    borderRadius: 4,
    border: active || indeterminate ? "none" : "1.5px solid #cbd5e1",
    background: active || indeterminate ? "#2563eb" : "white",
    cursor: "pointer",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

function modalCheckboxStyle(active: boolean, indeterminate?: boolean): React.CSSProperties {
  return {
    width: 16,
    height: 16,
    borderRadius: 4,
    border: active || indeterminate ? "none" : "1.5px solid #cbd5e1",
    background: active || indeterminate ? "#2563eb" : "white",
    cursor: "pointer",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  };
}

// ── ViewSwitcher（复用 Reception） ────────────────────────────────

function ViewSwitcher({
  current,
  onChange,
}: {
  current: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-xl"
      style={{
        background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.12)",
      }}
    >
      {VIEW_TABS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-200"
          style={
            current === tab.key
              ? {
                  background: "white",
                  color: "#1e293b",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                }
              : { color: "rgba(255,255,255,0.6)" }
          }
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// ── Badge 组件（复用 Reception 样式） ─────────────────────────────

function levelBadge(level: string | null) {
  if (!level) return <span className="text-slate-300">—</span>;
  const colorClass = LEVEL_BADGE_CLASS[level] ?? LEVEL_BADGE_DEFAULT;
  return <span className={`${BADGE_BASE} ${colorClass}`}>{level}</span>;
}

function categoryBadge(category: string | null) {
  if (!category) return <span className="text-slate-300">—</span>;
  const colorClass = CATEGORY_BADGE_CLASS[category] ?? CATEGORY_BADGE_DEFAULT;
  return <span className={`${BADGE_BASE} ${colorClass}`}>{category}</span>;
}

function affiliationBadge(affiliation: string | null) {
  if (!affiliation) return <span style={{ color: "#cbd5e1" }}>—</span>;
  const isCompany = affiliation === "公司";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2px 8px",
        borderRadius: "6px",
        fontSize: "11px",
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: isCompany
          ? "rgba(59,130,246,0.10)"
          : "rgba(34,197,94,0.10)",
        color: isCompany ? "#3b82f6" : "#16a34a",
      }}
    >
      {affiliation}
    </span>
  );
}

function progressBadge(progress: string | null) {
  if (!progress) return null;
  const styles: Record<string, string> = {
    "未开始": "bg-slate-100 text-slate-600 border border-slate-200",
    "进行中": "bg-blue-50 text-blue-600 border border-blue-200 font-medium",
    "已结束": "bg-emerald-50 text-emerald-600 border border-emerald-200",
  };
  const cls = styles[progress] ?? "bg-slate-100 text-slate-600 border border-slate-200";
  return (
    <span className={`inline-flex items-center justify-center px-2 py-0.5 ml-2 text-[10px] rounded-full whitespace-nowrap ${cls}`}>
      {progress}
    </span>
  );
}

// ── 飞书导入预览 Modal ─────────────────────────────────────────────

interface FeishuImportModalProps {
  records: ParsedProject[];
  selected: Set<number>;
  loading: boolean;
  onToggle: (i: number) => void;
  onToggleAll: () => void;
  onConfirm: () => void;
  onClose: () => void;
}

function FeishuImportModal({
  records,
  selected,
  loading,
  onToggle,
  onToggleAll,
  onConfirm,
  onClose,
}: FeishuImportModalProps) {
  const allChecked = records.length > 0 && selected.size === records.length;
  const someChecked = selected.size > 0 && !allChecked;
  // 同时统计飞书原生子记录（feishuParentId）和字段关联子记录（parentName）
  const parentCount = records.filter((r) => !r.parentName && !r.feishuParentId).length;
  const childCount = records.filter((r) => !!r.parentName || !!r.feishuParentId).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ width: "min(960px, 95vw)", maxHeight: "85vh" }}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h3 className="text-lg font-bold text-gray-900">飞书数据预览</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              共解析{" "}
              <strong className="text-gray-700">{records.length}</strong> 条记录（主项目{" "}
              {parentCount} 个，子项目 {childCount} 个），已选{" "}
              <strong className="text-blue-600">{selected.size}</strong> 条
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X size={18} style={{ color: "#64748b" }} />
          </button>
        </div>

        {/* 表格内容 */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: "10px 16px", width: 44 }}>
                  <div
                    style={modalCheckboxStyle(allChecked, someChecked)}
                    onClick={onToggleAll}
                  >
                    {allChecked && <Check size={10} color="white" />}
                    {someChecked && (
                      <span
                        style={{
                          width: 8,
                          height: 2,
                          background: "white",
                          borderRadius: 1,
                          display: "block",
                        }}
                      />
                    )}
                  </div>
                </th>
                <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>
                  项目名称
                </th>
                <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>
                  父级项目
                </th>
                <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>
                  类别
                </th>
                <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>
                  级别
                </th>
                <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>
                  总金额(万)
                </th>
                <th style={{ padding: "10px 16px", textAlign: "right", fontSize: 11, fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>
                  已到账(万)
                </th>
                <th style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "#94a3b8", whiteSpace: "nowrap" }}>
                  归属
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => {
                const isSelected = selected.has(i);
                return (
                  <tr
                    key={i}
                    style={{
                      borderBottom: "1px solid #f1f5f9",
                      background: isSelected ? "rgba(37,99,235,0.04)" : "",
                      cursor: "pointer",
                    }}
                    onClick={() => onToggle(i)}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = "#f8fafc";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = isSelected
                        ? "rgba(37,99,235,0.04)"
                        : "";
                    }}
                  >
                    <td style={{ padding: "10px 16px" }} onClick={(e) => e.stopPropagation()}>
                      <div style={modalCheckboxStyle(isSelected)} onClick={() => onToggle(i)}>
                        {isSelected && <Check size={10} color="white" />}
                      </div>
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      <div className="flex items-center gap-1.5">
                        {r.parentName && (
                          <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: 8 }}>
                            ↳
                          </span>
                        )}
                        {r.isWeekFocus && (
                          <Flame size={11} style={{ color: "#f97316" }} />
                        )}
                        <span
                          style={{
                            fontWeight: r.parentName ? 400 : 500,
                            color: "#1e293b",
                            fontSize: 13,
                          }}
                        >
                          {r.name}
                        </span>
                      </div>
                    </td>
                    <td style={{ padding: "10px 16px", fontSize: 12, color: "#64748b" }}>
                      {r.parentName ?? <span style={{ color: "#cbd5e1" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      {r.categoryDict
                        ? categoryBadge(r.categoryDict)
                        : <span style={{ color: "#cbd5e1" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 16px" }}>
                      {r.levelDict
                        ? levelBadge(r.levelDict)
                        : <span style={{ color: "#cbd5e1" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, color: "#475569" }}>
                      {r.totalAmount != null
                        ? r.totalAmount.toLocaleString()
                        : <span style={{ color: "#cbd5e1" }}>—</span>}
                    </td>
                    <td style={{ padding: "10px 16px", textAlign: "right", fontSize: 12, fontWeight: 600, color: "#16a34a" }}>
                      {(r.receivedAmount ?? 0).toLocaleString()}
                    </td>
                    <td style={{ padding: "10px 16px", fontSize: 12, color: "#64748b" }}>
                      {r.affiliation ?? <span style={{ color: "#cbd5e1" }}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 底部操作 */}
        <div
          className="flex items-center justify-between px-6 py-4 border-t border-gray-200 rounded-b-2xl"
          style={{ background: "#f8fafc" }}
        >
          <p className="text-sm text-gray-500">
            以项目名称为唯一标识：已存在则更新，不存在则新建
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              disabled={loading || selected.size === 0}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
                color: "white",
              }}
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              批量导入 ({selected.size} 条)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 删除确认弹窗 ──────────────────────────────────────────────────────

interface DeleteConfirmModalProps {
  project: MajorProject;
  onClose: () => void;
  onConfirm: () => void;
}

function DeleteConfirmModal({
  project,
  onClose,
  onConfirm,
}: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-gray-900 mb-2">确认删除</h3>
        <p className="text-sm text-gray-600 mb-4">
          确定要删除项目「<strong>{project.name}</strong>」吗？此操作不可撤销。
        </p>
        <div className="flex items-center gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TableView（精修后的表格视图，含多选 Checkbox） ────────────────

interface TableViewProps {
  projects: MajorProject[];
  loading: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (id: string) => void;
  onViewDetail: (p: MajorProject) => void;
  onDelete: (p: MajorProject) => void;
  orderBy?: string;
  order?: "asc" | "desc";
  onSort: (field: string) => void;
  selectedIds: Set<string>;
  onToggleAll: () => void;
  onToggleRow: (id: string) => void;
  onAddChild: (p: MajorProject) => void;
  onAggregate: (id: string, target: "total" | "received" | "both") => void;
  isSearchMode?: boolean;  // 搜索模式：不过滤 parentId，展示所有匹配结果（含子项目）
}

function TableView({
  projects,
  loading,
  expandedIds,
  onToggleExpand,
  onViewDetail,
  onDelete,
  orderBy,
  order,
  onSort,
  selectedIds,
  onToggleAll,
  onToggleRow,
  onAddChild,
  onAggregate,
  isSearchMode = false,
}: TableViewProps) {
  const [aggDropId, setAggDropId] = React.useState<string | null>(null);
  function renderProjectRow(project: MajorProject, level = 0): React.ReactNode {
    const isExpanded = expandedIds.has(project.id);
    const hasChildren = project.children && project.children.length > 0;
    const indent = level * 40;
    const isSelected = selectedIds.has(project.id);

    return (
      <React.Fragment key={project.id}>
        <tr
          style={{
            borderBottom: "1px solid #f1f5f9",
            cursor: "pointer",
            background: isSelected ? "rgba(37,99,235,0.04)" : level > 0 ? "#f8fafc" : "",
          }}
          onMouseEnter={(e) => {
            if (!isSelected) e.currentTarget.style.background = level > 0 ? "#f0f4f8" : "#f8fafc";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = isSelected ? "rgba(37,99,235,0.04)" : level > 0 ? "#f8fafc" : "";
          }}
          onClick={() => onViewDetail(project)}
        >
          {/* Checkbox */}
          <td
            style={{ padding: "12px 8px 12px 16px", width: 40 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={checkboxStyle(isSelected)}
              onClick={() => onToggleRow(project.id)}
            >
              {isSelected && <Check size={10} color="white" />}
            </div>
          </td>

          {/* 1. 项目名称（树形） */}
          <td style={{ padding: "12px 16px", minWidth: 250, verticalAlign: "middle" }}>
            <div
              className="flex items-center gap-2"
              style={{ paddingLeft: indent }}
            >
              {/* 展开/收起按钮（仅有子项目时显示，动画旋转） */}
              {hasChildren ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleExpand(project.id);
                  }}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0"
                >
                  <ChevronRight
                    size={14}
                    style={{
                      transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                </button>
              ) : (
                <div style={{ width: 14, flexShrink: 0 }} />
              )}

              {/* 子项目分支图标（所有 level > 0 行） */}
              {level > 0 && (
                <CornerDownRight size={12} style={{ color: "#94a3b8", flexShrink: 0 }} />
              )}

              {project.isWeekFocus && (
                <Flame size={14} style={{ color: "#f97316", flexShrink: 0 }} />
              )}

              <span
                style={{
                  color: "#1e293b",
                  fontWeight: level > 0 ? 400 : 500,
                  fontSize: 13,
                }}
              >
                {project.name}
              </span>
              {progressBadge(project.progress)}
            </div>
          </td>

          {/* 2. 项目类别 */}
          <td style={{ padding: "12px 24px 12px 16px", verticalAlign: "middle" }}>
            {categoryBadge(project.categoryDict?.value ?? null)}
          </td>

          {/* 3. 收款公司主体（多值） */}
          <td style={{ padding: "12px 16px", fontSize: 13, color: "#475569" }}>
            {project.companyEntityNames?.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {project.companyEntityNames.map((name) => (
                  <span
                    key={name}
                    style={{
                      padding: "1px 7px",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 500,
                      background: "rgba(59,130,246,0.10)",
                      color: "#3b82f6",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {name}
                  </span>
                ))}
              </div>
            ) : project.companyEntityDict?.value ? (
              <span>{project.companyEntityDict.value}</span>
            ) : (
              <span style={{ color: "#cbd5e1" }}>—</span>
            )}
          </td>

          {/* 4. 项目级别 */}
          <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
            {levelBadge(project.levelDict?.value ?? null)}
          </td>

          {/* 5. 总金额 */}
          <td
            style={{
              padding: "12px 16px",
              textAlign: "right",
              fontSize: 13,
              fontWeight: 500,
              color: "#1e293b",
            }}
          >
            {project.totalAmount !== null ? (
              <span className="inline-flex items-center gap-1 justify-end">
                {project.totalAmount.toLocaleString()}
                {project.isAmountAutoSum && (
                  <Calculator size={11} className="text-blue-400 flex-shrink-0" aria-label="来自子项目汇总" />
                )}
              </span>
            ) : "—"}
          </td>

          {/* 7. 已到账金额 */}
          <td
            style={{
              padding: "12px 16px",
              textAlign: "right",
              fontSize: 13,
              fontWeight: 600,
              color: "#16a34a",
            }}
          >
            <span className="inline-flex items-center gap-1 justify-end">
              {project.receivedAmount.toLocaleString()}
              {project.isAmountAutoSum && (
                <Calculator size={11} className="text-blue-400 flex-shrink-0" aria-label="来自子项目汇总" />
              )}
            </span>
          </td>

          {/* 8. 归属 */}
          <td style={{ padding: "12px 16px", textAlign: "center" }}>
            {affiliationBadge(project.affiliation)}
          </td>

          {/* 10. 待办事项 */}
          <td
            style={{
              padding: "12px 16px",
              fontSize: 12,
              color: "#64748b",
              maxWidth: 150,
            }}
          >
            <div
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {project.todoItems || (
                <span style={{ color: "#cbd5e1" }}>—</span>
              )}
            </div>
          </td>

          {/* 操作 */}
          <td style={{ padding: "12px 16px" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-1">
              {level === 0 && (
                <button
                  onClick={() => onAddChild(project)}
                  className="p-1.5 hover:bg-blue-100 rounded-lg"
                  title="添加子项目"
                >
                  <Plus size={14} style={{ color: "#3b82f6" }} />
                </button>
              )}
              {/* 汇总按钮：仅有子项目的父项目显示 */}
              {level === 0 && hasChildren && (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setAggDropId(aggDropId === project.id ? null : project.id)}
                    className="p-1.5 hover:bg-blue-100 rounded-lg"
                    title="汇总金额"
                  >
                    <Calculator size={14} style={{ color: "#2563eb" }} />
                  </button>
                  {aggDropId === project.id && (
                    <div style={{
                      position: "absolute", right: 0, top: "calc(100% + 2px)", zIndex: 50,
                      background: "white", border: "1px solid #e2e8f0",
                      borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.1)", minWidth: 140,
                    }}>
                      {[
                        { label: "汇总总金额", value: "total" as const },
                        { label: "汇总已到账", value: "received" as const },
                        { label: "同时汇总", value: "both" as const },
                      ].map(item => (
                        <div
                          key={item.value}
                          onClick={() => { onAggregate(project.id, item.value); setAggDropId(null); }}
                          style={{ padding: "8px 12px", fontSize: 12, color: "#1e293b", cursor: "pointer" }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        >
                          {item.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <button
                onClick={() => onDelete(project)}
                className="p-1.5 hover:bg-red-100 rounded-lg"
                title="删除"
              >
                <Trash2 size={14} style={{ color: "#ef4444" }} />
              </button>
            </div>
          </td>
        </tr>

        {/* 子项目（递归） */}
        {isExpanded &&
          hasChildren &&
          project.children.map((child) => renderProjectRow(child, level + 1))}
      </React.Fragment>
    );
  }

  if (loading) {
    return (
      <div
        className="flex items-center justify-center py-24"
        style={{ color: "#94a3b8" }}
      >
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Building2 size={40} style={{ color: "#cbd5e1" }} />
        <p style={{ color: "#94a3b8", fontSize: 14 }}>暂无项目数据</p>
      </div>
    );
  }

  // 全选状态（仅顶层可见项目）
  const allTopSelected =
    projects.length > 0 && projects.every((p) => selectedIds.has(p.id));
  const someTopSelected =
    projects.some((p) => selectedIds.has(p.id)) && !allTopSelected;

  const sortableColumns = [
    { label: "项目名称",   field: "name" },
    { label: "项目类别",   field: "categoryDict" },
    { label: "收款公司主体", field: null },          // 多值数组，不支持排序
    { label: "项目级别",   field: "levelDict" },
    { label: "总金额(万)", field: "totalAmount" },
    { label: "已到账(万)", field: "receivedAmount" },
    { label: "归属",       field: "affiliation" },
    { label: "待办事项",   field: null },
    { label: "操作",       field: null },
  ];

  return (
    <div style={{ flex: 1, overflowY: "auto", maxHeight: "calc(100vh - 280px)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ position: "sticky", top: 0, zIndex: 20, background: "#f8fafc", borderBottom: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            {/* 全选 Checkbox */}
            <th style={{ padding: "10px 8px 10px 16px", width: 40 }}>
              <div
                style={checkboxStyle(allTopSelected, someTopSelected)}
                onClick={onToggleAll}
              >
                {allTopSelected && <Check size={10} color="white" />}
                {someTopSelected && (
                  <span
                    style={{
                      width: 8,
                      height: 2,
                      background: "white",
                      borderRadius: 1,
                      display: "block",
                    }}
                  />
                )}
              </div>
            </th>
            {sortableColumns.map((col) => (
              <th
                key={col.label}
                onClick={() => col.field && onSort(col.field)}
                style={{
                  padding: "10px 16px",
                  textAlign: "left",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#94a3b8",
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                  cursor: col.field ? "pointer" : "default",
                }}
              >
                <div className="flex items-center gap-1">
                  {col.label}
                  {col.field && orderBy === col.field && (
                    <span>{order === "asc" ? "↑" : "↓"}</span>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        {/* 搜索模式：展示所有匹配结果（含子项目）；正常模式：只展示顶层项目，子项目通过展开按钮渲染 */}
        <tbody>{(isSearchMode ? projects : projects.filter(p => !p.parentId)).map((p) => renderProjectRow(p))}</tbody>
      </table>
    </div>
  );
}

// ── CardView（浅蓝渐变 + 玻璃拟物 + 子项目气泡） ──────────────────

const PROGRESS_ORDER: Record<string, number> = { "进行中": 0, "未开始": 1, "已结束": 2 };

const PROGRESS_BADGE: Record<string, React.CSSProperties> = {
  "进行中": { background: "rgba(37,99,235,0.12)", color: "#2563eb", border: "1px solid rgba(37,99,235,0.2)" },
  "未开始": { background: "rgba(100,116,139,0.10)", color: "#64748b", border: "1px solid rgba(100,116,139,0.15)" },
  "已结束": { background: "rgba(22,163,74,0.10)", color: "#16a34a", border: "1px solid rgba(22,163,74,0.15)" },
};

interface CardViewProps {
  projects: MajorProject[];
  loading: boolean;
  onViewDetail: (p: MajorProject) => void;
}

function PosterCard({ project, onClick, onOpenSubProject }: {
  project: MajorProject;
  onClick: () => void;
  onOpenSubProject?: (sub: MajorProject) => void;
}) {
  const progress = project.progress ?? "未开始";
  const badgeStyle = PROGRESS_BADGE[progress] ?? PROGRESS_BADGE["未开始"];
  const total    = project.totalAmount ?? 0;
  const received = project.receivedAmount ?? 0;
  const pct      = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
  const children = project.children ?? [];

  // 从 proofMaterials 中提取第一张图片（排除 PDF）
  const proofMaterials = (project.proofMaterials as { url?: string; type?: string }[]) ?? [];
  const coverImg = proofMaterials.find(m => m.type === "image" && m.url)?.url ?? null;

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer relative flex flex-col overflow-hidden"
      style={{
        borderRadius: 16,
        border: "1px solid rgba(186,213,255,0.35)",
        boxShadow: "0 2px 12px rgba(37,99,235,0.08)",
        transition: "all 0.22s ease",
        minHeight: 200,
        background: coverImg ? undefined : "linear-gradient(135deg,#eff6ff 0%,#e0f2fe 50%,#f0f9ff 100%)",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = "translateY(-3px)";
        el.style.boxShadow = "0 8px 32px rgba(37,99,235,0.18), 0 0 0 1px rgba(37,99,235,0.15)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget as HTMLDivElement;
        el.style.transform = "";
        el.style.boxShadow = "0 2px 12px rgba(37,99,235,0.08)";
      }}
    >
      {/* 底层图片（有证明材料图片时） */}
      {coverImg && (
        <img src={coverImg} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }} />
      )}
      {/* 三明治渐变遮罩 */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 1,
        background: coverImg
          ? "linear-gradient(to bottom,rgba(255,255,255,0.92) 0%,rgba(255,255,255,0.28) 50%,rgba(255,255,255,0.96) 100%)"
          : undefined,
        pointerEvents: "none",
      }} />

      {/* 前景内容 */}
      <div className="relative flex flex-col h-full p-4" style={{ zIndex: 2 }}>
        {/* 标签行 */}
        <div className="flex items-center gap-1.5 flex-wrap mb-2">
          {project.isWeekFocus && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700,
              padding: "2px 7px", borderRadius: 5,
              background: "rgba(249,115,22,0.12)", color: "#ea580c", border: "1px solid rgba(249,115,22,0.2)" }}>
              <Flame size={9} />周重点
            </span>
          )}
          {project.levelDict && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
              background: "rgba(37,99,235,0.10)", color: "#1d4ed8", border: "1px solid rgba(37,99,235,0.18)" }}>
              {project.levelDict.value}
            </span>
          )}
          {project.categoryDict && (
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 5,
              background: "rgba(100,116,139,0.08)", color: "#475569", border: "1px solid rgba(100,116,139,0.15)" }}>
              {project.categoryDict.value}
            </span>
          )}
        </div>

        {/* 项目标题 */}
        <h3 style={{
          fontSize: 14, fontWeight: 700, color: "#1e293b", lineHeight: 1.45,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden", flex: 1, marginBottom: 8,
        }}>
          {project.name}
        </h3>

        {/* 子项目气泡 */}
        {children.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {children.map(sub => (
              <span
                key={sub.id}
                onClick={(e) => {
                  e.stopPropagation(); // 阻止冒泡，不触发父卡片点击
                  onOpenSubProject?.(sub);
                }}
                className="inline-flex items-center"
                style={{
                  padding: "2px 8px", borderRadius: 999, fontSize: 10, color: "#059669",
                  background: "rgba(236,253,245,0.8)", backdropFilter: "blur(8px)",
                  border: "1px solid #d1fae5",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                  maxWidth: "95%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  cursor: onOpenSubProject ? "pointer" : "default",
                }}
                title={sub.name}
              >
                <CornerDownRight size={9} style={{ color: "#34d399", marginRight: 3, flexShrink: 0 }} />
                {sub.name}
              </span>
            ))}
          </div>
        )}

        {/* 资金进度条 */}
        {total > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", marginBottom: 3 }}>
              <span>总额 {total.toLocaleString()} 万</span>
              <span>已到账 {received.toLocaleString()} 万</span>
            </div>
            <div style={{ width: "100%", height: 5, borderRadius: 999,
              background: "rgba(148,163,184,0.2)", overflow: "hidden", backdropFilter: "blur(4px)" }}>
              <div style={{ height: "100%", width: `${pct}%`,
                background: "linear-gradient(90deg,#34d399,#0d9488)", borderRadius: 999,
                transition: "width 0.5s ease" }} />
            </div>
          </div>
        )}

        {/* 底部状态 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          {project.affiliation ? (
            <span style={{ fontSize: 10, color: "#64748b",
              background: "rgba(255,255,255,0.60)", backdropFilter: "blur(4px)",
              padding: "2px 7px", borderRadius: 4, border: "1px solid rgba(148,163,184,0.2)" }}>
              {project.affiliation}
            </span>
          ) : <span />}
          <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 5,
            backdropFilter: "blur(4px)", ...badgeStyle }}>
            {progress}
          </span>
        </div>
      </div>
    </div>
  );
}

function CardView({ projects, loading, onViewDetail }: CardViewProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" style={{ color: "#94a3b8" }}>
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  const topLevel = projects.filter(p => !p.parentId);
  const sorted = [...topLevel].sort((a, b) =>
    (PROGRESS_ORDER[a.progress ?? "未开始"] ?? 1) - (PROGRESS_ORDER[b.progress ?? "未开始"] ?? 1)
  );

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Building2 size={40} style={{ color: "#cbd5e1" }} />
        <p style={{ color: "#94a3b8", fontSize: 14 }}>暂无项目数据</p>
      </div>
    );
  }

  return (
    <div style={{
      padding: "20px 32px",
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
      gap: 16,
      background: "#f0f4f8",
      minHeight: "100%",
    }}>
      {sorted.map(p => (
        <PosterCard key={p.id} project={p} onClick={() => onViewDetail(p)} onOpenSubProject={onViewDetail} />
      ))}
    </div>
  );
}

// ── KanbanView（简化的看板视图） ──────────────────────────────────

interface KanbanViewProps {
  projects: MajorProject[];
  loading: boolean;
  onViewDetail: (p: MajorProject) => void;
}

function KanbanView({ projects, loading, onViewDetail }: KanbanViewProps) {
  const grouped = projects.reduce(
    (acc, p) => {
      const level = p.levelDict?.value ?? "未分类";
      if (!acc[level]) acc[level] = [];
      acc[level].push(p);
      return acc;
    },
    {} as Record<string, MajorProject[]>
  );

  const columns = Object.entries(grouped);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" style={{ color: "#94a3b8" }}>
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Building2 size={40} style={{ color: "#cbd5e1" }} />
        <p style={{ color: "#94a3b8", fontSize: 14 }}>暂无项目数据</p>
      </div>
    );
  }

  return (
    <div className="p-6 overflow-x-auto">
      <div className="flex gap-4" style={{ minWidth: "max-content" }}>
        {columns.map(([level, items]) => (
          <div key={level} className="flex flex-col" style={{ width: 320, flexShrink: 0 }}>
            <div
              className="flex items-center justify-between px-4 py-3 rounded-t-xl"
              style={{
                background: LEVEL_BG[level] ?? "rgba(100,116,139,0.10)",
                borderBottom: `2px solid ${LEVEL_COLOR[level] ?? "#64748b"}`,
              }}
            >
              <div className="flex items-center gap-2">
                <span style={{ fontSize: 13, fontWeight: 600, color: LEVEL_COLOR[level] ?? "#64748b" }}>
                  {level}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: "#94a3b8",
                    background: "rgba(255,255,255,0.6)",
                    padding: "2px 6px",
                    borderRadius: 4,
                  }}
                >
                  {items.length}
                </span>
              </div>
            </div>

            <div
              className="flex flex-col gap-3 p-3 rounded-b-xl"
              style={{ background: "#f8fafc", minHeight: 200 }}
            >
              {items.map((p) => (
                <div
                  key={p.id}
                  onClick={() => onViewDetail(p)}
                  className="bg-white rounded-lg p-3 cursor-pointer hover:shadow-md transition-shadow border border-gray-200"
                >
                  {p.parentId && (
                    <div className="mb-2">
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 4,
                          background: "rgba(148,163,184,0.10)",
                          color: "#64748b",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <CornerDownRight size={10} />
                        子项目
                      </span>
                    </div>
                  )}
                  <div className="flex items-start gap-2 mb-2">
                    {p.isWeekFocus && (
                      <Flame size={12} style={{ color: "#f97316", flexShrink: 0 }} />
                    )}
                    <h4 style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", lineHeight: 1.4 }}>
                      {p.name}
                    </h4>
                  </div>

                  {p.categoryDict && (
                    <div className="mb-2">{categoryBadge(p.categoryDict.value)}</div>
                  )}

                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    已到账：
                    <strong style={{ color: "#16a34a" }}>
                      {p.receivedAmount.toLocaleString()}
                    </strong>{" "}
                    万
                  </div>

                  {p.affiliation && (
                    <div className="mt-2">{affiliationBadge(p.affiliation)}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 工具函数：平铺树形结构 ──────────────────────────────────────────────

function flattenProjects(projects: MajorProject[]): MajorProject[] {
  const result: MajorProject[] = [];
  projects.forEach((p) => {
    result.push(p);
    if (p.children && p.children.length > 0) {
      result.push(...p.children);
    }
  });
  return result;
}

// ── 多选字典筛选组件 ──────────────────────────────────────────────────

interface MultiDictSelectProps {
  category: string;
  values: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
}

function MultiDictSelect({ category, values, onChange, placeholder = "全部" }: MultiDictSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [items, setItems] = useState<{ id: string; value: string }[]>([]);
  const triggerRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/major-projects/dicts?category=${category}`);
        const data = await res.json();
        if (data.rows) setItems(data.rows.filter((r: { isActive: boolean }) => r.isActive));
      } catch {}
    }
    load();
  }, [category]);

  useEffect(() => {
    if (!isOpen) return;
    const h = (e: MouseEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return;
      if (dropRef.current?.contains(e.target as Node)) return;
      setIsOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [isOpen]);

  const toggle = (id: string) => {
    if (values.includes(id)) {
      onChange(values.filter((v) => v !== id));
    } else {
      onChange([...values, id]);
    }
  };

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const selectedLabels = items.filter((i) => values.includes(i.id)).map((i) => i.value);
  const displayText = selectedLabels.length > 0 ? `已选 ${selectedLabels.length} 项` : placeholder;

  return (
    <div style={{ position: "relative" }} ref={triggerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          borderRadius: 8,
          fontSize: 13,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.08)",
          color: "white",
          cursor: "pointer",
        }}
      >
        <span>{displayText}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {values.length > 0 && (
            <X
              size={14}
              onClick={clearAll}
              style={{ cursor: "pointer" }}
            />
          )}
          <ChevronDown size={14} style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "0.2s" }} />
        </div>
      </button>
      {isOpen && (
        <div
          ref={dropRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "#1e293b",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {items.map((item) => (
            <div
              key={item.id}
              onClick={() => toggle(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                fontSize: 13,
                color: "white",
                cursor: "pointer",
                background: values.includes(item.id) ? "rgba(59, 130, 246, 0.2)" : "transparent",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = values.includes(item.id) ? "rgba(59, 130, 246, 0.3)" : "rgba(255,255,255,0.05)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = values.includes(item.id) ? "rgba(59, 130, 246, 0.2)" : "transparent")}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  border: values.includes(item.id) ? "none" : "1px solid rgba(255,255,255,0.3)",
                  borderRadius: 3,
                  background: values.includes(item.id) ? "#3b82f6" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {values.includes(item.id) && <Check size={10} color="white" />}
              </div>
              <span>{item.value}</span>
            </div>
          ))}
          {items.length === 0 && (
            <div style={{ padding: "12px", fontSize: 12, color: "#94a3b8", textAlign: "center" }}>暂无选项</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── PageConfig Modal（基础设置 + 快捷链接） ──────────────────────

function PageConfigModal({ config, onClose, onSaved }: {
  config:  PageConfig;
  onClose: () => void;
  onSaved: (cfg: PageConfig) => void;
}) {
  type Tab = "basics" | "links";
  const [activeTab, setActiveTab] = useState<Tab>("basics");
  const [draft,     setDraft]     = useState<PageConfig>(() => JSON.parse(JSON.stringify(config)) as PageConfig);
  const [saving,    setSaving]    = useState(false);
  const [errMsg,    setErrMsg]    = useState("");

  function setMeta(k: keyof PageMeta, v: string) {
    setDraft(d => ({ ...d, pageMeta: { ...d.pageMeta, [k]: v } }));
  }
  function setLink(idx: number, k: keyof QuickLink, v: string) {
    setDraft(d => {
      const links = [...d.quickLinks];
      links[idx] = { ...links[idx], [k]: v };
      return { ...d, quickLinks: links };
    });
  }
  function addLink() {
    setDraft(d => ({ ...d, quickLinks: [...d.quickLinks, { title: "", url: "" }] }));
  }
  function removeLink(idx: number) {
    setDraft(d => ({ ...d, quickLinks: d.quickLinks.filter((_, i) => i !== idx) }));
  }

  async function handleSave() {
    setSaving(true);
    setErrMsg("");
    try {
      const payload: PageConfig = {
        ...draft,
        quickLinks: draft.quickLinks.filter(l => l.title.trim() || l.url.trim()),
      };
      const res = await fetch("/api/major-projects/page-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("保存失败");
      onSaved(payload);
      onClose();
    } catch (e) {
      setErrMsg((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "basics", label: "基础设置" },
    { key: "links",  label: "快捷链接" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col" style={{ maxHeight: "85vh" }}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h3 className="text-base font-bold text-gray-900">页面配置</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        {/* Tabs */}
        <div className="flex px-6 pt-3 gap-1" style={{ borderBottom: "1px solid #f1f5f9" }}>
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className="px-4 py-2 text-sm font-medium rounded-t-lg transition-all"
              style={activeTab === t.key
                ? { color: "#2563eb", borderBottom: "2px solid #2563eb", marginBottom: -1 }
                : { color: "#94a3b8" }}
            >{t.label}</button>
          ))}
        </div>
        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === "basics" && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">页面名称</label>
                <input
                  value={draft.pageMeta.title}
                  onChange={e => setMeta("title", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  style={{ border: "1px solid #e2e8f0" }}
                  placeholder="如：重大项目管理"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">标语 / 备注</label>
                <input
                  value={draft.pageMeta.description}
                  onChange={e => setMeta("description", e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  style={{ border: "1px solid #e2e8f0" }}
                  placeholder="如：项目全生命周期管理与追踪"
                />
              </div>
            </div>
          )}
          {activeTab === "links" && (
            <div className="space-y-3">
              {draft.quickLinks.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={link.title}
                    onChange={e => setLink(i, "title", e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ border: "1px solid #e2e8f0" }}
                    placeholder="链接标题"
                  />
                  <input
                    value={link.url}
                    onChange={e => setLink(i, "url", e.target.value)}
                    className="flex-1 px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                    style={{ border: "1px solid #e2e8f0" }}
                    placeholder="https://..."
                  />
                  <button onClick={() => removeLink(i)} className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0">
                    <X size={15} />
                  </button>
                </div>
              ))}
              <button
                onClick={addLink}
                className="w-full py-2 rounded-lg text-sm text-slate-500 hover:text-slate-700 transition-all"
                style={{ border: "1px dashed #cbd5e1" }}
              >
                + 新增快捷链接
              </button>
            </div>
          )}
          {errMsg && <p className="mt-3 text-xs text-red-500">{errMsg}</p>}
        </div>
        {/* 底部操作 */}
        <div className="flex items-center justify-end gap-2 px-6 py-4" style={{ borderTop: "1px solid #f1f5f9" }}>
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-all">
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg text-sm font-semibold text-white transition-all"
            style={{ background: saving ? "#94a3b8" : "#2563eb" }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────

export default function MajorProjectsPage() {
  const [filters, setFilters] = useState<Filters>({
    view: "table",
    q: "",
    levelDictIds: [],
    categoryDictIds: [],
    parentId: "null", // 默认只加载顶层主项目（含 children 数组），子项目通过展开按钮展示
    page: 1,
    limit: 20,
  });

  const [projects, setProjects] = useState<MajorProject[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [reloadKey, setReloadKey] = useState(0);

  // 平铺数据（用于 Card 和 Kanban 视图）
  const flattenedProjects = flattenProjects(projects);

  // 真实总数：当筛选"仅顶层项目"时，包括子项目数量；否则使用 API 返回的 total
  const displayTotal = filters.parentId === "null"
    ? projects.reduce((sum, p) => sum + 1 + (p.children?.length || 0), 0)
    : total;

  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<MajorProject | null>(null);

  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    project: MajorProject | null;
  }>({ open: false, project: null });

  // 数据流转引擎 State
  const [bitableUrl, setBitableUrl] = useState("");
  const [parseLoading, setParseLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  // 多选 State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());

  // 导入预览 Modal State
  const [importModal, setImportModal] = useState<{
    open: boolean;
    records: ParsedProject[];
  }>({ open: false, records: [] });

  // Modal 内已选索引集合
  const [importSelected, setImportSelected] = useState<Set<number>>(new Set());

  // Toast 通知
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  // 跨页全选 & 批量删除
  const [allSelectedMode, setAllSelectedMode] = useState(false);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // 添加子项目 Modal
  const [addChildModal, setAddChildModal] = useState<{ open: boolean; parent: MajorProject | null }>({ open: false, parent: null });
  const [newChildName, setNewChildName] = useState("");
  const [addingChild, setAddingChild] = useState(false);

  // 新建项目 Modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newProject, setNewProject] = useState<{
    name: string;
    levelDictId: string | null;
    categoryDictId: string | null;
    companyEntityDictId: string | null;
    totalAmount: string;
    remark: string;
  }>({ name: "", levelDictId: null, categoryDictId: null, companyEntityDictId: null, totalAmount: "", remark: "" });

  // 批量汇总下拉
  const [aggregateDropOpen, setAggregateDropOpen] = useState(false);
  const [aggregating, setAggregating] = useState(false);

  function showToast(msg: string, type: "success" | "error" = "success") {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }

  // 新建项目提交
  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProject.name.trim()) {
      showToast("项目名称不能为空", "error");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/major-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newProject.name.trim(),
          levelDictId: newProject.levelDictId,
          categoryDictId: newProject.categoryDictId,
          companyEntityDictId: newProject.companyEntityDictId,
          totalAmount: newProject.totalAmount ? Number(newProject.totalAmount) : null,
          remark: newProject.remark.trim() || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "创建失败");
      showToast("项目已创建");
      setCreateModalOpen(false);
      setNewProject({ name: "", levelDictId: null, categoryDictId: null, companyEntityDictId: null, totalAmount: "", remark: "" });
      loadProjects();
    } catch (err) {
      showToast((err as Error).message, "error");
    } finally {
      setCreating(false);
    }
  }

  // 加载项目列表
  async function loadProjects() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      filters.levelDictIds.forEach((id) => params.append("levelDictId", id));
      filters.categoryDictIds.forEach((id) => params.append("categoryDictId", id));
      if (filters.companyEntityName) params.set("company", filters.companyEntityName);
      // 搜索时不传 parentId，全库搜索（含子项目）；非搜索时才应用仅顶层过滤
      if (filters.parentId && !filters.q) params.set("parentId", filters.parentId);
      if (filters.orderBy) params.set("orderBy", filters.orderBy);
      if (filters.order) params.set("order", filters.order);
      params.set("page", String(filters.page));
      params.set("limit", String(filters.limit));

      const res = await fetch(`/api/major-projects?${params}`);
      if (!res.ok) throw new Error("加载失败");
      const data = await res.json();
      setProjects(data.projects ?? []);
      setTotal(data.total ?? 0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProjects();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, reloadKey]);

  // 跨模块深度链接：?openDrawerId=<projectId> 自动打开详情 Drawer
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const openDrawerId = searchParams.get("openDrawerId");
    if (!openDrawerId || projects.length === 0) return;
    // 在顶层和子项目中查找
    let found: MajorProject | null = null;
    for (const p of projects) {
      if (p.id === openDrawerId) { found = p; break; }
      for (const child of (p.children ?? [])) {
        if (child.id === openDrawerId) { found = child; break; }
      }
      if (found) break;
    }
    if (found) {
      setSelectedProject(found);
      setIsDrawerOpen(true);
      // 清除 URL 参数，避免刷新重复触发
      const url = new URL(window.location.href);
      url.searchParams.delete("openDrawerId");
      router.replace(url.pathname + (url.search || ""));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, projects]);

  function updateFilter(partial: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...partial }));
  }

  function clearFilters() {
    setFilters((f) => ({ ...f, q: "", levelDictIds: [], categoryDictIds: [], companyEntityName: undefined }));
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleViewDetail(project: MajorProject) {
    setSelectedProject(project);
    setIsDrawerOpen(true);
  }

  function handleSort(field: string) {
    setFilters((f) => {
      if (f.orderBy === field) {
        return { ...f, order: f.order === "asc" ? "desc" : "asc" };
      } else {
        return { ...f, orderBy: field, order: "desc" };
      }
    });
  }

  async function handleDelete() {
    if (!deleteModal.project) return;
    try {
      const res = await fetch(`/api/major-projects/${deleteModal.project.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("删除失败");
      setDeleteModal({ open: false, project: null });
      loadProjects();
    } catch (e) {
      alert((e as Error).message);
    }
  }

  // 两步导入：Step 1 — 解析飞书，展示预览 Modal
  async function handleParseBitable() {
    const url = bitableUrl.trim();
    if (!url) return alert("请输入飞书多维表格 URL");

    // 判断是否 Wiki 链接
    const isWiki = url.includes("/wiki/");

    let appToken = "";
    let tableId = "";

    if (isWiki) {
      const wikiMatch = url.match(/\/wiki\/([a-zA-Z0-9_-]+)/);
      const tableMatch = url.match(/[?&]table=([a-zA-Z0-9_-]+)/);
      if (!wikiMatch) return alert("无效的飞书 Wiki URL，请检查格式");
      appToken = wikiMatch[1];
      tableId = tableMatch?.[1] ?? "";
    } else {
      const match = url.match(/\/base\/([a-zA-Z0-9_-]+).*[?&]table=([a-zA-Z0-9_-]+)/);
      if (!match) return alert("无效的飞书多维表格 URL，请检查格式");
      [, appToken, tableId] = match;
    }

    if (!tableId) return alert("URL 中缺少 table 参数，请确认链接包含 ?table=tblXXX");

    setParseLoading(true);
    try {
      const res = await fetch("/api/major-projects/parse-bitable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appToken, tableId, isWiki }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "解析失败");
      }
      const data = await res.json();
      if (!data.records || data.records.length === 0) {
        return alert("未解析到任何有效记录，请检查表格内容");
      }
      // 默认全选
      setImportSelected(new Set<number>(data.records.map((_: unknown, i: number) => i)));
      setImportModal({ open: true, records: data.records });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setParseLoading(false);
    }
  }

  // 两步导入：Step 2 — 确认后批量 Upsert
  async function handleBulkImport() {
    const toImport = importModal.records.filter((_, i) => importSelected.has(i));
    if (toImport.length === 0) return alert("请至少选择一条记录");

    setParseLoading(true);
    try {
      const res = await fetch("/api/major-projects/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projects: toImport }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "导入失败");
      }
      const data = await res.json();
      setImportModal({ open: false, records: [] });
      setBitableUrl("");
      loadProjects();
      showToast(`导入完成：新增 ${data.created} 个，更新 ${data.updated} 个`);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setParseLoading(false);
    }
  }

  // 同步选中记录到飞书
  async function handleSyncToFeishu() {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setSyncingIds(new Set(ids));
    try {
      const res = await fetch("/api/major-projects/sync-feishu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json() as {
        synced?: number; failed?: number; warnings?: string[];
        errors?: { id: string; name: string; error: string }[]; error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "同步失败");
      const warn = data.warnings?.length ? `（${data.warnings.length} 个附件跳过）` : "";
      if ((data.failed ?? 0) > 0) {
        const reason = data.errors?.[0]?.error ? `\n原因：${data.errors[0].error}` : "";
        showToast(`同步完成：成功 ${data.synced ?? 0} 个，失败 ${data.failed} 个${warn}${reason}`, "error");
      } else {
        showToast(`已同步 ${data.synced ?? 0} 个项目到飞书${warn}`);
      }
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setSyncingIds(new Set());
    }
  }

  // 导出本地 Excel
  async function handleExportExcel() {
    setExportLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.q) params.set("q", filters.q);
      filters.levelDictIds.forEach((id) => params.append("levelDictId", id));
      filters.categoryDictIds.forEach((id) => params.append("categoryDictId", id));
      if (filters.companyEntityName) params.set("company", filters.companyEntityName);
      if (filters.parentId) params.set("parentId", filters.parentId);

      const res = await fetch(`/api/major-projects/export?${params}`);
      if (!res.ok) throw new Error("导出失败");

      const blob = await res.blob();
      const dlUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = dlUrl;
      a.download = `重大项目-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      window.URL.revokeObjectURL(dlUrl);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setExportLoading(false);
    }
  }

  // ── 跨页全选：拉取当前筛选条件下的所有项目 ID ───────────────────
  async function handleSelectAllPages() {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    filters.levelDictIds.forEach((id) => params.append("levelDictId", id));
    filters.categoryDictIds.forEach((id) => params.append("categoryDictId", id));
    params.set("parentId", filters.parentId || "null");
    params.set("limit", "9999");
    params.set("page", "1");
    try {
      const res = await fetch(`/api/major-projects?${params}`);
      const data = await res.json();
      const ids: string[] = [];
      for (const p of (data.projects ?? []) as MajorProject[]) {
        ids.push(p.id);
        for (const c of (p.children ?? [])) ids.push(c.id);
      }
      setSelectedIds(new Set(ids));
      setAllSelectedMode(true);
    } catch (e) {
      console.error("全选失败:", e);
    }
  }

  // ── 批量汇总金额 ──────────────────────────────────────────────────
  async function handleBulkAggregate(target: "total" | "received" | "both") {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setAggregating(true);
    setAggregateDropOpen(false);
    try {
      const res = await fetch("/api/major-projects/aggregate-amounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: ids, target }),
      });
      const data = await res.json() as { updated?: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "汇总失败");
      if ((data.updated ?? 0) === 0) {
        showToast("未找到含子项目的父项目，无需汇总", "error");
      } else {
        showToast(`汇总完成，已更新 ${data.updated} 个父项目的金额`);
        loadProjects();
      }
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setAggregating(false);
    }
  }

  // ── 批量软删除 ───────────────────────────────────────────────────
  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      const res = await fetch("/api/major-projects/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "删除失败");
      }
      const data = await res.json();
      setBulkDeleteConfirm(false);
      setSelectedIds(new Set());
      setAllSelectedMode(false);
      loadProjects();
      showToast(`已软删除 ${data.deleted} 个项目`);
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  }

  const hasFilters = filters.q || filters.levelDictIds.length > 0 || filters.categoryDictIds.length > 0 || !!filters.companyEntityName;

  // ── 添加子项目 ───────────────────────────────────────────────────
  async function handleAddChild() {
    if (!addChildModal.parent || !newChildName.trim()) return;
    setAddingChild(true);
    try {
      const res = await fetch("/api/major-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newChildName.trim(), parentId: addChildModal.parent.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "创建失败");
      }
      // 自动展开父项目
      setExpandedIds((prev) => new Set([...prev, addChildModal.parent!.id]));
      setAddChildModal({ open: false, parent: null });
      setNewChildName("");
      loadProjects();
      showToast("子项目已创建");
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setAddingChild(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f0f4f8", display: "flex", flexDirection: "column" }}>
      {/* 顶部栏（深蓝渐变） */}
      <PageHeaderWithConfig
        pageId="major-projects"
        defaultTitle="重大项目管理"
        defaultDescription="项目全生命周期管理与追踪"
        rightSlot={
          <div className="flex items-center gap-3">
            <button
              onClick={() => setCreateModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: "rgba(34,197,94,0.85)",
                color: "white",
                border: "1px solid rgba(34,197,94,0.4)",
              }}
            >
              <Plus size={14} />
              新增项目
            </button>
            {selectedIds.size > 0 && (
                <>
                  <span
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.7)",
                      background: "rgba(37,99,235,0.3)",
                      padding: "4px 12px",
                      borderRadius: 8,
                    }}
                  >
                    已选 <strong>{selectedIds.size}</strong> 个
                  </span>
                  <button
                    onClick={() => setBulkDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all"
                    style={{
                      background: "rgba(239,68,68,0.85)",
                      color: "white",
                      border: "1px solid rgba(239,68,68,0.4)",
                    }}
                  >
                    <Trash2 size={13} />
                    批量删除 ({selectedIds.size})
                  </button>
                  {/* 批量汇总下拉 */}
                  <div style={{ position: "relative" }}>
                    <button
                      onClick={() => setAggregateDropOpen(v => !v)}
                      disabled={aggregating}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50"
                      style={{
                        background: "rgba(59,130,246,0.85)",
                        color: "white",
                        border: "1px solid rgba(59,130,246,0.4)",
                      }}
                    >
                      {aggregating ? <Loader2 size={13} className="animate-spin" /> : <Calculator size={13} />}
                      ∑ 批量汇总 ({selectedIds.size})
                      <ChevronDown size={12} style={{ transform: aggregateDropOpen ? "rotate(180deg)" : "none", transition: "0.2s" }} />
                    </button>
                    {aggregateDropOpen && (
                      <div style={{
                        position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 50,
                        background: "#1e293b", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 8, boxShadow: "0 4px 12px rgba(0,0,0,0.4)", minWidth: 160,
                      }}>
                        {[
                          { label: "仅汇总总金额", value: "total" as const },
                          { label: "仅汇总已到账", value: "received" as const },
                          { label: "同时汇总两者", value: "both" as const },
                        ].map(item => (
                          <div
                            key={item.value}
                            onClick={() => handleBulkAggregate(item.value)}
                            style={{ padding: "9px 14px", fontSize: 13, color: "white", cursor: "pointer" }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(59,130,246,0.2)")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                          >
                            {item.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              <div
                style={{
                  fontSize: 13,
                  color: "rgba(255,255,255,0.8)",
                  background: "rgba(255,255,255,0.1)",
                  padding: "8px 16px",
                  borderRadius: 8,
                }}
              >
                共 <strong>{total}</strong> 个项目
              </div>
            </div>
          }
        />
      {/* 筛选栏 + 数据工具栏（深色背景延续） */}
      <div style={{ background: "linear-gradient(135deg,#0f172a 0%,#1e3a5f 55%,#0f172a 100%)", flexShrink: 0 }}>
        <div style={{ padding: "0 32px 16px" }}>
          {/* 筛选栏 + ViewSwitcher */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              {/* 搜索 */}
              <div className="relative">
                <Search
                  size={14}
                  style={{
                    position: "absolute",
                    left: 12,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "#94a3b8",
                  }}
                />
                <input
                  type="text"
                  value={filters.q}
                  onChange={(e) => updateFilter({ q: e.target.value })}
                  placeholder="搜索项目名称..."
                  style={{
                    paddingLeft: 36,
                    paddingRight: 12,
                    paddingTop: 8,
                    paddingBottom: 8,
                    borderRadius: 8,
                    fontSize: 13,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.08)",
                    color: "white",
                    outline: "none",
                    minWidth: 200,
                  }}
                  onFocus={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
                  onBlur={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                />
              </div>

              {/* 级别筛选（多选） */}
              <div style={{ width: 200 }}>
                <MultiDictSelect
                  category="level"
                  values={filters.levelDictIds}
                  onChange={(ids) => updateFilter({ levelDictIds: ids, page: 1 })}
                  placeholder="全部级别"
                />
              </div>

              {/* 类别筛选（多选） */}
              <div style={{ width: 200 }}>
                <MultiDictSelect
                  category="category"
                  values={filters.categoryDictIds}
                  onChange={(ids) => updateFilter({ categoryDictIds: ids, page: 1 })}
                  placeholder="全部类别"
                />
              </div>

              {/* 层级筛选 */}
              <select
                value={filters.parentId}
                onChange={(e) => updateFilter({ parentId: e.target.value })}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  outline: "none",
                }}
              >
                <option value="" style={{ background: "#1e293b", color: "white" }}>全部项目</option>
                <option value="null" style={{ background: "#1e293b", color: "white" }}>仅顶层项目</option>
              </select>

              {/* 公司筛选标签 */}
              {filters.companyEntityName && (
                <button
                  onClick={() => updateFilter({ companyEntityName: undefined, page: 1 })}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "6px 10px",
                    fontSize: 12,
                    color: "#c4b5fd",
                    background: "rgba(139,92,246,0.2)",
                    border: "1px solid rgba(139,92,246,0.3)",
                    borderRadius: 8,
                  }}
                >
                  <X size={11} />
                  {filters.companyEntityName}
                </button>
              )}

              {/* 清除筛选 */}
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "8px 12px",
                    fontSize: 12,
                    color: "#fecaca",
                    background: "rgba(239,68,68,0.2)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: 8,
                  }}
                >
                  <X size={12} />
                  清除筛选
                </button>
              )}
            </div>

            {/* ViewSwitcher */}
            <ViewSwitcher current={filters.view} onChange={(v) => updateFilter({ view: v })} />
          </div>
        </div>

        {/* 数据流转操作栏 */}
        <div style={{ padding: "0 32px 16px" }}>
          <div
            className="flex items-center gap-3 p-4 rounded-xl flex-wrap"
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            {/* 飞书多维表格 URL */}
            <div className="flex items-center gap-2 flex-1" style={{ minWidth: 280 }}>
              <Link2 size={14} style={{ color: "rgba(255,255,255,0.6)" }} />
              <input
                type="text"
                value={bitableUrl}
                onChange={(e) => setBitableUrl(e.target.value)}
                placeholder="粘贴飞书多维表格 URL..."
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.08)",
                  color: "white",
                  outline: "none",
                }}
                onFocus={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
                onBlur={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              />
            </div>

            {/* 解析导入按钮 */}
            <button
              onClick={handleParseBitable}
              disabled={parseLoading || !bitableUrl.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "rgba(59,130,246,0.9)",
                color: "white",
                border: "1px solid rgba(59,130,246,0.3)",
              }}
            >
              {parseLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Upload size={14} />
              )}
              解析导入
            </button>

            {/* 同步到飞书按钮（有选中时才显示） */}
            {selectedIds.size > 0 && (
              <button
                onClick={handleSyncToFeishu}
                disabled={syncingIds.size > 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg,#0891b2,#0e7490)",
                  color: "white",
                  border: "1px solid rgba(8,145,178,0.4)",
                }}
              >
                {syncingIds.size > 0 ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Cloud size={14} />
                )}
                同步到飞书 ({selectedIds.size})
              </button>
            )}

            {/* 导出本地按钮 */}
            <button
              onClick={handleExportExcel}
              disabled={exportLoading}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "rgba(34,197,94,0.9)",
                color: "white",
                border: "1px solid rgba(34,197,94,0.3)",
              }}
            >
              {exportLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              导出 Excel
            </button>
          </div>
        </div>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {filters.view === "table" && (
          <div
            style={{
              background: "white",
              margin: "16px 32px",
              borderRadius: 12,
              boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* 跨页全选 Banner */}
            {(() => {
              const currentPageIds = getAllProjectIds(projects);
              const allCurrentSelected =
                currentPageIds.length > 0 &&
                currentPageIds.every((id) => selectedIds.has(id));
              if (allSelectedMode) {
                return (
                  <div
                    className="flex items-center gap-2 px-5 py-2.5 text-sm"
                    style={{ background: "#eff6ff", borderBottom: "1px solid #bfdbfe" }}
                  >
                    <Check size={14} style={{ color: "#2563eb" }} />
                    <span style={{ color: "#1d4ed8" }}>
                      已选中所有 <strong>{selectedIds.size}</strong> 个符合筛选条件的项目。
                    </span>
                    <button
                      onClick={() => { setSelectedIds(new Set()); setAllSelectedMode(false); }}
                      style={{ color: "#2563eb", fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}
                    >
                      取消全选
                    </button>
                  </div>
                );
              }
              if (allCurrentSelected && total > projects.length) {
                return (
                  <div
                    className="flex items-center gap-2 px-5 py-2.5 text-sm"
                    style={{ background: "#eff6ff", borderBottom: "1px solid #bfdbfe" }}
                  >
                    <span style={{ color: "#475569" }}>
                      已选中当前页 <strong>{currentPageIds.length}</strong> 个项目。
                    </span>
                    <button
                      onClick={handleSelectAllPages}
                      style={{ color: "#2563eb", fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}
                    >
                      选中所有 {total} 个主项目
                    </button>
                  </div>
                );
              }
              return null;
            })()}
            <TableView
              projects={projects}
              loading={loading}
              expandedIds={expandedIds}
              onToggleExpand={toggleExpand}
              onViewDetail={handleViewDetail}
              onDelete={(p) => setDeleteModal({ open: true, project: p })}
              isSearchMode={!!filters.q}
              orderBy={filters.orderBy}
              order={filters.order}
              onSort={handleSort}
              selectedIds={selectedIds}
              onToggleAll={() => {
                const allIds = getAllProjectIds(projects);
                if (allIds.every((id) => selectedIds.has(id))) {
                  setSelectedIds(new Set());
                  setAllSelectedMode(false);
                } else {
                  setSelectedIds(new Set(allIds));
                  setAllSelectedMode(false); // 重新选择时退出全页模式
                }
              }}
              onToggleRow={(id) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              onAddChild={(p) => setAddChildModal({ open: true, parent: p })}
              onAggregate={async (id, target) => {
                try {
                  const res = await fetch("/api/major-projects/aggregate-amounts", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectIds: [id], target }),
                  });
                  const data = await res.json() as { updated?: number; error?: string };
                  if (!res.ok) throw new Error(data.error ?? "汇总失败");
                  showToast(data.updated ? "汇总完成，金额已更新" : "无子项目，无需汇总", data.updated ? "success" : "error");
                  if (data.updated) loadProjects();
                } catch (e) { showToast((e as Error).message, "error"); }
              }}
            />
          </div>
        )}
        {filters.view === "card" && (
          <div style={{ flex: 1, overflowY: "auto", background: "#0f172a" }}>
            <CardView projects={projects} loading={loading} onViewDetail={handleViewDetail} />
          </div>
        )}
        {filters.view === "kanban" && (
          <div style={{ flex: 1, overflowY: "auto" }}>
            <DashboardView onFilterChange={updateFilter} />
          </div>
        )}
      </div>

      {/* 分页（表格视图 & 卡片视图） */}
      {(filters.view === "table" || filters.view === "card") && total > 0 && (
        <div
          style={{
            padding: "16px 32px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "white",
            borderTop: "1px solid #e2e8f0",
          }}
        >
          <div className="flex items-center gap-4">
            <div style={{ fontSize: 13, color: "#64748b" }}>
              {filters.parentId === "null" ? (
                <>
                  共 {displayTotal} 个项目（{projects.length} 个主项目
                  {displayTotal > projects.length && ` + ${displayTotal - projects.length} 个子项目`}
                  ），当前第 {filters.page} 页 / 共 {Math.ceil(total / filters.limit)} 页
                </>
              ) : (
                <>
                  共 {displayTotal} 个项目，当前第 {filters.page} 页 / 共{" "}
                  {Math.ceil(displayTotal / filters.limit)} 页
                </>
              )}
            </div>
            {/* 每页条数选择 */}
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 13, color: "#64748b" }}>每页</span>
              <select
                value={filters.limit}
                onChange={(e) => updateFilter({ limit: Number(e.target.value), page: 1 })}
                style={{
                  padding: "4px 8px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13,
                  background: "white",
                  cursor: "pointer",
                }}
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
                max={Math.ceil(total / filters.limit)}
                placeholder={String(filters.page)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const val = Number((e.target as HTMLInputElement).value);
                    const maxPage = Math.ceil(total / filters.limit);
                    if (val >= 1 && val <= maxPage) {
                      updateFilter({ page: val });
                      (e.target as HTMLInputElement).value = "";
                    }
                  }
                }}
                onBlur={(e) => {
                  const val = Number(e.target.value);
                  const maxPage = Math.ceil(total / filters.limit);
                  if (val >= 1 && val <= maxPage) {
                    updateFilter({ page: val });
                    e.target.value = "";
                  }
                }}
                style={{
                  width: 48,
                  height: 32,
                  padding: "4px 8px",
                  border: "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13,
                  textAlign: "center",
                }}
              />
              <span style={{ fontSize: 13, color: "#64748b" }}>页</span>
            </div>
            {/* 上一页/下一页 */}
            <button
              onClick={() => updateFilter({ page: Math.max(1, filters.page - 1) })}
              disabled={filters.page === 1}
              style={{
                padding: "6px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 13,
                background: "white",
                cursor: filters.page === 1 ? "not-allowed" : "pointer",
                opacity: filters.page === 1 ? 0.5 : 1,
              }}
            >
              上一页
            </button>
            <button
              onClick={() => updateFilter({ page: filters.page + 1 })}
              disabled={filters.page * filters.limit >= total}
              style={{
                padding: "6px 12px",
                border: "1px solid #e2e8f0",
                borderRadius: 6,
                fontSize: 13,
                background: "white",
                cursor: filters.page * filters.limit >= total ? "not-allowed" : "pointer",
                opacity: filters.page * filters.limit >= total ? 0.5 : 1,
              }}
            >
              下一页
            </button>
          </div>
        </div>
      )}

      {/* 新建项目 Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <form
            onSubmit={handleCreateProject}
            className="bg-white rounded-2xl w-full max-w-lg p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">新增重大项目</h3>
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-100"
              >
                <X size={18} style={{ color: "#64748b" }} />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">项目名称 *</label>
              <input
                value={newProject.name}
                onChange={(e) => setNewProject((p) => ({ ...p, name: e.target.value }))}
                placeholder="请输入项目名称"
                className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                style={{ border: "1px solid #e2e8f0" }}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">项目级别</label>
                <DictSelect
                  category="level"
                  value={newProject.levelDictId}
                  onChange={(id) => setNewProject((p) => ({ ...p, levelDictId: id }))}
                  placeholder="请选择级别"
                  canEdit={true}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">项目类别</label>
                <DictSelect
                  category="category"
                  value={newProject.categoryDictId}
                  onChange={(id) => setNewProject((p) => ({ ...p, categoryDictId: id }))}
                  placeholder="请选择类别"
                  canEdit={true}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">收款公司主体</label>
                <DictSelect
                  category="companyEntity"
                  value={newProject.companyEntityDictId}
                  onChange={(id) => setNewProject((p) => ({ ...p, companyEntityDictId: id }))}
                  placeholder="请选择公司"
                  canEdit={true}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">总金额（元）</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={newProject.totalAmount}
                  onChange={(e) => setNewProject((p) => ({ ...p, totalAmount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  style={{ border: "1px solid #e2e8f0" }}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1.5">备注</label>
              <textarea
                value={newProject.remark}
                onChange={(e) => setNewProject((p) => ({ ...p, remark: e.target.value }))}
                placeholder="可选填"
                rows={3}
                className="w-full px-3 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                style={{ border: "1px solid #e2e8f0" }}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateModalOpen(false)}
                className="px-4 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={creating || !newProject.name.trim()}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)" }}
              >
                {creating ? "创建中..." : "创建项目"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 详情 Drawer */}
      {isDrawerOpen && selectedProject && (
        <ProjectDrawer
          projectId={selectedProject.id}
          projectName={selectedProject.name}
          onClose={() => setIsDrawerOpen(false)}
          onSaved={() => {
            setIsDrawerOpen(false);
            setReloadKey(k => k + 1);
          }}
          onAmountsUpdated={() => setReloadKey(k => k + 1)}
        />
      )}

      {/* 删除确认弹窗 */}
      {deleteModal.open && deleteModal.project && (
        <DeleteConfirmModal
          project={deleteModal.project}
          onClose={() => setDeleteModal({ open: false, project: null })}
          onConfirm={handleDelete}
        />
      )}

      {/* 飞书导入预览 Modal */}
      {importModal.open && (
        <FeishuImportModal
          records={importModal.records}
          selected={importSelected}
          loading={parseLoading}
          onToggle={(i) => {
            setImportSelected((prev) => {
              const next = new Set(prev);
              if (next.has(i)) next.delete(i);
              else next.add(i);
              return next;
            });
          }}
          onToggleAll={() => {
            if (importSelected.size === importModal.records.length) {
              setImportSelected(new Set());
            } else {
              setImportSelected(new Set(importModal.records.map((_, i) => i)));
            }
          }}
          onConfirm={handleBulkImport}
          onClose={() => setImportModal({ open: false, records: [] })}
        />
      )}

      {/* 批量删除确认弹窗 */}
      {bulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div
                className="flex items-center justify-center w-10 h-10 rounded-full"
                style={{ background: "rgba(239,68,68,0.1)" }}
              >
                <AlertTriangle size={20} style={{ color: "#ef4444" }} />
              </div>
              <h3 className="text-lg font-bold text-gray-900">确认批量删除</h3>
            </div>
            <p className="text-sm text-gray-600 mb-1">
              即将软删除 <strong style={{ color: "#ef4444" }}>{selectedIds.size}</strong> 个项目。
            </p>
            <p className="text-xs text-gray-400 mb-6">
              软删除不会丢失数据，仅从列表隐藏。若所选项目包含子项目，子项目也将一并隐藏。
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => setBulkDeleteConfirm(false)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 text-white hover:bg-red-700"
              >
                确认删除 ({selectedIds.size} 个)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 添加子项目弹窗 */}
      {addChildModal.open && addChildModal.parent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-gray-900 mb-1">添加子项目</h3>
            <p className="text-sm text-gray-500 mb-4">
              归属主项目：<strong className="text-gray-700">{addChildModal.parent.name}</strong>
            </p>
            <input
              type="text"
              value={newChildName}
              onChange={(e) => setNewChildName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddChild(); }}
              placeholder="请输入子项目名称..."
              autoFocus
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                fontSize: 14,
                outline: "none",
                marginBottom: 16,
                boxSizing: "border-box",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = "#60a5fa"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "#e2e8f0"; }}
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => { setAddChildModal({ open: false, parent: null }); setNewChildName(""); }}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                取消
              </button>
              <button
                onClick={handleAddChild}
                disabled={addingChild || !newChildName.trim()}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)", color: "white" }}
              >
                {addingChild ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Plus size={14} />
                )}
                创建子项目
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast 通知 */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            zIndex: 100,
            padding: "12px 20px",
            borderRadius: 12,
            background: toast.type === "success" ? "#16a34a" : "#dc2626",
            color: "white",
            fontSize: 14,
            fontWeight: 500,
            boxShadow: "0 4px 20px rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {toast.type === "success" ? <Check size={16} /> : <X size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  );
}
