import { JobRepository } from './repositories/job.repository';
import { CreateJobInput, PersistedJob } from './types';

export class JobStateService {
  constructor(private readonly jobRepository: JobRepository) {}

  createJob(input: CreateJobInput): Promise<PersistedJob> {
    return this.jobRepository.createJob(input);
  }

  markInProgress(jobId: string): Promise<void> {
    return this.jobRepository.markInProgress(jobId);
  }

  markCompleted(jobId: string, result: Record<string, unknown>): Promise<void> {
    return this.jobRepository.markCompleted(jobId, result);
  }

  markFailed(jobId: string, error: string, result?: Record<string, unknown>): Promise<void> {
    return this.jobRepository.markFailed(jobId, error, result);
  }

  getJob(jobId: string): Promise<PersistedJob | null> {
    return this.jobRepository.getJob(jobId);
  }

  listActiveJobsByUser(userId: string): Promise<PersistedJob[]> {
    return this.jobRepository.listActiveJobsByUser(userId);
  }
}
