import { JobRepository } from '../../repositories/job.repository';
import {
  EnqueuedJob,
  InboundTask,
  JobPayload,
  JobRecord,
} from '../../types/job.types';
import { MessageRepository } from '../../repositories/message.repository';
import { logger } from '../../utils/logger';

export class JobService {
  constructor(
    private readonly messageRepository: MessageRepository,
    private readonly jobRepository: JobRepository,
  ) {}

  async enqueue(task: InboundTask): Promise<EnqueuedJob> {
    const dedupeKey = `${task.userId}:${task.telegramUpdateId}:${task.kind}`;
    const existing = await this.jobRepository.findByDedupeKey(dedupeKey);
    if (existing) {
      return {
        job: existing,
        acknowledgement: this.getAcknowledgement(existing.type),
      };
    }

    const message = await this.messageRepository.create(task);
    const payload: JobPayload = {
      text: task.text,
      fileId: task.fileId,
      fileName: task.fileName,
      mimeType: task.mimeType,
      duration: task.duration,
      metadata: task.metadata,
    };

    const job = await this.jobRepository.create({
      userId: task.userId,
      chatId: task.chatId,
      messageId: message.id,
      type: task.kind,
      concurrencyKey: null,
      dedupeKey,
      payload,
      maxAttempts: 2,
    });

    logger.info('Job created', {
      jobId: job.id,
      userId: job.userId,
      chatId: job.chatId,
      telegramUpdateId: task.telegramUpdateId,
      jobType: job.type,
    });

    return {
      job,
      acknowledgement: this.getAcknowledgement(job.type),
    };
  }

  async attachAcknowledgement(jobId: string, ackMessageId: number): Promise<void> {
    await this.jobRepository.updateAcknowledgementMessage(jobId, ackMessageId);
  }

  async markCompleted(jobId: string, finalMessage: string): Promise<void> {
    await this.jobRepository.markCompleted(jobId, { finalMessage });
  }

  async markFailed(job: JobRecord, error: Error): Promise<void> {
    const terminal = job.attempts >= job.maxAttempts;
    await this.jobRepository.markFailed(
      job.id,
      { message: error.message, stack: error.stack },
      terminal,
    );
  }

  async findById(jobId: string): Promise<JobRecord | undefined> {
    return this.jobRepository.findById(jobId);
  }

  async getSnapshot(): Promise<{ queued: number; running: number }> {
    return this.jobRepository.getStatusCounts();
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
}
