import { JobRecord } from '../../types/job.types';
import { JobRepository } from '../../repositories/job.repository';

export class JobSchedulerService {
  constructor(private readonly jobRepository: JobRepository) {}

  async canRun(job: JobRecord): Promise<boolean> {
    if (!job.concurrencyKey) {
      return true;
    }

    return !(await this.jobRepository.hasRunningJobForConcurrencyKey(job.concurrencyKey));
  }
}
