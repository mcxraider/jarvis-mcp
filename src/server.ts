import express, { Request, Response, NextFunction } from 'express';
import {
  getMetricsContentType,
  getMetricsSnapshot,
  recordUncaughtError,
} from './observability';
import { logger, serializeError } from './utils/logger';
import { createWebhookRouter } from './controllers/webhook.controller';
import { initializeApplication } from './app';

const NGROK_URL = process.env.NGROK_URL!;
const TELEGRAM_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN!;

async function startServer(): Promise<void> {
  const services = await initializeApplication();

  try {
    await services.botService.setupWebhook(NGROK_URL, TELEGRAM_SECRET_TOKEN);
  } catch (err) {
    logger.error('app.webhook_setup_failed', serializeError(err));
  }

  const app = express();
  app.use(express.json());

  app.get('/ping', (_req: Request, res: Response, _next: NextFunction) => {
    res.json({ status: 'ok' });
  });

  app.get('/metrics', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type', getMetricsContentType());
    res.send(await getMetricsSnapshot());
  });

  app.use(
    createWebhookRouter(
      services.botService,
      services.conversationStore,
      services.usageTrackingService,
    ),
  );

  services.workerService.start();

  const PORT = process.env.PORT || 3000;
  logger.info('app.starting', { port: PORT });
  app.listen(PORT, () => {
    logger.info('app.ready', {
      port: PORT,
      healthPath: '/ping',
      metricsPath: '/metrics',
    });
  });

  const shutdown = async (signal: string) => {
    logger.info('app.shutting_down', { signal });
    await services.workerService.stop();
    await services.databaseService.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('uncaughtException', (error) => {
    recordUncaughtError('uncaughtException');
    logger.error('runtime.fatal', {
      kind: 'uncaughtException',
      ...serializeError(error),
    });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    recordUncaughtError('unhandledRejection');
    logger.error('runtime.fatal', {
      kind: 'unhandledRejection',
      ...serializeError(reason),
    });
  });
}

void startServer();
