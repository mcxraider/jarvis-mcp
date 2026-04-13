export interface ProcessingContext {
  jobId?: string;
  sourceMessageId?: string;
  chatId?: string;
  onStage?: (eventType: string, message?: string) => Promise<void> | void;
}

export interface ProcessorResponse {
  responseText: string;
  processingTimeMs?: number;
  transcriptionText?: string;
}
