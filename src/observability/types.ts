export type MessageType = 'text' | 'audio' | 'audio_document' | 'command' | 'unknown';

export type PrimitiveLogValue = string | number | boolean | null | undefined;

export type LogFields = Record<string, PrimitiveLogValue | PrimitiveLogValue[]>;

export type MetricTags = Record<string, string>;

export interface TelemetryContext {
  requestId: string;
  updateId?: number;
  chatId?: string | number;
  userId?: string;
  messageType?: MessageType;
  jobId?: string;
  component?: string;
  stage?: string;
}
