// services/webhook.controller.ts
import express from 'express';
import type { TelegramBotService } from '../services/telegram/telegram-bot.service';
import { logger } from '../utils/logger';
import { ConversationStoreService, UsageTrackingService } from '../services/persistence';

export function createWebhookRouter(
  botService: TelegramBotService,
  conversationStore?: ConversationStoreService,
  usageTrackingService?: UsageTrackingService,
) {
  const router = express.Router();

  router.post('/webhook/:secret', express.json(), async (req, res): Promise<void> => {
    const secret = req.params.secret;
    if (!secret || secret !== process.env.TELEGRAM_SECRET_TOKEN) {
      logger.warn('Unauthorized webhook attempt', { ip: req.ip, secret });
      res.sendStatus(401);
      return;
    }
    try {
      const updateId = typeof req.body?.update_id === 'number' ? req.body.update_id : undefined;
      if (updateId) {
        const existingMessage = await conversationStore?.findByTelegramUpdateId(updateId);
        if (existingMessage) {
          logger.info('Skipping duplicate Telegram update', {
            telegramUpdateId: updateId,
            messageId: existingMessage.id,
          });
          res.sendStatus(200);
          return;
        }
      }

      const from = req.body?.message?.from ?? req.body?.callback_query?.from;
      const chat = req.body?.message?.chat ?? req.body?.callback_query?.message?.chat;
      await usageTrackingService?.recordEvent({
        userId: from?.id?.toString(),
        chatId: chat?.id?.toString(),
        eventType: 'message_received',
        metadata: {
          updateId: updateId ?? null,
          updateKeys: req.body ? Object.keys(req.body) : [],
        },
      });

      await botService.handleUpdate(req.body);
      res.sendStatus(200);
      return;
    } catch (err) {
      logger.error('Webhook handler failed', {
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
      res.status(500).json({ error: 'Internal Server Error' });
      return;
    }
  });

  return router;
}
