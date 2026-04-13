// src/app.ts — service wiring
import 'dotenv/config';
import { logger } from './utils/logger';
import { TelegramBotService } from './services/telegram/telegram-bot.service';
import { MessageProcessorService } from './services/telegram/message-processor.service';
import { TelegramConfig } from './types/telegram.types';
import { DirectToolCallDispatcher } from './services/tools/direct-tool-dispatcher.service';
import {
  ClarificationStateService,
  ConversationStoreService,
  DatabaseService,
  JobRepository,
  JobStateService,
  MessageRepository,
  MigrationRunner,
  PendingClarificationRepository,
  UsageEventRepository,
  UsageTrackingService,
  UserPreferencesRepository,
} from './services/persistence';

// Validate required environment variables before constructing any service
const REQUIRED_ENV_VARS = [
  'BOT_TOKEN',
  'NGROK_URL',
  'TELEGRAM_SECRET_TOKEN',
  'OPENAI_API_KEY',
  'TODOIST_API_KEY',
];

for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    console.error(`[startup] Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

const BOT_TOKEN = process.env.BOT_TOKEN!;
const NGROK_URL = process.env.NGROK_URL!;
const TELEGRAM_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN!;
const DATABASE_PATH = process.env.DATABASE_PATH || './data/jarvis.db';
const DATABASE_VERBOSE_LOGGING = process.env.DATABASE_VERBOSE_LOGGING === 'true';

export interface AppServices {
  botService: TelegramBotService;
  databaseService: DatabaseService;
  conversationStore: ConversationStoreService;
  jobStateService: JobStateService;
  clarificationStateService: ClarificationStateService;
  usageTrackingService: UsageTrackingService;
  userPreferencesRepository: UserPreferencesRepository;
}

export async function initializeApplication(): Promise<AppServices> {
  const databaseService = new DatabaseService({
    path: DATABASE_PATH,
    verboseLogging: DATABASE_VERBOSE_LOGGING,
  });
  await databaseService.init();

  const migrationRunner = new MigrationRunner(databaseService);
  await migrationRunner.runMigrations();

  const messageRepository = new MessageRepository(databaseService);
  const jobRepository = new JobRepository(databaseService);
  const clarificationRepository = new PendingClarificationRepository(databaseService);
  const userPreferencesRepository = new UserPreferencesRepository(databaseService);
  const usageEventRepository = new UsageEventRepository(databaseService);

  const conversationStore = new ConversationStoreService(messageRepository);
  const jobStateService = new JobStateService(jobRepository);
  const clarificationStateService = new ClarificationStateService(clarificationRepository);
  const usageTrackingService = new UsageTrackingService(usageEventRepository);

  const toolDispatcher = new DirectToolCallDispatcher();
  const messageProcessor = new MessageProcessorService(toolDispatcher, usageTrackingService);

  const telegramConfig: TelegramConfig = {
    token: BOT_TOKEN,
    webhookUrl: NGROK_URL,
    secretToken: TELEGRAM_SECRET_TOKEN,
  };

  const botService = new TelegramBotService(telegramConfig, messageProcessor, {
    conversationStore,
    jobStateService,
    usageTrackingService,
  });

  logger.info('Services initialised', {
    databasePath: DATABASE_PATH,
  });

  return {
    botService,
    databaseService,
    conversationStore,
    jobStateService,
    clarificationStateService,
    usageTrackingService,
    userPreferencesRepository,
  };
}
