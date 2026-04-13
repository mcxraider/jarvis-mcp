// src/server.ts — Express setup, webhook registration, graceful shutdown
import express, { Request, Response, NextFunction } from 'express';
import {
  getMetricsContentType,
  getMetricsSnapshot,
  recordUncaughtError,
} from './observability';
import { logger, serializeError } from './utils/logger';
import { createWebhookRouter } from './controllers/webhook.controller';
import { botService } from './app';

const NGROK_URL = process.env.NGROK_URL!;
const TELEGRAM_SECRET_TOKEN = process.env.TELEGRAM_SECRET_TOKEN!;

// Register webhook with Telegram (runs once per URL; safe to call on every start)
(async () => {
  try {
    await botService.setupWebhook(NGROK_URL, TELEGRAM_SECRET_TOKEN);
  } catch (err) {
    logger.error('app.webhook_setup_failed', serializeError(err));
  }
})();

// Express app
const app = express();
app.use(express.json());

app.get('/ping', (_req: Request, res: Response, _next: NextFunction) => {
  res.json({ status: 'ok' });
});

app.get('/metrics', async (_req: Request, res: Response) => {
  res.setHeader('Content-Type', getMetricsContentType());
  res.send(await getMetricsSnapshot());
});

app.use(createWebhookRouter(botService));

// Start listening
const PORT = process.env.PORT || 3000;
logger.info('app.starting', { port: PORT });
app.listen(PORT, () => {
  logger.info('app.ready', {
    port: PORT,
    healthPath: '/ping',
    metricsPath: '/metrics',
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('app.shutting_down', { signal: 'SIGTERM' });
  process.exit(0);
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
