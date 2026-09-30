/**
 * withErrorHandler — unified API route handler wrapper.
 *
 * Wraps a Next.js App Router route handler with:
 * - Automatic try/catch (no more boilerplate per route)
 * - Structured error logging via logger
 * - Consistent JSON error response format
 * - Zod validation error → 400
 * - Auth error → 401
 * - Prisma known errors → appropriate status codes
 *
 * Usage:
 *   import { withErrorHandler } from '@/lib/api-handler';
 *
 *   export const GET = withErrorHandler(async (request, context) => {
 *     const data = await prisma.user.findMany();
 *     return Response.json(data);
 *   });
 *
 *   export const POST = withErrorHandler(async (request, context) => {
 *     const body = await request.json();
 *     const parsed = createUserSchema.parse(body); // ZodValidationError → 400
 *     ...
 *   });
 */

import { logger } from './logger';

type RouteContext = { params: Promise<Record<string, string | string[]>> };

type RouteHandler = (
  request: Request,
  context: RouteContext
) => Promise<Response> | Response;

// ── Custom error classes for predictable status codes ──────────────

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class ValidationError extends HttpError {
  constructor(message: string, public details?: unknown) {
    super(400, message, details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends HttpError {
  constructor(message = 'Unauthorized') {
    super(401, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not Found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

// ── Prisma error detection (without importing Prisma types) ─────────

function isPrismaError(error: unknown): { status: number; message: string } | null {
  if (!(error instanceof Error)) return null;

  // PrismaClientKnownRequestError
  const code = (error as { code?: string }).code;
  if (!code) return null;

  switch (code) {
    case 'P2002':
      return { status: 409, message: '数据已存在（唯一约束冲突）' };
    case 'P2025':
      return { status: 404, message: '记录不存在' };
    case 'P2003':
      return { status: 400, message: '外键约束失败，请检查关联数据' };
    default:
      return { status: 500, message: `数据库错误 (${code})` };
  }
}

// ── Zod error detection ────────────────────────────────────────────

function isZodError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'ZodError' || error.name === 'ZodValidationError')
  );
}

// ── Main HOC ────────────────────────────────────────────────────────

export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (request: Request, context: RouteContext): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (error) {
      // HttpError subclasses — use the embedded status code
      if (error instanceof HttpError) {
        if (error.statusCode >= 500) {
          logger.error('API HttpError (5xx)', error, { path: request.url });
        } else {
          logger.warn('API HttpError', {
            status: error.statusCode,
            message: error.message,
            path: request.url,
          });
        }
        return Response.json(
          { error: error.message, details: error.details },
          { status: error.statusCode }
        );
      }

      // Zod validation error → 400
      if (isZodError(error)) {
        const details = (error as { errors?: unknown[] }).errors ||
          (error as { issues?: unknown[] }).issues ||
          (error as { format?: () => unknown }).format?.();
        logger.warn('Validation error', { path: request.url, details });
        return Response.json(
          { error: '请求参数校验失败', details },
          { status: 400 }
        );
      }

      // Prisma known errors
      const prismaResult = isPrismaError(error);
      if (prismaResult) {
        logger.error('Prisma error', error, { path: request.url });
        return Response.json(
          { error: prismaResult.message },
          { status: prismaResult.status }
        );
      }

      // Unknown error — don't leak internals
      logger.error('Unhandled API error', error, { path: request.url });
      const message =
        error instanceof Error ? error.message : 'Internal Server Error';
      return Response.json(
        { error: process.env.NODE_ENV === 'production' ? '服务器内部错误' : message },
        { status: 500 }
      );
    }
  };
}
