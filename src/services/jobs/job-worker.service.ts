import { logger } from '../../utils/logger';
import { JobQueueService } from './job-queue.service';
import { JobProgressService } from './job-progress.service';
import { JobService } from './job.service';
import { JobPayload, JobProcessor, JobRecord } from '../../types/job.types';
import { TelegramResponseService } from '../telegram/telegram-response.service';

interface JobWorkerServiceOptions {
  pollIntervalMs?: number;
  concurrency?: number;
  lockTimeoutMs?: number;
}

export class JobWorkerService {
  private readonly workerId = `worker-${process.pid}`;
  private readonly pollIntervalMs: number;
  private readonly concurrency: number;
  private readonly lockTimeoutMs: number;
  private readonly processors = new Map<JobRecord['type'], JobProcessor>();
  private timer?: NodeJS.Timeout;
  private isRunning = false;
  private activeJobs = 0;

  constructor(
    private readonly jobQueueService: JobQueueService,
    private readonly jobProgressService: JobProgressService,
    private readonly jobService: JobService,
    private readonly telegramResponseService: TelegramResponseService,
    options: JobWorkerServiceOptions = {},
  ) {
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.concurrency = options.concurrency ?? 2;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 30_000;
  }

  registerProcessor(type: JobRecord['type'], processor: JobProcessor): void {
    this.processors.set(type, processor);
  }

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }

    while (this.activeJobs > 0) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async runOnce(): Promise<boolean> {
    if (this.isRunning || this.activeJobs >= this.concurrency) {
      return false;
    }

    this.isRunning = true;

    try {
      await this.jobQueueService.requeueStaleJobs(this.lockTimeoutMs);
      const job = await this.jobQueueService.claimNextRunnableJob(this.workerId);
      if (!job) {
        return false;
      }

      this.activeJobs += 1;
      void this.executeJob(job).finally(() => {
        this.activeJobs -= 1;
      });

      return true;
    } finally {
      this.isRunning = false;
    }
  }

  private async tick(): Promise<void> {
    while (this.activeJobs < this.concurrency) {
      const claimed = await this.runOnce();
      if (!claimed) {
        break;
      }
    }
  }

  private async executeJob(job: JobRecord): Promise<void> {
    const processor = this.processors.get(job.type);
    if (!processor) {
      await this.failJob(job, new Error(`No processor registered for job type ${job.type}`));
      return;
    }

    const progressReporter = this.jobProgressService.createReporter(job.id);

    try {
      logger.info('Job claimed', {
        jobId: job.id,
        userId: job.userId,
        chatId: job.chatId,
        jobType: job.type,
        attempt: job.attempts,
      });

      const result = await processor.process({
        job,
        payload: JSON.parse(job.payloadJson) as JobPayload,
        progressReporter,
        cancellationState: {
          isCancelled: async () => {
            const latest = await this.jobService.findById(job.id);
            return !!latest && ['cancelled', 'superseded'].includes(latest.status);
          },
        },
      });

      await this.jobProgressService.record(job.id, 'job.completed');
      await this.telegramResponseService.sendFinalResponse(job.chatId, result.finalMessage);
      await this.jobService.markCompleted(job.id, result.finalMessage);
    } catch (error) {
      await this.failJob(job, error as Error);
    }
  }

  private async failJob(job: JobRecord, error: Error): Promise<void> {
    logger.error('Job execution failed', {
      jobId: job.id,
      userId: job.userId,
      chatId: job.chatId,
      jobType: job.type,
      attempt: job.attempts,
      error: error.message,
    });

    await this.jobProgressService.record(job.id, 'job.failed', error.message);
    await this.jobService.markFailed(job, error);

    const latest = await this.jobService.findById(job.id);
    if (latest?.status === 'failed') {
      await this.telegramResponseService.sendFailureResponse(
        job.chatId,
        '❌ Sorry, I had trouble processing your request.',
      );
    }
  }
}
