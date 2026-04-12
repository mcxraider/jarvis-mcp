import 'dotenv/config';
import { logger } from './utils/logger';
import { TelegramBotService } from './services/telegram/telegram-bot.service';
import { MessageProcessorService } from './services/telegram/message-processor.service';
import { TelegramConfig } from './types/telegram.types';
import { DirectToolCallDispatcher } from './services/tools/direct-tool-dispatcher.service';
import { SQLiteService } from './services/persistence/sqlite.service';
import { MessageRepository } from './repositories/message.repository';
import { JobRepository } from './repositories/job.repository';
import { JobEventRepository } from './repositories/job-event.repository';
import { JobService } from './services/jobs/job.service';
import { TelegramUpdateIntakeService } from './services/telegram/telegram-update-intake.service';
import { JobSchedulerService } from './services/jobs/job-scheduler.service';
import { JobQueueService } from './services/jobs/job-queue.service';
import { TelegramResponseService } from './services/telegram/telegram-response.service';
import { TelegramProgressService } from './services/telegram/telegram-progress.service';
import { JobProgressService } from './services/jobs/job-progress.service';
import { JobWorkerService } from './services/jobs/job-worker.service';
import { TextJobProcessor } from './services/jobs/processors/text-job.processor';
import { AudioJobProcessor } from './services/jobs/processors/audio-job.processor';
import { FileService } from './services/telegram/file.service';

const REQUIRED_ENV_VARS = ['BOT_TOKEN', 'NGROK_URL', 'TELEGRAM_SECRET_TOKEN', 'OPENAI_API_KEY'];

export interface ApplicationServices {
  botService: TelegramBotService;
  workerService: JobWorkerService;
  sqliteService: SQLiteService;
}

export async function initializeApplication(): Promise<ApplicationServices> {
  for (const key of REQUIRED_ENV_VARS) {
    if (!process.env[key]) {
      console.error(`[startup] Missing required environment variable: ${key}`);
      process.exit(1);
    }
  }

  const BOT_TOKEN = process.env.BOT_TOKEN!;
  const NGROK_URL = process.env.NGROK_URL!;
  const TELEGRAM_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN!;

  const sqliteService = new SQLiteService();
  await sqliteService.initialize();

  const db = sqliteService.getDatabase();
  const messageRepository = new MessageRepository(db);
  const jobRepository = new JobRepository(db);
  const jobEventRepository = new JobEventRepository(db);

  const jobService = new JobService(messageRepository, jobRepository);
  const intakeService = new TelegramUpdateIntakeService(jobService);
  const toolDispatcher = process.env.TODOIST_API_KEY ? new DirectToolCallDispatcher() : undefined;
  const messageProcessor = new MessageProcessorService(toolDispatcher);

  const telegramConfig: TelegramConfig = {
    token: BOT_TOKEN,
    webhookUrl: NGROK_URL,
    secretToken: TELEGRAM_SECRET_TOKEN,
  };

  const botService = new TelegramBotService(telegramConfig, intakeService, jobService);
  const fileService = new FileService(BOT_TOKEN, botService.bot.telegram);
  const responseService = new TelegramResponseService(botService.bot.telegram);
  const progressService = new TelegramProgressService(responseService, jobRepository);
  const jobProgressService = new JobProgressService(
    jobEventRepository,
    jobRepository,
    progressService,
  );
  const jobSchedulerService = new JobSchedulerService(jobRepository);
  const jobQueueService = new JobQueueService(jobRepository, jobSchedulerService);
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

  logger.info('Services initialised');

  return {
    botService,
    workerService,
    sqliteService,
  };
}
