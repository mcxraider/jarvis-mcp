import winston from 'winston';
import { TelemetryContext, LogFields } from '../observability/types';

const REDACTED = '[REDACTED]';
const TELEGRAM_FILE_URL_PATTERN = /https:\/\/api\.telegram\.org\/file\/bot[^\s"]+/g;
const ENV_SECRET_KEYS = ['BOT_TOKEN', 'TELEGRAM_SECRET_TOKEN', 'OPENAI_API_KEY', 'TODOIST_API_KEY'];

function getLogLevel(): string {
  if (process.env.LOG_LEVEL) {
    return process.env.LOG_LEVEL;
  }

  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function sanitizeString(value: string): string {
  let sanitized = value.replace(TELEGRAM_FILE_URL_PATTERN, REDACTED);

  for (const envKey of ENV_SECRET_KEYS) {
    const secret = process.env[envKey];
    if (secret) {
      sanitized = sanitized.split(secret).join(REDACTED);
    }
  }

  return sanitized;
}

function sanitizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return serializeError(value);
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        sanitizeValue(nestedValue),
      ]),
    );
  }

  return value;
}

const sanitizeFormat = winston.format((info) => sanitizeValue(info) as winston.Logform.TransformableInfo);

const baseLogger = winston.createLogger({
  level: getLogLevel(),
  defaultMeta: {
    service: process.env.SERVICE_NAME || 'jarvis-mcp',
    env: process.env.NODE_ENV || 'development',
    version: process.env.SERVICE_VERSION || process.env.npm_package_version || 'unknown',
  },
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    sanitizeFormat(),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});

export const logger = baseLogger;

export function serializeError(error: unknown): LogFields {
  if (!(error instanceof Error)) {
    return {
      errorMessage: typeof error === 'string' ? sanitizeString(error) : 'Unknown error',
    };
  }

  const normalized = error as Error & { code?: string };
  return {
    errorName: normalized.name,
    errorMessage: sanitizeString(normalized.message),
    errorStack: normalized.stack ? sanitizeString(normalized.stack) : undefined,
    errorCode: normalized.code,
  };
}

export function getLogger(context?: TelemetryContext): winston.Logger {
  if (!context) {
    return baseLogger;
  }

  return baseLogger.child(
    Object.fromEntries(
      Object.entries(context).filter(([, value]) => value !== undefined),
    ) as TelemetryContext,
  );
}

export function createComponentLogger(
  component: string,
  context?: TelemetryContext,
): winston.Logger {
  if (!context) {
    return baseLogger.child({ component });
  }

  return getLogger(context).child({ component });
}

export function sanitizeForLogging(value: unknown): unknown {
  return sanitizeValue(value);
}
