"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Network, LayoutDashboard, ChevronRight, ChevronDown, Building2,
  Users, Globe, MapPin, Search, ExternalLink, X, Info,
  TrendingUp, FileText, Calendar, RefreshCw, Loader2,
  Newspaper, Shield, Lightbulb, Plus, Pencil, Trash2,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import PageHeaderWithConfig from "@/components/shared/PageHeaderWithConfig";
import ReactECharts from "echarts-for-react";
import Link from "next/link";
import {
  createOdcInstitution,
  upsertOdcInstitution,
  deleteOdcInstitution,
  getSubDepartments,
  getLeaders,
  createSubDepartment,
  updateSubDepartment,
  deleteSubDepartment,
  createLeader,
  updateLeader,
  deleteLeader,
  seedMockInstitutionData,
  updateInstitutionWebsite,
  getOdcLines,
  createOdcLine,
  updateOdcLine,
  deleteOdcLine,
  seedDefaultOdcLines,
  getInstitutionIntelligence,
  generateInstitutionIntelligence,
  getAvailableReceptions,
  linkReceptionsToInstitution,
  getLinkedReceptionsDetails,
} from "@/app/actions/odc";

// ══════════════════════════════════════════════════════════════════
// 数据结构
// ══════════════════════════════════════════════════════════════════

interface OdcDivision {
  name: string;
  assigneeFeishuId?: string;
  assigneeName?: string;
}

interface OdcNode {
  id: string;
  jurisdiction: string;  // '中央部委' | '江苏省' | '上海市' | '广东省' | '湖北省'
  verticalLine: string;  // '工信条线' | '发改条线' | '商务条线' | '科技条线' | '人社条线' | '人民政府' | ...
  level: string;         // '国家级' | '省级' | '市级' | '区级' | '板块'
  regionName?: string;   // 可选，兼容旧数据
  fullName: string;
  shortName: string;
  divisions: OdcDivision[];
}

interface OdcIntelligence {
  nodeId: string;
  officialUrl?: string;
  departments?: { name: string; desc: string }[];
  leadership?: { name: string; title: string }[];
  recentNews?: { title: string; date: string; url?: string }[];
  aiInsights?: string;
}

interface ReceptionRecord {
  id: string;
  title: string;
  startTime: string;
  level: string;
  purpose: string;
}

interface AdminUser {
  id: string;
  name: string;
}

interface OdcSubDeptFE {
  id: string;
  institutionId: string;
  name: string;
  responsibilities?: string | null;
  contactPersonId?: string | null;
  externalContactName?: string | null;
  parentId?: string | null;
  sortOrder: number;
}

interface OdcLeaderFE {
  id: string;
  institutionId: string;
  name: string;
  title: string;
  avatarUrl?: string | null;
  bio?: string | null;
  profileUrl?: string | null;
  sortOrder: number;
}

interface SubDeptTree extends OdcSubDeptFE {
  children: SubDeptTree[];
}

// ══════════════════════════════════════════════════════════════════
// Mock 数据
// ══════════════════════════════════════════════════════════════════

// 100% 真实 ODC 图谱数据（严格 1:1 还原用户思维导图，禁止添加任何幻觉数据）
const ODC_NODES: OdcNode[] = [
  // --- 中央部委 (仅占位，不编造处室) ---
  { id: 'c1', jurisdiction: '中央部委', verticalLine: '工信条线', level: '国家级', shortName: '工信部', fullName: '工业和信息化部', divisions: [] },
  { id: 'c2', jurisdiction: '中央部委', verticalLine: '发改条线', level: '国家级', shortName: '发改委', fullName: '国家发展和改革委员会', divisions: [] },
  { id: 'c3', jurisdiction: '中央部委', verticalLine: '科技条线', level: '国家级', shortName: '科技部', fullName: '科学技术部', divisions: [] },

  // --- 江苏省 (省级) ---
  { id: 'js1', jurisdiction: '江苏省', verticalLine: '人民政府', level: '省级', shortName: '省委/省政府', fullName: '江苏省委/省政府', divisions: [{ name: '外事办', assigneeName: 'Yuting Wang' }] },
  { id: 'js2', jurisdiction: '江苏省', verticalLine: '工信条线', level: '省级', shortName: '省工信厅', fullName: '江苏省工业和信息化厅', divisions: [{ name: '产业升级处', assigneeName: 'Yuting Wang' }, { name: '装备工业处' }, { name: '信息基础设施处' }] },
  { id: 'js3', jurisdiction: '江苏省', verticalLine: '商务条线', level: '省级', shortName: '省商务厅', fullName: '江苏省商务厅', divisions: [{ name: '对外投资和经济合作处', assigneeName: 'Yuting Wang' }] },
  { id: 'js4', jurisdiction: '江苏省', verticalLine: '发改条线', level: '省级', shortName: '省发改委', fullName: '江苏省发展和改革委员会', divisions: [{ name: '产业发展处', assigneeName: 'Yuting Wang' }, { name: '重大项目管理处' }] },
  { id: 'js5', jurisdiction: '江苏省', verticalLine: '科技条线', level: '省级', shortName: '省科技厅', fullName: '江苏省科学技术厅', divisions: [{ name: '成果转化处', assigneeName: 'Yuting Wang' }, { name: '生产力促进中心' }, { name: '高新技术处' }] },

  // --- 江苏省 (苏州市 - 市级) ---
  { id: 'sz1', jurisdiction: '江苏省', verticalLine: '人民政府', level: '市级', shortName: '市委/市政府', fullName: '苏州市委/市政府', divisions: [{ name: '办公室', assigneeName: 'Yuting Wang' }] },
  { id: 'sz2', jurisdiction: '江苏省', verticalLine: '工信条线', level: '市级', shortName: '市工信局', fullName: '苏州市工业和信息化局', divisions: [{ name: '产业政策与法规处', assigneeName: 'Yuting Wang' }, { name: '装备工业处', assigneeName: 'Zoe Gu' }, { name: '人工智能发展处 (大数据处)', assigneeName: 'Yuting Wang' }, { name: '企业服务处', assigneeName: 'Zoe Gu' }, { name: '电子信息产业处', assigneeName: 'Zoe Gu' }, { name: '信息化推进处', assigneeName: 'Zoe Gu' }] },
  { id: 'sz3', jurisdiction: '江苏省', verticalLine: '科技条线', level: '市级', shortName: '市科技局', fullName: '苏州市科学技术局', divisions: [{ name: '政策法规处', assigneeName: 'Yuting Wang' }, { name: '高新技术处', assigneeName: 'Zoe Gu' }, { name: '科研机构处 (科技成果处)', assigneeName: 'Zoe Gu' }, { name: '市外国专家局 (科技人才处)', assigneeName: 'Zoe Gu' }, { name: '生产力促进中心', assigneeName: 'Zoe Gu' }] },
  { id: 'sz4', jurisdiction: '江苏省', verticalLine: '发改条线', level: '市级', shortName: '市发改委', fullName: '苏州市发展和改革委员会', divisions: [{ name: '发展战略和规划处', assigneeName: 'Yuting Wang' }, { name: '重大项目管理处', assigneeName: 'Yuting Wang' }, { name: '创新和高技术发展处' }] },
  { id: 'sz5', jurisdiction: '江苏省', verticalLine: '其他条线', level: '市级', shortName: '市网信办', fullName: '苏州市委网信办', divisions: [{ name: '新媒体融合中心', assigneeName: 'Yuting Wang' }] },
  { id: 'sz6', jurisdiction: '江苏省', verticalLine: '商务条线', level: '市级', shortName: '市商务局', fullName: '苏州市商务局', divisions: [{ name: '外商投资企业服务处', assigneeName: 'Yuting Wang' }] },
  { id: 'sz7', jurisdiction: '江苏省', verticalLine: '其他条线', level: '市级', shortName: '市工商联', fullName: '苏州市工商业联合会', divisions: [{ name: '组织建设部', assigneeName: 'Yuting Wang' }, { name: '经济联络部' }] },

  // --- 江苏省 (相城区 - 区级) ---
  { id: 'xc1', jurisdiction: '江苏省', verticalLine: '人民政府', level: '区级', shortName: '区委/区政府', fullName: '相城区委/区政府', divisions: [{ name: '组织部', assigneeName: 'Yuting Wang' }, { name: '办公室', assigneeName: 'Yuting Wang' }, { name: '政协' }, { name: '外事办' }] },
  { id: 'xc2', jurisdiction: '江苏省', verticalLine: '发改条线', level: '区级', shortName: '区发改委', fullName: '相城区发展和改革委员会', divisions: [{ name: '产业发展科', assigneeName: 'Yuting Wang' }, { name: '重大项目服务中心' }] },
  { id: 'xc3', jurisdiction: '江苏省', verticalLine: '商务条线', level: '区级', shortName: '区商务局', fullName: '相城区商务局', divisions: [{ name: '商贸科', assigneeName: 'Zoe Gu' }, { name: '外经贸科' }] },
  { id: 'xc4', jurisdiction: '江苏省', verticalLine: '工信条线', level: '区级', shortName: '区工信局', fullName: '相城区工业和信息化局', divisions: [{ name: '智能制造科', assigneeName: 'Zoe Gu' }, { name: '产业协调科' }] },
  { id: 'xc5', jurisdiction: '江苏省', verticalLine: '科技条线', level: '区级', shortName: '区科技局', fullName: '相城区科学技术局', divisions: [{ name: '高新技术科', assigneeName: 'Zoe Gu' }, { name: '科技研发与合作交流科' }, { name: '科技人才科' }] },
  { id: 'xc6', jurisdiction: '江苏省', verticalLine: '市场监管', level: '区级', shortName: '区市监局', fullName: '相城区市场监督管理局', divisions: [{ name: '质量与标准监督科', assigneeName: 'Zoe Gu' }] },
  { id: 'xc7', jurisdiction: '江苏省', verticalLine: '人社条线', level: '区级', shortName: '区人社局', fullName: '相城区人力资源和社会保障局', divisions: [{ name: '社会保险科 (政策法规科)', assigneeName: 'Yara Ying' }, { name: '劳动关系监察与仲裁科' }] },
  { id: 'xc8', jurisdiction: '江苏省', verticalLine: '民政条线', level: '区级', shortName: '区民政局', fullName: '相城区民政局', divisions: [{ name: '社会救助和福利科', assigneeName: 'Yara Ying' }] },

  // --- 江苏省 (高铁新城 - 板块) ---
  { id: 'gt1', jurisdiction: '江苏省', verticalLine: '人民政府', level: '板块', shortName: '管委会', fullName: '苏州高铁新城管委会', divisions: [{ name: '领导班子', assigneeName: 'Yuting Wang' }, { name: '接待办', assigneeName: 'Yuting Wang' }, { name: '综合办', assigneeName: 'Zoe Gu' }] },
  { id: 'gt2', jurisdiction: '江苏省', verticalLine: '商务条线', level: '板块', shortName: '科技商务局', fullName: '高铁新城科技商务局', divisions: [{ name: '招商科', assigneeName: 'Zoe Gu' }, { name: '人才科', assigneeName: 'Yara Ying' }] },
  { id: 'gt3', jurisdiction: '江苏省', verticalLine: '组织人事', level: '板块', shortName: '组织人事局', fullName: '高铁新城组织人事局', divisions: [{ name: '党委', assigneeName: 'Zoe Gu' }, { name: '团委', assigneeName: 'Yara Ying' }, { name: '文明办', assigneeName: 'Yara Ying' }, { name: '慈善会', assigneeName: 'Yara Ying' }] },
  { id: 'gt4', jurisdiction: '江苏省', verticalLine: '发改条线', level: '板块', shortName: '经济发展局', fullName: '高铁新城经济发展局', divisions: [{ name: '经济发展局', assigneeName: 'Yara Ying' }] },
  { id: 'gt5', jurisdiction: '江苏省', verticalLine: '企业服务', level: '板块', shortName: '经服中心', fullName: '高铁新城企业服务中心', divisions: [{ name: '经服中心', assigneeName: 'Zoe Gu' }] },

  // --- 上海市 ---
  { id: 'sh1', jurisdiction: '上海市', verticalLine: '其他条线', level: '区级', shortName: '浦东统计局', fullName: '浦东新区统计局', divisions: [{ name: '浦东统计局', assigneeName: 'Yuting Wang' }] },
  { id: 'sh2', jurisdiction: '上海市', verticalLine: '其他条线', level: '区级', shortName: '金桥管理局', fullName: '上海金桥经济技术开发区管委会', divisions: [{ name: '金桥管理局', assigneeName: 'Yuting Wang' }] },
  { id: 'sh3', jurisdiction: '上海市', verticalLine: '人民政府', level: '区级', shortName: '区委/区政府', fullName: '嘉定区委/区政府', divisions: [{ name: '区委/区政府', assigneeName: 'Yuting Wang' }] },
  { id: 'sh4', jurisdiction: '上海市', verticalLine: '投资促进', level: '区级', shortName: '投促中心', fullName: '嘉定区投资促进中心', divisions: [{ name: '投促中心' }] },

  // --- 广东省 (含广州、深圳) ---
  { id: 'gd1', jurisdiction: '广东省', verticalLine: '科技条线', level: '区级', shortName: '增城科创局', fullName: '广州市增城区科技创新局', divisions: [{ name: '科创局', assigneeName: 'Yuting Wang' }] },
  { id: 'gd2', jurisdiction: '广东省', verticalLine: '人民政府', level: '区级', shortName: '增城管委会', fullName: '广州市增城区管委会', divisions: [{ name: '管委会' }] },
  { id: 'gd3', jurisdiction: '广东省', verticalLine: '其他条线', level: '区级', shortName: '增城统计局', fullName: '广州市增城区统计局', divisions: [{ name: '统计局' }] },
  { id: 'gd4', jurisdiction: '广东省', verticalLine: '工信条线', level: '区级', shortName: '增城工信局', fullName: '广州市增城区工业和信息化局', divisions: [{ name: '工信局' }] },
  { id: 'gd5', jurisdiction: '广东省', verticalLine: '人社条线', level: '区级', shortName: '增城人社局', fullName: '广州市增城区人力资源和社会保障局', divisions: [{ name: '人社局' }] },
  { id: 'gd6', jurisdiction: '广东省', verticalLine: '其他条线', level: '区级', shortName: '龙岗汽车办', fullName: '深圳市龙岗区汽车办', divisions: [{ name: '汽车办', assigneeName: 'Yuting Wang' }] },
  { id: 'gd7', jurisdiction: '广东省', verticalLine: '其他条线', level: '区级', shortName: '龙岗经科办', fullName: '深圳市龙岗区经科办', divisions: [{ name: '经科办' }] },
  { id: 'gd8', jurisdiction: '广东省', verticalLine: '发改条线', level: '区级', shortName: '坪山发改局', fullName: '深圳市坪山区发展和改革局', divisions: [{ name: '发改局', assigneeName: 'Zoe Gu' }] },
  { id: 'gd9', jurisdiction: '广东省', verticalLine: '其他条线', level: '区级', shortName: '坪山汽车办', fullName: '深圳市坪山区汽车办', divisions: [{ name: '汽车办' }] },
  { id: 'gd10', jurisdiction: '广东省', verticalLine: '人社条线', level: '区级', shortName: '坪山人力局', fullName: '深圳市坪山区人力资源局', divisions: [{ name: '人力资源局' }] },

  // --- 湖北省 ---
  { id: 'hb1', jurisdiction: '湖北省', verticalLine: '人民政府', level: '区级', shortName: '经开区委/区政府', fullName: '武汉经济技术开发区区委/管委会', divisions: [{ name: '区委/区政府', assigneeName: 'Yuting Wang' }] },
];

