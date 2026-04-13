import {
  EnqueuedJob,
  InboundTask,
  JobPayload,
  JobRecord,
} from '../../types/job.types';
import { logger } from '../../utils/logger';
import { ConversationStoreService, JobStateService, PersistedJob } from '../persistence';

export class JobService {
  constructor(
    private readonly conversationStore: ConversationStoreService,
    private readonly jobStateService: JobStateService,
  ) {}

  async enqueue(task: InboundTask): Promise<EnqueuedJob> {
    const dedupeKey = `${task.userId}:${task.telegramUpdateId}:${task.kind}`;
    const existing = await this.jobStateService.findByDedupeKey(dedupeKey);
    if (existing) {
      const mapped = this.mapJob(existing);
      return {
        job: mapped,
        acknowledgement: this.getAcknowledgement(mapped.type),
      };
    }

    const message = await this.conversationStore.createIncomingMessage({
      telegramUpdateId: task.telegramUpdateId,
      telegramMessageId: task.telegramMessageId,
      chatId: task.chatId,
      userId: task.userId,
      messageType: task.kind === 'voice' ? 'voice' : task.kind,
      contentText: task.text,
      fileId: task.fileId,
      fileName: task.fileName,
      mimeType: task.mimeType,
      status: 'processing',
    });
    const payload: JobPayload = {
      text: task.text,
      fileId: task.fileId,
      fileName: task.fileName,
      mimeType: task.mimeType,
      duration: task.duration,
      metadata: task.metadata,
    };

    const job = await this.jobStateService.createJob({
      userId: task.userId,
      chatId: task.chatId,
      sourceMessageId: message.id,
      jobType: this.mapJobType(task.kind),
      concurrencyKey: null,
      dedupeKey,
      payload: payload as unknown as Record<string, unknown>,
      maxAttempts: 2,
    });

    logger.info('Job created', {
      jobId: job.id,
      userId: job.userId,
      chatId: job.chatId,
      telegramUpdateId: task.telegramUpdateId,
      jobType: job.jobType,
    });

    return {
      job: this.mapJob(job),
      acknowledgement: this.getAcknowledgement(task.kind),
    };
  }

  async attachAcknowledgement(jobId: string, ackMessageId: number): Promise<void> {
    await this.jobStateService.updateAcknowledgementMessage(jobId, ackMessageId.toString());
  }

  async markCompleted(jobId: string, finalMessage: string): Promise<void> {
    await this.jobStateService.markCompleted(jobId, { finalMessage });
    const job = await this.jobStateService.getJob(jobId);
    if (job?.sourceMessageId) {
      await this.conversationStore.markMessageProcessing(job.sourceMessageId, 'processed', undefined, jobId);
    }
  }

  async markFailed(job: JobRecord, error: Error): Promise<void> {
    const terminal = job.attempts >= job.maxAttempts;
    if (terminal) {
      await this.jobStateService.markFailed(job.id, error.message, {
        message: error.message,
        stack: error.stack,
      });
      if (job.messageId) {
        await this.conversationStore.markMessageProcessing(job.messageId, 'failed', error.message, job.id);
      }
      return;
    }

    await this.jobStateService.requeue(job.id, error.message);
  }

  async findById(jobId: string): Promise<JobRecord | undefined> {
    const job = await this.jobStateService.getJob(jobId);
    return job ? this.mapJob(job) : undefined;
  }

  async getSnapshot(): Promise<{ queued: number; running: number }> {
    return this.jobStateService.getStatusCounts();
  }

  private getAcknowledgement(type: JobRecord['type']): string {
    switch (type) {
      case 'voice':
        return 'Voice note received. I’m transcribing it now.';
      case 'audio_document':
        return 'Audio file received. I’m processing it now.';
      case 'text':
      default:
        return 'Received. Working on it.';
    }
  }

  private mapJobType(kind: InboundTask['kind']): PersistedJob['jobType'] {
    switch (kind) {
      case 'voice':
        return 'voice_processing';
      case 'audio_document':
        return 'audio_document_processing';
      case 'text':
      default:
        return 'text_processing';
    }
  }

  private mapJob(job: PersistedJob): JobRecord {
    return {
      id: job.id,
      userId: job.userId,
      chatId: job.chatId,
      messageId: job.sourceMessageId || '',
      type:
        job.jobType === 'voice_processing'
          ? 'voice'
          : job.jobType === 'audio_document_processing'
            ? 'audio_document'
            : 'text',
      status: job.status === 'in_progress' ? 'running' : job.status,
      priority: job.priority,
      concurrencyKey: job.concurrencyKey,
      dedupeKey: job.dedupeKey || '',
      payloadJson: JSON.stringify(job.payload),
      resultJson: job.result ? JSON.stringify(job.result) : null,
      errorJson: job.errorMessage ? JSON.stringify({ message: job.errorMessage }) : null,
      attempts: job.attemptCount,
      maxAttempts: job.maxAttempts,
      lockedAt: job.lockedAt,
      workerId: job.workerId,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      supersededByJobId: job.supersededByJobId,
      ackMessageId: job.ackMessageId,
      progressMessageId: job.progressMessageId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }
}
