// src/services/telegram/telegram-bot.service.ts
import { logger } from '../../utils/logger';
import { Telegraf, Context } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import { TelegramHandlers } from './handlers/telegram-handlers';
import { FileService } from './file.service';
import { MessageProcessorService } from './message-processor.service';
import { TelegramConfig } from '../../types/telegram.types';
import { BotActivityService } from './bot-activity.service';
import { BotStatusService } from './bot-status.service';
import { TodoistAPIService } from '../external/todoist-api.service';
import { GPT_CONSTANTS } from '../ai/constants/gpt.constants';
import {
  extendTelemetryContext,
  getTelemetryContext,
  recordTelegramUpdate,
  runWithTelemetryContext,
  TelemetryContext,
} from '../../observability';
import { getLogger, serializeError } from '../../utils/logger';

/**
 * Service class responsible for managing Telegram bot operations
 */
export class TelegramBotService {
  public readonly bot: Telegraf<Context>;
  private readonly botToken: string;
  private readonly handlers: TelegramHandlers;
  private readonly fileService: FileService;
  private readonly messageProcessor: MessageProcessorService;
  private readonly activityService: BotActivityService;
  private readonly statusService: BotStatusService;

  constructor(
    config: TelegramConfig,
    messageProcessor: MessageProcessorService
  ) {
    this.botToken = config.token;
    this.bot = new Telegraf(config.token);
    this.messageProcessor = messageProcessor;
    this.fileService = new FileService(this.botToken, this.bot.telegram);
    this.activityService = new BotActivityService();
    this.statusService = new BotStatusService(this.activityService, {
      gptModel: process.env.OPENAI_MODEL || GPT_CONSTANTS.DEFAULT_MODEL,
      todoistService: process.env.TODOIST_API_KEY
        ? new TodoistAPIService(process.env.TODOIST_API_KEY)
        : undefined,
    });
    this.handlers = new TelegramHandlers(
      this.fileService,
      this.messageProcessor,
      this.activityService,
      this.statusService,
    );

    this.setupBotHandlers();
    this.setupErrorHandling();

    logger.info('telegram.bot.initialized');
  }

  /**
   * Sets up all bot message handlers and commands
   */
  private setupBotHandlers(): void {
    this.handlers.setupHandlers(this.bot);
  }

  /**
   * Sets up global error handling for the bot
   */
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

  /**
   * Sets up webhook for receiving updates from Telegram
   */
  async setupWebhook(webhookUrl: string, secretToken: string): Promise<void> {
    try {
      const fullWebhookUrl = `${webhookUrl}/webhook/${secretToken}`;

      logger.info('telegram.webhook.setup_requested', { webhookUrl });

      await this.syncCommands();

      await this.bot.telegram.setWebhook(fullWebhookUrl, {
        secret_token: secretToken,
        max_connections: 100,
        drop_pending_updates: true
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

  /**
   * Removes the webhook
   */
  async removeWebhook(): Promise<void> {
    try {
      await this.bot.telegram.deleteWebhook({ drop_pending_updates: true });
      logger.info('telegram.webhook.removed');
    } catch (error) {
      logger.error('telegram.webhook.remove_failed', serializeError(error));
      throw error;
    }
  }

  /**
   * Handles incoming updates from Telegram webhook
   */
  async handleUpdate(update: any, context: TelemetryContext): Promise<void> {
    const enrichedContext = extendTelemetryContext(context, {
      component: 'telegram_update',
      chatId: update?.message?.chat?.id || update?.callback_query?.message?.chat?.id,
      userId: update?.message?.from?.id ? String(update.message.from.id) : undefined,
      stage: 'update',
    });
    const scopedLogger = getLogger(enrichedContext);

    try {
      scopedLogger.info('telegram.update.received', {
        updateType: this.getUpdateType(update),
      });
      recordTelegramUpdate(this.getUpdateType(update));

      await runWithTelemetryContext(enrichedContext, () => this.bot.handleUpdate(update));
    } catch (error) {
      scopedLogger.error('telegram.update.failed', {
        ...serializeError(error),
      });
      throw error;
    }
  }

  /**
   * Sends a message to a specific chat
   */
  async sendMessage(
    chatId: number,
    text: string,
    options?: any
  ): Promise<Message.TextMessage> {
    const scopedLogger = getLogger(
      this.getContextFromOptions(options, { component: 'telegram_send_message', chatId }),
    );
    try {
      const sentMessage = await this.bot.telegram.sendMessage(chatId, text, options);
      scopedLogger.info('telegram.reply.sent', {
        chatId,
        textLength: text.length,
      });
      return sentMessage;
    } catch (error) {
      scopedLogger.error('telegram.reply.failed', {
        chatId,
        textLength: text.length,
        ...serializeError(error),
      });
      throw error;
    }
  }

  /**
   * Gets bot information
   */
  async getBotInfo(): Promise<any> {
    try {
      const botInfo = await this.bot.telegram.getMe();
      logger.debug('telegram.bot.info_retrieved', { username: botInfo.username });
      return botInfo;
    } catch (error) {
      logger.error('telegram.bot.info_failed', serializeError(error));
      throw error;
    }
  }

  /**
   * Starts polling for updates (for development)
   */
  async startPolling(): Promise<void> {
    try {
      await this.syncCommands();
      await this.bot.launch();
      logger.info('telegram.bot.polling_started');
    } catch (error) {
      logger.error('telegram.bot.polling_failed', serializeError(error));
      throw error;
    }
  }

  /**
   * Stops the bot gracefully
   */
  async stop(): Promise<void> {
    try {
      this.bot.stop();
      logger.info('telegram.bot.stopped');
    } catch (error) {
      logger.error('telegram.bot.stop_failed', serializeError(error));
    }
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
