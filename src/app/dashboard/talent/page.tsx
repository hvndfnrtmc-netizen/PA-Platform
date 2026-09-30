"use client";

/**
 * /dashboard/talent — 人才福利政策管理看板
 * 由原生 HTML + Chart.js 版本迁移至 Next.js + recharts + Tailwind
 */

import { useState, useMemo, useRef, useCallback } from "react";
import {
  Gift, Search, Download, Upload, RefreshCw, ExternalLink, CheckCircle2,
  Clock, Users, Folder, AlertTriangle, BarChart2, X,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  PROJECTS, NODE_TEMPLATES, getProjectProgress, getDaysLeft,
  type Project,
} from "./data";

// ──────────────────────────────────────────────
// 常量
// ──────────────────────────────────────────────

const CITY_OPTIONS   = ["全部", "苏州", "上海", "深圳"] as const;
const STATUS_OPTIONS = ["全部", "进行中", "已完成", "停滞"] as const;

const CITY_COLORS: Record<string, { bg: string; text: string }> = {
  苏州: { bg: "#dbeafe", text: "#1d4ed8" },
  上海: { bg: "#fce7f3", text: "#be185d" },
  深圳: { bg: "#d1fae5", text: "#065f46" },
};

const STATUS_STYLE: Record<string, { bg: string; text: string; border?: string }> = {
  进行中: { bg: "#dcfce7", text: "#16a34a" },
  已完成: { bg: "#f0fdf4", text: "#22c55e", border: "#bbf7d0" },
  停滞:   { bg: "#fef2f2", text: "#ef4444" },
};

const COMPANY_PALETTE = [
  ["#dbeafe", "#1d4ed8"], ["#fce7f3", "#be185d"], ["#d1fae5", "#065f46"],
  ["#fef3c7", "#92400e"], ["#ede9fe", "#5b21b6"], ["#ffedd5", "#c2410c"],
] as [string, string][];

const CHART_COLORS = [
  "#3b82f6", "#ec4899", "#22c55e", "#f59e0b", "#8b5cf6",
];

// ──────────────────────────────────────────────
// 里程碑轨道组件
// ──────────────────────────────────────────────

