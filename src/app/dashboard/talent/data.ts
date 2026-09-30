// ============================================================
// 人才福利模块 — 静态数据层（对应原 data.js）
// 维护说明：修改 PROJECTS 数组中的字段即可更新看板数据
// ============================================================

export interface NodeTemplate {
  id:    string;
  name:  string;
  order: number;
}

export interface Project {
  id:               string;
  name:             string;
  city:             string;
  company:          string;
  startYear?:       number;
  endYear?:         number;
  totalPeople:      number;
  completedPeople:  number;
  currentNode:      string;
  status:           "进行中" | "已完成" | "停滞";
  deadline:         string | null;
  feishuUrl:        string;
  applyUrl:         string;
}

// ── 节点模板表 ──────────────────────────────────────────────
export const NODE_TEMPLATES: NodeTemplate[] = [
  { id: "n1", name: "公司资质申报",       order: 1 },
  { id: "n2", name: "个人申报",           order: 2 },
  { id: "n3", name: "单位审核",           order: 3 },
  { id: "n4", name: "主管部门审核",       order: 4 },
  { id: "n5", name: "现场核验",           order: 5 },
  { id: "n6", name: "等待公示",           order: 6 },
  { id: "n7", name: "奖金发放",           order: 7 },
  { id: "n8", name: "等待分批次奖金发放", order: 8 },
];

// ── 项目基本信息表 ───────────────────────────────────────────
// feishuUrl  : 飞书云文档链接（查看详情按钮）
// applyUrl   : 申报系统链接（处理待办按钮）
// completedPeople : 已完成人数（手动维护）
export const PROJECTS: Project[] = [
  {
    id: "P001",
    name: "2026年度相城区产业人才",
    city: "苏州",
    company: "SZmomenta",
    totalPeople: 180,
    completedPeople: 120,
    currentNode: "n2",
    status: "进行中",
    deadline: "2026-03-31",
    feishuUrl: "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=6f8s32cf-8a79-441e-9fba-ae877641476b",
    applyUrl:  "https://www.szxchr.com/a",
  },
  {
    id: "P002",
    name: "2024年度姑苏紧缺人才",
    city: "苏州",
    company: "SZmomenta / SZ初速度",
    startYear: 2024,
    endYear: 2026,
    totalPeople: 22,
    completedPeople: 22,
    currentNode: "n8",
    status: "进行中",
    deadline: null,
    feishuUrl: "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=203u7efd-6e07-478a-a242-8e155228539e",
    applyUrl:  "https://rcsz.hrss.suzhou.com.cn/#/",
  },
  {
    id: "P003",
    name: "2025年度姑苏紧缺人才",
    city: "苏州",
    company: "SZmomenta / SZ初速度",
    startYear: 2025,
    endYear: 2027,
    totalPeople: 24,
    completedPeople: 10,
    currentNode: "n6",
    status: "进行中",
    deadline: null,
    feishuUrl: "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=60do7de8-e81b-4cc1-97a7-e2cdd0a1c14d",
    applyUrl:  "https://rcsz.hrss.suzhou.com.cn/#/",
  },
  {
    id: "P004",
    name: "2025年度苏州市优秀人才",
    city: "苏州",
    company: "SZmomenta / SZ初速度",
    totalPeople: 22,
    completedPeople: 22,
    currentNode: "n6",
    status: "进行中",
    deadline: null,
    feishuUrl: "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=310u1f16-c40f-414d-bcd5-8db48641d0d9",
    applyUrl:  "https://rcsz.hrss.suzhou.com.cn/#/",
  },
  {
    id: "P005",
    name: "2024相城区安家补贴（老政策最后一批）",
    city: "苏州",
    company: "SZmomenta / SZ初速度",
    startYear: 2024,
    endYear: 2027,
    totalPeople: 11,
    completedPeople: 8,
    currentNode: "n8",
    status: "进行中",
    deadline: null,
    feishuUrl: "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=a9ejce5a-4bdb-45b9-a15c-0f7578688592",
    applyUrl:  "https://www.szxchr.com/a",
  },
  {
    id: "P006",
    name: "相城区人才房票（月度常态化）",
    city: "苏州",
    company: "SZmomenta / SZ初速度",
    totalPeople: 20,
    completedPeople: 20,
    currentNode: "n2",
    status: "已完成",
    deadline: null,
    feishuUrl: "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=234l78d6-ca57-43a3-9034-9d3f2f13c389",
    applyUrl:  "https://docs.qq.com/sheet/DQ1NWaE5TY0JRZUNr",
  },
  {
    id: "P007",
    name: "相城区重点产业人才薪酬补贴（月度常态化）",
    city: "苏州",
    company: "SZmomenta / SZ初速度 / 新芯航途",
    totalPeople: 100,
    completedPeople: 100,
    currentNode: "n2",
    status: "已完成",
    deadline: null,
    feishuUrl: "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=61eo83d7-b67a-427a-a944-d4804cb46581",
    applyUrl:  "https://www.szxchr.com/a",
  },
  {
    id: "P008",
    name: "2026年度深圳市境外人才奖励",
    city: "深圳",
    company: "深圳初速度",
    totalPeople: 3,
    completedPeople: 3,
    currentNode: "n4",
    status: "进行中",
    deadline: "2026-04-10",
    feishuUrl: "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=574n82db-c0fa-4c66-b4d9-a9b0ecc98a92",
    applyUrl:  "https://www.gdzwfw.gov.cn/",
  },
];

// ── 工具函数 ──────────────────────────────────────────────────

/** 获取某项目完成进度百分比 */
export function getProjectProgress(project: Project): number {
  if (!project.totalPeople) return 0;
  return Math.round((project.completedPeople / project.totalPeople) * 100);
}

/** 计算距截止日期剩余天数（负数表示已逾期） */
export function getDaysLeft(deadline: string): number {
  return Math.ceil((new Date(deadline).getTime() - Date.now()) / 86_400_000);
}
