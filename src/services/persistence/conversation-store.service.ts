import { MessageRepository } from './repositories/message.repository';
import {
  CreateIncomingMessageInput,
  CreateOutgoingMessageInput,
  PersistedMessage,
  PersistedMessageStatus,
} from './types';

export class ConversationStoreService {
  constructor(private readonly messageRepository: MessageRepository) {}

  createIncomingMessage(input: CreateIncomingMessageInput): Promise<PersistedMessage> {
    return this.messageRepository.createIncomingMessage(input);
  }

  createOutgoingMessage(input: CreateOutgoingMessageInput): Promise<PersistedMessage> {
    return this.messageRepository.createOutgoingMessage(input);
  }

  markMessageProcessing(
    messageId: string,
    status: PersistedMessageStatus,
    errorMessage?: string,
    jobId?: string,
  ): Promise<void> {
    return this.messageRepository.markMessageProcessing(messageId, status, errorMessage, jobId);
  }

  listRecentMessagesByUser(userId: string, limit: number): Promise<PersistedMessage[]> {
    return this.messageRepository.listRecentMessagesByUser(userId, limit);
  }

  findByTelegramUpdateId(updateId: number): Promise<PersistedMessage | null> {
    return this.messageRepository.findByTelegramUpdateId(updateId);
  }
}
