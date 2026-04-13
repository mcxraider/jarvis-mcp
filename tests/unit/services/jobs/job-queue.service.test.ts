import { JobQueueService } from '../../../../src/services/jobs/job-queue.service';

describe('JobQueueService', () => {
  it('claims the first runnable queued job', async () => {
    const jobRepository = {
      listQueuedJobs: jest.fn().mockResolvedValue([
        { id: 'job-1', concurrencyKey: null },
      ]),
      claim: jest.fn().mockResolvedValue({ id: 'job-1', status: 'running' }),
    } as any;
    const scheduler = {
      canRun: jest.fn().mockResolvedValue(true),
    } as any;
    const service = new JobQueueService(jobRepository, scheduler);

    const job = await service.claimNextRunnableJob('worker-1');

    expect(jobRepository.claim).toHaveBeenCalledWith('job-1', 'worker-1');
    expect(job).toEqual(expect.objectContaining({ id: 'job-1', status: 'running' }));
  });

  it('skips queued jobs that are blocked by concurrency rules', async () => {
    const jobRepository = {
      listQueuedJobs: jest.fn().mockResolvedValue([
        { id: 'job-1', concurrencyKey: 'user:1:write' },
        { id: 'job-2', concurrencyKey: null },
      ]),
      claim: jest.fn().mockResolvedValue({ id: 'job-2', status: 'running' }),
    } as any;
    const scheduler = {
      canRun: jest
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    } as any;
    const service = new JobQueueService(jobRepository, scheduler);

    const job = await service.claimNextRunnableJob('worker-1');

    expect(jobRepository.claim).toHaveBeenCalledWith('job-2', 'worker-1');
    expect(job).toEqual(expect.objectContaining({ id: 'job-2', status: 'running' }));
  });
});
