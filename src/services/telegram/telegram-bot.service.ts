import { logger } from '../../utils/logger';
import { Telegraf, Context } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import { TelegramHandlers } from './handlers/telegram-handlers';
import { FileService } from './file.service';
import { TelegramConfig } from '../../types/telegram.types';
import { BotActivityService } from './bot-activity.service';
import { BotStatusService } from './bot-status.service';
import { TodoistAPIService } from '../external/todoist-api.service';
import { GPT_CONSTANTS } from '../ai/constants/gpt.constants';
import { ConversationStoreService, UsageTrackingService } from '../persistence';
import { TelegramUpdateIntakeService } from './telegram-update-intake.service';
import { TelegramResponseService } from './telegram-response.service';
import { JobService } from '../jobs/job.service';

export class TelegramBotService {
  public readonly bot: Telegraf<Context>;
  private readonly botToken: string;
  private readonly handlers: TelegramHandlers;
  private readonly fileService: FileService;
  private readonly activityService: BotActivityService;
  private readonly statusService: BotStatusService;
  private readonly responseService: TelegramResponseService;

  constructor(
    config: TelegramConfig,
    intakeService: TelegramUpdateIntakeService,
    jobService: JobService,
    persistence?: {
      conversationStore?: ConversationStoreService;
      usageTrackingService?: UsageTrackingService;
    },
  ) {
    this.botToken = config.token;
    this.bot = new Telegraf(config.token);
    this.fileService = new FileService(this.botToken, this.bot.telegram);
    this.activityService = new BotActivityService();
    this.responseService = new TelegramResponseService(this.bot.telegram);
    this.statusService = new BotStatusService(this.activityService, {
      gptModel: process.env.OPENAI_MODEL || GPT_CONSTANTS.DEFAULT_MODEL,
      todoistService: process.env.TODOIST_API_KEY
        ? new TodoistAPIService(process.env.TODOIST_API_KEY)
        : undefined,
      queueSnapshotProvider: jobService,
    });
    this.handlers = new TelegramHandlers(
      this.fileService,
      intakeService,
      this.activityService,
      this.statusService,
      this.responseService,
      jobService,
      persistence?.conversationStore,
    );

    this.setupBotHandlers();
    this.setupErrorHandling();

    logger.info('Telegram bot initialized successfully');
  }

  private setupBotHandlers(): void {
    this.handlers.setupHandlers(this.bot);
  }

  private setupErrorHandling(): void {
    this.bot.catch(async (err: unknown, ctx: Context) => {
      const error = err as Error;
      logger.error('Bot error occurred', {
        error: error.message,
        stack: error.stack,
        userId: ctx.from?.id,
        chatId: ctx.chat?.id,
      });

      try {
        await ctx.reply('❌ Sorry, something went wrong. Please try again.');
      } catch (replyError) {
        logger.error('Failed to send error message', {
          originalError: error.message,
          replyError: (replyError as Error).message,
        });
      }
    });
  }

  async setupWebhook(webhookUrl: string, secretToken: string): Promise<void> {
    try {
      const fullWebhookUrl = `${webhookUrl}/webhook/${secretToken}`;

      logger.info('Setting up webhook', { url: fullWebhookUrl });

      await this.syncCommands();

      await this.bot.telegram.setWebhook(fullWebhookUrl, {
        secret_token: secretToken,
        max_connections: 100,
        drop_pending_updates: true,
      });

      logger.info('Webhook configured successfully');
    } catch (error) {
      logger.error('Failed to set webhook', {
        error: (error as Error).message,
        webhookUrl,
      });
      throw new Error(`Webhook setup failed: ${(error as Error).message}`);
    }
  }

  async removeWebhook(): Promise<void> {
    await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
    logger.info('Webhook removed successfully');
  }

  async handleUpdate(update: any): Promise<void> {
    try {
      await this.bot.handleUpdate(update);
    } catch (error) {
      logger.error('Error handling Telegram update', {
        updateId: update.update_id,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async sendMessage(chatId: number, text: string, options?: any): Promise<Message.TextMessage> {
    return this.bot.telegram.sendMessage(chatId, text, options);
  }

  async getBotInfo(): Promise<any> {
    const botInfo = await this.bot.telegram.getMe();
    logger.debug('Retrieved bot info', { username: botInfo.username });
    return botInfo;
  }

  async startPolling(): Promise<void> {
    await this.syncCommands();
    await this.bot.launch();
    logger.info('Bot started polling for updates');
  }

  async stop(): Promise<void> {
    this.bot.stop();
    logger.info('Bot stopped successfully');
  }

  private async syncCommands(): Promise<void> {
    await this.bot.telegram.setMyCommands([
      { command: 'help', description: 'Show available commands and supported inputs' },
      { command: 'status', description: 'Show bot health, uptime, and dependency status' },
    ]);
  }
}
