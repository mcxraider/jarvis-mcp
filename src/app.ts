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
  JobEventRepository,
  JobRepository,
  JobStateService,
  MessageRepository,
  MigrationRunner,
  PendingClarificationRepository,
  UsageEventRepository,
  UsageTrackingService,
  UserPreferencesRepository,
} from './services/persistence';
import { JobService } from './services/jobs/job.service';
import { TelegramUpdateIntakeService } from './services/telegram/telegram-update-intake.service';
import { TelegramResponseService } from './services/telegram/telegram-response.service';
import { TelegramProgressService } from './services/telegram/telegram-progress.service';
import { JobProgressService } from './services/jobs/job-progress.service';
import { JobSchedulerService } from './services/jobs/job-scheduler.service';
import { JobQueueService } from './services/jobs/job-queue.service';
import { JobWorkerService } from './services/jobs/job-worker.service';
import { TextJobProcessor } from './services/jobs/processors/text-job.processor';
import { AudioJobProcessor } from './services/jobs/processors/audio-job.processor';
import { FileService } from './services/telegram/file.service';

const REQUIRED_ENV_VARS = [
  'BOT_TOKEN',
  'NGROK_URL',
  'TELEGRAM_SECRET_TOKEN',
  'OPENAI_API_KEY',
  'TODOIST_API_KEY',
];

const BOT_TOKEN = process.env.BOT_TOKEN!;
const NGROK_URL = process.env.NGROK_URL!;
const TELEGRAM_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN!;
const DATABASE_PATH = process.env.DATABASE_PATH || './data/jarvis.db';
const DATABASE_VERBOSE_LOGGING = process.env.DATABASE_VERBOSE_LOGGING === 'true';

export interface AppServices {
  botService: TelegramBotService;
  workerService: JobWorkerService;
  databaseService: DatabaseService;
  conversationStore: ConversationStoreService;
  jobStateService: JobStateService;
  clarificationStateService: ClarificationStateService;
  usageTrackingService: UsageTrackingService;
  userPreferencesRepository: UserPreferencesRepository;
}

export async function initializeApplication(): Promise<AppServices> {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[startup] Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  const databaseService = new DatabaseService({
    path: DATABASE_PATH,
    verboseLogging: DATABASE_VERBOSE_LOGGING,
  });
  await databaseService.init();

  const migrationRunner = new MigrationRunner(databaseService);
  await migrationRunner.runMigrations();

  const messageRepository = new MessageRepository(databaseService);
  const jobRepository = new JobRepository(databaseService);
  const jobEventRepository = new JobEventRepository(databaseService);
  const clarificationRepository = new PendingClarificationRepository(databaseService);
  const userPreferencesRepository = new UserPreferencesRepository(databaseService);
  const usageEventRepository = new UsageEventRepository(databaseService);

  const conversationStore = new ConversationStoreService(messageRepository);
  const jobStateService = new JobStateService(jobRepository);
  const clarificationStateService = new ClarificationStateService(clarificationRepository);
  const usageTrackingService = new UsageTrackingService(usageEventRepository);

  const jobService = new JobService(conversationStore, jobStateService);
  const intakeService = new TelegramUpdateIntakeService(jobService);
  const toolDispatcher = new DirectToolCallDispatcher();
  const messageProcessor = new MessageProcessorService(toolDispatcher, usageTrackingService);

  const telegramConfig: TelegramConfig = {
    token: BOT_TOKEN,
    webhookUrl: NGROK_URL,
    secretToken: TELEGRAM_SECRET_TOKEN,
  };

  const botService = new TelegramBotService(telegramConfig, intakeService, jobService, {
    conversationStore,
    usageTrackingService,
  });
  const fileService = new FileService(BOT_TOKEN, botService.bot.telegram);
  const responseService = new TelegramResponseService(botService.bot.telegram);
  const progressService = new TelegramProgressService(responseService, jobStateService);
  const jobProgressService = new JobProgressService(
    jobEventRepository,
    jobStateService,
    progressService,
  );
  const jobSchedulerService = new JobSchedulerService(jobStateService);
  const jobQueueService = new JobQueueService(jobStateService, jobSchedulerService);
  const workerService = new JobWorkerService(
    jobQueueService,
    jobProgressService,
    jobService,
    responseService,
  );

  workerService.registerProcessor('text', new TextJobProcessor(messageProcessor));
  workerService.registerProcessor('voice', new AudioJobProcessor(messageProcessor, fileService));
  workerService.registerProcessor(
    'audio_document',
    new AudioJobProcessor(messageProcessor, fileService),
  );

  logger.info('app.services_initialized', {
    databasePath: DATABASE_PATH,
  });

  return {
    botService,
    workerService,
    databaseService,
    conversationStore,
    jobStateService,
    clarificationStateService,
    usageTrackingService,
    userPreferencesRepository,
  };
}
