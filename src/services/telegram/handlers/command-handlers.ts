// src/services/telegram/handlers/command-handlers.ts
import { Context } from 'telegraf';
import { logger } from '../../../utils/logger';
import { BotActivityService } from '../bot-activity.service';
import { BotStatusService } from '../bot-status.service';
import { ConversationStoreService } from '../../persistence';
import { Message } from 'telegraf/typings/core/types/typegram';

/**
 * Handles bot commands
 */
export class CommandHandlers {
  constructor(
    private readonly activityService: BotActivityService,
    private readonly statusService: BotStatusService,
    private readonly conversationStore?: ConversationStoreService,
  ) {}

  async handleHelp(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const updateId = ctx.update && 'update_id' in ctx.update ? ctx.update.update_id : undefined;
    const telegramMessageId = ctx.message && 'message_id' in ctx.message ? ctx.message.message_id : undefined;
    logger.info('User requested help', { userId });
    this.activityService.recordActivity('command_help');

    const incomingMessage = userId && chatId
      ? await this.conversationStore?.createIncomingMessage({
          telegramUpdateId: updateId,
          telegramMessageId,
          chatId: chatId.toString(),
          userId: userId.toString(),
          messageType: 'command',
          contentText: '/help',
          status: 'processed',
        })
      : null;

    const helpMessage = `🆘 *JarvisMCP Help*

*Available Commands:*
/help - Show this help message
/status - Check bot status

*Features:*
📝 Send any text message and I'll process it
🎵 Send audio files (.ogg, .mp3, .wav, .m4a) and I'll process them
🔊 Send voice messages and I'll handle them right away

*Supported Audio Formats:*
• OGG Vorbis (Telegram voice messages)
• MP3
• WAV
• M4A`;

    const reply = (await ctx.reply(helpMessage, { parse_mode: 'Markdown' })) as Message.TextMessage;
    if (userId && chatId) {
      await this.conversationStore?.createOutgoingMessage({
        telegramMessageId: reply.message_id,
        chatId: chatId.toString(),
        userId: userId.toString(),
        messageType: 'command',
        contentText: helpMessage,
        replyToMessageId: incomingMessage?.id,
        status: 'processed',
      });
    }
  }

  async handleStatus(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const updateId = ctx.update && 'update_id' in ctx.update ? ctx.update.update_id : undefined;
    const telegramMessageId = ctx.message && 'message_id' in ctx.message ? ctx.message.message_id : undefined;
    logger.info('User requested status', { userId });
    this.activityService.recordActivity('command_status');

    const incomingMessage = userId && chatId
      ? await this.conversationStore?.createIncomingMessage({
          telegramUpdateId: updateId,
          telegramMessageId,
          chatId: chatId.toString(),
          userId: userId.toString(),
          messageType: 'command',
          contentText: '/status',
          status: 'processed',
        })
      : null;

    const statusMessage = await this.statusService.getFormattedStatus();
    const reply = (await ctx.reply(statusMessage, { parse_mode: 'Markdown' })) as Message.TextMessage;
    if (userId && chatId) {
      await this.conversationStore?.createOutgoingMessage({
        telegramMessageId: reply.message_id,
        chatId: chatId.toString(),
        userId: userId.toString(),
        messageType: 'status',
        contentText: statusMessage,
        replyToMessageId: incomingMessage?.id,
        status: 'processed',
      });
    }
  }
}