// 情报数据（从数据库实时加载，此处不预置任何假数据）
const MOCK_INTELLIGENCE: Record<string, OdcIntelligence> = {};

// ══════════════════════════════════════════════════════════════════
// 样式常量
// ══════════════════════════════════════════════════════════════════

const LINE_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  // 旧版名称（静态兜底数据）
  "工信条线": { bg: "rgba(37,99,235,0.08)",   border: "rgba(37,99,235,0.25)",   text: "#2563eb", dot: "#3b82f6" },
  "发改条线": { bg: "rgba(124,58,237,0.08)",  border: "rgba(124,58,237,0.25)",  text: "#7c3aed", dot: "#8b5cf6" },
  "商务条线": { bg: "rgba(5,150,105,0.08)",   border: "rgba(5,150,105,0.25)",   text: "#059669", dot: "#10b981" },
  "科技条线": { bg: "rgba(217,119,6,0.08)",   border: "rgba(217,119,6,0.25)",   text: "#d97706", dot: "#f59e0b" },
  "人社条线": { bg: "rgba(220,38,38,0.08)",   border: "rgba(220,38,38,0.25)",   text: "#dc2626", dot: "#ef4444" },
  "人民政府": { bg: "rgba(15,118,110,0.08)",  border: "rgba(15,118,110,0.25)",  text: "#0f766e", dot: "#14b8a6" },
  "其他条线": { bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.25)", text: "#475569", dot: "#64748b" },
  "市场监管": { bg: "rgba(234,88,12,0.08)",   border: "rgba(234,88,12,0.25)",   text: "#ea580c", dot: "#f97316" },
  "民政条线": { bg: "rgba(168,85,247,0.08)",  border: "rgba(168,85,247,0.25)",  text: "#a855f7", dot: "#c084fc" },
  "组织人事": { bg: "rgba(236,72,153,0.08)",  border: "rgba(236,72,153,0.25)",  text: "#ec4899", dot: "#f472b6" },
  "企业服务": { bg: "rgba(20,184,166,0.08)",  border: "rgba(20,184,166,0.25)",  text: "#14b8a6", dot: "#2dd4bf" },
  "投资促进": { bg: "rgba(234,179,8,0.08)",   border: "rgba(234,179,8,0.25)",   text: "#ca8a04", dot: "#eab308" },
  // 新版国家标准简称（DB 硬重置后使用）
  "工信":           { bg: "rgba(37,99,235,0.08)",   border: "rgba(37,99,235,0.25)",   text: "#2563eb", dot: "#3b82f6" },
  "发改":           { bg: "rgba(124,58,237,0.08)",  border: "rgba(124,58,237,0.25)",  text: "#7c3aed", dot: "#8b5cf6" },
  "商务":           { bg: "rgba(5,150,105,0.08)",   border: "rgba(5,150,105,0.25)",   text: "#059669", dot: "#10b981" },
  "科技":           { bg: "rgba(217,119,6,0.08)",   border: "rgba(217,119,6,0.25)",   text: "#d97706", dot: "#f59e0b" },
  "人社":           { bg: "rgba(220,38,38,0.08)",   border: "rgba(220,38,38,0.25)",   text: "#dc2626", dot: "#ef4444" },
  "党委/政府办公":  { bg: "rgba(15,118,110,0.08)",  border: "rgba(15,118,110,0.25)",  text: "#0f766e", dot: "#14b8a6" },
  "其他":           { bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.25)", text: "#475569", dot: "#64748b" },
  "民政":           { bg: "rgba(168,85,247,0.08)",  border: "rgba(168,85,247,0.25)",  text: "#a855f7", dot: "#c084fc" },
  "企服/投促":      { bg: "rgba(20,184,166,0.08)",  border: "rgba(20,184,166,0.25)",  text: "#14b8a6", dot: "#2dd4bf" },
  "网信":           { bg: "rgba(99,102,241,0.08)",  border: "rgba(99,102,241,0.25)",  text: "#6366f1", dot: "#818cf8" },
  "数据":           { bg: "rgba(6,182,212,0.08)",   border: "rgba(6,182,212,0.25)",   text: "#0891b2", dot: "#22d3ee" },
  "教育":           { bg: "rgba(34,197,94,0.08)",   border: "rgba(34,197,94,0.25)",   text: "#16a34a", dot: "#4ade80" },
  "统战":           { bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.25)",   text: "#dc2626", dot: "#f87171" },
};

const LEVEL_COLORS: Record<string, string> = {
  "国家级": "#be123c",  // rose-700 — 深沉权威
  "省级":   "#6d28d9",  // purple-700 — 优雅省级
  "市级":   "#1d4ed8",  // blue-700 — 清爽市级
  "区级":   "#0e7490",  // cyan-700 — 稳重区级
  "板块":   "#b45309",  // amber-700 — 产业板块
};

const JURISDICTION_ICONS: Record<string, string> = {
  "中央部委": "🏛️",
  "江苏省":   "🌿",
  "上海市":   "🌆",
  "广东省":   "🌊",
  "湖北省":   "🏯",
  "北京":     "🏯",
};

const ALL_LINES   = [...new Set(ODC_NODES.map(n => n.verticalLine))];
const ALL_LEVELS  = ["国家级", "省级", "市级", "区级", "板块"];
const ALL_JURISDICTIONS = [...new Set(ODC_NODES.map(n => n.jurisdiction))];

// ══════════════════════════════════════════════════════════════════
// 组织架构辅助函数
// ══════════════════════════════════════════════════════════════════

function buildSubDeptTree(nodes: OdcSubDeptFE[], parentId: string | null = null): SubDeptTree[] {
  return nodes
    .filter(n => (n.parentId ?? null) === parentId)
    .map(n => ({ ...n, children: buildSubDeptTree(nodes, n.id) }));
}

