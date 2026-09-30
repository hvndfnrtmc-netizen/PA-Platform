/**
 * Zod validation schemas for Tasks API routes.
 */

import { z } from 'zod';

export const createTaskSchema = z.object({
  title: z.string().min(1, '任务标题不能为空').max(200),
  description: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  dueDate: z.string().datetime().optional(),
  assigneeIds: z.array(z.string().min(1)).min(1, '至少指定一个执行人'),
  parentId: z.string().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const updateTaskSchema = createTaskSchema.partial();

export const taskIdSchema = z.object({
  id: z.string().min(1, '任务ID不能为空'),
});

export const taskQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'in_progress', 'completed', 'overdue']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  assigneeId: z.string().optional(),
  search: z.string().max(200).optional(),
});

// ── Task assignment ────────────────────────────────────────────────

export const assignTaskSchema = z.object({
  taskId: z.string().min(1),
  assigneeIds: z.array(z.string().min(1)).min(1, '至少指定一个执行人'),
});

export const updateAssignmentStatusSchema = z.object({
  assignmentId: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'completed']),
  remark: z.string().max(500).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
