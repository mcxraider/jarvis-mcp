import { logger, getLogger, serializeError } from '../../utils/logger';
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
import {
  extendTelemetryContext,
  getTelemetryContext,
  recordTelegramUpdate,
  runWithTelemetryContext,
  TelemetryContext,
} from '../../observability';

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

    logger.info('telegram.bot.initialized');
  }

  private setupBotHandlers(): void {
    this.handlers.setupHandlers(this.bot);
  }

  private setupErrorHandling(): void {
    this.bot.catch(async (err: unknown, ctx: Context) => {
      const error = err as Error;
      const context = extendTelemetryContext(this.getContextFromTelegram(ctx), {
        component: 'telegram_bot',
        stage: 'bot_error',
      });
      const scopedLogger = getLogger(context);

      scopedLogger.error('telegram.update.failed', {
        ...serializeError(error),
      });

      try {
        await ctx.reply('❌ Sorry, something went wrong. Please try again.');
        scopedLogger.info('telegram.reply.sent', {
          replyLength: 47,
        });
      } catch (replyError) {
        scopedLogger.error('telegram.reply.failed', {
          ...serializeError(replyError),
          originalErrorMessage: error.message,
        });
      }
    });
  }

  async setupWebhook(webhookUrl: string, secretToken: string): Promise<void> {
    try {
      const fullWebhookUrl = `${webhookUrl}/webhook/${secretToken}`;

      logger.info('telegram.webhook.setup_requested', { webhookUrl });

      await this.syncCommands();

      await this.bot.telegram.setWebhook(fullWebhookUrl, {
        secret_token: secretToken,
        max_connections: 100,
        drop_pending_updates: true,
      });

      logger.info('telegram.webhook.configured');
    } catch (error) {
      logger.error('telegram.webhook.failed', {
        ...serializeError(error),
        webhookUrl,
      });
      throw new Error(`Webhook setup failed: ${(error as Error).message}`);
    }
  }

  async removeWebhook(): Promise<void> {
    await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
    logger.info('telegram.webhook.removed');
  }

  async handleUpdate(update: any, context?: TelemetryContext): Promise<void> {
    const enrichedContext = extendTelemetryContext(context, {
      component: 'telegram_update',
      chatId: update?.message?.chat?.id || update?.callback_query?.message?.chat?.id,
      userId:
        update?.message?.from?.id?.toString() || update?.callback_query?.from?.id?.toString(),
      stage: 'update',
    });
    const scopedLogger = getLogger(enrichedContext);

    try {
      const updateType = this.getUpdateType(update);
      scopedLogger.info('telegram.update.received', {
        updateType,
      });
      recordTelegramUpdate(updateType);

      await runWithTelemetryContext(enrichedContext, () => this.bot.handleUpdate(update));
    } catch (error) {
      scopedLogger.error('telegram.update.failed', {
        ...serializeError(error),
      });
      throw error;
    }
  }

  async sendMessage(chatId: number, text: string, options?: any): Promise<Message.TextMessage> {
    const scopedLogger = getLogger(
      this.getContextFromOptions(options, { component: 'telegram_send_message', chatId }),
    );

    const sentMessage = await this.bot.telegram.sendMessage(chatId, text, options);
    scopedLogger.info('telegram.reply.sent', {
      chatId,
      textLength: text.length,
    });

    return sentMessage;
  }

  async getBotInfo(): Promise<any> {
    const botInfo = await this.bot.telegram.getMe();
    logger.debug('telegram.bot.info_retrieved', { username: botInfo.username });
    return botInfo;
  }

  async startPolling(): Promise<void> {
    await this.syncCommands();
    await this.bot.launch();
    logger.info('telegram.bot.polling_started');
  }

  async stop(): Promise<void> {
    this.bot.stop();
    logger.info('telegram.bot.stopped');
  }

  private async syncCommands(): Promise<void> {
    await this.bot.telegram.setMyCommands([
      { command: 'help', description: 'Show available commands and supported inputs' },
      { command: 'status', description: 'Show bot health, uptime, and dependency status' },
    ]);
  }

  private getUpdateType(update: any): string {
    if (update?.message?.voice) return 'voice';
    if (update?.message?.audio) return 'audio';
    if (update?.message?.document) return 'document';
    if (update?.message?.text) return 'text';
    return 'unknown';
  }

  private getContextFromTelegram(ctx: Context): TelemetryContext | undefined {
    const currentContext = getTelemetryContext();
    if (!currentContext) {
      return undefined;
    }

    return extendTelemetryContext(currentContext, {
      updateId: (ctx.update as any)?.update_id,
      chatId: ctx.chat?.id,
      userId: ctx.from?.id ? String(ctx.from.id) : undefined,
    });
  }

  private getContextFromOptions(
    options: any,
    fallback: Partial<TelemetryContext>,
  ): TelemetryContext | undefined {
    if (options?.telemetryContext) {
      return extendTelemetryContext(options.telemetryContext, fallback);
    }

    const currentContext = getTelemetryContext();
    return currentContext ? extendTelemetryContext(currentContext, fallback) : undefined;
  }
}
