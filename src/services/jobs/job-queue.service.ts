import { JobRepository } from '../../repositories/job.repository';
import { JobRecord } from '../../types/job.types';
import { JobSchedulerService } from './job-scheduler.service';

export class JobQueueService {
  constructor(
    private readonly jobRepository: JobRepository,
    private readonly jobSchedulerService: JobSchedulerService,
  ) {}

  async requeueStaleJobs(lockTimeoutMs: number): Promise<number> {
    const staleBefore = new Date(Date.now() - lockTimeoutMs).toISOString();
    return this.jobRepository.requeueStaleRunningJobs(staleBefore);
  }

  async claimNextRunnableJob(workerId: string): Promise<JobRecord | undefined> {
    const queuedJobs = await this.jobRepository.listQueuedJobs();

    for (const job of queuedJobs) {
      if (!(await this.jobSchedulerService.canRun(job))) {
        continue;
      }

      const claimed = await this.jobRepository.claim(job.id, workerId);
      if (claimed) {
        return claimed;
      }
    }

    return undefined;
  }
}
