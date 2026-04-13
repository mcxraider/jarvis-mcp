import { DatabaseService } from '../database.service';
import { CreateJobInput, JobStatus, PersistedJob } from '../types';
import { generateId, nowIso, parseJsonObject, stringifyJson } from '../utils';

interface JobRow {
  id: string;
  user_id: string;
  chat_id: string;
  source_message_id: string | null;
  job_type: PersistedJob['jobType'];
  status: PersistedJob['status'];
  payload_json: string;
  result_json: string | null;
  error_message: string | null;
  attempt_count: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class JobRepository {
  constructor(private readonly database: DatabaseService) {}

  async createJob(input: CreateJobInput): Promise<PersistedJob> {
    const id = generateId('job');
    const createdAt = nowIso();

    await this.database.run(
      `INSERT INTO jobs (
        id, user_id, chat_id, source_message_id, job_type, status, payload_json, result_json,
        error_message, attempt_count, started_at, completed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, 0, NULL, NULL, ?, ?)`,
      [
        id,
        input.userId,
        input.chatId,
        input.sourceMessageId ?? null,
        input.jobType,
        JSON.stringify(input.payload),
        createdAt,
        createdAt,
      ],
    );

    return {
      id,
      userId: input.userId,
      chatId: input.chatId,
      sourceMessageId: input.sourceMessageId ?? null,
      jobType: input.jobType,
      status: 'queued',
      payload: input.payload,
      result: null,
      errorMessage: null,
      attemptCount: 0,
      startedAt: null,
      completedAt: null,
      createdAt,
      updatedAt: createdAt,
    };
  }

  async markInProgress(jobId: string): Promise<void> {
    const now = nowIso();
    await this.database.run(
      `UPDATE jobs
       SET status = 'in_progress', attempt_count = attempt_count + 1, started_at = COALESCE(started_at, ?), updated_at = ?
       WHERE id = ?`,
      [now, now, jobId],
    );
  }

  async markCompleted(jobId: string, result: Record<string, unknown>): Promise<void> {
    const now = nowIso();
    await this.database.run(
      `UPDATE jobs
       SET status = 'completed', result_json = ?, error_message = NULL, completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [JSON.stringify(result), now, now, jobId],
    );
  }

  async markFailed(jobId: string, error: string, result?: Record<string, unknown>): Promise<void> {
    const now = nowIso();
    await this.database.run(
      `UPDATE jobs
       SET status = 'failed', result_json = COALESCE(?, result_json), error_message = ?, completed_at = ?, updated_at = ?
       WHERE id = ?`,
      [stringifyJson(result), error, now, now, jobId],
    );
  }

  async getJob(jobId: string): Promise<PersistedJob | null> {
    const row = await this.database.get<JobRow>('SELECT * FROM jobs WHERE id = ?', [jobId]);
    return row ? this.mapRow(row) : null;
  }

  async listActiveJobsByUser(userId: string): Promise<PersistedJob[]> {
    const rows = await this.database.all<JobRow>(
      `SELECT * FROM jobs WHERE user_id = ? AND status IN ('queued', 'in_progress') ORDER BY created_at ASC`,
      [userId],
    );
    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: JobRow): PersistedJob {
    return {
      id: row.id,
      userId: row.user_id,
      chatId: row.chat_id,
      sourceMessageId: row.source_message_id,
      jobType: row.job_type,
      status: row.status,
      payload: parseJsonObject(row.payload_json) || {},
      result: parseJsonObject(row.result_json),
      errorMessage: row.error_message,
      attemptCount: row.attempt_count,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
