"use client";

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import PageHeaderWithConfig from "@/components/shared/PageHeaderWithConfig";
import { Search, ChevronRight, MapPin, Plus, Pencil, Loader2, RotateCcw, Users, BarChart2, LayoutList, TableProperties } from "lucide-react";
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell, BarChart,
} from "recharts";

interface FundDisb {
  amount: string | number;
  isReceived: boolean;
  receivedDate?: string | null;
}
interface TalentAwardeeCard {
  id?: string;
  name?: string;
  status?: string;
  createdAt?: string;
  approvedAmount?: string | number | null;
  disbursements: FundDisb[];
}
interface TalentCycleCard {
  id?: string;
  name?: string;
  awardees: TalentAwardeeCard[];
}
interface TalentCompanyCard {
  id?: string;
  name?: string;
  cycles: TalentCycleCard[];
}
interface TalentProgram {
  id: string;
  name: string;
  level: string;
  region: string;
  isKeyProject: boolean;
  companies?: TalentCompanyCard[];
}

const LEVEL_ORDER = ["国家级", "省级", "市级", "区级"];
const LEVEL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  "国家级": { bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200" },
  "省级":   { bg: "bg-purple-50",  text: "text-purple-700",  border: "border-purple-200" },
  "市级":   { bg: "bg-blue-50",    text: "text-blue-700",    border: "border-blue-200" },
  "区级":   { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
};

const REGION_CHILDREN: Record<string, string[]> = {
  "江苏省": ["江苏省", "苏州市", "相城区"],
};

/** 统计表格视图 */
function TalentTableView({ programs }: { programs: TalentProgram[] }) {
  const [activeTab, setActiveTab] = useState<string>("__summary__");

  // 全局汇总：提取所有不重复的周期名称（排序）
  const allCycleNames = useMemo(() => {
    const names = new Set<string>();
    programs.forEach(p => (p.companies ?? []).forEach(c => (c.cycles ?? []).forEach(cy => { if (cy.name) names.add(cy.name); })));
    return Array.from(names).sort();
  }, [programs]);

  // 计算某项目在某周期的统计数据
  const getCycleStats = (project: TalentProgram, cycleName: string) => {
    const cycles = (project.companies ?? []).flatMap(c => (c.cycles ?? []).filter(cy => cy.name === cycleName));
    const awardees = cycles.flatMap(cy => cy.awardees ?? []);
    return {
      count: awardees.length,
      amount: awardees.reduce((acc, a) => acc + parseFloat(String(a.approvedAmount ?? 0)), 0) / 10000,
    };
  };

  // 某项目的人员明细
  const getProjectRows = (project: TalentProgram) => {
    const rows: { idx: number; cycleName: string; companyName: string; name: string; status: string; totalApproved: number; totalReceived: number }[] = [];
    let i = 1;
    (project.companies ?? []).forEach(company => {
      (company.cycles ?? []).forEach(cycle => {
        (cycle.awardees ?? []).forEach(awardee => {
          const disbs = awardee.disbursements ?? [];
          rows.push({
            idx: i++,
            cycleName: cycle.name ?? "",
            companyName: company.name ?? "",
            name: awardee.name ?? "",
            status: awardee.status ?? "待确认",
            totalApproved: disbs.reduce((acc, d) => acc + parseFloat(String(d.amount) || "0"), 0) / 10000,
            totalReceived: disbs.filter(d => d.isReceived).reduce((acc, d) => acc + parseFloat(String(d.amount) || "0"), 0) / 10000,
          });
        });
      });
    });
    return rows;
  };

  const statusColor = (s: string) => {
    if (s === "已完成" || s === "已拨付") return "text-emerald-600 bg-emerald-50";
    if (s === "进行中") return "text-blue-600 bg-blue-50";
    return "text-slate-500 bg-slate-50";
  };

  const activeProject = programs.find(p => p.id === activeTab);

  return (
    <div className="p-6">
      {/* Tab 导航 */}
      <div className="flex gap-0 border-b border-slate-200 mb-4 overflow-x-auto">
        <button type="button" onClick={() => setActiveTab("__summary__")}
          className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${activeTab === "__summary__" ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
          全局汇总
        </button>
        {programs.map(p => (
          <button key={p.id} type="button" onClick={() => setActiveTab(p.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${activeTab === p.id ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {p.name}
          </button>
        ))}
      </div>

      {/* 全局汇总表 */}
      {activeTab === "__summary__" && (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm min-w-full">
            <thead>
              <tr>
                <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-left text-slate-700 font-semibold whitespace-nowrap">项目名称</th>
                {allCycleNames.map(name => (
                  <th key={name} colSpan={2} className="border border-slate-300 bg-slate-100 px-3 py-2 text-center text-slate-700 font-semibold whitespace-nowrap">{name}</th>
                ))}
                {allCycleNames.length === 0 && <th className="border border-slate-300 bg-slate-100 px-3 py-2 text-slate-400">暂无周期数据</th>}
              </tr>
              <tr>
                <th className="border border-slate-300 bg-slate-50 px-3 py-2" />
                {allCycleNames.map(name => (
                  <React.Fragment key={name}>
                    <th className="border border-slate-300 bg-slate-50 px-3 py-2 text-center text-slate-600 font-medium whitespace-nowrap">入选人数</th>
                    <th className="border border-slate-300 bg-slate-50 px-3 py-2 text-center text-slate-600 font-medium whitespace-nowrap">拟资助金额(万)</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {programs.map((project, idx) => (
                <tr key={project.id} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                  <td className="border border-slate-300 px-3 py-2 font-medium text-slate-800 whitespace-nowrap">{project.name}</td>
                  {allCycleNames.map(name => {
                    const s = getCycleStats(project, name);
                    return (
                      <React.Fragment key={name}>
                        <td className="border border-slate-300 px-3 py-2 text-center text-slate-700">{s.count > 0 ? s.count : "-"}</td>
                        <td className="border border-slate-300 px-3 py-2 text-center text-slate-700">{s.amount > 0 ? s.amount.toFixed(2) : "-"}</td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              ))}
              {programs.length === 0 && (
                <tr><td colSpan={1 + allCycleNames.length * 2} className="px-4 py-8 text-center text-slate-400">暂无项目数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* 具体项目明细表 */}
      {activeTab !== "__summary__" && activeProject && (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm min-w-full">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-300 px-3 py-2 text-center text-slate-700 font-semibold w-12">序号</th>
                <th className="border border-slate-300 px-3 py-2 text-center text-slate-700 font-semibold whitespace-nowrap">批次/周期</th>
                <th className="border border-slate-300 px-3 py-2 text-center text-slate-700 font-semibold">姓名</th>
                <th className="border border-slate-300 px-3 py-2 text-center text-slate-700 font-semibold whitespace-nowrap">所属公司</th>
                <th className="border border-slate-300 px-3 py-2 text-center text-slate-700 font-semibold whitespace-nowrap">补贴总额(万)</th>
                <th className="border border-slate-300 px-3 py-2 text-center text-slate-700 font-semibold whitespace-nowrap">实际已下发(万)</th>
                <th className="border border-slate-300 px-3 py-2 text-center text-slate-700 font-semibold">状态</th>
              </tr>
            </thead>
            <tbody>
              {getProjectRows(activeProject).map(row => (
                <tr key={`${row.cycleName}-${row.name}-${row.idx}`} className={row.idx % 2 === 0 ? "bg-slate-50/40" : "bg-white"}>
                  <td className="border border-slate-300 px-3 py-2 text-center text-slate-500">{row.idx}</td>
                  <td className="border border-slate-300 px-3 py-2 text-center whitespace-nowrap text-slate-700">{row.cycleName}</td>
                  <td className="border border-slate-300 px-3 py-2 text-center text-slate-800 font-medium whitespace-nowrap">{row.name || "-"}</td>
                  <td className="border border-slate-300 px-3 py-2 text-center text-slate-600 whitespace-nowrap">{row.companyName || "-"}</td>
                  <td className="border border-slate-300 px-3 py-2 text-center text-slate-700">{row.totalApproved > 0 ? row.totalApproved.toFixed(2) : "-"}</td>
                  <td className="border border-slate-300 px-3 py-2 text-center text-emerald-700">{row.totalReceived > 0 ? row.totalReceived.toFixed(2) : "-"}</td>
                  <td className="border border-slate-300 px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor(row.status)}`}>{row.status}</span>
                  </td>
                </tr>
              ))}
              {getProjectRows(activeProject).length === 0 && (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">该项目暂无人员数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const PIE_COLORS = ["#ef4444", "#a855f7", "#3b82f6", "#10b981", "#f59e0b", "#6b7280"];

/** 数据大屏组件 */
function TalentDashboard({
  programs,
  onNavFilter,
}: {
  programs: TalentProgram[];
  onNavFilter: (type: "level" | "region", value: string) => void;
}) {
  const [trendFilter, setTrendFilter] = useState<"week" | "month" | "year" | "all">("year");

  const allCycles = useMemo(() => programs.flatMap(p => (p.companies ?? []).flatMap(c => c.cycles ?? [])), [programs]);
  const allAwardees = useMemo(() => allCycles.flatMap(cy => cy.awardees ?? []), [allCycles]);
  const allDisbs = useMemo(() => allAwardees.flatMap(a => a.disbursements ?? []), [allAwardees]);

  const totalProjects = programs.length;
  const totalCycles = allCycles.length;
  const totalAwardees = allAwardees.length;
  const totalApproved = useMemo(() => allDisbs.reduce((acc, d) => acc + parseFloat(String(d.amount) || "0"), 0), [allDisbs]);
  const totalReceived = useMemo(() => allDisbs.filter(d => d.isReceived).reduce((acc, d) => acc + parseFloat(String(d.amount) || "0"), 0), [allDisbs]);
  const fundProgress = totalApproved > 0 ? Math.min(100, (totalReceived / totalApproved) * 100) : 0;

  const levelData = useMemo(() => {
    const g: Record<string, number> = {};
    programs.forEach(p => { g[p.level] = (g[p.level] || 0) + 1; });
    return Object.entries(g).map(([name, value]) => ({ name, value }));
  }, [programs]);

  const regionData = useMemo(() => {
    const g: Record<string, number> = {};
    programs.forEach(p => { if (p.region) g[p.region] = (g[p.region] || 0) + 1; });
    return Object.entries(g).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [programs]);

  const trendData = useMemo(() => {
    const now = new Date();
    const map = new Map<string, { label: string; awardeeCount: number; receivedAmount: number }>();
    const addMonths = (months: number) => {
      for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        map.set(key, { label: `${d.getMonth() + 1}月`, awardeeCount: 0, receivedAmount: 0 });
      }
    };
    const addDays = (days: number) => {
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now.getTime() - i * 86400000);
        const key = d.toISOString().slice(0, 10);
        map.set(key, { label: `${d.getMonth() + 1}/${d.getDate()}`, awardeeCount: 0, receivedAmount: 0 });
      }
    };
    if (trendFilter === "week") addDays(7);
    else if (trendFilter === "month") addDays(30);
    else if (trendFilter === "year") addMonths(12);
    else addMonths(24);

    allAwardees.forEach(a => {
      if (a.createdAt) {
        const d = new Date(a.createdAt);
        const key = (trendFilter === "week" || trendFilter === "month")
          ? d.toISOString().slice(0, 10)
          : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        if (map.has(key)) map.get(key)!.awardeeCount += 1;
      }
      a.disbursements?.forEach(disb => {
        if (disb.isReceived && disb.receivedDate) {
          const rd = new Date(disb.receivedDate);
          const key = (trendFilter === "week" || trendFilter === "month")
            ? rd.toISOString().slice(0, 10)
            : `${rd.getFullYear()}-${String(rd.getMonth() + 1).padStart(2, "0")}`;
          if (map.has(key)) map.get(key)!.receivedAmount += parseFloat(String(disb.amount) || "0");
        }
      });
    });
    return Array.from(map.values());
  }, [allAwardees, trendFilter]);

  return (
    <div className="p-6 bg-slate-50/50 min-h-full">
      {/* 四大指标卡片 */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-xs text-slate-400 mb-1">项目总数</p>
          <p className="text-3xl font-bold text-slate-800">{totalProjects}</p>
          <p className="text-xs text-slate-400 mt-1">个申报项目</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-xs text-slate-400 mb-1">总周期数</p>
          <p className="text-3xl font-bold text-slate-800">{totalCycles}</p>
          <p className="text-xs text-slate-400 mt-1">个申报周期</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-xs text-slate-400 mb-1">覆盖总人数</p>
          <p className="text-3xl font-bold text-slate-800">{totalAwardees}</p>
          <p className="text-xs text-slate-400 mt-1">位入选人员</p>
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <p className="text-xs text-slate-400 mb-1">总资金大盘</p>
          <div className="flex items-baseline gap-1">
            <p className="text-2xl font-bold text-emerald-600">{(totalReceived / 10000).toFixed(2)}</p>
            <p className="text-sm text-slate-400">万 / {(totalApproved / 10000).toFixed(2)}万</p>
          </div>
          <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${fundProgress}%` }} />
          </div>
          <p className="text-xs text-emerald-500 mt-1">{fundProgress.toFixed(1)}% 已到账</p>
        </div>
      </div>

      {/* 趋势图 */}
      <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-slate-700">资金与申报人数趋势</h3>
          <div className="flex gap-1">
            {(["week", "month", "year", "all"] as const).map(f => (
              <button key={f} type="button" onClick={() => setTrendFilter(f)}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${trendFilter === f ? "bg-emerald-100 text-emerald-700 font-medium" : "text-slate-400 hover:bg-slate-50"}`}>
                {f === "week" ? "本周" : f === "month" ? "本月" : f === "year" ? "本年" : "全部"}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={trendData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#cbd5e1" />
            <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="#cbd5e1" />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="#cbd5e1" tickFormatter={(v: number) => `${(v / 10000).toFixed(0)}万`} />
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <Tooltip formatter={(v: any, name: any) => {
              const val = typeof v === "number" ? v : 0;
              return [name === "receivedAmount" ? `${(val / 10000).toFixed(2)}万` : val, name === "awardeeCount" ? "申报人数" : "到账资金"];
            }} />
            <Legend formatter={(n: string) => n === "awardeeCount" ? "申报人数" : "到账资金"} />
            <Bar yAxisId="left" dataKey="awardeeCount" fill="#6ee7b7" radius={[3, 3, 0, 0]} />
            <Line yAxisId="right" type="monotone" dataKey="receivedAmount" stroke="#059669" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* 分布图 */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">级别分布</h3>
          <p className="text-xs text-slate-400 mb-3">点击扇形可跳转筛选</p>
          {levelData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={levelData} cx="50%" cy="50%" outerRadius={75} dataKey="value"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onClick={(d: any) => { if (d?.name) onNavFilter("level", d.name as string); }}>
                  {levelData.map((entry, i) => <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} cursor="pointer" />)}
                </Pie>
                <Legend />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">暂无数据</div>
          )}
        </div>
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700 mb-1">地区分布</h3>
          <p className="text-xs text-slate-400 mb-3">点击条形可跳转筛选</p>
          {regionData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={regionData} layout="vertical" margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="#cbd5e1" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#cbd5e1" width={55} />
                <Tooltip />
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Bar dataKey="value" fill="#34d399" radius={[0, 3, 3, 0]} cursor="pointer"
                  onClick={(d: any) => { if (d?.name) onNavFilter("region", d.name as string); }} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm">暂无数据</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 简易 Switch 组件 */
function KeySwitch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); onChange(); }}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none ${
        checked ? "bg-orange-400" : "bg-gray-300"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

export default function TalentDeclarationPage() {
  const router = useRouter();

  const [programs,      setPrograms]      = useState<TalentProgram[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [searchQuery,   setSearchQuery]   = useState("");
  const [activeRegion,  setActiveRegion]  = useState("全部");
  const [activeLevel,   setActiveLevel]   = useState("全部");
  const [showKeyOnly,   setShowKeyOnly]   = useState(true);
  const [togglingId,    setTogglingId]    = useState<string | null>(null);
  const [viewMode,      setViewMode]      = useState<"nav" | "dashboard" | "table">("nav");

  const regionOptions = ["全部", "全国", "江苏省", "上海市", "深圳市"];
  const levelOptions  = ["全部", ...LEVEL_ORDER];

  // 从数据库加载项目
  useEffect(() => {
    fetch("/api/talent-declaration")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setPrograms(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  /** 切换当期重点 — 乐观更新 */
  const toggleKeyProject = useCallback(async (id: string, current: boolean) => {
    setTogglingId(id);
    // 乐观更新
    setPrograms(prev => prev.map(p => p.id === id ? { ...p, isKeyProject: !current } : p));
    try {
      const res = await fetch(`/api/talent-declaration/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isKeyProject: !current }),
      });
      if (!res.ok) throw new Error("保存失败");
    } catch {
      // 回滚
      setPrograms(prev => prev.map(p => p.id === id ? { ...p, isKeyProject: current } : p));
    } finally {
      setTogglingId(null);
    }
  }, []);

  const filteredPrograms = useMemo(() => {
    return programs.filter(program => {
      const matchSearch = program.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchLevel  = activeLevel === "全部" || program.level === activeLevel;
      const regionGroup = REGION_CHILDREN[activeRegion];
      const matchActiveRegion = activeRegion === "全部" ||
        (regionGroup ? regionGroup.includes(program.region) : program.region === activeRegion);
      const matchKey = !showKeyOnly || program.isKeyProject;
      return matchSearch && matchLevel && matchActiveRegion && matchKey;
    });
  }, [programs, searchQuery, activeLevel, activeRegion, showKeyOnly]);

  const isSearching = searchQuery.length > 0;

  const groupedPrograms = useMemo(() => {
    const groups: Record<string, TalentProgram[]> = {};
    for (const level of LEVEL_ORDER) {
      const items = filteredPrograms
        .filter(p => p.level === level)
        // 重点项目置顶
        .sort((a, b) => (a.isKeyProject === b.isKeyProject ? 0 : a.isKeyProject ? -1 : 1));
      if (items.length > 0) groups[level] = items;
    }
    const otherItems = filteredPrograms
      .filter(p => !LEVEL_ORDER.includes(p.level))
      .sort((a, b) => (a.isKeyProject === b.isKeyProject ? 0 : a.isKeyProject ? -1 : 1));
    if (otherItems.length > 0) groups["其他"] = otherItems;
    return groups;
  }, [filteredPrograms]);

  /** 渲染单张卡片（搜索/分组两种模式复用） */
  const renderCard = (program: TalentProgram, alwaysShowActions = false) => {
    const lc = LEVEL_COLORS[program.level] || LEVEL_COLORS["区级"];
    const isKey = program.isKeyProject;
    const isToggling = togglingId === program.id;

    // 汇总推算
    const allCycles = (program.companies ?? []).flatMap(c => c.cycles ?? []);
    const allAwardees = allCycles.flatMap(cy => cy.awardees ?? []);
    const allDisbs = allAwardees.flatMap(a => a.disbursements ?? []);
    const totalCycles = allCycles.length;
    const totalAwardees = allAwardees.length;
    const totalApproved = allDisbs.reduce((acc, d) => acc + parseFloat(String(d.amount) || "0"), 0);
    const totalReceived = allDisbs.filter(d => d.isReceived).reduce((acc, d) => acc + parseFloat(String(d.amount) || "0"), 0);
    const progress = totalApproved > 0 ? Math.min(100, (totalReceived / totalApproved) * 100) : 0;

    const actionButtons = (
      <>
        <div className="flex items-center gap-1.5">
          <KeySwitch checked={isKey} onChange={() => toggleKeyProject(program.id, isKey)} disabled={isToggling} />
          <span className={`text-xs font-medium ${isKey ? "text-orange-600" : "text-slate-400"}`}>
            {isToggling ? "…" : "当期重点"}
          </span>
        </div>
        <div className="h-4 w-px bg-slate-200" />
        <button
          onClick={() => router.push(`/dashboard/talent-declaration/${program.id}?edit=true`)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors border border-slate-200"
        >
          <Pencil size={13} /> 编辑内容
        </button>
        <button
          onClick={() => router.push(`/dashboard/talent-declaration/${program.id}`)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
          style={{ border: "1px solid #dbeafe" }}
        >
          进入申报 <ChevronRight size={14} />
        </button>
      </>
    );

    return (
      <div
        key={program.id}
        className={`relative w-full rounded-xl p-5 flex items-center group ${
          isKey ? "bg-orange-50/60 border border-orange-200" : "bg-white"
        }`}
        style={isKey ? {} : { border: "1px solid #e2e8f0" }}
      >
        {/* 左侧：名称 + 标签 */}
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-slate-800 truncate">{program.name}</h3>
            {isKey && (
              <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-600 border border-orange-300">
                当期重点
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium border ${lc.bg} ${lc.text} ${lc.border}`}>{program.level}</span>
            {program.region && (
              <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs border border-emerald-200 flex items-center gap-1">
                <MapPin size={10}/>{program.region}
              </span>
            )}
          </div>
        </div>

        {alwaysShowActions ? (
          /* 搜索模式：直接显示操作按钮 */
          <div className="flex items-center gap-3 shrink-0">{actionButtons}</div>
        ) : (
          <>
            {/* 默认状态：数据透视区 */}
            <div className="flex items-center gap-6 shrink-0 transition-opacity duration-200 group-hover:opacity-0 group-hover:pointer-events-none">
              <div className="flex items-center gap-1.5 text-slate-600">
                <RotateCcw size={13} className="text-slate-400" />
                <span className="text-sm font-semibold">{totalCycles}</span>
                <span className="text-xs text-slate-400">期</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-600">
                <Users size={13} className="text-slate-400" />
                <span className="text-sm font-semibold">{totalAwardees}</span>
                <span className="text-xs text-slate-400">人</span>
              </div>
              <div className="flex flex-col gap-1 min-w-[130px]">
                <span className="text-xs text-slate-400">
                  资金进度: {(totalReceived / 10000).toFixed(2)}万 / {(totalApproved / 10000).toFixed(2)}万
                </span>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>

            {/* Hover 状态：操作按钮区（绝对定位覆盖右侧） */}
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-3 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-200">
              {actionButtons}
            </div>
          </>
        )}
      </div>
    );
  };

  const handleNavFilter = useCallback((type: "level" | "region", value: string) => {
    if (type === "level") setActiveLevel(value);
    else setActiveRegion(value);
    setViewMode("nav");
  }, []);

  return (
    <div className="flex-1 overflow-auto bg-[#f6fcf8]">
      {/* 页面头部 — 配置链接复用重大项目组件 */}
      <PageHeaderWithConfig
        pageId="talent-declaration"
        defaultTitle="人才申报项目导航"
        defaultDescription="汇聚各级政府人才政策，支持级别与地域联合筛选"
        variant="light"
        rightSlot={
          <button
            onClick={() => router.push("/dashboard/talent-declaration/new")}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            <Plus size={15} /> 新建项目
          </button>
        }
      />
      {/* 视图切换器 */}
      <div className="px-8 py-3 bg-emerald-50/80 border-b border-emerald-100 flex justify-center">
        <div className="inline-flex items-center bg-white rounded-lg p-1 shadow-sm border border-emerald-100">
          <button type="button" onClick={() => setViewMode("nav")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "nav" ? "bg-emerald-50 text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            <LayoutList size={14} /> 导航视图
          </button>
          <button type="button" onClick={() => setViewMode("dashboard")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "dashboard" ? "bg-emerald-50 text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            <BarChart2 size={14} /> 数据大屏
          </button>
          <button type="button" onClick={() => setViewMode("table")}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${viewMode === "table" ? "bg-emerald-50 text-emerald-700 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            <TableProperties size={14} /> 统计表格
          </button>
        </div>
      </div>

      {/* 数据大屏 */}
      {viewMode === "dashboard" && (
        <TalentDashboard programs={programs} onNavFilter={handleNavFilter} />
      )}

      {/* 统计表格 */}
      {viewMode === "table" && (
        <TalentTableView programs={programs} />
      )}

      {/* 导航视图 */}
      {viewMode === "nav" && <div className="p-6 bg-[#f6fcf8]">
        {/* 搜索栏 */}
        <div className="mb-4 bg-white p-4 rounded-xl" style={{ border: "1px solid #e2e8f0" }}>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="搜索项目名称..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-lg text-sm bg-slate-50 text-slate-800 outline-none focus:ring-2 focus:ring-blue-200"
              style={{ border: "1px solid #e2e8f0" }}
            />
          </div>
        </div>

        {/* 地区 + 级别 + 当期重点筛选 */}
        <div className="mb-5 bg-white px-4 py-3 rounded-xl flex flex-col gap-2" style={{ border: "1px solid #e2e8f0" }}>
          {/* 地区行 */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-400 shrink-0 w-8">地区</span>
            <div className="flex flex-wrap gap-2">
              {regionOptions.map(region => (
                <button
                  key={region}
                  onClick={() => setActiveRegion(region)}
                  className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                    activeRegion === region
                      ? "bg-blue-50 border border-blue-200 text-blue-600 font-medium"
                      : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {region}
                </button>
              ))}
            </div>
          </div>
          {/* 级别行 */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-400 shrink-0 w-8">级别</span>
            <div className="flex flex-wrap gap-2">
              {levelOptions.map(level => (
                <button
                  key={level}
                  onClick={() => setActiveLevel(level)}
                  className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                    activeLevel === level
                      ? "bg-blue-50 border border-blue-200 text-blue-600 font-medium"
                      : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
          {/* 当期重点行 */}
          <div className="flex items-center gap-3 pt-0.5">
            <span className="text-xs font-medium text-slate-400 shrink-0 w-8">重点</span>
            <button
              onClick={() => setShowKeyOnly(v => !v)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                showKeyOnly
                  ? "bg-orange-100 text-orange-700 border-orange-300"
                  : "bg-white text-gray-500 border-gray-200 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200"
              }`}
            >
              🔥 当期重点
            </button>
          </div>
        </div>

        {/* 加载中 */}
        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader2 size={20} className="animate-spin mr-2" /> 加载中...
          </div>
        ) : programs.length === 0 ? (
          /* 空状态 */
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-slate-400 text-sm mb-4">还没有任何申报项目，点击「新建项目」开始创建</p>
            <button
              onClick={() => router.push("/dashboard/talent-declaration/new")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors"
            >
              <Plus size={15} /> 新建项目
            </button>
          </div>
        ) : (
          <>
            {/* 结果统计 */}
            <p className="text-xs text-slate-400 mb-4">
              共 {filteredPrograms.length} 个申报项目
              {showKeyOnly && <span className="ml-2 text-orange-500 font-medium">· 仅显示当期重点</span>}
            </p>

            {/* 搜索模式：平铺展示 */}
            {isSearching ? (
              <div className="flex flex-col gap-3">
                {filteredPrograms.map(program => renderCard(program, true))}
                {filteredPrograms.length === 0 && (
                  <div className="text-center py-16 text-slate-400">未找到匹配的人才申报项目</div>
                )}
              </div>
            ) : (
              /* 默认模式：按级别分组展示，重点项目置顶 */
              <div className="flex flex-col gap-8">
                {Object.entries(groupedPrograms).map(([level, progs]) => {
                  const lc = LEVEL_COLORS[level] || LEVEL_COLORS["区级"];
                  return (
                    <div key={level}>
                      <div className="flex items-center gap-2 mb-4">
                        <span className={`px-3 py-1 rounded-lg text-sm font-bold border ${lc.bg} ${lc.text} ${lc.border}`}>{level}</span>
                        <span className="text-xs text-slate-400">{progs.length} 个项目</span>
                      </div>
                      <div className="flex flex-col gap-3">
                        {progs.map(program => renderCard(program, false))}
                      </div>
                    </div>
                  );
                })}
                {Object.keys(groupedPrograms).length === 0 && (
                  <div className="text-center py-16 text-slate-400">未找到匹配的人才申报项目</div>
                )}
              </div>
            )}
          </>
        )}
      </div>}
    </div>
  );
}
