/**
 * Zod validation schemas for Reception API routes.
 *
 * Usage in route handlers:
 *   import { createReceptionSchema } from '@/lib/validations/reception';
 *   const parsed = createReceptionSchema.parse(await request.json());
 *
 * Or with withErrorHandler:
 *   export const POST = withErrorHandler(async (request) => {
 *     const body = createReceptionSchema.parse(await request.json());
 *     // body is fully typed and validated
 *   });
 */

import { z } from 'zod';

// ── Reception create/update ────────────────────────────────────────

export const createReceptionSchema = z.object({
  name: z.string().min(1, '接待名称不能为空').max(200, '接待名称过长'),
  date: z.string().datetime('日期格式无效').or(z.string().min(1)),
  format: z.string().min(1, '接待形式不能为空').max(100),
  hostName: z.string().min(1, '接待人不能为空').max(100),
  hostPhone: z.string().max(50).optional(),
  guests: z.string().max(2000).optional(),
  department: z.string().max(200).optional(),
  location: z.string().max(500).optional(),
  remark: z.string().max(2000).optional(),
  todoList: z.array(z.unknown()).optional(),
});

export const updateReceptionSchema = createReceptionSchema.partial();

export const receptionIdSchema = z.object({
  id: z.string().min(1, 'ID不能为空'),
});

// ── Reception todo ─────────────────────────────────────────────────

export const createTodoSchema = z.object({
  title: z.string().min(1, '待办标题不能为空').max(200),
  description: z.string().max(2000).optional(),
  assigneeId: z.string().min(1, '指派人不能为空'),
  dueDate: z.string().datetime().optional(),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const updateTodoSchema = createTodoSchema.partial();

// ── Reception query params ─────────────────────────────────────────

export const receptionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(200).optional(),
  status: z.string().max(50).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