function MilestoneTrack({ currentNode }: { currentNode: string }) {
  const currOrder = NODE_TEMPLATES.find(n => n.id === currentNode)?.order ?? 0;
  return (
    <div className="flex items-center pb-9 mb-2">
      {NODE_TEMPLATES.map((n, i) => {
        const isLast  = i === NODE_TEMPLATES.length - 1;
        const status  = n.order < currOrder ? "done" : n.order === currOrder ? "active" : "todo";
        const dotBg   = status === "done" ? "#22c55e" : status === "active" ? "#f59e0b" : "#e2e8f0";
        const lineBg  = status === "done" ? "#22c55e" : "#e2e8f0";
        const labelCls = status === "active"
          ? "text-amber-500 font-medium"
          : status === "done"
          ? "text-green-500"
          : "text-gray-400";
        return (
          <div key={n.id} className={`flex items-center ${isLast ? "" : "flex-1"}`}>
            <div className="relative flex-shrink-0">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{
                  background: dotBg,
                  boxShadow:  status === "active" ? "0 0 0 3px rgba(245,158,11,0.25)" : undefined,
                }}
              />
              <span className={`absolute top-full mt-0.5 left-1/2 -translate-x-1/2 text-[8px] text-center w-[40px] break-words leading-tight pointer-events-none ${labelCls}`}>
                {n.name}
              </span>
            </div>
            {!isLast && (
              <div className="flex-1 h-0.5 mx-0.5" style={{ background: lineBg }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────
// 截止日期标签
// ──────────────────────────────────────────────

function DeadlineBadge({ deadline }: { deadline: string }) {
  const diff = getDaysLeft(deadline);
  const urgent  = diff < 7;
  const warning = diff < 14;
  const overdue = diff < 0;
  const text = overdue
    ? `已逾期 ${Math.abs(diff)} 天！`
    : diff < 7  ? `⚠️ 还剩 ${diff} 天截止`
    : diff < 14 ? `⏳ 还剩 ${diff} 天截止`
    : `截止日期：${deadline}`;
  return (
    <p
      className="text-xs mb-2 font-medium"
      style={{ color: urgent || overdue ? "#ef4444" : warning ? "#f59e0b" : "#64748b" }}
    >
      ⏰ {text}
    </p>
  );
}

// ──────────────────────────────────────────────
// 项目卡片
// ──────────────────────────────────────────────

function ProjectCard({ project }: { project: Project }) {
  const pct       = getProjectProgress(project);
  const currNode  = NODE_TEMPLATES.find(n => n.id === project.currentNode);
  const cityStyle = CITY_COLORS[project.city]  ?? { bg: "#f1f5f9", text: "#475569" };
  const sStyle    = STATUS_STYLE[project.status] ?? { bg: "#f1f5f9", text: "#475569" };
  const borderColor = project.status === "已完成" ? "#22c55e"
                    : project.status === "停滞"   ? "#ef4444"
                    : "#3b82f6";
  const fillColor   = project.status === "已完成"
    ? "linear-gradient(90deg,#22c55e,#4ade80)"
    : project.status === "停滞"
    ? "linear-gradient(90deg,#ef4444,#f87171)"
    : "linear-gradient(90deg,#3b82f6,#818cf8)";

  return (
    <div
      className="bg-white rounded-2xl p-4 shadow-sm hover:shadow-md transition-all border border-gray-100"
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      {/* 标题行 */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-semibold text-slate-800 leading-snug">{project.name}</p>
        <span
          className="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold"
          style={{ background: sStyle.bg, color: sStyle.text, border: sStyle.border ? `1px solid ${sStyle.border}` : undefined }}
        >
          {project.status}
        </span>
      </div>

      {/* 标签行 */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
          style={{ background: cityStyle.bg, color: cityStyle.text }}>
          {project.city}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500">
          {project.company}
        </span>
        {project.startYear && (
          <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-50 text-amber-700">
            {project.startYear}–{project.endYear}
          </span>
        )}
      </div>

      {/* 进度条 */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: fillColor }}
          />
        </div>
        <span className="text-[11px] font-bold text-slate-700 w-9 text-right">{pct}%</span>
        <span className="text-[10px] text-slate-400 whitespace-nowrap">
          {project.completedPeople}/{project.totalPeople} 人
        </span>
      </div>

      {/* 当前节点 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-slate-500">
          当前节点：<strong className="text-slate-700">{currNode?.name ?? "—"}</strong>
        </span>
        <span className="text-[11px] font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-lg border border-slate-100">
          共 {project.totalPeople} 人次
        </span>
      </div>

      {/* 里程碑 */}
      <MilestoneTrack currentNode={project.currentNode} />

      {/* 截止日期 */}
      {project.deadline && <DeadlineBadge deadline={project.deadline} />}

      {/* 操作按钮 */}
      <div className="flex gap-2 mt-1">
        <a href={project.feishuUrl} target="_blank" rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold rounded-lg border border-gray-200 text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors">
          <ExternalLink size={11} />查看详情
        </a>
        <a href={project.applyUrl} target="_blank" rel="noopener noreferrer"
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11px] font-semibold rounded-lg text-white transition-opacity hover:opacity-90"
          style={{ background: "linear-gradient(135deg,#3b82f6,#818cf8)" }}>
          <CheckCircle2 size={11} />处理待办
        </a>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// KPI 卡片
// ──────────────────────────────────────────────

function KpiCard({
  icon, label, value, sub, color, clickable, active, onClick,
}: {
  icon: React.ReactNode; label: string; value: string | number;
  sub: string; color: string; clickable?: boolean; active?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl p-4 shadow-sm border transition-all ${
        clickable ? "cursor-pointer hover:shadow-md" : ""
      } ${active ? "border-amber-400 ring-2 ring-amber-200" : "border-gray-100 hover:border-gray-200"}`}
    >
      {active && (
        <span className="absolute top-2 right-2 text-[9px] font-bold bg-amber-400 text-white px-1.5 py-0.5 rounded-full">
          筛选中
        </span>
      )}
      <div className="text-lg mb-1">{icon}</div>
      <p className="text-xs text-slate-500 font-medium mb-1">{label}</p>
      <p className="text-2xl font-bold leading-none" style={{ color }}>{value}</p>
      <p className="text-[10px] text-slate-400 mt-1">{sub}</p>
    </div>
  );
}

// ──────────────────────────────────────────────
// 主页面
// ──────────────────────────────────────────────

export default function TalentPage() {
  const [city,     setCity]     = useState<string>("全部");
  const [status,   setStatus]   = useState<string>("全部");
  const [search,   setSearch]   = useState("");
  const [soonOnly, setSoonOnly] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  // ── 过滤逻辑 ────────────────────────────────
  const filtered = useMemo(() => {
    const kw = search.toLowerCase().trim();
    return PROJECTS.filter(p => {
      if (city   !== "全部" && p.city   !== city)   return false;
      if (status !== "全部" && p.status !== status) return false;
      if (kw && !p.name.toLowerCase().includes(kw)) return false;
      if (soonOnly) {
        if (!p.deadline) return false;
        const diff = getDaysLeft(p.deadline);
        if (diff < 0 || diff > 14) return false;
      }
      return true;
    });
  }, [city, status, search, soonOnly]);

  // ── KPI ──────────────────────────────────────
  const kpi = useMemo(() => {
    const active      = filtered.filter(p => p.status === "进行中").length;
    const done        = filtered.filter(p => p.status === "已完成").length;
    const totalPeople = filtered.reduce((s, p) => s + p.totalPeople, 0);
    const soon        = filtered.filter(p => {
      if (!p.deadline) return false;
      const d = getDaysLeft(p.deadline);
      return d >= 0 && d <= 14;
    }).length;
    const avg = filtered.length
      ? (filtered.reduce((s, p) => s + getProjectProgress(p), 0) / filtered.length).toFixed(1)
      : "0.0";
    return { active, done, totalPeople, soon, avg };
  }, [filtered]);

  // ── 图表数据 ─────────────────────────────────
  const nodeChartData = useMemo(() =>
    NODE_TEMPLATES.map(n => ({
      name:  n.name,
      count: filtered.filter(p => p.currentNode === n.id).length,
    })),
    [filtered]
  );

  const cityChartData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(p => { map[p.city] = (map[p.city] ?? 0) + 1; });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [filtered]);

  const companyBlocks = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.forEach(p => { map[p.company] = (map[p.company] ?? 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  // ── 重置 ─────────────────────────────────────
  const reset = useCallback(() => {
    setCity("全部"); setStatus("全部"); setSearch(""); setSoonOnly(false);
  }, []);

  // ── 导出 CSV ──────────────────────────────────
  function exportCSV() {
    const rows = [
      ["项目名称", "城市", "公司", "状态", "总人次", "已完成", "进度", "当前节点", "截止日期"],
      ...filtered.map(p => {
        const node = NODE_TEMPLATES.find(n => n.id === p.currentNode);
        return [
          p.name, p.city, p.company, p.status,
          p.totalPeople, p.completedPeople,
          getProjectProgress(p) + "%",
          node?.name ?? "—",
          p.deadline ?? "—",
        ];
      }),
    ];
    const csv  = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement("a"), {
      href: url,
      download: `人才福利政策报表_${new Date().toLocaleDateString("zh-CN").replace(/\//g, "-")}.csv`,
    });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ── 导入 CSV ──────────────────────────────────
  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const text = ev.target!.result as string;
        const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter(l => l.trim());
        const parseRow = (line: string) => {
          const row: string[] = []; let inQ = false, cell = "";
          for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { if (inQ && line[i+1] === '"') { cell += '"'; i++; } else inQ = !inQ; }
            else if (ch === "," && !inQ) { row.push(cell); cell = ""; }
            else cell += ch;
          }
          row.push(cell); return row;
        };
        const rows   = lines.map(parseRow);
        const header = rows[0];
        const nodeByName = Object.fromEntries(NODE_TEMPLATES.map(n => [n.name, n.id]));
        const idx    = (name: string) => header.indexOf(name);
        let updated  = 0; const notFound: string[] = [];
        rows.slice(1).forEach(row => {
          const pName = row[idx("项目名称")]?.trim();
          if (!pName) return;
          const proj = PROJECTS.find(p => p.name === pName);
          if (!proj) { notFound.push(pName); return; }
          const total     = parseInt(row[idx("总人次")]);
          const completed = parseInt(row[idx("已完成")]);
          const st        = row[idx("状态")]?.trim() as Project["status"];
          const nodeName  = row[idx("当前节点")]?.trim();
          const dl        = row[idx("截止日期")]?.trim();
          if (!isNaN(total)     && total >= 0)      proj.totalPeople     = total;
          if (!isNaN(completed) && completed >= 0)  proj.completedPeople = completed;
          if (st && ["进行中","已完成","停滞"].includes(st)) proj.status = st;
          if (nodeName && nodeByName[nodeName]) proj.currentNode = nodeByName[nodeName];
          proj.deadline = (dl && dl !== "—") ? dl : null;
          updated++;
        });
        alert(
          `✅ 导入完成！成功更新 ${updated} 个项目` +
          (notFound.length ? `\n\n⚠️ 未找到（已跳过）：\n${notFound.join("\n")}` : "")
        );
      } catch (err) { alert("导入失败：" + (err as Error).message); }
    };
    reader.readAsText(file, "UTF-8");
  }

  const hasFilters = city !== "全部" || status !== "全部" || search || soonOnly;

  return (
    <div className="flex-1 overflow-auto bg-slate-50">

      {/* ── 页面 Header ───────────────────────────────────── */}
      <div className="px-8 pt-8 pb-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg,#3b82f6,#818cf8)" }}>
              <Gift size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">人才福利政策管理看板</h1>
              <p className="text-sm text-slate-500 mt-0.5">追踪各城市人才补贴申报进度，管理政策项目里程碑</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input ref={importRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
            <button
              onClick={() => importRef.current?.click()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-slate-600 bg-white border border-gray-200 hover:border-blue-300 hover:text-blue-600 transition-colors">
              <Upload size={13} />导入报表
            </button>
            <button
              onClick={exportCSV}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(135deg,#3b82f6,#1d4ed8)" }}>
              <Download size={13} />导出报表
            </button>
          </div>
        </div>
      </div>

      <div className="px-8 pb-8 space-y-5">

        {/* ── KPI 卡片 ───────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard icon="📁" label="总项目数"    value={filtered.length}   sub="当前筛选范围"       color="#3b82f6" />
          <KpiCard icon="▶️" label="进行中项目"  value={kpi.active}        sub="当前活跃"           color="#22c55e" />
          <KpiCard icon="👥" label="覆盖总人次"  value={kpi.totalPeople.toLocaleString()} sub="所有项目参与人数之和" color="#06b6d4" />
          <KpiCard
            icon="⏰" label="即将截止"  value={kpi.soon}
            sub="14天内需完成 · 点击筛选"  color="#f59e0b"
            clickable active={soonOnly}
            onClick={() => setSoonOnly(v => !v)}
          />
          <KpiCard icon="✅" label="已完成项目"  value={kpi.done}          sub="状态为已完成"       color="#ef4444" />
          <KpiCard icon="📊" label="平均项目进度" value={kpi.avg + "%"}     sub="完成度均值"         color="#8b5cf6" />
        </div>

        {/* ── 筛选栏 ────────────────────────────────────── */}
        <div className="bg-white rounded-2xl px-5 py-3.5 shadow-sm border border-gray-100 flex flex-wrap items-center gap-3">
          {/* 城市 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium whitespace-nowrap">城市</span>
            <div className="flex gap-1.5">
              {CITY_OPTIONS.map(c => (
                <button key={c} onClick={() => setCity(c)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    city === c
                      ? "bg-blue-50 border-blue-400 text-blue-600"
                      : "bg-slate-50 border-slate-200 text-slate-500 hover:border-blue-300"
                  }`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="w-px h-5 bg-slate-100" />

          {/* 状态 */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-medium whitespace-nowrap">状态</span>
            <div className="flex gap-1.5">
              {STATUS_OPTIONS.map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    status === s
                      ? "bg-blue-50 border-blue-400 text-blue-600"
                      : "bg-slate-50 border-slate-200 text-slate-500 hover:border-blue-300"
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="w-px h-5 bg-slate-100" />

          {/* 搜索 */}
          <div className="relative flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="搜索项目名称…"
              className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs border border-slate-200 bg-slate-50 outline-none focus:border-blue-400 focus:bg-white text-slate-700"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={12} />
              </button>
            )}
          </div>

          {/* 重置 */}
          {hasFilters && (
            <button onClick={reset}
              className="flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-medium border border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-500 transition-colors ml-auto">
              <RefreshCw size={11} />重置
            </button>
          )}
        </div>

        {/* ── 主内容区：左列项目列表 + 右列图表 ────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-5">

          {/* 左列：项目列表 */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-r-full bg-blue-500" />
                <span className="text-sm font-bold text-slate-700">项目进度总览</span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-600">
                  {filtered.length}
                </span>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center py-16 text-slate-400">
                <Search size={36} className="mb-3 opacity-30" />
                <p className="text-sm font-medium text-slate-500">没有符合条件的项目</p>
                <p className="text-xs mt-1">尝试调整筛选条件或重置</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {filtered.map(p => <ProjectCard key={p.id} project={p} />)}
              </div>
            )}
          </div>

          {/* 右列：图表面板 */}
          <div className="flex flex-col gap-4">

            {/* 各节点项目分布（水平条形图） */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-sm font-bold text-slate-700 mb-0.5">各节点项目分布</p>
              <p className="text-xs text-slate-400 mb-4">当前处于各节点的项目数量</p>
              {nodeChartData.every(d => d.count === 0) ? (
                <div className="flex items-center justify-center h-40 text-slate-300 text-xs">暂无数据</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart
                    data={nodeChartData}
                    layout="vertical"
                    margin={{ top: 0, right: 16, left: 4, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11, fill: "#94a3b8" }}
                      axisLine={false} tickLine={false} allowDecimals={false}
                    />
                    <YAxis
                      type="category" dataKey="name" width={100}
                      tick={{ fontSize: 10, fill: "#64748b" }}
                      axisLine={false} tickLine={false}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                      formatter={(v: unknown) => [`${v} 个项目`, "数量"]}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={14}>
                      {nodeChartData.map((d, i) => (
                        <Cell key={i} fill={d.count > 0 ? "rgba(79,110,247,0.75)" : "rgba(226,232,240,0.8)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 城市项目分布（甜甜圈图） */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-sm font-bold text-slate-700 mb-0.5">城市项目分布</p>
              <p className="text-xs text-slate-400 mb-2">各城市项目占比</p>
              {cityChartData.length === 0 ? (
                <div className="flex items-center justify-center h-40 text-slate-300 text-xs">暂无数据</div>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={cityChartData}
                      cx="50%" cy="45%"
                      innerRadius={50} outerRadius={72}
                      dataKey="value" paddingAngle={2} stroke="none"
                    >
                      {cityChartData.map((_, i) => (
                        <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Legend
                      iconType="circle" iconSize={8}
                      wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 12, borderRadius: 10, border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)" }}
                      formatter={(v: unknown) => [`${v} 个项目`, "数量"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* 公司主体分布（色块） */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
              <p className="text-sm font-bold text-slate-700 mb-0.5">公司项目分布</p>
              <p className="text-xs text-slate-400 mb-3">各公司主体项目数</p>
              {companyBlocks.length === 0 ? (
                <span className="text-xs text-slate-400">暂无数据</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {companyBlocks.map(([company, count], i) => {
                    const [bg, color] = COMPANY_PALETTE[i % COMPANY_PALETTE.length];
                    return (
                      <div
                        key={company}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold cursor-default hover:opacity-80 transition-opacity"
                        style={{ background: bg, color }}
                        title={`${company}：${count} 个项目`}
                      >
                        <span className="text-base font-bold block leading-tight">{count}</span>
                        <span className="font-normal opacity-80 break-all leading-tight" style={{ fontSize: 10 }}>{company}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
