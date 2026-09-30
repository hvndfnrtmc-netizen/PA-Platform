/**
 * Zod validation schemas for Users & Auth API routes.
 */

import { z } from 'zod';

export const userIdSchema = z.object({
  id: z.string().min(1, '用户ID不能为空'),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  displayName: z.string().max(100).optional(),
  email: z.string().email('邮箱格式无效').optional(),
  phone: z.string().max(50).optional(),
  department: z.string().max(200).optional(),
  role: z.enum(['admin', 'user', 'viewer']).optional(),
  feishuOpenId: z.string().optional(),
  feishuUserId: z.string().optional(),
});

export const userQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  department: z.string().optional(),
  role: z.enum(['admin', 'user', 'viewer']).optional(),
});

// ── Department ─────────────────────────────────────────────────────

export const createDepartmentSchema = z.object({
  name: z.string().min(1, '部门名称不能为空').max(200),
  type: z.string().max(50).optional(),
  feishuDeptId: z.string().max(100).optional(),
  parentId: z.string().optional(),
  sortOrder: z.number().int().min(0).default(0),
});

export const updateDepartmentSchema = createDepartmentSchema.partial();

// ── Common pagination (reusable across modules) ────────────────────

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateUserInput = z.infer<typeof updateUserSchema>;
