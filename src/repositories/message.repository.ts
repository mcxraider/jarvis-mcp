import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { InboundTask, MessageRecord } from '../types/job.types';

export class MessageRepository {
  constructor(private readonly db: Database<sqlite3.Database, sqlite3.Statement>) {}

  async create(task: InboundTask): Promise<MessageRecord> {
    const now = new Date().toISOString();
    const result = await this.db.run(
      `
        INSERT INTO messages (
          telegram_update_id,
          telegram_message_id,
          chat_id,
          user_id,
          message_type,
          payload_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      task.telegramUpdateId,
      task.telegramMessageId,
      task.chatId,
      task.userId,
      task.kind,
      JSON.stringify(task),
      now,
      now,
    );

    return {
      id: result.lastID!,
      telegramUpdateId: task.telegramUpdateId,
      telegramMessageId: task.telegramMessageId,
      chatId: task.chatId,
      userId: task.userId,
      messageType: task.kind,
      payloadJson: JSON.stringify(task),
      createdAt: now,
      updatedAt: now,
    };
  }
}
