import { JobEventRepository } from '../../repositories/job-event.repository';
import { JobRepository } from '../../repositories/job.repository';
import { JobProgressReporter, JobRecord } from '../../types/job.types';
import { TelegramProgressService } from '../telegram/telegram-progress.service';

export class JobProgressService {
  constructor(
    private readonly jobEventRepository: JobEventRepository,
    private readonly jobRepository: JobRepository,
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
    const job = await this.jobRepository.findById(jobId);
    if (job) {
      await this.telegramProgressService.updateProgress(job, eventType, message);
    }
  }
}
