export interface DatabaseConfig {
  path: string;
  verboseLogging: boolean;
}

export type MessageDirection = 'incoming' | 'outgoing' | 'system';
export type PersistedMessageType =
  | 'text'
  | 'voice'
  | 'audio'
  | 'audio_document'
  | 'command'
  | 'status'
  | 'error';
export type PersistedMessageStatus = 'received' | 'processing' | 'processed' | 'failed';

export type JobType =
  | 'text_processing'
  | 'voice_processing'
  | 'audio_document_processing'
  | 'tool_execution';
export type JobStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'superseded';

export type ClarificationStatus = 'pending' | 'answered' | 'expired' | 'cancelled';

export type UsageEventType =
  | 'message_received'
  | 'message_processed'
  | 'gpt_request'
  | 'gpt_response'
  | 'tool_called'
  | 'tool_completed'
  | 'audio_transcription'
  | 'error';

export interface PersistedMessage {
  id: string;
  telegramUpdateId: number | null;
  telegramMessageId: number | null;
  chatId: string;
  userId: string;
  direction: MessageDirection;
  messageType: PersistedMessageType;
  contentText: string | null;
  fileId: string | null;
  fileUrl: string | null;
  fileName: string | null;
  mimeType: string | null;
  replyToMessageId: string | null;
  jobId: string | null;
  status: PersistedMessageStatus;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface PersistedJob {
  id: string;
  userId: string;
  chatId: string;
  sourceMessageId: string | null;
  jobType: JobType;
  status: JobStatus;
  priority: number;
  concurrencyKey: string | null;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorMessage: string | null;
  attemptCount: number;
  maxAttempts: number;
  lockedAt: string | null;
  workerId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  supersededByJobId: string | null;
  ackMessageId: string | null;
  progressMessageId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEventRecord {
  id: string;
  jobId: string;
  eventType: string;
  message: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface PendingClarificationRecord {
  id: string;
  userId: string;
  chatId: string;
  sourceMessageId: string | null;
  jobId: string | null;
  status: ClarificationStatus;
  intentName: string | null;
  confidenceScore: number | null;
  questionText: string;
  proposedAction: Record<string, unknown> | null;
  answerMessageId: string | null;
  expiresAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface UserPreferenceRecord {
  id: string;
  userId: string;
  preferenceKey: string;
  preferenceValue: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UsageEventRecord {
  id: string;
  userId: string | null;
  chatId: string | null;
  jobId: string | null;
  messageId: string | null;
  eventType: UsageEventType;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateIncomingMessageInput {
  telegramUpdateId?: number;
  telegramMessageId?: number;
  chatId: string;
  userId: string;
  messageType: PersistedMessageType;
  contentText?: string;
  fileId?: string;
  fileUrl?: string;
  fileName?: string;
  mimeType?: string;
  jobId?: string;
  status?: PersistedMessageStatus;
}

export interface CreateOutgoingMessageInput {
  telegramMessageId?: number;
  chatId: string;
  userId: string;
  messageType: PersistedMessageType;
  contentText?: string;
  replyToMessageId?: string;
  jobId?: string;
  status?: PersistedMessageStatus;
}

export interface CreateJobInput {
  userId: string;
  chatId: string;
  sourceMessageId?: string;
  jobType: JobType;
  payload: Record<string, unknown>;
  priority?: number;
  concurrencyKey?: string | null;
  dedupeKey?: string | null;
  maxAttempts?: number;
}

export interface CreatePendingClarificationInput {
  userId: string;
  chatId: string;
  sourceMessageId?: string;
  jobId?: string;
  intentName?: string;
  confidenceScore?: number;
  questionText: string;
  proposedAction?: Record<string, unknown>;
  expiresAt?: string;
}

export interface RecordUsageEventInput {
  userId?: string;
  chatId?: string;
  jobId?: string;
  messageId?: string;
  eventType: UsageEventType;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface UsageSummary {
  eventCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEstimatedCostUsd: number;
}
