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
  priority: number | null;
  concurrency_key: string | null;
  dedupe_key: string | null;
  payload_json: string;
  result_json: string | null;
  error_message: string | null;
  attempt_count: number;
  max_attempts: number | null;
  locked_at: string | null;
  worker_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  superseded_by_job_id: string | null;
  ack_message_id: string | null;
  progress_message_id: string | null;
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
        id, user_id, chat_id, source_message_id, job_type, status, priority, concurrency_key,
        dedupe_key, payload_json, result_json, error_message, attempt_count, max_attempts,
        locked_at, worker_id, started_at, completed_at, superseded_by_job_id, ack_message_id,
        progress_message_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, NULL, NULL, 0, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      [
        id,
        input.userId,
        input.chatId,
        input.sourceMessageId ?? null,
        input.jobType,
        input.priority ?? 100,
        input.concurrencyKey ?? null,
        input.dedupeKey ?? null,
        JSON.stringify(input.payload),
        input.maxAttempts ?? 2,
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
      priority: input.priority ?? 100,
      concurrencyKey: input.concurrencyKey ?? null,
      dedupeKey: input.dedupeKey ?? null,
      payload: input.payload,
      result: null,
      errorMessage: null,
      attemptCount: 0,
      maxAttempts: input.maxAttempts ?? 2,
      lockedAt: null,
      workerId: null,
      startedAt: null,
      completedAt: null,
      supersededByJobId: null,
      ackMessageId: null,
      progressMessageId: null,
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

  async findByDedupeKey(dedupeKey: string): Promise<PersistedJob | null> {
    const row = await this.database.get<JobRow>('SELECT * FROM jobs WHERE dedupe_key = ?', [dedupeKey]);
    return row ? this.mapRow(row) : null;
  }

  async listQueuedJobs(): Promise<PersistedJob[]> {
    const rows = await this.database.all<JobRow>(
      `SELECT * FROM jobs WHERE status = 'queued' ORDER BY priority ASC, created_at ASC`,
    );
    return rows.map((row) => this.mapRow(row));
  }

  async hasRunningJobForConcurrencyKey(concurrencyKey: string): Promise<boolean> {
    const row = await this.database.get<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM jobs
       WHERE concurrency_key = ?
         AND status = 'in_progress'`,
      [concurrencyKey],
    );

    return (row?.count || 0) > 0;
  }

  async claim(jobId: string, workerId: string): Promise<PersistedJob | null> {
    const now = nowIso();
    const result = await this.database.run(
      `UPDATE jobs
       SET status = 'in_progress',
           attempt_count = attempt_count + 1,
           locked_at = ?,
           worker_id = ?,
           started_at = COALESCE(started_at, ?),
           updated_at = ?
       WHERE id = ?
         AND status = 'queued'`,
      [now, workerId, now, now, jobId],
    );

    if (!result.changes) {
      return null;
    }

    return this.getJob(jobId);
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
       SET status = 'failed', result_json = COALESCE(?, result_json), error_message = ?, completed_at = ?, locked_at = NULL, worker_id = NULL, updated_at = ?
       WHERE id = ?`,
      [stringifyJson(result), error, now, now, jobId],
    );
  }

  async requeue(jobId: string, error: string): Promise<void> {
    const now = nowIso();
    await this.database.run(
      `UPDATE jobs
       SET status = 'queued',
           error_message = ?,
           locked_at = NULL,
           worker_id = NULL,
           updated_at = ?
       WHERE id = ?`,
      [error, now, jobId],
    );
  }

  async requeueStaleRunningJobs(staleBeforeIso: string): Promise<number> {
    const now = nowIso();
    const result = await this.database.run(
      `UPDATE jobs
       SET status = 'queued',
           locked_at = NULL,
           worker_id = NULL,
           updated_at = ?
       WHERE status = 'in_progress'
         AND locked_at IS NOT NULL
         AND locked_at < ?
         AND attempt_count < max_attempts`,
      [now, staleBeforeIso],
    );
    return result.changes;
  }

  async markSuperseded(jobId: string, supersededByJobId: string): Promise<void> {
    const now = nowIso();
    await this.database.run(
      `UPDATE jobs
       SET status = 'superseded',
           superseded_by_job_id = ?,
           completed_at = ?,
           updated_at = ?
       WHERE id = ?
         AND status = 'queued'`,
      [supersededByJobId, now, now, jobId],
    );
  }

  async updateAcknowledgementMessage(jobId: string, ackMessageId: string): Promise<void> {
    await this.database.run(
      `UPDATE jobs SET ack_message_id = ?, updated_at = ? WHERE id = ?`,
      [ackMessageId, nowIso(), jobId],
    );
  }

  async updateProgressMessage(jobId: string, progressMessageId: string): Promise<void> {
    await this.database.run(
      `UPDATE jobs SET progress_message_id = ?, updated_at = ? WHERE id = ?`,
      [progressMessageId, nowIso(), jobId],
    );
  }

  async getStatusCounts(): Promise<{ queued: number; running: number }> {
    const rows = await this.database.all<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count
       FROM jobs
       WHERE status IN ('queued', 'in_progress')
       GROUP BY status`,
    );

    return rows.reduce(
      (acc, row) => {
        if (row.status === 'queued') {
          acc.queued = row.count;
        }

        if (row.status === 'in_progress') {
          acc.running = row.count;
        }

        return acc;
      },
      { queued: 0, running: 0 },
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
      priority: row.priority ?? 100,
      concurrencyKey: row.concurrency_key,
      dedupeKey: row.dedupe_key,
      payload: parseJsonObject(row.payload_json) || {},
      result: parseJsonObject(row.result_json),
      errorMessage: row.error_message,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts ?? 2,
      lockedAt: row.locked_at,
      workerId: row.worker_id,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      supersededByJobId: row.superseded_by_job_id,
      ackMessageId: row.ack_message_id,
      progressMessageId: row.progress_message_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
