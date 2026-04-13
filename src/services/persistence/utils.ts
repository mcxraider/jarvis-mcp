import crypto from 'crypto';

export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  return JSON.parse(value) as Record<string, unknown>;
}

export function stringifyJson(value: Record<string, unknown> | null | undefined): string | null {
  if (!value) {
    return null;
  }

  return JSON.stringify(value);
}
