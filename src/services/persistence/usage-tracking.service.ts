import { UsageEventRepository } from './repositories/usage-event.repository';
import { RecordUsageEventInput, UsageEventRecord, UsageSummary } from './types';

export class UsageTrackingService {
  constructor(private readonly usageEventRepository: UsageEventRepository) {}

  recordEvent(input: RecordUsageEventInput): Promise<UsageEventRecord> {
    return this.usageEventRepository.recordEvent(input);
  }

  listEventsForUser(userId: string, limit: number): Promise<UsageEventRecord[]> {
    return this.usageEventRepository.listEventsForUser(userId, limit);
  }

  summarizeUsageForUser(userId: string, createdAfter: string): Promise<UsageSummary> {
    return this.usageEventRepository.summarizeUsageForUser(userId, createdAfter);
  }
}
