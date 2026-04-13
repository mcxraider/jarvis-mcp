import { DatabaseService } from '../database.service';
import { CreatePendingClarificationInput, PendingClarificationRecord } from '../types';
import { generateId, nowIso, parseJsonObject, stringifyJson } from '../utils';

interface PendingClarificationRow {
  id: string;
  user_id: string;
  chat_id: string;
  source_message_id: string | null;
  job_id: string | null;
  status: PendingClarificationRecord['status'];
  intent_name: string | null;
  confidence_score: number | null;
  question_text: string;
  proposed_action_json: string | null;
  answer_message_id: string | null;
  expires_at: string | null;
  created_at: string;
  resolved_at: string | null;
}

export class PendingClarificationRepository {
  constructor(private readonly database: DatabaseService) {}

  async createPendingClarification(
    input: CreatePendingClarificationInput,
  ): Promise<PendingClarificationRecord> {
    const id = generateId('clarification');
    const createdAt = nowIso();

    await this.database.run(
      `INSERT INTO pending_clarifications (
        id, user_id, chat_id, source_message_id, job_id, status, intent_name, confidence_score,
        question_text, proposed_action_json, answer_message_id, expires_at, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL, ?, ?, NULL)`,
      [
        id,
        input.userId,
        input.chatId,
        input.sourceMessageId ?? null,
        input.jobId ?? null,
        input.intentName ?? null,
        input.confidenceScore ?? null,
        input.questionText,
        stringifyJson(input.proposedAction),
        input.expiresAt ?? null,
        createdAt,
      ],
    );

    return {
      id,
      userId: input.userId,
      chatId: input.chatId,
      sourceMessageId: input.sourceMessageId ?? null,
      jobId: input.jobId ?? null,
      status: 'pending',
      intentName: input.intentName ?? null,
      confidenceScore: input.confidenceScore ?? null,
      questionText: input.questionText,
      proposedAction: input.proposedAction ?? null,
      answerMessageId: null,
      expiresAt: input.expiresAt ?? null,
      createdAt,
      resolvedAt: null,
    };
  }

  async findActiveByUser(userId: string): Promise<PendingClarificationRecord | null> {
    const row = await this.database.get<PendingClarificationRow>(
      `SELECT * FROM pending_clarifications WHERE user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );

    return row ? this.mapRow(row) : null;
  }

  async resolveClarification(
    clarificationId: string,
    status: 'answered' | 'expired' | 'cancelled',
    answerMessageId?: string,
  ): Promise<void> {
    await this.database.run(
      `UPDATE pending_clarifications
       SET status = ?, answer_message_id = COALESCE(?, answer_message_id), resolved_at = ?
       WHERE id = ?`,
      [status, answerMessageId ?? null, nowIso(), clarificationId],
    );
  }

  async expireClarifications(now: string): Promise<number> {
    const result = await this.database.run(
      `UPDATE pending_clarifications
       SET status = 'expired', resolved_at = ?
       WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?`,
      [now, now],
    );
    return result.changes;
  }

  private mapRow(row: PendingClarificationRow): PendingClarificationRecord {
    return {
      id: row.id,
      userId: row.user_id,
      chatId: row.chat_id,
      sourceMessageId: row.source_message_id,
      jobId: row.job_id,
      status: row.status,
      intentName: row.intent_name,
      confidenceScore: row.confidence_score,
      questionText: row.question_text,
      proposedAction: parseJsonObject(row.proposed_action_json),
      answerMessageId: row.answer_message_id,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }
}
