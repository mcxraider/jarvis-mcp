import { logger } from '../../../utils/logger';
import { DatabaseService } from '../database.service';
import {
  CreateIncomingMessageInput,
  CreateOutgoingMessageInput,
  PersistedMessage,
  PersistedMessageStatus,
} from '../types';
import { generateId, nowIso } from '../utils';

interface MessageRow {
  id: string;
  telegram_update_id: number | null;
  telegram_message_id: number | null;
  chat_id: string;
  user_id: string;
  direction: PersistedMessage['direction'];
  message_type: PersistedMessage['messageType'];
  content_text: string | null;
  file_id: string | null;
  file_url: string | null;
  file_name: string | null;
  mime_type: string | null;
  reply_to_message_id: string | null;
  job_id: string | null;
  status: PersistedMessage['status'];
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
}

export class MessageRepository {
  constructor(private readonly database: DatabaseService) {}

  async createIncomingMessage(input: CreateIncomingMessageInput): Promise<PersistedMessage> {
    const id = generateId('msg');
    const createdAt = nowIso();
    const status = input.status || 'received';

    try {
      await this.database.run(
        `INSERT INTO messages (
          id, telegram_update_id, telegram_message_id, chat_id, user_id, direction, message_type,
          content_text, file_id, file_url, file_name, mime_type, reply_to_message_id, job_id,
          status, error_message, created_at, processed_at
        ) VALUES (?, ?, ?, ?, ?, 'incoming', ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, NULL)`,
        [
          id,
          input.telegramUpdateId ?? null,
          input.telegramMessageId ?? null,
          input.chatId,
          input.userId,
          input.messageType,
          input.contentText ?? null,
          input.fileId ?? null,
          input.fileUrl ?? null,
          input.fileName ?? null,
          input.mimeType ?? null,
          input.jobId ?? null,
          status,
          createdAt,
        ],
      );
    } catch (error) {
      logger.error('Failed to create incoming message', {
        dbOperation: 'createIncomingMessage',
        telegramUpdateId: input.telegramUpdateId,
        userId: input.userId,
        chatId: input.chatId,
        error: (error as Error).message,
      });
      throw error;
    }

    return {
      id,
      telegramUpdateId: input.telegramUpdateId ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
      chatId: input.chatId,
      userId: input.userId,
      direction: 'incoming',
      messageType: input.messageType,
      contentText: input.contentText ?? null,
      fileId: input.fileId ?? null,
      fileUrl: input.fileUrl ?? null,
      fileName: input.fileName ?? null,
      mimeType: input.mimeType ?? null,
      replyToMessageId: null,
      jobId: input.jobId ?? null,
      status,
      errorMessage: null,
      createdAt,
      processedAt: null,
    };
  }

  async createOutgoingMessage(input: CreateOutgoingMessageInput): Promise<PersistedMessage> {
    const id = generateId('msg');
    const createdAt = nowIso();
    const processedAt = nowIso();
    const status = input.status || 'processed';

    await this.database.run(
      `INSERT INTO messages (
        id, telegram_update_id, telegram_message_id, chat_id, user_id, direction, message_type,
        content_text, file_id, file_url, file_name, mime_type, reply_to_message_id, job_id,
        status, error_message, created_at, processed_at
      ) VALUES (?, NULL, ?, ?, ?, 'outgoing', ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, NULL, ?, ?)`,
      [
        id,
        input.telegramMessageId ?? null,
        input.chatId,
        input.userId,
        input.messageType,
        input.contentText ?? null,
        input.replyToMessageId ?? null,
        input.jobId ?? null,
        status,
        createdAt,
        processedAt,
      ],
    );

    return {
      id,
      telegramUpdateId: null,
      telegramMessageId: input.telegramMessageId ?? null,
      chatId: input.chatId,
      userId: input.userId,
      direction: 'outgoing',
      messageType: input.messageType,
      contentText: input.contentText ?? null,
      fileId: null,
      fileUrl: null,
      fileName: null,
      mimeType: null,
      replyToMessageId: input.replyToMessageId ?? null,
      jobId: input.jobId ?? null,
      status,
      errorMessage: null,
      createdAt,
      processedAt,
    };
  }

  async markMessageProcessing(
    messageId: string,
    status: PersistedMessageStatus,
    errorMessage?: string,
    jobId?: string,
  ): Promise<void> {
    const processedAt = status === 'processed' || status === 'failed' ? nowIso() : null;

    await this.database.run(
      `UPDATE messages
       SET status = ?, error_message = ?, processed_at = COALESCE(?, processed_at), job_id = COALESCE(?, job_id)
       WHERE id = ?`,
      [status, errorMessage ?? null, processedAt, jobId ?? null, messageId],
    );
  }

  async listRecentMessagesByUser(userId: string, limit: number): Promise<PersistedMessage[]> {
    const rows = await this.database.all<MessageRow>(
      `SELECT * FROM messages WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit],
    );

    return rows.map((row) => this.mapRow(row));
  }

  async findByTelegramUpdateId(updateId: number): Promise<PersistedMessage | null> {
    const row = await this.database.get<MessageRow>(
      `SELECT * FROM messages WHERE telegram_update_id = ? ORDER BY created_at DESC LIMIT 1`,
      [updateId],
    );

    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: MessageRow): PersistedMessage {
    return {
      id: row.id,
      telegramUpdateId: row.telegram_update_id,
      telegramMessageId: row.telegram_message_id,
      chatId: row.chat_id,
      userId: row.user_id,
      direction: row.direction,
      messageType: row.message_type,
      contentText: row.content_text,
      fileId: row.file_id,
      fileUrl: row.file_url,
      fileName: row.file_name,
      mimeType: row.mime_type,
      replyToMessageId: row.reply_to_message_id,
      jobId: row.job_id,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      processedAt: row.processed_at,
    };
  }
}
