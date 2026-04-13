import express from 'express';
import type { TelegramBotService } from '../services/telegram/telegram-bot.service';
import { ConversationStoreService, UsageTrackingService } from '../services/persistence';
import { createTelemetryContext, recordWebhook } from '../observability';
import { getLogger, serializeError } from '../utils/logger';

export function createWebhookRouter(
  botService: TelegramBotService,
  conversationStore?: ConversationStoreService,
  usageTrackingService?: UsageTrackingService,
) {
  const router = express.Router();

  router.post('/webhook/:secret', express.json(), async (req, res): Promise<void> => {
    const updateId = typeof req.body?.update_id === 'number' ? req.body.update_id : undefined;
    const from = req.body?.message?.from ?? req.body?.callback_query?.from;
    const chat = req.body?.message?.chat ?? req.body?.callback_query?.message?.chat;
    const context = createTelemetryContext({
      updateId,
      chatId: chat?.id,
      userId: from?.id?.toString(),
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
      if (updateId) {
        const existingMessage = await conversationStore?.findByTelegramUpdateId(updateId);
        if (existingMessage) {
          requestLogger.info('webhook.duplicate_skipped', {
            telegramUpdateId: updateId,
            messageId: existingMessage.id,
          });
          recordWebhook('success', Date.now() - startTime);
          res.sendStatus(200);
          return;
        }
      }

      await usageTrackingService?.recordEvent({
        userId: from?.id?.toString(),
        chatId: chat?.id?.toString(),
        eventType: 'message_received',
        metadata: {
          updateId: updateId ?? null,
          updateKeys: req.body ? Object.keys(req.body) : [],
        },
      });

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
