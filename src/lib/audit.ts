/**
 * 审计日志工具函数
 * 所有 PA 账号的查询、导出、高危操作均通过此函数记录
 */

import prisma from "@/lib/prisma";
import { AuditAction, Prisma } from "@prisma/client";

interface AuditParams {
  userId: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  isDangerous?: boolean;
  feishuVerifyToken?: string;
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        resourceType: params.resourceType,
        resourceId: params.resourceId,
        metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        isDangerous: params.isDangerous ?? false,
        feishuVerifyToken: params.feishuVerifyToken,
      },
    });
  } catch (err) {
    // 审计日志写入失败不应中断业务，但必须上报
    console.error("[AuditLog] 写入失败:", err);
  }
}

export { AuditAction };
