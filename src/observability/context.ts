import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID, createHash } from 'crypto';
import { TelemetryContext } from './types';

const telemetryStorage = new AsyncLocalStorage<TelemetryContext>();

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as T;
}

export function createTelemetryContext(context: Partial<TelemetryContext> = {}): TelemetryContext {
  return stripUndefined({
    requestId: context.requestId || randomUUID(),
    updateId: context.updateId,
    chatId: context.chatId,
    userId: context.userId,
    messageType: context.messageType,
    jobId: context.jobId,
    component: context.component,
    stage: context.stage,
  });
}

export function extendTelemetryContext(
  context: TelemetryContext | undefined,
  patch: Partial<TelemetryContext>,
): TelemetryContext {
  return createTelemetryContext({
    ...(context || {}),
    ...patch,
  });
}

export function runWithTelemetryContext<T>(
  context: TelemetryContext,
  callback: () => T | Promise<T>,
): T | Promise<T> {
  return telemetryStorage.run(context, callback);
}

export function getTelemetryContext(): TelemetryContext | undefined {
  return telemetryStorage.getStore();
}

export function hashContent(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}
