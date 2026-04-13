import { PendingClarificationRepository } from './repositories/pending-clarification.repository';
import { CreatePendingClarificationInput, PendingClarificationRecord } from './types';

export class ClarificationStateService {
  constructor(private readonly clarificationRepository: PendingClarificationRepository) {}

  createPendingClarification(
    input: CreatePendingClarificationInput,
  ): Promise<PendingClarificationRecord> {
    return this.clarificationRepository.createPendingClarification(input);
  }

  findActiveByUser(userId: string): Promise<PendingClarificationRecord | null> {
    return this.clarificationRepository.findActiveByUser(userId);
  }

  resolveClarification(
    clarificationId: string,
    status: 'answered' | 'expired' | 'cancelled',
    answerMessageId?: string,
  ): Promise<void> {
    return this.clarificationRepository.resolveClarification(
      clarificationId,
      status,
      answerMessageId,
    );
  }

  expireClarifications(now: string): Promise<number> {
    return this.clarificationRepository.expireClarifications(now);
  }
}
