// src/services/telegram/handlers/telegram-handlers.ts
import { Telegraf, Context } from 'telegraf';
import { FileService } from '../file.service';
import { CommandHandlers } from '../handlers/command-handlers';
import { MessageHandlers } from '../handlers/message-handlers';
import { BotActivityService } from '../bot-activity.service';
import { BotStatusService } from '../bot-status.service';
import { TelegramUpdateIntakeService } from '../telegram-update-intake.service';
import { TelegramResponseService } from '../telegram-response.service';
import { JobService } from '../../jobs/job.service';

/**
 * Centralizes all Telegram bot handlers
 */
export class TelegramHandlers {
  private readonly commandHandlers: CommandHandlers;
  private readonly messageHandlers: MessageHandlers;

  constructor(
    fileService: FileService,
    intakeService: TelegramUpdateIntakeService,
    activityService: BotActivityService,
    statusService: BotStatusService,
    responseService: TelegramResponseService,
    jobService: JobService,
  ) {
    this.commandHandlers = new CommandHandlers(activityService, statusService);
    this.messageHandlers = new MessageHandlers(
      fileService,
      intakeService,
      activityService,
      responseService,
      jobService,
    );
  }

  setupHandlers(bot: Telegraf<Context>): void {
    this.setupCommandHandlers(bot);
    this.setupMessageHandlers(bot);
  }

  private setupCommandHandlers(bot: Telegraf<Context>): void {
    bot.command('help', this.commandHandlers.handleHelp.bind(this.commandHandlers));
    bot.command('status', this.commandHandlers.handleStatus.bind(this.commandHandlers));
  }

  private setupMessageHandlers(bot: Telegraf<Context>): void {
    bot.on('text', this.messageHandlers.handleText.bind(this.messageHandlers));
    bot.on('voice', this.messageHandlers.handleVoice.bind(this.messageHandlers));
    bot.on('audio', this.messageHandlers.handleAudio.bind(this.messageHandlers));
    bot.on('document', this.messageHandlers.handleDocument.bind(this.messageHandlers));
    bot.on('message', this.messageHandlers.handleUnknown.bind(this.messageHandlers));
  }
}
