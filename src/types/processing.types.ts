export interface ProcessingContext {
  jobId?: string;
  sourceMessageId?: string;
  chatId?: string;
}

export interface ProcessorResponse {
  responseText: string;
  processingTimeMs?: number;
  transcriptionText?: string;
}
