/**
 * Structured logger — replaces raw console.log/error/warn in API routes.
 *
 * Usage:
 *   import { logger } from '@/lib/logger';
 *   logger.info('Sync complete', { count: 42 });
 *   logger.error('Database connection failed', err);
 *
 * In production: logs to stderr (Vercel captures this).
 * In development: pretty-prints with colors.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogMeta {
  [key: string]: unknown;
}

const isDev = process.env.NODE_ENV !== 'production';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const MIN_PRIORITY = isDev ? LEVEL_PRIORITY.debug : LEVEL_PRIORITY.info;

function formatMessage(level: LogLevel, message: string, meta?: LogMeta): string {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (!meta || Object.keys(meta).length === 0) {
    return `${prefix} ${message}`;
  }

  return `${prefix} ${message} ${JSON.stringify(meta)}`;
}

export const logger = {
  debug(message: string, meta?: LogMeta): void {
    if (LEVEL_PRIORITY.debug < MIN_PRIORITY) return;
    if (isDev) {
      console.debug(formatMessage('debug', message, meta));
    }
  },

  info(message: string, meta?: LogMeta): void {
    if (LEVEL_PRIORITY.info < MIN_PRIORITY) return;
    console.log(formatMessage('info', message, meta));
  },

  warn(message: string, meta?: LogMeta): void {
    if (LEVEL_PRIORITY.warn < MIN_PRIORITY) return;
    console.warn(formatMessage('warn', message, meta));
  },

  error(message: string, error?: unknown, meta?: LogMeta): void {
    const errorMeta: LogMeta = { ...meta };
    if (error instanceof Error) {
      errorMeta.name = error.name;
      errorMeta.message = error.message;
      if (isDev) {
        errorMeta.stack = error.stack;
      }
    } else if (error !== undefined) {
      errorMeta.error = String(error);
    }
    console.error(formatMessage('error', message, errorMeta));
  },
};
