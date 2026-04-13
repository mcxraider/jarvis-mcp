import { JobRecord } from '../../types/job.types';
import { JobSchedulerService } from './job-scheduler.service';
import { JobStateService } from '../persistence';

export class JobQueueService {
  constructor(
    private readonly jobStateService: JobStateService,
    private readonly jobSchedulerService: JobSchedulerService,
  ) {}

  async requeueStaleJobs(lockTimeoutMs: number): Promise<number> {
    const staleBefore = new Date(Date.now() - lockTimeoutMs).toISOString();
    return this.jobStateService.requeueStaleRunningJobs(staleBefore);
  }

  async claimNextRunnableJob(workerId: string): Promise<JobRecord | undefined> {
    const queuedJobs = (await this.jobStateService.listQueuedJobs()).map((job) => ({
      id: job.id,
      userId: job.userId,
      chatId: job.chatId,
      messageId: job.sourceMessageId || '',
      type: this.mapJobType(job.jobType),
      status: this.mapStatus(job.status),
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
    }));

    for (const job of queuedJobs) {
      if (!(await this.jobSchedulerService.canRun(job))) {
        continue;
      }

      const claimed = await this.jobStateService.claim(job.id, workerId);
      if (claimed) {
        return {
          id: claimed.id,
          userId: claimed.userId,
          chatId: claimed.chatId,
          messageId: claimed.sourceMessageId || '',
          type: this.mapJobType(claimed.jobType),
          status: this.mapStatus(claimed.status),
          priority: claimed.priority,
          concurrencyKey: claimed.concurrencyKey,
          dedupeKey: claimed.dedupeKey || '',
          payloadJson: JSON.stringify(claimed.payload),
          resultJson: claimed.result ? JSON.stringify(claimed.result) : null,
          errorJson: claimed.errorMessage ? JSON.stringify({ message: claimed.errorMessage }) : null,
          attempts: claimed.attemptCount,
          maxAttempts: claimed.maxAttempts,
          lockedAt: claimed.lockedAt,
          workerId: claimed.workerId,
          startedAt: claimed.startedAt,
          completedAt: claimed.completedAt,
          supersededByJobId: claimed.supersededByJobId,
          ackMessageId: claimed.ackMessageId,
          progressMessageId: claimed.progressMessageId,
          createdAt: claimed.createdAt,
          updatedAt: claimed.updatedAt,
        };
      }
    }

    return undefined;
  }

  private mapJobType(jobType: string): JobRecord['type'] {
    switch (jobType) {
      case 'voice_processing':
        return 'voice';
      case 'audio_document_processing':
        return 'audio_document';
      case 'text_processing':
      default:
        return 'text';
    }
  }

  private mapStatus(status: string): JobRecord['status'] {
    return status === 'in_progress' ? 'running' : (status as JobRecord['status']);
  }
}
