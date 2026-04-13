import { DatabaseService } from '../database.service';
import { JobEventRecord } from '../types';
import { generateId, nowIso, parseJsonObject, stringifyJson } from '../utils';

interface JobEventRow {
  id: string;
  job_id: string;
  event_type: string;
  message: string | null;
  payload_json: string | null;
  created_at: string;
}

export class JobEventRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(
    jobId: string,
    eventType: string,
    message?: string,
    payload?: Record<string, unknown>,
  ): Promise<JobEventRecord> {
    const id = generateId('jobevt');
    const createdAt = nowIso();

    await this.database.run(
      `INSERT INTO job_events (id, job_id, event_type, message, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, jobId, eventType, message ?? null, stringifyJson(payload), createdAt],
    );

    return {
      id,
      jobId,
      eventType,
      message: message ?? null,
      payload: payload ?? null,
      createdAt,
    };
  }

  async listForJob(jobId: string): Promise<JobEventRecord[]> {
    const rows = await this.database.all<JobEventRow>(
      `SELECT * FROM job_events WHERE job_id = ? ORDER BY created_at ASC`,
      [jobId],
    );

    return rows.map((row) => ({
      id: row.id,
      jobId: row.job_id,
      eventType: row.event_type,
      message: row.message,
      payload: parseJsonObject(row.payload_json),
      createdAt: row.created_at,
    }));
  }
}