function SubDeptNodeCard({
  node,
  adminUsers,
  onSave,
  onDelete,
  onAddChild,
}: {
  node: SubDeptTree;
  adminUsers: AdminUser[];
  onSave: (id: string, data: { name?: string; responsibilities?: string; contactPersonId?: string | null; externalContactName?: string | null }) => void;
  onDelete: (id: string) => void;
  onAddChild: (parentId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(node.name);
  const [editResp, setEditResp] = useState(node.responsibilities ?? "");
  const [editContact, setEditContact] = useState(node.contactPersonId ?? "");
  const [editExternal, setEditExternal] = useState(node.externalContactName ?? "");
  const hasAssignee = !!(node.contactPersonId || node.externalContactName);
  const momentaName = adminUsers.find(u => u.id === node.contactPersonId)?.name;

  return (
    <div className="flex flex-col items-start">
      {/* 节点卡片 */}
      <div className={`relative rounded-xl border-2 p-2.5 text-xs font-medium transition-all cursor-pointer min-w-[100px] max-w-[150px] ${
        hasAssignee
          ? "bg-blue-50 border-blue-400 text-blue-700 hover:shadow-md"
          : "bg-slate-50 border-slate-200 text-slate-500 hover:border-slate-300"
      }`}
        onClick={() => setEditing(true)}
      >
        <div className="font-medium leading-snug">{node.name}</div>
        {hasAssignee && (
          <div className="mt-1 text-[10px] leading-tight truncate">
            <span className="text-blue-500">{momentaName ?? "待分配"}</span>
            <span className="text-slate-300 mx-0.5">—</span>
            <span className="text-orange-500">{node.externalContactName ?? "待录入"}</span>
          </div>
        )}
      </div>

      {/* 子节点 */}
      {node.children.length > 0 && (
        <div className="ml-4 mt-2 border-l-2 border-slate-200 pl-3 space-y-2">
          {node.children.map(child => (
            <SubDeptNodeCard key={child.id} node={child} adminUsers={adminUsers}
              onSave={onSave} onDelete={onDelete} onAddChild={onAddChild} />
          ))}
        </div>
      )}

      {/* 编辑弹窗 */}
      {editing && (
        <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setEditing(false); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5 flex flex-col gap-3">
            <h4 className="text-sm font-semibold text-slate-800">编辑科室</h4>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">科室名称</label>
              <input className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-200"
                value={editName} onChange={e => setEditName(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">具体职责</label>
              <textarea rows={3} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                value={editResp} onChange={e => setEditResp(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">对接人员（我方）</label>
              <select className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 outline-none"
                value={editContact} onChange={e => setEditContact(e.target.value)}>
                <option value="">— 清除对接 —</option>
                {adminUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">对方对接人 (微信/姓名)</label>
              <input className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-orange-200"
                placeholder="填写对方政府联系人姓名或微信备注"
                value={editExternal} onChange={e => setEditExternal(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 justify-between pt-1">
              <button type="button" onClick={() => { if (confirm("确认删除此科室？")) { onDelete(node.id); setEditing(false); } }}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">删除</button>
              <div className="flex gap-2">
                <button type="button" onClick={() => { onAddChild(node.id); setEditing(false); }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50">
                  + 添加子科室
                </button>
                <button type="button" onClick={() => {
                  onSave(node.id, { name: editName, responsibilities: editResp, contactPersonId: editContact || null, externalContactName: editExternal || null });
                  setEditing(false);
                }} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LeaderCard({ leader, onUpdate, onDelete }: {
  leader: OdcLeaderFE;
  onUpdate: (id: string, data: { name?: string; title?: string; bio?: string; profileUrl?: string; avatarUrl?: string | null }) => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(leader.name);
  const [editTitle, setEditTitle] = useState(leader.title);
  const [editBio, setEditBio] = useState(leader.bio ?? "");
  const [editUrl, setEditUrl] = useState(leader.profileUrl ?? "");
  const [editAvatar, setEditAvatar] = useState(leader.avatarUrl ?? "");
  const [avatarUploading, setAvatarUploading] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 bg-white hover:shadow-sm transition-shadow overflow-hidden">
      <div className="flex items-center gap-3 p-3">
        {leader.avatarUrl
          ? <img src={leader.avatarUrl} alt={leader.name} className="w-9 h-9 rounded-full object-cover flex-shrink-0" />
          : <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center text-sm font-bold text-blue-700 flex-shrink-0">
              {leader.name[0]}
            </div>
        }
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold text-slate-800 truncate">{leader.name}</p>
            {leader.profileUrl && (
              <a href={leader.profileUrl} target="_blank" rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-600 flex-shrink-0" title="官网履历">
                <ExternalLink size={11} />
              </a>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{leader.title}</p>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button type="button" onClick={() => setEditing(true)}
            className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors" title="编辑">
            <Pencil size={11} />
          </button>
          {leader.bio && (
            <button type="button" onClick={() => setExpanded(v => !v)}
              className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors">
              {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            </button>
          )}
        </div>
      </div>
      {expanded && leader.bio && (
        <div className="px-3 pb-3 text-xs text-slate-600 leading-relaxed border-t border-slate-100 pt-2">
          {leader.bio}
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-[70] bg-black/30 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setEditing(false); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-xs p-5 flex flex-col gap-3">
            <h4 className="text-sm font-semibold text-slate-800">编辑领导成员</h4>
            {/* 头像上传 */}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">头像</label>
              <div className="flex items-center gap-3">
                {editAvatar
                  ? <img src={editAvatar} alt="头像预览" className="w-10 h-10 rounded-full object-cover border border-slate-200" />
                  : <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-purple-100 flex items-center justify-center text-sm font-bold text-blue-700 border border-slate-200">
                      {editName[0] || "?"}
                    </div>
                }
                <label className={`text-xs px-3 py-1.5 rounded-lg border cursor-pointer transition-colors ${avatarUploading ? "opacity-50 cursor-not-allowed border-slate-200 text-slate-400" : "border-blue-200 text-blue-600 hover:bg-blue-50"}`}>
                  {avatarUploading ? "上传中..." : "上传图片"}
                  <input type="file" accept="image/*" className="hidden" disabled={avatarUploading}
                    onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setAvatarUploading(true);
                      try {
                        const fd = new FormData();
                        fd.append("file", file);
                        const res = await fetch("/api/odc/avatar", { method: "POST", body: fd });
                        const json = await res.json() as { url?: string; error?: string };
                        if (json.url) setEditAvatar(json.url);
                        else alert(json.error ?? "上传失败");
                      } catch {
                        alert("上传失败，请重试");
                      } finally {
                        setAvatarUploading(false);
                        e.target.value = "";
                      }
                    }}
                  />
                </label>
                {editAvatar && (
                  <button type="button" onClick={() => setEditAvatar("")}
                    className="text-xs text-red-400 hover:text-red-600">移除</button>
                )}
              </div>
            </div>
            {([["姓名", editName, setEditName] as const, ["职位", editTitle, setEditTitle] as const, ["官网链接", editUrl, setEditUrl] as const]).map(([label, val, set]) => (
              <div key={label}>
                <label className="text-xs text-slate-500 mb-1 block">{label}</label>
                <input className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-200"
                  value={val} onChange={e => set(e.target.value)} />
              </div>
            ))}
            <div>
              <label className="text-xs text-slate-500 mb-1 block">个人简介</label>
              <textarea rows={3} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 outline-none resize-none"
                value={editBio} onChange={e => setEditBio(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 justify-between pt-1">
              <button type="button" onClick={() => { if (confirm("确认删除？")) { onDelete(leader.id); setEditing(false); } }}
                className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50">删除</button>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditing(false)} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-500">取消</button>
                <button type="button" onClick={() => {
                  onUpdate(leader.id, { name: editName, title: editTitle, bio: editBio, profileUrl: editUrl, avatarUrl: editAvatar || null });
                  setEditing(false);
                }} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">保存</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 情报抽屉
// ══════════════════════════════════════════════════════════════════

function IntelligenceDrawer({
  node,
  adminUsers = [],
  onUpdateNode,
  onToast,
  onClose,
}: {
  node: OdcNode;
  adminUsers?: AdminUser[];
  onUpdateNode?: (updated: OdcNode) => void;
  onToast?: (type: "success" | "error", msg: string, duration?: number) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [intel,           setIntel]           = useState<OdcIntelligence | null>(null);
  const [receptions,      setReceptions]      = useState<ReceptionRecord[]>([]);
  const [loading,         setLoading]         = useState(true);
  const [activeTab,       setActiveTab]       = useState<"overview" | "news" | "reception">("overview");
  const [editingDivIdx,   setEditingDivIdx]   = useState<number | null>(null);
  const [divAssignee,     setDivAssignee]     = useState("");

  // ── Task 4 新增状态 ──
  const [subDepts,        setSubDepts]        = useState<OdcSubDeptFE[]>([]);
  const [leaders,         setLeaders]         = useState<OdcLeaderFE[]>([]);
  const [websiteUrl,      setWebsiteUrl]      = useState("");
  const [editingWebsite,  setEditingWebsite]  = useState(false);
  const [scrapingAI,      setScrapingAI]      = useState(false);
  const [addingSubDept,   setAddingSubDept]   = useState<{ parentId?: string } | null>(null);
  const [newSubDeptName,  setNewSubDeptName]  = useState("");
  const [addingLeader,    setAddingLeader]    = useState(false);
  const [newLeaderName,   setNewLeaderName]   = useState("");
  const [newLeaderTitle,  setNewLeaderTitle]  = useState("");

  // ── Task 7: AI 情报状态 ──
  type AiAnalysis = { summary?: string; impact?: string; suggestions?: string };
  type AiIntelRecord = { institutionId: string; lastScrapedAt: Date; rawNewsData: unknown; aiAnalysis: unknown };
  const [aiIntel,         setAiIntel]         = useState<AiIntelRecord | null>(null);
  const [generatingAI,    setGeneratingAI]    = useState(false);

  // ── Task 8: 历史接待状态 ──
  type LinkedReception = { id: string; title: string; startTime: Date; level: string; purpose: string };
  const [linkedReceptions,    setLinkedReceptions]    = useState<LinkedReception[]>([]);
  const [showLinkModal,       setShowLinkModal]       = useState(false);
  const [availableReceptions, setAvailableReceptions] = useState<LinkedReception[]>([]);
  const [selectedIds,         setSelectedIds]         = useState<Set<string>>(new Set());
  const [linkSearch,          setLinkSearch]          = useState("");
  const [linkLoading,         setLinkLoading]         = useState(false);

  useEffect(() => {
    setLoading(true);
    setTimeout(() => {
      setIntel(MOCK_INTELLIGENCE[node.id] ?? null);
      setLoading(false);
    }, 400);
  }, [node.id]);

  // 加载下设科室和领导班子
  useEffect(() => {
    getSubDepartments(node.id).then(data => setSubDepts(data.map(d => ({
      id: d.id, institutionId: d.institutionId, name: d.name,
      responsibilities: d.responsibilities, contactPersonId: d.contactPersonId,
      externalContactName: d.externalContactName,
      parentId: d.parentId, sortOrder: d.sortOrder,
    }))));
    getLeaders(node.id).then(data => setLeaders(data.map(l => ({
      id: l.id, institutionId: l.institutionId, name: l.name,
      title: l.title, avatarUrl: l.avatarUrl, bio: l.bio,
      profileUrl: l.profileUrl, sortOrder: l.sortOrder,
    }))));
  }, [node.id]);

  // Task 7: 加载 AI 情报
  useEffect(() => {
    getInstitutionIntelligence(node.id).then(data => setAiIntel(data as AiIntelRecord | null));
  }, [node.id]);

  // Task 8: 加载已关联接待
  useEffect(() => {
    getLinkedReceptionsDetails(node.id).then(data =>
      setLinkedReceptions(data as LinkedReception[])
    );
  }, [node.id]);

  useEffect(() => {
    fetch(`/api/reception?visitingUnit=${encodeURIComponent(node.shortName)}&limit=5`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { items?: ReceptionRecord[] } | null) => setReceptions(d?.items ?? []))
      .catch(() => setReceptions([]));
  }, [node.shortName]);

  const lineStyle = LINE_COLORS[node.verticalLine] ?? LINE_COLORS["工信条线"];
  const subDeptTree = buildSubDeptTree(subDepts);

  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1" />
      <div
        className="w-[480px] h-full bg-white flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
        style={{ borderLeft: "1px solid #e2e8f0" }}
      >
        {/* 标题 */}
        <div className="flex items-start justify-between px-5 py-5" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <div className="flex items-start gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-lg"
              style={{ background: lineStyle.bg, border: `1px solid ${lineStyle.border}` }}
            >
              {JURISDICTION_ICONS[node.jurisdiction] ?? "🏛️"}
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-800 leading-snug">{node.fullName}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: lineStyle.bg, color: lineStyle.text, border: `1px solid ${lineStyle.border}` }}>
                  {node.verticalLine}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: `${LEVEL_COLORS[node.level]}18`, color: LEVEL_COLORS[node.level] }}>
                  {node.level}
                </span>
                <span className="text-xs text-slate-400">{node.regionName ?? node.level}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 flex-shrink-0">
            <X size={16} className="text-slate-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex px-5 pt-3" style={{ borderBottom: "1px solid #f1f5f9" }}>
          {(["overview", "news", "reception"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="px-4 py-2 text-sm font-medium relative"
              style={{ color: activeTab === tab ? "#2563eb" : "#64748b" }}
            >
              {tab === "overview" ? "部门概览" : tab === "news" ? "最新动态" : "历史接待"}
              {activeTab === tab && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ background: "#2563eb" }} />
              )}
            </button>
          ))}
        </div>

        {/* 内容 */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" />加载中...
            </div>
          ) : (
            <>
              {activeTab === "overview" && (
                <div className="space-y-6">

                  {/* ① 官网网址 + AI 抓取按钮 */}
                  <div className="flex items-center gap-2">
                    {editingWebsite ? (
                      <>
                        <Globe size={13} className="text-slate-400 flex-shrink-0" />
                        <input
                          className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-blue-300 outline-none focus:ring-2 focus:ring-blue-200"
                          value={websiteUrl}
                          onChange={e => setWebsiteUrl(e.target.value)}
                          placeholder="https://..."
                          autoFocus
                        />
                        <button type="button" className="text-xs px-2 py-1 rounded bg-blue-600 text-white"
                          onClick={async () => {
                            await updateInstitutionWebsite(node.id, websiteUrl);
                            setEditingWebsite(false);
                          }}>✓</button>
                        <button type="button" className="text-xs px-1.5 py-1 rounded border border-slate-200 text-slate-500"
                          onClick={() => setEditingWebsite(false)}>✕</button>
                      </>
                    ) : (
                      <>
                        <Globe size={13} className="text-slate-400 flex-shrink-0" />
                        {websiteUrl
                          ? <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="flex-1 text-xs text-blue-600 hover:underline truncate">{websiteUrl}</a>
                          : <span className="flex-1 text-xs text-slate-400 italic">未录入官网地址</span>
                        }
                        <button type="button" onClick={() => setEditingWebsite(true)}
                          className="text-xs px-2 py-0.5 rounded border border-slate-200 text-slate-400 hover:text-blue-600 hover:border-blue-300 transition-colors">
                          <Pencil size={10} className="inline mr-0.5" />{websiteUrl ? "修改" : "录入"}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={scrapingAI}
                      onClick={async () => {
                        setScrapingAI(true);
                        try {
                          const result = await seedMockInstitutionData(node.id, node.fullName);
                          if (result.success) {
                            const [newDepts, newLeaders] = await Promise.all([
                              getSubDepartments(node.id),
                              getLeaders(node.id),
                            ]);
                            setSubDepts(newDepts.map(d => ({ id: d.id, institutionId: d.institutionId, name: d.name, responsibilities: d.responsibilities, contactPersonId: d.contactPersonId, externalContactName: d.externalContactName, parentId: d.parentId, sortOrder: d.sortOrder })));
                            setLeaders(newLeaders.map(l => ({ id: l.id, institutionId: l.institutionId, name: l.name, title: l.title, avatarUrl: l.avatarUrl, bio: l.bio, profileUrl: l.profileUrl, sortOrder: l.sortOrder })));
                            onToast?.("success", `AI数据抓取成功！已为「${node.shortName}」生成下设科室和领导班子`);
                            router.refresh();
                          } else {
                            onToast?.("error", result.error ?? "未知错误", 8000);
                          }
                        } catch (e) {
                          onToast?.("error", `网络错误：${(e as Error).message}`, 8000);
                        } finally {
                          setScrapingAI(false);
                        }
                      }}
                      className="flex-shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                      style={{ background: "linear-gradient(135deg,#4f46e5,#7c3aed)", color: "white" }}
                    >
                      {scrapingAI ? <Loader2 size={11} className="animate-spin" /> : "🤖"} {scrapingAI ? "抓取中..." : "AI抓取"}
                    </button>
                  </div>

                  {/* ② 对接人员（自动联动下设科室） */}
                  {(() => {
                    const linkedDepts = subDepts.filter(d => d.contactPersonId || d.externalContactName);
                    const fallbackDivs = node.divisions.filter(d => d.assigneeName);
                    const hasData = linkedDepts.length > 0 || fallbackDivs.length > 0;
                    if (!hasData) return null;
                    return (
                      <div>
                        <h3 className="text-xs font-semibold text-slate-500 mb-3 uppercase tracking-wide flex items-center gap-1.5">
                          <Users size={12} />对接人员
                        </h3>
                        <div className="space-y-2">
                          {linkedDepts.length > 0 ? linkedDepts.map(dept => {
                            const momentaName = adminUsers.find(u => u.id === dept.contactPersonId)?.name;
                            return (
                              <div key={dept.id} className="flex items-center justify-between p-3 rounded-xl" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                                <p className="text-sm font-medium text-slate-700 truncate max-w-[160px]">{dept.name}</p>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700">
                                    我方: {momentaName ?? "待分配"}
                                  </span>
                                  <span className="text-slate-300 text-xs">—</span>
                                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-orange-50 text-orange-700">
                                    对方: {dept.externalContactName ?? "待录入"}
                                  </span>
                                </div>
                              </div>
                            );
                          }) : fallbackDivs.map((div, i) => (
                            <div key={i} className="flex items-center justify-between p-3 rounded-xl" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                              <p className="text-sm font-medium text-slate-700">{div.name}</p>
                              {div.assigneeName && (
                                <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: lineStyle.bg, color: lineStyle.text }}>
                                  {div.assigneeName}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ③ 下设机构组织架构图 */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                        <Building2 size={12} />下设机构
                        <span className="text-slate-400 font-normal ml-1 normal-case">({subDepts.length})</span>
                      </h3>
                      <button type="button"
                        onClick={() => setAddingSubDept({ parentId: undefined })}
                        className="text-xs px-2 py-1 rounded-lg border border-dashed border-blue-300 text-blue-500 hover:bg-blue-50 transition-colors">
                        + 新增根科室
                      </button>
                    </div>

                    {subDeptTree.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                        暂无下设科室，点击「AI抓取」或手动新增
                      </div>
                    ) : (
                      <div className="space-y-2 overflow-x-auto pb-2">
                        {subDeptTree.map(rootNode => (
                          <SubDeptNodeCard
                            key={rootNode.id}
                            node={rootNode}
                            adminUsers={adminUsers}
                            onSave={async (id, data) => {
                              await updateSubDepartment(id, data);
                              const updated = await getSubDepartments(node.id);
                              setSubDepts(updated.map(d => ({ id: d.id, institutionId: d.institutionId, name: d.name, responsibilities: d.responsibilities, contactPersonId: d.contactPersonId, externalContactName: d.externalContactName, parentId: d.parentId, sortOrder: d.sortOrder })));
                            }}
                            onDelete={async (id) => {
                              await deleteSubDepartment(id);
                              setSubDepts(prev => prev.filter(d => d.id !== id && d.parentId !== id));
                            }}
                            onAddChild={(parentId) => setAddingSubDept({ parentId })}
                          />
                        ))}
                      </div>
                    )}

                    {/* 新增科室内联表单 */}
                    {addingSubDept !== null && (
                      <div className="mt-3 flex items-center gap-2 p-3 bg-blue-50 rounded-xl border border-blue-200">
                        <input
                          className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-blue-200 outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                          placeholder={addingSubDept.parentId ? "子科室名称..." : "根科室名称..."}
                          value={newSubDeptName}
                          onChange={e => setNewSubDeptName(e.target.value)}
                          autoFocus
                        />
                        <button type="button"
                          onClick={async () => {
                            if (!newSubDeptName.trim()) return;
                            await createSubDepartment({ institutionId: node.id, name: newSubDeptName.trim(), parentId: addingSubDept.parentId });
                            const updated = await getSubDepartments(node.id);
                            setSubDepts(updated.map(d => ({ id: d.id, institutionId: d.institutionId, name: d.name, responsibilities: d.responsibilities, contactPersonId: d.contactPersonId, externalContactName: d.externalContactName, parentId: d.parentId, sortOrder: d.sortOrder })));
                            setAddingSubDept(null);
                            setNewSubDeptName("");
                          }}
                          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700">添加</button>
                        <button type="button" onClick={() => { setAddingSubDept(null); setNewSubDeptName(""); }}
                          className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 text-slate-500">取消</button>
                      </div>
                    )}
                  </div>

                  {/* ④ 领导班子网格 */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                        <Users size={12} />领导班子
                        <span className="text-slate-400 font-normal ml-1 normal-case">({leaders.length})</span>
                      </h3>
                      <button type="button"
                        onClick={() => setAddingLeader(true)}
                        className="text-xs px-2 py-1 rounded-lg border border-dashed border-purple-300 text-purple-500 hover:bg-purple-50 transition-colors">
                        + 添加领导成员
                      </button>
                    </div>

                    {leaders.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-xl">
                        暂无领导班子数据，点击「AI抓取」自动生成
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {leaders.map(leader => (
                          <LeaderCard
                            key={leader.id}
                            leader={leader}
                            onUpdate={async (id, data) => {
                              await updateLeader(id, data);
                              setLeaders(prev => prev.map(l => l.id === id ? { ...l, ...data } : l));
                            }}
                            onDelete={async (id) => {
                              await deleteLeader(id);
                              setLeaders(prev => prev.filter(l => l.id !== id));
                            }}
                          />
                        ))}
                      </div>
                    )}

                    {/* 新增领导内联表单 */}
                    {addingLeader && (
                      <div className="mt-3 p-3 bg-purple-50 rounded-xl border border-purple-200 space-y-2">
                        <div className="flex gap-2">
                          <input
                            className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-purple-200 outline-none bg-white"
                            placeholder="姓名"
                            value={newLeaderName}
                            onChange={e => setNewLeaderName(e.target.value)}
                            autoFocus
                          />
                          <input
                            className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-purple-200 outline-none bg-white"
                            placeholder="职位（如：局长）"
                            value={newLeaderTitle}
                            onChange={e => setNewLeaderTitle(e.target.value)}
                          />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button type="button" onClick={() => { setAddingLeader(false); setNewLeaderName(""); setNewLeaderTitle(""); }}
                            className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 text-slate-500">取消</button>
                          <button type="button"
                            onClick={async () => {
                              if (!newLeaderName.trim() || !newLeaderTitle.trim()) return;
                              const result = await createLeader({ institutionId: node.id, name: newLeaderName.trim(), title: newLeaderTitle.trim() });
                              if (result.success && result.id) {
                                setLeaders(prev => [...prev, { id: result.id!, institutionId: node.id, name: newLeaderName.trim(), title: newLeaderTitle.trim(), sortOrder: prev.length, avatarUrl: null, bio: null, profileUrl: null }]);
                              }
                              setAddingLeader(false);
                              setNewLeaderName("");
                              setNewLeaderTitle("");
                            }}
                            className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700">确认添加</button>
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              )}

              {activeTab === "news" && (() => {
                const ai = aiIntel;
                const analysis = ai?.aiAnalysis as AiAnalysis | null;
                const rawNews = (ai?.rawNewsData as { title: string; date: string; url?: string }[] | null) ?? [];
                const isStale = !ai || (Date.now() - new Date(ai.lastScrapedAt).getTime() > 3 * 24 * 60 * 60 * 1000);
                return (
                  <div className="space-y-4">
                    {/* 触发扫描按钮区 */}
                    <div className="flex items-center justify-between">
                      {ai && !isStale && (
                        <span className="text-xs text-slate-400">
                          上次扫描：{new Date(ai.lastScrapedAt).toLocaleDateString("zh-CN")}
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={generatingAI}
                        onClick={async () => {
                          setGeneratingAI(true);
                          try {
                            const res = await generateInstitutionIntelligence(node.id, node.fullName);
                            if (res.success && res.data) setAiIntel(res.data as AiIntelRecord);
                            else onToast?.("error", res.error ?? "情报扫描失败", 8000);
                          } catch (e) {
                            onToast?.("error", `网络错误：${(e as Error).message}`, 8000);
                          } finally {
                            setGeneratingAI(false);
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-white transition-all disabled:opacity-60"
                        style={{ background: "linear-gradient(135deg, #4f46e5, #0ea5e9)", marginLeft: "auto" }}
                      >
                        {generatingAI ? <Loader2 size={13} className="animate-spin" /> : <><span>🌐</span></>}
                        {generatingAI ? "扫描中..." : isStale ? "启动全网情报扫描与 AI 研判" : "重新扫描"}
                      </button>
                    </div>

                    {/* AI 研判结果 */}
                    {analysis && (
                      <div className="space-y-3">
                        {/* 近期新闻 */}
                        {rawNews.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">近期动态原文</p>
                            {rawNews.map((n, i) => (
                              <div key={i} className="p-2.5 rounded-lg text-xs" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                                <p className="font-medium text-slate-700 mb-0.5 leading-snug">{n.title}</p>
                                <span className="text-slate-400">{n.date}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 核心动向 */}
                        <div className="p-4 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(14,165,233,0.06))", border: "1px solid rgba(99,102,241,0.15)" }}>
                          <p className="text-xs font-semibold text-indigo-600 mb-1.5 flex items-center gap-1">📰 核心政策动向总结</p>
                          <p className="text-sm text-slate-700 leading-relaxed">{analysis.summary}</p>
                        </div>

                        {/* 业务研判 */}
                        <div className="p-4 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.06), rgba(59,130,246,0.06))", border: "1px solid rgba(16,185,129,0.15)" }}>
                          <p className="text-xs font-semibold text-emerald-600 mb-1.5 flex items-center gap-1">🚗 行业与 Momenta 业务研判</p>
                          <p className="text-sm text-slate-700 leading-relaxed">{analysis.impact}</p>
                        </div>

                        {/* 申报建议 */}
                        <div className="p-4 rounded-xl" style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.06), rgba(239,68,68,0.06))", border: "1px solid rgba(245,158,11,0.15)" }}>
                          <p className="text-xs font-semibold text-amber-600 mb-1.5 flex items-center gap-1">💰 申报与公关建议</p>
                          <ul className="space-y-1">
                            {(analysis.suggestions ?? "").split("\n").filter(Boolean).map((s, i) => (
                              <li key={i} className="text-sm text-slate-700 leading-relaxed flex items-start gap-1.5">
                                <span className="text-amber-400 mt-0.5">•</span>{s.replace(/^\d+\.\s*/, "")}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {/* 智库联动 */}
                        <Link
                          href={`/dashboard/copilot?preset=${encodeURIComponent(`请基于以下关于${node.fullName}的研判，帮我写一份拜访话术：${analysis.suggestions ?? ""}`)}`}
                          className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-xs font-medium transition-all"
                          style={{ background: "linear-gradient(135deg, #ede9fe, #dbeafe)", color: "#4f46e5", border: "1px solid #c7d2fe" }}
                        >
                          💬 将此研判报告发送至「智库 Chat」进行深度追问 →
                        </Link>
                      </div>
                    )}

                    {/* 无数据空状态 */}
                    {!analysis && !generatingAI && (
                      <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                        <Newspaper size={32} className="mb-2 opacity-30" />
                        <p className="text-sm">点击上方按钮启动 AI 情报扫描</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {activeTab === "reception" && (
                <div>
                  {/* 头部操作行 */}
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs text-slate-400">共 {linkedReceptions.length} 条关联记录</p>
                    <button
                      type="button"
                      onClick={async () => {
                        setLinkLoading(true);
                        const data = await getAvailableReceptions();
                        setAvailableReceptions(data as LinkedReception[]);
                        setSelectedIds(new Set());
                        setLinkSearch("");
                        setShowLinkModal(true);
                        setLinkLoading(false);
                      }}
                      disabled={linkLoading}
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors"
                      style={{ background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}
                    >
                      {linkLoading ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                      关联历史接待记录
                    </button>
                  </div>

                  {/* 时间轴 */}
                  {linkedReceptions.length > 0 ? (
                    <div className="relative ml-4 border-l-2 border-slate-200">
                      {linkedReceptions.map(r => (
                        <div key={r.id} className="relative mb-5 ml-5">
                          {/* 轴点 */}
                          <div className="absolute w-3 h-3 bg-blue-500 rounded-full -left-[27px] top-2" />
                          {/* 卡片 */}
                          <div className="p-3 rounded-xl group transition-colors" style={{ background: "#f8fafc", border: "1px solid #e2e8f0" }}>
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-xs text-slate-400">{new Date(r.startTime).toLocaleDateString("zh-CN")}</span>
                              {r.level && (
                                <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">{r.level}</span>
                              )}
                            </div>
                            <p className="text-sm font-semibold text-slate-800 mb-1 leading-snug">{r.title}</p>
                            {r.purpose && <p className="text-xs text-slate-500 mb-2 line-clamp-2">{r.purpose}</p>}
                            <Link
                              href={`/dashboard/reception?q=${encodeURIComponent(r.title)}`}
                              className="inline-flex items-center gap-1 text-xs font-medium transition-colors group-hover:text-blue-700"
                              style={{ color: "#3b82f6" }}
                            >
                              🔗 查看接待详情 →
                            </Link>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                      <Calendar size={32} className="mb-2 opacity-30" />
                      <p className="text-sm">暂无关联接待，点击右上角一键导入</p>
                    </div>
                  )}

                  {/* 关联弹窗 */}
                  {showLinkModal && (
                    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4"
                      onClick={e => { if (e.target === e.currentTarget) setShowLinkModal(false); }}>
                      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: "80vh" }}>
                        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <h3 className="text-sm font-bold text-slate-800">关联历史接待记录</h3>
                          <button onClick={() => setShowLinkModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100">
                            <X size={15} className="text-slate-400" />
                          </button>
                        </div>
                        <div className="px-5 py-3" style={{ borderBottom: "1px solid #f1f5f9" }}>
                          <div className="relative">
                            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                              className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-slate-50 outline-none"
                              style={{ border: "1px solid #e2e8f0" }}
                              placeholder="搜索接待记录..."
                              value={linkSearch}
                              onChange={async e => {
                                setLinkSearch(e.target.value);
                                const data = await getAvailableReceptions(e.target.value || undefined);
                                setAvailableReceptions(data as LinkedReception[]);
                              }}
                            />
                          </div>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto pr-2 px-5 py-3 space-y-2">
                          {availableReceptions.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center py-8">暂无接待记录</p>
                          ) : availableReceptions.map(r => (
                            <label key={r.id} className="flex items-start gap-3 p-2.5 rounded-lg cursor-pointer hover:bg-slate-50">
                              <input
                                type="checkbox"
                                className="mt-0.5 flex-shrink-0"
                                checked={selectedIds.has(r.id)}
                                onChange={e => {
                                  const next = new Set(selectedIds);
                                  if (e.target.checked) next.add(r.id); else next.delete(r.id);
                                  setSelectedIds(next);
                                }}
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-slate-400 mb-0.5">
                                  {new Date(r.startTime).toLocaleDateString("zh-CN")}
                                  {r.level && <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">[{r.level}]</span>}
                                </p>
                                <p className="text-sm font-medium text-slate-700 leading-snug">{r.title}</p>
                                {r.purpose && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{r.purpose}</p>}
                              </div>
                            </label>
                          ))}
                        </div>
                        <div className="flex items-center justify-between px-5 py-4" style={{ borderTop: "1px solid #f1f5f9" }}>
                          <span className="text-xs text-slate-400">已选 {selectedIds.size} 条</span>
                          <div className="flex gap-2">
                            <button onClick={() => setShowLinkModal(false)}
                              className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 text-slate-500 hover:bg-slate-50">
                              取消
                            </button>
                            <button
                              disabled={selectedIds.size === 0}
                              onClick={async () => {
                                await linkReceptionsToInstitution(node.id, Array.from(selectedIds));
                                const fresh = await getLinkedReceptionsDetails(node.id);
                                setLinkedReceptions(fresh as LinkedReception[]);
                                setShowLinkModal(false);
                              }}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                              style={{ background: "#2563eb" }}>
                              确认关联
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 新增/编辑机构弹窗
// ══════════════════════════════════════════════════════════════════

function InstitutionFormModal({
  initial,
  adminUsers,
  lines,
  onSubmit,
  onClose,
}: {
  initial?: OdcNode;
  adminUsers: AdminUser[];
  lines: { id: string; name: string }[];
  onSubmit: (data: Partial<OdcNode>) => void;
  onClose: () => void;
}) {
  const isEdit = !!initial;
  const [fullName,       setFullName]       = useState(initial?.fullName ?? "");
  const [shortName,      setShortName]      = useState(initial?.shortName ?? "");
  const [jurisdiction,   setJurisdiction]   = useState(initial?.jurisdiction ?? "江苏省");
  const defaultLine = initial?.verticalLine ?? (lines[0]?.name ?? "工信条线");
  const [verticalLine,   setVerticalLine]   = useState(defaultLine);
  const [level,          setLevel]          = useState(initial?.level ?? "市级");
  const [assigneeName,   setAssigneeName]   = useState(initial?.divisions?.[0]?.assigneeName ?? "");
  const [assigneeQuery,  setAssigneeQuery]  = useState(initial?.divisions?.[0]?.assigneeName ?? "");
  const [showAssigneeDropdown, setShowAssigneeDropdown] = useState(false);
  const filteredAdminUsers = adminUsers.filter(u =>
    assigneeQuery === "" || u.name.toLowerCase().includes(assigneeQuery.toLowerCase())
  );

  const LABEL = "text-xs font-medium text-slate-500 mb-1 block";
  const INPUT = "w-full px-3 py-2 rounded-lg text-sm border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-blue-200";

  function handleSubmit() {
    if (!fullName.trim() || !shortName.trim()) return;
    const divisions: OdcDivision[] = assigneeName
      ? [{ name: fullName.trim(), assigneeName }]
      : (initial?.divisions ?? []);
    onSubmit({ fullName: fullName.trim(), shortName: shortName.trim(), jurisdiction, verticalLine, level, divisions });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">{isEdit ? "编辑机构" : "新增机构/部门"}</h3>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 transition-colors"><X size={16} /></button>
        </div>
        <div className="flex flex-col gap-3">
          <div>
            <label className={LABEL}>机构全称 *</label>
            <input className={INPUT} value={fullName} onChange={e => setFullName(e.target.value)} placeholder="如：苏州市工业和信息化局" autoFocus />
          </div>
          <div>
            <label className={LABEL}>机构简称 *</label>
            <input className={INPUT} value={shortName} onChange={e => setShortName(e.target.value)} placeholder="如：市工信局" />
          </div>
          <div>
            <label className={LABEL}>所属地区</label>
            <select className={INPUT} value={jurisdiction} onChange={e => setJurisdiction(e.target.value)}>
              {ALL_JURISDICTIONS.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>所属条线</label>
            <select className={INPUT} value={verticalLine} onChange={e => setVerticalLine(e.target.value)}>
              {lines.map(l => <option key={l.id} value={l.name}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>行政层级</label>
            <select className={INPUT} value={level} onChange={e => setLevel(e.target.value)}>
              {ALL_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="relative">
            <label className={LABEL}>对接人员</label>
            <input
              className={INPUT}
              value={assigneeQuery}
              placeholder={adminUsers.length === 0 ? "请先在超级后台添加人员" : "输入姓名搜索..."}
              disabled={adminUsers.length === 0}
              onChange={e => {
                setAssigneeQuery(e.target.value);
                setAssigneeName(e.target.value);
                setShowAssigneeDropdown(true);
              }}
              onFocus={() => setShowAssigneeDropdown(true)}
              onBlur={() => setTimeout(() => setShowAssigneeDropdown(false), 150)}
            />
            {assigneeQuery && (
              <button
                type="button"
                className="absolute right-2 top-[30px] text-slate-400 hover:text-slate-600"
                onMouseDown={e => { e.preventDefault(); setAssigneeQuery(""); setAssigneeName(""); }}
              >
                <X size={13} />
              </button>
            )}
            {showAssigneeDropdown && filteredAdminUsers.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white rounded-lg shadow-lg border border-slate-200 max-h-40 overflow-y-auto">
                <div
                  className="px-3 py-2 text-xs text-slate-400 cursor-pointer hover:bg-slate-50"
                  onMouseDown={e => { e.preventDefault(); setAssigneeName(""); setAssigneeQuery(""); setShowAssigneeDropdown(false); }}
                >
                  — 暂不分配 —
                </div>
                {filteredAdminUsers.map(u => (
                  <div
                    key={u.id}
                    className="px-3 py-2 text-sm text-slate-700 cursor-pointer hover:bg-blue-50 hover:text-blue-700"
                    onMouseDown={e => { e.preventDefault(); setAssigneeName(u.name); setAssigneeQuery(u.name); setShowAssigneeDropdown(false); }}
                  >
                    {u.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">取消</button>
          <button type="button" onClick={handleSubmit} disabled={!fullName.trim() || !shortName.trim()}
            className="px-4 py-2 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 transition-colors">
            {isEdit ? "保存修改" : "确认创建"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmDialog({
  node,
  onConfirm,
  onClose,
}: {
  node: OdcNode;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 flex flex-col gap-4">
        <h3 className="text-sm font-semibold text-slate-800">确认删除机构</h3>
        <p className="text-sm text-slate-600">
          确定要删除「<strong>{node.fullName}</strong>」吗？相关的对接记录可能受影响。
        </p>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-xs border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors">取消</button>
          <button type="button" onClick={onConfirm} className="px-4 py-2 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors">确认删除</button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 视图一：条线网络视图
// ══════════════════════════════════════════════════════════════════

function LineNetworkView({
  nodes,
  activeLine,
  onNodeClick,
  onEdit,
  onDelete,
}: {
  nodes: OdcNode[];
  activeLine: string | null;
  onNodeClick: (node: OdcNode) => void;
  onEdit: (node: OdcNode) => void;
  onDelete: (node: OdcNode) => void;
}) {
  const allNodeLines = [...new Set(nodes.map(n => n.verticalLine))];
  const lines = activeLine ? [activeLine] : allNodeLines;

  return (
    <div className="space-y-6 px-6 py-6">
      {lines.map(line => {
        const lineNodes = nodes.filter(n => n.verticalLine === line);
        if (lineNodes.length === 0) return null;
        const style = LINE_COLORS[line] ?? LINE_COLORS["其他条线"];

        // Group by level
        const byLevel: Record<string, OdcNode[]> = {};
        ALL_LEVELS.forEach(lvl => {
          const lvlNodes = lineNodes.filter(n => n.level === lvl);
          if (lvlNodes.length > 0) byLevel[lvl] = lvlNodes;
        });

        return (
          <div key={line} className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${style.border}` }}>
            {/* 条线标题 */}
            <div className="px-5 py-3 flex items-center gap-3" style={{ background: style.bg }}>
              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: style.dot }} />
              <span className="text-sm font-bold" style={{ color: style.text }}>{line}</span>
              <span className="text-xs ml-auto" style={{ color: style.text, opacity: 0.7 }}>
                {lineNodes.length} 个机构 · {lineNodes.reduce((acc, n) => acc + n.divisions.length, 0)} 个处室
              </span>
            </div>

            {/* 节点网格 */}
            <div className="p-4 bg-white">
              <div className="grid grid-cols-5 gap-3">
                {ALL_LEVELS.map(lvl => {
                  const lvlNodes = byLevel[lvl] ?? [];
                  if (lvlNodes.length === 0) {
                    return (
                      <div key={lvl} className="flex flex-col items-center justify-center min-h-[60px] rounded-xl border border-dashed border-slate-200">
                        <span className="text-xs text-slate-300">{lvl}</span>
                      </div>
                    );
                  }
                  return (
                    <div key={lvl} className="flex flex-col gap-2">
                      {lvlNodes.map(node => (
                        <div
                          key={node.id}
                          className="relative group flex flex-col p-3 rounded-xl text-left transition-all hover:shadow-md cursor-pointer"
                          style={{ background: "#f8fafc", border: `1px solid ${style.border}` }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = style.bg; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "#f8fafc"; }}
                          onClick={() => onNodeClick(node)}
                        >
                          {/* Hover 操作区 */}
                          <div
                            className="absolute top-1.5 right-1.5 hidden group-hover:flex items-center gap-1 bg-white/90 px-1 py-0.5 rounded shadow-sm"
                            onClick={e => e.stopPropagation()}
                          >
                            <button type="button" onClick={() => onEdit(node)}
                              className="p-0.5 text-slate-400 hover:text-blue-600 transition-colors rounded" title="编辑">
                              <Pencil size={11} />
                            </button>
                            <button type="button" onClick={() => onDelete(node)}
                              className="p-0.5 text-slate-400 hover:text-red-500 transition-colors rounded" title="删除">
                              <Trash2 size={11} />
                            </button>
                          </div>
                          <span className="text-xs font-bold truncate" style={{ color: LEVEL_COLORS[node.level] }}>
                            [{lvl}]
                          </span>
                          <span className="text-xs font-semibold text-slate-700 mt-0.5 leading-snug">
                            {node.shortName}
                          </span>
                          {node.shortName && node.shortName !== node.fullName && (
                            <span className="text-xs text-slate-400 font-normal truncate mt-0.5" title={node.fullName}>
                              ({node.fullName})
                            </span>
                          )}
                          <span className="text-xs text-slate-400 mt-1">
                            {node.divisions.length} 处室
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 视图二：行政层级视图
// ══════════════════════════════════════════════════════════════════

function HierarchyView({
  nodes,
  activeJurisdiction,
  onNodeClick,
  onEdit,
  onDelete,
}: {
  nodes: OdcNode[];
  activeJurisdiction: string | null;
  onNodeClick: (node: OdcNode) => void;
  onEdit: (node: OdcNode) => void;
  onDelete: (node: OdcNode) => void;
}) {
  const dynamicJurisdictions = [...new Set(nodes.map(n => n.jurisdiction))];
  const jurisdictions = activeJurisdiction
    ? [activeJurisdiction]
    : dynamicJurisdictions;

  return (
    <div className="space-y-6 px-6 py-6">
      {jurisdictions.map(jurisdiction => {
        const jNodes = nodes.filter(n => n.jurisdiction === jurisdiction);
        if (jNodes.length === 0) return null;

        // Group by verticalLine（从实际节点动态推断，不依赖静态 ALL_LINES）
        const jLines = [...new Set(jNodes.map(n => n.verticalLine))];
        const byLine: Record<string, OdcNode[]> = {};
        jLines.forEach(line => {
          const lineNodes = jNodes.filter(n => n.verticalLine === line);
          if (lineNodes.length > 0) byLine[line] = lineNodes;
        });

        return (
          <div key={jurisdiction} className="rounded-2xl overflow-hidden border border-slate-200">
            <div className="px-5 py-3 flex items-center gap-3 bg-slate-50" style={{ borderBottom: "1px solid #e2e8f0" }}>
              <span className="text-base">{JURISDICTION_ICONS[jurisdiction] ?? "🏛️"}</span>
              <span className="text-sm font-bold text-slate-800">{jurisdiction}</span>
              <span className="text-xs text-slate-400 ml-auto">
                {jNodes.length} 个机构
              </span>
            </div>

            <div className="p-4 bg-white space-y-3">
              {Object.entries(byLine).map(([line, lineNodes]) => {
                const style = LINE_COLORS[line] ?? LINE_COLORS["其他条线"];
                return (
                  <div key={line}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: style.dot }} />
                      <span className="text-xs font-semibold" style={{ color: style.text }}>{line}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {lineNodes.map(node => (
                        <div
                          key={node.id}
                          className="relative group flex items-center gap-3 p-3 rounded-xl text-left transition-all hover:shadow-sm cursor-pointer"
                          style={{ border: `1px solid ${style.border}`, background: style.bg }}
                          onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.opacity = "0.85"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.opacity = "1"; }}
                          onClick={() => onNodeClick(node)}
                        >
                          {/* Hover 操作区 */}
                          <div
                            className="absolute top-1.5 right-1.5 hidden group-hover:flex items-center gap-1 bg-white/90 px-1 py-0.5 rounded shadow-sm"
                            onClick={e => e.stopPropagation()}
                          >
                            <button type="button" onClick={() => onEdit(node)}
                              className="p-0.5 text-slate-400 hover:text-blue-600 transition-colors rounded" title="编辑">
                              <Pencil size={11} />
                            </button>
                            <button type="button" onClick={() => onDelete(node)}
                              className="p-0.5 text-slate-400 hover:text-red-500 transition-colors rounded" title="删除">
                              <Trash2 size={11} />
                            </button>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-bold text-slate-700 truncate">{node.shortName}</p>
                            {node.shortName && node.shortName !== node.fullName && (
                              <p className="text-xs text-slate-400 font-normal truncate" title={node.fullName}>
                                ({node.fullName})
                              </p>
                            )}
                            <p className="text-xs text-slate-500 mt-0.5">{node.divisions.length} 个处室对接</p>
                          </div>
                          <span className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                            style={{ background: `${LEVEL_COLORS[node.level]}18`, color: LEVEL_COLORS[node.level] }}>
                            {node.level}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 视图三：数据大屏
// ══════════════════════════════════════════════════════════════════

const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444"];

function DashboardView({
  nodes,
  setActiveLine,
  setActiveLevel,
  setActiveRegion,
  setViewMode,
  setDisplayMode,
}: {
  nodes: OdcNode[];
  setActiveLine: (line: string | null) => void;
  setActiveLevel: (level: string | null) => void;
  setActiveRegion: (region: string) => void;
  setViewMode: (v: "network" | "hierarchy" | "dashboard") => void;
  setDisplayMode: (m: "matrix" | "graph") => void;
}) {
  // Stats
  const totalNodes     = nodes.length;
  const totalDivisions = nodes.reduce((acc, n) => acc + n.divisions.length, 0);
  const totalAssignees = new Set(
    nodes.flatMap(n => n.divisions.map(d => d.assigneeName).filter(Boolean))
  ).size;

  // By line（从实际节点动态推断，避免与静态 ALL_LINES 不一致）
  const dynamicLines = [...new Set(nodes.map(n => n.verticalLine))];
  const byLine = dynamicLines.map(line => ({
    name: line.replace("条线", ""),
    fullName: line,
    value: nodes.filter(n => n.verticalLine === line).length,
  }));

  // By jurisdiction（从实际节点动态推断）
  const dynamicJurisdictions = [...new Set(nodes.map(n => n.jurisdiction))];
  const byJurisdiction = dynamicJurisdictions.map(j => ({
    name: j,
    value: nodes.filter(n => n.jurisdiction === j).length,
  }));

  // By level
  const byLevel = ALL_LEVELS.map(lvl => ({
    name: lvl,
    value: nodes.filter(n => n.level === lvl).length,
  }));

  const statCards = [
    { label: "覆盖机构", value: totalNodes, unit: "个", color: "#2563eb", bg: "rgba(37,99,235,0.08)" },
    { label: "对接处室", value: totalDivisions, unit: "个", color: "#7c3aed", bg: "rgba(124,58,237,0.08)" },
    { label: "条线覆盖", value: dynamicLines.length, unit: "条", color: "#059669", bg: "rgba(5,150,105,0.08)" },
    { label: "PA 专员", value: totalAssignees, unit: "人", color: "#d97706", bg: "rgba(217,119,6,0.08)" },
  ];

  return (
    <div className="px-6 py-6 space-y-6">
      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        {statCards.map(card => (
          <div key={card.label} className="rounded-2xl p-5" style={{ background: card.bg, border: `1px solid ${card.color}28` }}>
            <p className="text-xs font-semibold text-slate-500 mb-2">{card.label}</p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold" style={{ color: card.color }}>{card.value}</span>
              <span className="text-sm font-medium" style={{ color: card.color }}>{card.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 图表行 */}
      <div className="grid grid-cols-3 gap-4">
        {/* 按条线（点击穿透到矩阵视图） */}
        <div className="bg-white rounded-2xl p-5 cursor-pointer" style={{ border: "1px solid #e2e8f0" }}>
          <h3 className="text-sm font-bold text-slate-700 mb-1">条线分布</h3>
          <p className="text-xs text-slate-400 mb-3">点击柱子可跳转到对应条线矩阵</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byLine} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} cursor="pointer"
                onClick={(data: unknown) => {
                  const d = data as { fullName?: string } | null;
                  if (d?.fullName) {
                    setActiveLine(d.fullName);
                    setViewMode("network");
                    setDisplayMode("matrix");
                  }
                }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 按层级（点击穿透到矩阵视图） */}
        <div className="bg-white rounded-2xl p-5 cursor-pointer" style={{ border: "1px solid #e2e8f0" }}>
          <h3 className="text-sm font-bold text-slate-700 mb-1">层级分布</h3>
          <p className="text-xs text-slate-400 mb-3">点击柱子可跳转到对应层级矩阵</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={byLevel} margin={{ left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} cursor="pointer"
                onClick={(data: unknown) => {
                  const d = data as { name?: string } | null;
                  if (d?.name) {
                    setActiveLevel(d.name);
                    setViewMode("network");
                    setDisplayMode("matrix");
                  }
                }} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 按地区（点击扇区穿透到对应属地） */}
        <div className="bg-white rounded-2xl p-5 cursor-pointer" style={{ border: "1px solid #e2e8f0" }}>
          <h3 className="text-sm font-bold text-slate-700 mb-1">属地分布</h3>
          <p className="text-xs text-slate-400 mb-3">点击扇区可跳转到对应属地矩阵</p>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={byJurisdiction} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3}
                onClick={(data: { name?: string }) => {
                  if (data?.name) {
                    setActiveRegion(data.name);
                    setActiveLine(null);
                    setViewMode("network");
                    setDisplayMode("matrix");
                  }
                }}>
                {byJurisdiction.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} style={{ cursor: "pointer" }} />
                ))}
              </Pie>
              <Tooltip />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 机构列表 */}
      <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid #e2e8f0" }}>
        <div className="px-5 py-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
          <h3 className="text-sm font-bold text-slate-700">全量机构清单</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
                {["机构全称", "简称", "属地", "条线", "层级", "处室数", "对接人"].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodes.map(node => {
                const lineStyle = LINE_COLORS[node.verticalLine] ?? LINE_COLORS["工信条线"];
                return (
                  <tr key={node.id} className="hover:bg-slate-50 transition-colors" style={{ borderBottom: "1px solid #f8fafc" }}>
                    <td className="px-4 py-3 text-xs text-slate-700 font-medium">{node.fullName}</td>
                    <td className="px-4 py-3 text-xs text-slate-600">{node.shortName}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{node.jurisdiction}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: lineStyle.bg, color: lineStyle.text }}>
                        {node.verticalLine}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: `${LEVEL_COLORS[node.level]}18`, color: LEVEL_COLORS[node.level] }}>
                        {node.level}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">{node.divisions.length}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {[...new Set(node.divisions.map(d => d.assigneeName).filter(Boolean))].join("、")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 拓扑导图组件
// ══════════════════════════════════════════════════════════════════

interface TreeNode { name: string; value?: string; children?: TreeNode[]; itemStyle?: Record<string, string> }

// 层级对应的语义色（与 LEVEL_COLORS 对应）
const LEVEL_NODE_STYLE: Record<string, { color: string; borderColor: string }> = {
  "国家级": { color: "#fff1f2", borderColor: "#be123c" },  // rose
  "省级":   { color: "#f5f3ff", borderColor: "#6d28d9" },  // purple
  "市级":   { color: "#eff6ff", borderColor: "#1d4ed8" },  // blue
  "区级":   { color: "#ecfeff", borderColor: "#0e7490" },  // cyan
  "板块":   { color: "#fef3c7", borderColor: "#b45309" },  // amber
};

function buildLineTreeData(nodes: OdcNode[], regionName: string): TreeNode {
  const root: TreeNode = { name: regionName, children: [] };
  const linesMap = new Map<string, TreeNode>();
  nodes.forEach(node => {
    const lineColor = LINE_COLORS[node.verticalLine]?.dot ?? "#64748b";
    if (!linesMap.has(node.verticalLine)) {
      const lineNode: TreeNode = {
        name: node.verticalLine,
        children: [],
        itemStyle: { color: lineColor, borderColor: lineColor },
      };
      linesMap.set(node.verticalLine, lineNode);
      root.children!.push(lineNode);
    }
    const ns = LEVEL_NODE_STYLE[node.level] ?? { color: "#f8fafc", borderColor: "#94a3b8" };
    linesMap.get(node.verticalLine)!.children!.push({
      name: node.fullName || node.shortName,
      value: node.id,
      itemStyle: { color: ns.color, borderColor: ns.borderColor, borderWidth: "2" },
    });
  });
  return root;
}

function buildHierarchyTreeData(nodes: OdcNode[], regionName: string): TreeNode {
  const root: TreeNode = { name: regionName, children: [] };
  const levelMap = new Map<string, TreeNode>();
  nodes.forEach(node => {
    const area = node.level;
    const levelColor = LEVEL_COLORS[area] ?? "#64748b";
    if (!levelMap.has(area)) {
      const areaNode: TreeNode = {
        name: area,
        children: [],
        itemStyle: { color: levelColor, borderColor: levelColor },
      };
      levelMap.set(area, areaNode);
      root.children!.push(areaNode);
    }
    const ns = LEVEL_NODE_STYLE[area] ?? { color: "#f8fafc", borderColor: "#94a3b8" };
    levelMap.get(area)!.children!.push({
      name: node.fullName || node.shortName,
      value: node.id,
      itemStyle: { color: ns.color, borderColor: ns.borderColor, borderWidth: "2" },
    });
  });
  return root;
}

function OdcTreeGraph({ treeData, onNodeClick }: {
  treeData: TreeNode;
  onNodeClick: (nodeId: string) => void;
}) {
  const option = {
    tooltip: { trigger: 'item', triggerOn: 'mousemove', formatter: '{b}' },
    series: [{
      type: 'tree',
      data: [treeData],
      top: '5%', left: '15%', bottom: '5%', right: '22%',
      symbolSize: 12,
      symbol: 'roundRect',   // 圆角矩形节点，更现代
      // 🎯 关键：将 polyline（折线）改为 curve（平滑贝塞尔曲线）
      edgeShape: 'curve',
      edgeForkPosition: '63%',
      initialTreeDepth: 2,
      roam: true,
      // 连线：柔和的浅灰蓝色，适当透明度
      lineStyle: {
        color: '#cbd5e1',
        width: 1.5,
        opacity: 0.7,
        curveness: 0.5,
      },
      // 节点标签
      label: {
        position: 'right',
        verticalAlign: 'middle',
        align: 'left',
        fontSize: 12,
        color: '#334155',
        fontWeight: 500,
      },
      // 叶子节点标签（机构名）
      leaves: {
        label: {
          position: 'right',
          verticalAlign: 'middle',
          align: 'left',
          fontSize: 11,
          color: '#475569',
        },
      },
      // 节点 hover 效果
      emphasis: {
        focus: 'descendant',
        itemStyle: { shadowColor: 'rgba(0,0,0,0.2)', shadowBlur: 10 },
      },
      expandAndCollapse: true,
      animationDuration: 550,
      animationDurationUpdate: 750,
    }],
  };
  const onEvents = {
    'click': (params: { data?: { value?: string } }) => {
      if (params.data?.value) onNodeClick(params.data.value);
    },
  };
  return (
    <div className="w-full h-[700px] rounded-xl border border-slate-200 mt-4 overflow-hidden relative"
      style={{ background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)" }}>
      <div className="absolute top-4 right-4 text-xs text-slate-400 z-10 bg-white/70 px-2 py-1 rounded-lg backdrop-blur-sm">
        💡 滚轮缩放 · 拖拽平移 · 点击节点查看详情
      </div>
      <ReactECharts option={option} onEvents={onEvents} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
// 主页面组件
// ══════════════════════════════════════════════════════════════════

export default function OdcPage() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  const urlView         = searchParams.get("view") as "network" | "hierarchy" | "dashboard" | null;
  const urlLine         = searchParams.get("line");
  const urlLevel        = searchParams.get("level");
  const urlJurisdiction = searchParams.get("jurisdiction");

  const [viewMode,       setViewMode]       = useState<"network" | "hierarchy" | "dashboard">("network");
  const [displayMode,    setDisplayMode]    = useState<"matrix" | "graph">("matrix");
  const [activeLine,     setActiveLine]     = useState<string | null>(null);
  const [activeLevel,    setActiveLevel]    = useState<string | null>(null);
  const [activeJuris,    setActiveJuris]    = useState<string | null>(null);
  const [searchText,     setSearchText]     = useState("");
  const [selectedNode,   setSelectedNode]   = useState<OdcNode | null>(null);

  // CRUD 状态
  const [nodes,         setNodes]         = useState<OdcNode[]>(ODC_NODES);
  const [adminUsers,    setAdminUsers]    = useState<AdminUser[]>([]);
  const [showAddModal,  setShowAddModal]  = useState(false);
  const [editingNode,   setEditingNode]   = useState<OdcNode | null>(null);
  const [deleteTarget,  setDeleteTarget]  = useState<OdcNode | null>(null);
  const [odcToast,      setOdcToast]      = useState<{ type: "success" | "error"; msg: string } | null>(null);
  // 业务条线（动态）
  const [businessLines, setBusinessLines] = useState<{ id: string; name: string; sortOrder: number }[]>([]);
  const [showLinesMgmt, setShowLinesMgmt] = useState(false);
  const [newLineName,   setNewLineName]   = useState("");

  const showToast = useCallback((type: "success" | "error", msg: string, duration = 3000) => {
    setOdcToast({ type, msg });
    setTimeout(() => setOdcToast(null), duration);
  }, []);

  // 地域 Tabs：从数据库节点提取唯一地区，强制"中央部委"排第一，其余按出现顺序排列
  const sortedRegions = useMemo(() => {
    const available = Array.from(new Set(nodes.map(n => n.jurisdiction).filter(Boolean)));
    const others = available.filter(r => r !== '中央部委');
    return ['中央部委', ...others];
  }, [nodes]);
  const [activeRegion, setActiveRegion] = useState<string>('江苏省');

  // Initialize from URL params
  useEffect(() => {
    if (urlView && ["network", "hierarchy", "dashboard"].includes(urlView)) {
      setViewMode(urlView as "network" | "hierarchy" | "dashboard");
    }
    if (urlLine)         setActiveLine(urlLine);
    if (urlLevel)        setActiveLevel(urlLevel);
    if (urlJurisdiction) setActiveJuris(urlJurisdiction);
  }, [urlView, urlLine, urlLevel, urlJurisdiction]);

  const filteredNodes = useMemo(() => {
    // 先按地域 Tab 隔离（'all' 表示全国大盘，不限地区）
    let result = activeRegion === 'all' ? [...nodes] : nodes.filter(n => n.jurisdiction === activeRegion);
    if (activeLine)  result = result.filter(n => n.verticalLine === activeLine);
    if (activeLevel) result = result.filter(n => n.level === activeLevel);
    if (activeJuris) result = result.filter(n => n.jurisdiction === activeJuris);
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase();
      result = result.filter(n =>
        n.fullName.toLowerCase().includes(kw) ||
        n.shortName.toLowerCase().includes(kw) ||
        n.divisions.some(d => d.name.toLowerCase().includes(kw) || (d.assigneeName ?? "").toLowerCase().includes(kw))
      );
    }
    return result;
  }, [nodes, activeRegion, activeLine, activeLevel, activeJuris, searchText]);

  function clearFilters() {
    setActiveLine(null);
    setActiveLevel(null);
    setActiveJuris(null);
    setSearchText("");
    router.push("/dashboard/odc");
  }

  function handleRegionChange(region: string) {
    setActiveRegion(region);
    setActiveLine(null);
    setActiveLevel(null);
    setActiveJuris(null);
    setSearchText("");
    setDisplayMode("matrix");
  }

  function handleNodeClickById(nodeId: string) {
    const node = nodes.find(n => n.id === nodeId);
    if (node) setSelectedNode(node);
  }

  // ── 加载业务条线（动态字典） ──
  useEffect(() => {
    async function loadLines() {
      // 初始化：若 DB 为空则预置默认条线
      await seedDefaultOdcLines();
      const lines = await getOdcLines();
      setBusinessLines(lines.map(l => ({ id: l.id, name: l.name, sortOrder: l.sortOrder })));
    }
    loadLines().catch(() => {});
  }, []);

  // ── 加载后台用户（对接人下拉源） ──
  useEffect(() => {
    fetch("/api/users?take=200")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data.users)) {
          setAdminUsers(data.users.map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })));
        }
      })
      .catch(() => {});
  }, []);

  // ── 加载数据库中用户自建的机构（合并到 ODC_NODES 静态数据后面）──
  useEffect(() => {
    fetch("/api/odc/institutions")
      .then(r => r.json())
      .then((data: { id: string; shortName: string; fullName: string; jurisdiction: string; verticalLine: string; level: string; divisions: unknown }[]) => {
        if (Array.isArray(data)) {
          const dbNodes: OdcNode[] = data.map(inst => ({
            id:           inst.id,
            shortName:    inst.shortName,
            fullName:     inst.fullName,
            jurisdiction: inst.jurisdiction,
            verticalLine: inst.verticalLine,
            level:        inst.level,
            divisions:    (inst.divisions as OdcDivision[]) ?? [],
          }));
          // DB 有数据时，用 DB 数据完全替代静态节点（保证硬重置后精确显示 48 条）
          // DB 为空时保留 ODC_NODES 静态兜底数据
          if (dbNodes.length > 0) {
            setNodes(dbNodes);
          }
        }
      })
      .catch(() => {});
  }, []);

  // ── CRUD 函数（已连接 Server Actions，数据持久化到 DB）──
  async function createInstitution(data: Partial<OdcNode>) {
    try {
      const result = await createOdcInstitution({
        shortName:    data.shortName    ?? "",
        fullName:     data.fullName     ?? "",
        jurisdiction: data.jurisdiction ?? "江苏省",
        verticalLine: data.verticalLine ?? "工信条线",
        level:        data.level        ?? "市级",
        divisions:    data.divisions    ?? [],
      });
      if (result.success && result.id) {
        const newNode: OdcNode = {
          id:           result.id,
          jurisdiction: data.jurisdiction ?? "江苏省",
          verticalLine: data.verticalLine ?? "工信条线",
          level:        data.level        ?? "市级",
          fullName:     data.fullName     ?? "",
          shortName:    data.shortName    ?? "",
          divisions:    data.divisions    ?? [],
        };
        setNodes(prev => [...prev, newNode]);
        setShowAddModal(false);
        showToast("success", "机构创建成功");
      } else {
        showToast("error", `创建失败：${result.error ?? "未知错误"}`);
      }
    } catch (e) {
      showToast("error", `网络错误：${(e as Error).message}`);
    }
  }

  async function updateNode(updated: OdcNode) {
    try {
      const result = await upsertOdcInstitution(updated.id, {
        shortName:    updated.shortName,
        fullName:     updated.fullName,
        jurisdiction: updated.jurisdiction,
        verticalLine: updated.verticalLine,
        level:        updated.level,
        divisions:    updated.divisions,
      });
      if (result.success) {
        setNodes(prev => prev.map(n => n.id === updated.id ? updated : n));
        setEditingNode(null);
        setSelectedNode(prev => prev?.id === updated.id ? updated : prev);
        showToast("success", "保存成功");
      } else {
        showToast("error", `保存失败：${result.error ?? "未知错误"}`);
      }
    } catch (e) {
      showToast("error", `网络错误：${(e as Error).message}`);
    }
  }

  async function deleteInstitution(id: string) {
    try {
      const result = await deleteOdcInstitution(id);
      if (result.success) {
        setNodes(prev => prev.filter(n => n.id !== id));
        setDeleteTarget(null);
        setSelectedNode(prev => prev?.id === id ? null : prev);
        showToast("success", "删除成功");
      } else {
        showToast("error", `删除失败：${result.error ?? "未知错误"}`);
      }
    } catch (e) {
      showToast("error", `网络错误：${(e as Error).message}`);
    }
  }

  const hasFilter = activeLine || activeLevel || activeJuris || searchText;

  const VIEW_TABS = [
    { key: "network"    as const, label: "条线网络视图", icon: <Network size={14} /> },
    { key: "hierarchy"  as const, label: "行政层级视图", icon: <Globe size={14} /> },
    { key: "dashboard"  as const, label: "数据大屏",    icon: <LayoutDashboard size={14} /> },
  ];

  return (
    <div className="flex-1 overflow-auto bg-slate-50 flex flex-col">
      {/* Toast 通知 */}
      {odcToast && (
        <div className={`fixed bottom-6 right-6 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
          odcToast.type === "success" ? "bg-emerald-600 text-white" : "bg-red-600 text-white"
        }`}>
          {odcToast.type === "success" ? "✓" : "✕"} {odcToast.msg}
        </div>
      )}

      {/* 情报抽屉 */}
      {selectedNode && (
        <IntelligenceDrawer
          node={selectedNode}
          adminUsers={adminUsers}
          onUpdateNode={updateNode}
          onToast={showToast}
          onClose={() => setSelectedNode(null)}
        />
      )}

      {/* 新增机构弹窗 */}
      {showAddModal && (
        <InstitutionFormModal
          adminUsers={adminUsers}
          lines={businessLines}
          onSubmit={createInstitution}
          onClose={() => setShowAddModal(false)}
        />
      )}

      {/* 编辑机构弹窗 */}
      {editingNode && (
        <InstitutionFormModal
          initial={editingNode}
          adminUsers={adminUsers}
          lines={businessLines}
          onSubmit={data => updateNode({ ...editingNode, ...data } as OdcNode)}
          onClose={() => setEditingNode(null)}
        />
      )}

      {/* 删除确认弹窗 */}
      {deleteTarget && (
        <DeleteConfirmDialog
          node={deleteTarget}
          onConfirm={() => deleteInstitution(deleteTarget.id)}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {/* 页面头部 */}
      <PageHeaderWithConfig
        pageId="odc"
        defaultTitle="ODC 政企关系网络"
        defaultDescription="全国政务资源对接矩阵、政策情报中枢与沟通网络"
        gradient="linear-gradient(135deg, #0f172a 0%, #1e3a5f 40%, #064e3b 100%)"
        rightSlot={
          <div className="flex items-center gap-2">
            {/* 主视图切换胶囊（玻璃态） */}
            <div className="flex gap-0.5 p-1 rounded-xl" style={{ background: "rgba(255,255,255,0.1)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.1)" }}>
              {VIEW_TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setViewMode(tab.key); setDisplayMode("matrix"); }}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
                  style={
                    viewMode === tab.key
                      ? { background: "rgba(255,255,255,0.2)", color: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }
                      : { color: "rgba(255,255,255,0.6)" }
                  }
                  onMouseEnter={e => { if (viewMode !== tab.key) e.currentTarget.style.color = "#fff"; e.currentTarget.style.background = viewMode !== tab.key ? "rgba(255,255,255,0.05)" : e.currentTarget.style.background; }}
                  onMouseLeave={e => { if (viewMode !== tab.key) { e.currentTarget.style.color = "rgba(255,255,255,0.6)"; e.currentTarget.style.background = ""; } }}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>
            {/* 矩阵/导图子切换（玻璃态，仅 network/hierarchy 下显示） */}
            {(viewMode === "network" || viewMode === "hierarchy") && (
              <div className="flex p-1 rounded-lg" style={{ background: "rgba(255,255,255,0.1)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.1)" }}>
                <button
                  onClick={() => setDisplayMode("matrix")}
                  className="px-2.5 py-1 rounded text-xs font-medium transition-all"
                  style={displayMode === "matrix" ? { background: "rgba(255,255,255,0.2)", color: "#fff" } : { color: "rgba(255,255,255,0.55)" }}
                >
                  🗂️ 矩阵
                </button>
                <button
                  onClick={() => setDisplayMode("graph")}
                  className="px-2.5 py-1 rounded text-xs font-medium transition-all"
                  style={displayMode === "graph" ? { background: "rgba(255,255,255,0.2)", color: "#fff" } : { color: "rgba(255,255,255,0.55)" }}
                >
                  🕸️ 导图
                </button>
              </div>
            )}
          </div>
        }
      />

      {/* 地域维度隔离 Tabs */}
      <div className="px-6 bg-white flex-shrink-0" style={{ borderBottom: "1px solid #e2e8f0" }}>
        <div className="flex space-x-6 overflow-x-auto scrollbar-hide [&::-webkit-scrollbar]:hidden">
          {/* 全国大盘总控 Tab */}
          <button
            onClick={() => handleRegionChange('all')}
            className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
              activeRegion === 'all'
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
            }`}
          >
            <span className="mr-1">🌐</span> 全部 / 全国大盘
          </button>
          {sortedRegions.map(region => (
            <button
              key={region}
              onClick={() => handleRegionChange(region)}
              className={`py-3 px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors ${
                activeRegion === region
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              }`}
            >
              {region === '中央部委' ? '🇨🇳 中央/国家部委' : `📍 ${region}`}
            </button>
          ))}
        </div>
      </div>

      {/* 筛选区 — 三行极致压缩布局 */}
      <div className="px-6 py-2 bg-white flex-shrink-0 space-y-2" style={{ borderBottom: "1px solid #e2e8f0" }}>

        {/* 第一行：搜索框 + 新增按钮（视图切换已移至顶栏） */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1">
            <div className="relative min-w-[200px] max-w-[300px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="搜索机构名称、处室、对接人..."
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-xl bg-slate-50 outline-none"
                style={{ border: "1px solid #e2e8f0" }}
              />
            </div>
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white transition-all hover:opacity-90 shrink-0"
              style={{ background: "linear-gradient(135deg, #2563eb, #7c3aed)" }}
            >
              <Plus size={13} /> 新增机构/部门
            </button>
            {hasFilter && (
              <button onClick={clearFilters} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100 shrink-0">
                <X size={12} />清除筛选
              </button>
            )}
            <span className="text-xs text-slate-400 ml-1 shrink-0">{filteredNodes.length} 个机构</span>
          </div>
        </div>

        {/* 第二行：业务条线气泡（动态 DB 数据，"其他条线"置底） */}
        <div className="flex items-center flex-wrap gap-1.5">
          {businessLines.sort((a, b) => a.name === "其他条线" ? 1 : b.name === "其他条线" ? -1 : a.sortOrder - b.sortOrder).map(line => {
            const style = LINE_COLORS[line.name] ?? LINE_COLORS["其他条线"];
            const active = activeLine === line.name;
            return (
              <button
                key={line.id}
                onClick={() => setActiveLine(active ? null : line.name)}
                className="text-xs px-2.5 py-1 rounded-full font-medium transition-all"
                style={{
                  background: active ? style.bg : "transparent",
                  color: active ? style.text : "#64748b",
                  border: `1px solid ${active ? style.border : "#e2e8f0"}`,
                }}
              >
                {line.name}
              </button>
            );
          })}
          {/* 管理条线按钮 */}
          <button
            type="button"
            onClick={() => setShowLinesMgmt(true)}
            className="text-xs px-2 py-0.5 rounded-full border border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 transition-colors"
          >
            ⚙️ 管理条线
          </button>
        </div>

        {/* 第三行：行政层级气泡 */}
        <div className="flex items-center flex-wrap gap-1.5">
          {ALL_LEVELS.map(lvl => {
            const active = activeLevel === lvl;
            const color  = LEVEL_COLORS[lvl];
            return (
              <button
                key={lvl}
                onClick={() => setActiveLevel(active ? null : lvl)}
                className="text-xs px-2.5 py-1 rounded-full font-medium transition-all"
                style={{
                  background: active ? `${color}15` : "transparent",
                  color: active ? color : "#64748b",
                  border: `1px solid ${active ? `${color}40` : "#e2e8f0"}`,
                }}
              >
                {lvl}
              </button>
            );
          })}
        </div>
      </div>

      {/* 管理条线弹窗 */}
      {showLinesMgmt && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowLinesMgmt(false); }}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">⚙️ 管理业务条线</h3>
              <button type="button" onClick={() => setShowLinesMgmt(false)} className="p-1 text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {businessLines.map(line => (
                <div key={line.id} className="flex items-center justify-between px-3 py-1.5 rounded-lg hover:bg-slate-50">
                  <span className="text-sm text-slate-700">{line.name}</span>
                  {line.name !== "其他条线" && (
                    <button type="button"
                      onClick={async () => {
                        if (!confirm(`确认删除「${line.name}」？`)) return;
                        await deleteOdcLine(line.id);
                        const lines = await getOdcLines();
                        setBusinessLines(lines.map(l => ({ id: l.id, name: l.name, sortOrder: l.sortOrder })));
                      }}
                      className="p-0.5 text-slate-300 hover:text-red-500 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-1 border-t border-slate-100">
              <input
                className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-200"
                placeholder="新条线名称..."
                value={newLineName}
                onChange={e => setNewLineName(e.target.value)}
              />
              <button type="button"
                onClick={async () => {
                  if (!newLineName.trim()) return;
                  await createOdcLine(newLineName.trim());
                  setNewLineName("");
                  const lines = await getOdcLines();
                  setBusinessLines(lines.map(l => ({ id: l.id, name: l.name, sortOrder: l.sortOrder })));
                }}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-medium hover:bg-blue-700">
                + 新增
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 overflow-auto">
        {filteredNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Building2 size={40} className="mb-3 opacity-30" />
            <p className="text-sm">未找到匹配的机构</p>
            <button onClick={clearFilters} className="mt-3 text-xs text-blue-500 hover:underline">清除所有筛选</button>
          </div>
        ) : viewMode === "network" && displayMode === "graph" ? (
          <div className="px-6 py-4">
            <OdcTreeGraph
              treeData={buildLineTreeData(filteredNodes, activeRegion === 'all' ? '全国大盘' : activeRegion)}
              onNodeClick={handleNodeClickById}
            />
          </div>
        ) : viewMode === "hierarchy" && displayMode === "graph" ? (
          <div className="px-6 py-4">
            <OdcTreeGraph
              treeData={buildHierarchyTreeData(filteredNodes, activeRegion === 'all' ? '全国大盘' : activeRegion)}
              onNodeClick={handleNodeClickById}
            />
          </div>
        ) : viewMode === "network" ? (
          <LineNetworkView
            nodes={filteredNodes}
            activeLine={activeLine}
            onNodeClick={setSelectedNode}
            onEdit={setEditingNode}
            onDelete={setDeleteTarget}
          />
        ) : viewMode === "hierarchy" ? (
          <HierarchyView
            nodes={filteredNodes}
            activeJurisdiction={activeJuris}
            onNodeClick={setSelectedNode}
            onEdit={setEditingNode}
            onDelete={setDeleteTarget}
          />
        ) : (
          <DashboardView
            nodes={filteredNodes}
            setActiveLine={setActiveLine}
            setActiveLevel={setActiveLevel}
            setActiveRegion={setActiveRegion}
            setViewMode={setViewMode}
            setDisplayMode={setDisplayMode}
          />
        )}
      </div>
    </div>
  );
}
