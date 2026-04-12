import { JobSchedulerService } from '../../../../src/services/jobs/job-scheduler.service';

describe('JobSchedulerService', () => {
  it('allows jobs without a concurrency key to run', async () => {
    const scheduler = new JobSchedulerService({} as any);

    await expect(
      scheduler.canRun({ concurrencyKey: null } as any),
    ).resolves.toBe(true);
  });

  it('blocks jobs when the same concurrency key is already running', async () => {
    const scheduler = new JobSchedulerService({
      hasRunningJobForConcurrencyKey: jest.fn().mockResolvedValue(true),
    } as any);

    await expect(
      scheduler.canRun({ concurrencyKey: 'user:1:write' } as any),
    ).resolves.toBe(false);
  });
});
