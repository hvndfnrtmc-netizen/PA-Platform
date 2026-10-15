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
export const PROJECTS: Project[] = [];

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
