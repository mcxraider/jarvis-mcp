import { randomUUID } from 'crypto';
import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { JobPayload, JobRecord, JobStatus, JobType } from '../types/job.types';

interface CreateJobParams {
  userId: number;
  chatId: number;
  messageId: number;
  type: JobType;
  priority?: number;
  concurrencyKey?: string | null;
  dedupeKey: string;
  payload: JobPayload;
  maxAttempts?: number;
}

export class JobRepository {
  constructor(private readonly db: Database<sqlite3.Database, sqlite3.Statement>) {}

  async create(params: CreateJobParams): Promise<JobRecord> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const record: JobRecord = {
      id,
      userId: params.userId,
      chatId: params.chatId,
      messageId: params.messageId,
      type: params.type,
      status: 'queued',
      priority: params.priority ?? 100,
      concurrencyKey: params.concurrencyKey ?? null,
      dedupeKey: params.dedupeKey,
      payloadJson: JSON.stringify(params.payload),
      resultJson: null,
      errorJson: null,
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 2,
      lockedAt: null,
      workerId: null,
      startedAt: null,
      completedAt: null,
      supersededByJobId: null,
      ackMessageId: null,
      progressMessageId: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.run(
      `
        INSERT INTO jobs (
          id, user_id, chat_id, message_id, type, status, priority,
          concurrency_key, dedupe_key, payload_json, result_json, error_json,
          attempts, max_attempts, locked_at, worker_id, started_at, completed_at,
          superseded_by_job_id, ack_message_id, progress_message_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      record.id,
      record.userId,
      record.chatId,
      record.messageId,
      record.type,
      record.status,
      record.priority,
      record.concurrencyKey,
      record.dedupeKey,
      record.payloadJson,
      record.resultJson,
      record.errorJson,
      record.attempts,
      record.maxAttempts,
      record.lockedAt,
      record.workerId,
      record.startedAt,
      record.completedAt,
      record.supersededByJobId,
      record.ackMessageId,
      record.progressMessageId,
      record.createdAt,
      record.updatedAt,
    );

    return record;
  }

  async findByDedupeKey(dedupeKey: string): Promise<JobRecord | undefined> {
    const row = await this.db.get(`SELECT * FROM jobs WHERE dedupe_key = ?`, dedupeKey);
    return row ? this.mapJobRecord(row) : undefined;
  }

  async findById(jobId: string): Promise<JobRecord | undefined> {
    const row = await this.db.get(`SELECT * FROM jobs WHERE id = ?`, jobId);
    return row ? this.mapJobRecord(row) : undefined;
  }

  async listQueuedJobs(): Promise<JobRecord[]> {
    const rows = await this.db.all(
      `
        SELECT * FROM jobs
        WHERE status = 'queued'
        ORDER BY priority ASC, created_at ASC
      `,
    );
    return rows.map((row) => this.mapJobRecord(row));
  }

  async hasRunningJobForConcurrencyKey(concurrencyKey: string): Promise<boolean> {
    const row = await this.db.get(
      `
        SELECT COUNT(*) as count
        FROM jobs
        WHERE concurrency_key = ?
          AND status = 'running'
      `,
      concurrencyKey,
    );
    return (row?.count || 0) > 0;
  }

  async claim(jobId: string, workerId: string): Promise<JobRecord | undefined> {
    const now = new Date().toISOString();
    const result = await this.db.run(
      `
        UPDATE jobs
        SET status = 'running',
            locked_at = ?,
            worker_id = ?,
            started_at = COALESCE(started_at, ?),
            attempts = attempts + 1,
            updated_at = ?
        WHERE id = ?
          AND status = 'queued'
      `,
      now,
      workerId,
      now,
      now,
      jobId,
    );

    if (!result.changes) {
      return undefined;
    }

    return this.findById(jobId);
  }

  async markCompleted(
    jobId: string,
    resultPayload: Record<string, unknown>,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `
        UPDATE jobs
        SET status = 'completed',
            result_json = ?,
            error_json = NULL,
            completed_at = ?,
            locked_at = NULL,
            worker_id = NULL,
            updated_at = ?
        WHERE id = ?
      `,
      JSON.stringify(resultPayload),
      now,
      now,
      jobId,
    );
  }

  async markFailed(
    jobId: string,
    errorPayload: Record<string, unknown>,
    terminal: boolean,
  ): Promise<void> {
    const now = new Date().toISOString();
    const nextStatus: JobStatus = terminal ? 'failed' : 'queued';

    await this.db.run(
      `
        UPDATE jobs
        SET status = ?,
            error_json = ?,
            locked_at = NULL,
            worker_id = NULL,
            completed_at = CASE WHEN ? = 'failed' THEN ? ELSE completed_at END,
            updated_at = ?
        WHERE id = ?
      `,
      nextStatus,
      JSON.stringify(errorPayload),
      nextStatus,
      now,
      now,
      jobId,
    );
  }

  async markSuperseded(jobId: string, supersededByJobId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `
        UPDATE jobs
        SET status = 'superseded',
            superseded_by_job_id = ?,
            completed_at = ?,
            updated_at = ?
        WHERE id = ?
          AND status = 'queued'
      `,
      supersededByJobId,
      now,
      now,
      jobId,
    );
  }

  async supersedeQueuedJobsByDedupeKey(dedupeKey: string, supersededByJobId: string): Promise<void> {
    const rows = await this.db.all(
      `
        SELECT id FROM jobs
        WHERE dedupe_key = ?
          AND status = 'queued'
      `,
      dedupeKey,
    );

    for (const row of rows) {
      if (row.id !== supersededByJobId) {
        await this.markSuperseded(row.id, supersededByJobId);
      }
    }
  }

  async updateAcknowledgementMessage(jobId: string, ackMessageId: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `
        UPDATE jobs
        SET ack_message_id = ?, updated_at = ?
        WHERE id = ?
      `,
      ackMessageId,
      now,
      jobId,
    );
  }

  async updateProgressMessage(jobId: string, progressMessageId: number): Promise<void> {
    const now = new Date().toISOString();
    await this.db.run(
      `
        UPDATE jobs
        SET progress_message_id = ?, updated_at = ?
        WHERE id = ?
      `,
      progressMessageId,
      now,
      jobId,
    );
  }

  async requeueStaleRunningJobs(staleBeforeIso: string): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.db.run(
      `
        UPDATE jobs
        SET status = 'queued',
            locked_at = NULL,
            worker_id = NULL,
            updated_at = ?
        WHERE status = 'running'
          AND locked_at IS NOT NULL
          AND locked_at < ?
          AND attempts < max_attempts
      `,
      now,
      staleBeforeIso,
    );
    return result.changes || 0;
  }

  async getStatusCounts(): Promise<{ queued: number; running: number }> {
    const rows = await this.db.all(
      `
        SELECT status, COUNT(*) as count
        FROM jobs
        WHERE status IN ('queued', 'running')
        GROUP BY status
      `,
    );

    const counts = {
      queued: 0,
      running: 0,
    };

    for (const row of rows) {
      const status = String(row.status) as 'queued' | 'running';
      counts[status] = Number(row.count);
    }

    return counts;
  }

  private mapJobRecord(row: Record<string, unknown>): JobRecord {
    return {
      id: String(row.id),
      userId: Number(row.user_id),
      chatId: Number(row.chat_id),
      messageId: Number(row.message_id),
      type: row.type as JobType,
      status: row.status as JobStatus,
      priority: Number(row.priority),
      concurrencyKey: row.concurrency_key ? String(row.concurrency_key) : null,
      dedupeKey: String(row.dedupe_key),
      payloadJson: String(row.payload_json),
      resultJson: row.result_json ? String(row.result_json) : null,
      errorJson: row.error_json ? String(row.error_json) : null,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      lockedAt: row.locked_at ? String(row.locked_at) : null,
      workerId: row.worker_id ? String(row.worker_id) : null,
      startedAt: row.started_at ? String(row.started_at) : null,
      completedAt: row.completed_at ? String(row.completed_at) : null,
      supersededByJobId: row.superseded_by_job_id ? String(row.superseded_by_job_id) : null,
      ackMessageId: row.ack_message_id ? Number(row.ack_message_id) : null,
      progressMessageId: row.progress_message_id ? Number(row.progress_message_id) : null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    };
  }
}
