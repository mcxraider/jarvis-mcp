export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'superseded';

export type JobType = 'text' | 'voice' | 'audio_document';

export interface InboundTask {
  chatId: number;
  userId: number;
  telegramUpdateId: number;
  telegramMessageId: number;
  kind: JobType;
  text?: string;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  metadata: Record<string, unknown>;
}

export interface MessageRecord {
  id: number;
  telegramUpdateId: number;
  telegramMessageId: number;
  chatId: number;
  userId: number;
  messageType: JobType;
  payloadJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobPayload {
  text?: string;
  fileId?: string;
  fileName?: string;
  mimeType?: string;
  duration?: number;
  metadata: Record<string, unknown>;
}

export interface JobRecord {
  id: string;
  userId: number;
  chatId: number;
  messageId: number;
  type: JobType;
  status: JobStatus;
  priority: number;
  concurrencyKey: string | null;
  dedupeKey: string;
  payloadJson: string;
  resultJson: string | null;
  errorJson: string | null;
  attempts: number;
  maxAttempts: number;
  lockedAt: string | null;
  workerId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  supersededByJobId: string | null;
  ackMessageId: number | null;
  progressMessageId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEventRecord {
  id: number;
  jobId: string;
  eventType: string;
  message: string | null;
  payloadJson: string | null;
  createdAt: string;
}

export interface JobExecutionResult {
  finalMessage: string;
  structuredResult?: Record<string, unknown>;
  metrics?: Record<string, number>;
  telegramDeliveryPlan?: {
    replyToMessageId?: number;
  };
}

export interface JobProgressReporter {
  report(
    eventType: string,
    message?: string,
    payload?: Record<string, unknown>,
  ): Promise<void>;
}

export interface JobContext {
  job: JobRecord;
  payload: JobPayload;
  progressReporter: JobProgressReporter;
  cancellationState: {
    isCancelled: () => Promise<boolean>;
  };
}

export interface JobProcessor {
  process(context: JobContext): Promise<JobExecutionResult>;
}

export interface EnqueuedJob {
  job: JobRecord;
  acknowledgement: string;
}
