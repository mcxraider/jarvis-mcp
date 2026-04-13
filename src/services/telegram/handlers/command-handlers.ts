// src/services/telegram/handlers/command-handlers.ts
import { Context } from 'telegraf';
import { extendTelemetryContext, getTelemetryContext } from '../../../observability';
import { getLogger } from '../../../utils/logger';
import { BotActivityService } from '../bot-activity.service';
import { BotStatusService } from '../bot-status.service';

/**
 * Handles bot commands
 */
export class CommandHandlers {
  constructor(
    private readonly activityService: BotActivityService,
    private readonly statusService: BotStatusService,
  ) {}

  async handleHelp(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const logger = getLogger(
      extendTelemetryContext(getTelemetryContext(), {
        component: 'telegram_command',
        chatId: ctx.chat?.id,
        userId: userId ? String(userId) : undefined,
        messageType: 'command',
      }),
    );
    logger.info('telegram.command.received', { command: 'help' });
    this.activityService.recordActivity('command_help');

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

    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
  }

  async handleStatus(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    const logger = getLogger(
      extendTelemetryContext(getTelemetryContext(), {
        component: 'telegram_command',
        chatId: ctx.chat?.id,
        userId: userId ? String(userId) : undefined,
        messageType: 'command',
      }),
    );
    logger.info('telegram.command.received', { command: 'status' });
    this.activityService.recordActivity('command_status');

    const statusMessage = await this.statusService.getFormattedStatus();
    await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
  }
}
