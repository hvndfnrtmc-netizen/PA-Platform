/**
 * 核心业务类型定义
 * 基于 PRD 三类角色与核心流转状态
 */

import type {
  User,
  Department,
  Task,
  TaskAssignment,
  Asset,
  AssetVersion,
  TaskTemplate,
  Document,
  AuditLog,
} from "@prisma/client";

export type {
  User,
  Department,
  Task,
  TaskAssignment,
  Asset,
  AssetVersion,
  TaskTemplate,
  Document,
  AuditLog,
};

export { UserRole, DepartmentType, TaskType, TaskStatus, AssignmentStatus, AssetCategory, AuditAction } from "@prisma/client";

// ── 带关联关系的复合类型 ────────────────────────────────────

export type TaskWithAssignments = Task & {
  assignments: (TaskAssignment & {
    department: Department;
  })[];
  createdBy: Pick<User, "id" | "name" | "email">;
};

export type AssetWithSource = Asset & {
  sourceTask: Pick<Task, "id" | "title"> | null;
  createdBy: Pick<User, "id" | "name">;
  versions: AssetVersion[];
};

export type DepartmentTree = Department & {
  children: DepartmentTree[];
  contactUser: Pick<User, "id" | "name" | "email"> | null;
};

// ── API 响应类型 ─────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// ── 分页 ─────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── 资产大盘汇总 ─────────────────────────────────────────────

export interface AssetDashboardSummary {
  category: string;
  categoryLabel: string;
  latestPeriod: string;
  latestPeriodLabel: string;
  metrics: {
    metricKey: string;
    metricName: string;
    value: string;
    unit: string | null;
    sourceFeishuUrl: string | null;
  }[];
}
