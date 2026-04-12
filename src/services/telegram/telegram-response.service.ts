import { Message } from 'telegraf/typings/core/types/typegram';
import { Telegram } from 'telegraf';
import { logger } from '../../utils/logger';

export class TelegramResponseService {
  constructor(private readonly telegram: Telegram) {}

  async sendAcknowledgement(
    chatId: number,
    text: string,
    replyToMessageId?: number,
  ): Promise<Message.TextMessage> {
    return this.telegram.sendMessage(chatId, text, {
      reply_parameters: replyToMessageId ? { message_id: replyToMessageId } : undefined,
    });
  }

  async sendFinalResponse(chatId: number, text: string): Promise<Message.TextMessage> {
    return this.telegram.sendMessage(chatId, text);
  }

  async sendFailureResponse(chatId: number, text: string): Promise<Message.TextMessage> {
    return this.telegram.sendMessage(chatId, text);
  }

  async updateMessage(
    chatId: number,
    messageId: number,
    text: string,
  ): Promise<void> {
    try {
      await this.telegram.editMessageText(chatId, messageId, undefined, text);
    } catch (error) {
      logger.warn('Failed to update Telegram message', {
        chatId,
        messageId,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
