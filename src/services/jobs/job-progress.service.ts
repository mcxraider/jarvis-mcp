import { JobProgressReporter, JobRecord } from '../../types/job.types';
import { TelegramProgressService } from '../telegram/telegram-progress.service';
import { JobEventRepository, JobStateService } from '../persistence';

export class JobProgressService {
  constructor(
    private readonly jobEventRepository: JobEventRepository,
    private readonly jobStateService: JobStateService,
    private readonly telegramProgressService: TelegramProgressService,
  ) {}

  createReporter(jobId: string): JobProgressReporter {
    return {
      report: async (eventType: string, message?: string, payload?: Record<string, unknown>) => {
        await this.record(jobId, eventType, message, payload);
      },
    };
  }

  async record(
    jobId: string,
    eventType: string,
    message?: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await this.jobEventRepository.create(jobId, eventType, message, payload);
    const job = await this.jobStateService.getJob(jobId);
    if (job) {
      const mappedJob: JobRecord = {
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
      await this.telegramProgressService.updateProgress(mappedJob, eventType, message);
    }
  }
}
