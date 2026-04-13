import express, { Request, Response, NextFunction } from 'express';
import { logger } from './utils/logger';
import { createWebhookRouter } from './controllers/webhook.controller';
import { initializeApplication } from './app';

const NGROK_URL = process.env.NGROK_URL!;
const TELEGRAM_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN!;

async function startServer(): Promise<void> {
  const services = await initializeApplication();

  try {
    await services.botService.setupWebhook(NGROK_URL, TELEGRAM_SECRET_TOKEN);
  } catch (err) {
    logger.error('Error setting up webhook', {
      error: (err as Error).message,
    });
  }

  const app = express();
  app.use(express.json());

  app.get('/ping', (_req: Request, res: Response, _next: NextFunction) => {
    res.json({ status: 'ok' });
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
  app.listen(PORT, () => {
    logger.info(`Server started at http://localhost:${PORT}`);
    logger.info(`Waiting for Telegram updates on /webhook/:secret`);
  });

  const shutdown = async () => {
    logger.info('Shutting down gracefully...');
    await services.workerService.stop();
    await services.databaseService.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
}

void startServer();
