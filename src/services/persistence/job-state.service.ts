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

  requeue(jobId: string, error: string): Promise<void> {
    return this.jobRepository.requeue(jobId, error);
  }

  findByDedupeKey(dedupeKey: string): Promise<PersistedJob | null> {
    return this.jobRepository.findByDedupeKey(dedupeKey);
  }

  listQueuedJobs(): Promise<PersistedJob[]> {
    return this.jobRepository.listQueuedJobs();
  }

  hasRunningJobForConcurrencyKey(concurrencyKey: string): Promise<boolean> {
    return this.jobRepository.hasRunningJobForConcurrencyKey(concurrencyKey);
  }

  claim(jobId: string, workerId: string): Promise<PersistedJob | null> {
    return this.jobRepository.claim(jobId, workerId);
  }

  requeueStaleRunningJobs(staleBeforeIso: string): Promise<number> {
    return this.jobRepository.requeueStaleRunningJobs(staleBeforeIso);
  }

  updateAcknowledgementMessage(jobId: string, ackMessageId: string): Promise<void> {
    return this.jobRepository.updateAcknowledgementMessage(jobId, ackMessageId);
  }

  updateProgressMessage(jobId: string, progressMessageId: string): Promise<void> {
    return this.jobRepository.updateProgressMessage(jobId, progressMessageId);
  }

  getStatusCounts(): Promise<{ queued: number; running: number }> {
    return this.jobRepository.getStatusCounts();
  }

  getJob(jobId: string): Promise<PersistedJob | null> {
    return this.jobRepository.getJob(jobId);
  }

  listActiveJobsByUser(userId: string): Promise<PersistedJob[]> {
    return this.jobRepository.listActiveJobsByUser(userId);
  }
}
