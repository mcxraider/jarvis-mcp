import { MessageType } from '../observability';

export interface ProcessingContext {
  requestId?: string;
  jobId?: string;
  sourceMessageId?: string;
  chatId?: string;
  userId?: string;
  updateId?: number;
  messageType?: MessageType;
  onStage?: (eventType: string, message?: string) => Promise<void> | void;
}

export interface ProcessorResponse {
  responseText: string;
  processingTimeMs?: number;
  transcriptionText?: string;
}
