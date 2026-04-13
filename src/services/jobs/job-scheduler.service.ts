import { JobRecord } from '../../types/job.types';
import { JobStateService } from '../persistence';

export class JobSchedulerService {
  constructor(private readonly jobStateService: JobStateService) {}

  async canRun(job: JobRecord): Promise<boolean> {
    if (!job.concurrencyKey) {
      return true;
    }

    return !(await this.jobStateService.hasRunningJobForConcurrencyKey(job.concurrencyKey));
  }
}
