// services/webhook.controller.ts
import express from 'express';
import type { TelegramBotService } from '../services/telegram/telegram-bot.service';
import { createTelemetryContext, recordWebhook } from '../observability';
import { getLogger, serializeError } from '../utils/logger';

export function createWebhookRouter(botService: TelegramBotService) {
  const router = express.Router();

  router.post('/webhook/:secret', express.json(), async (req, res): Promise<void> => {
    const updateId = typeof req.body?.update_id === 'number' ? req.body.update_id : undefined;
    const context = createTelemetryContext({
      updateId,
      component: 'webhook',
      stage: 'ingress',
    });
    const requestLogger = getLogger(context);
    const startTime = Date.now();

    requestLogger.info('webhook.received', {
      ip: req.ip,
      hasUpdateBody: !!req.body,
    });

    const secret = req.params.secret;
    if (!secret || secret !== process.env.TELEGRAM_SECRET_TOKEN) {
      requestLogger.warn('webhook.rejected', { ip: req.ip });
      recordWebhook('rejected', Date.now() - startTime);
      res.sendStatus(401);
      return;
    }

    try {
      await botService.handleUpdate(req.body, context);
      requestLogger.info('webhook.completed', {
        durationMs: Date.now() - startTime,
        statusCode: 200,
      });
      recordWebhook('success', Date.now() - startTime);
      res.sendStatus(200);
      return;
    } catch (err) {
      requestLogger.error('webhook.failed', {
        ...serializeError(err),
        durationMs: Date.now() - startTime,
      });
      recordWebhook('error', Date.now() - startTime);
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }
  });

  return router;
}
