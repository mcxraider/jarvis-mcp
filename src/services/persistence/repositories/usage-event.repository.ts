import { DatabaseService } from '../database.service';
import { RecordUsageEventInput, UsageEventRecord, UsageSummary } from '../types';
import { generateId, nowIso, parseJsonObject, stringifyJson } from '../utils';

interface UsageEventRow {
  id: string;
  user_id: string | null;
  chat_id: string | null;
  job_id: string | null;
  message_id: string | null;
  event_type: UsageEventRecord['eventType'];
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  duration_ms: number | null;
  metadata_json: string | null;
  created_at: string;
}

interface UsageSummaryRow {
  event_count: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_estimated_cost_usd: number | null;
}

export class UsageEventRepository {
  constructor(private readonly database: DatabaseService) {}

  async recordEvent(input: RecordUsageEventInput): Promise<UsageEventRecord> {
    const id = generateId('usage');
    const createdAt = nowIso();

    await this.database.run(
      `INSERT INTO usage_events (
        id, user_id, chat_id, job_id, message_id, event_type, model, input_tokens,
        output_tokens, estimated_cost_usd, duration_ms, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.userId ?? null,
        input.chatId ?? null,
        input.jobId ?? null,
        input.messageId ?? null,
        input.eventType,
        input.model ?? null,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.estimatedCostUsd ?? null,
        input.durationMs ?? null,
        stringifyJson(input.metadata),
        createdAt,
      ],
    );

    return {
      id,
      userId: input.userId ?? null,
      chatId: input.chatId ?? null,
      jobId: input.jobId ?? null,
      messageId: input.messageId ?? null,
      eventType: input.eventType,
      model: input.model ?? null,
      inputTokens: input.inputTokens ?? null,
      outputTokens: input.outputTokens ?? null,
      estimatedCostUsd: input.estimatedCostUsd ?? null,
      durationMs: input.durationMs ?? null,
      metadata: input.metadata ?? null,
      createdAt,
    };
  }

  async listEventsForUser(userId: string, limit: number): Promise<UsageEventRecord[]> {
    const rows = await this.database.all<UsageEventRow>(
      `SELECT * FROM usage_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit],
    );

    return rows.map((row) => this.mapRow(row));
  }

  async summarizeUsageForUser(userId: string, createdAfter: string): Promise<UsageSummary> {
    const row = await this.database.get<UsageSummaryRow>(
      `SELECT
         COUNT(*) AS event_count,
         COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
         COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost_usd
       FROM usage_events
       WHERE user_id = ? AND created_at >= ?`,
      [userId, createdAfter],
    );

    return {
      eventCount: row?.event_count || 0,
      totalInputTokens: row?.total_input_tokens || 0,
      totalOutputTokens: row?.total_output_tokens || 0,
      totalEstimatedCostUsd: row?.total_estimated_cost_usd || 0,
    };
  }

  private mapRow(row: UsageEventRow): UsageEventRecord {
    return {
      id: row.id,
      userId: row.user_id,
      chatId: row.chat_id,
      jobId: row.job_id,
      messageId: row.message_id,
      eventType: row.event_type,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      estimatedCostUsd: row.estimated_cost_usd,
      durationMs: row.duration_ms,
      metadata: parseJsonObject(row.metadata_json),
      createdAt: row.created_at,
    };
  }
}
