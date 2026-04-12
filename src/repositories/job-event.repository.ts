import { Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import { JobEventRecord } from '../types/job.types';

export class JobEventRepository {
  constructor(private readonly db: Database<sqlite3.Database, sqlite3.Statement>) {}

  async create(
    jobId: string,
    eventType: string,
    message?: string,
    payload?: Record<string, unknown>,
  ): Promise<JobEventRecord> {
    const createdAt = new Date().toISOString();
    const result = await this.db.run(
      `
        INSERT INTO job_events (job_id, event_type, message, payload_json, created_at)
        VALUES (?, ?, ?, ?, ?)
      `,
      jobId,
      eventType,
      message || null,
      payload ? JSON.stringify(payload) : null,
      createdAt,
    );

    return {
      id: result.lastID!,
      jobId,
      eventType,
      message: message || null,
      payloadJson: payload ? JSON.stringify(payload) : null,
      createdAt,
    };
  }
}
