import path from 'path';
import { mkdir } from 'fs/promises';
import sqlite3 from 'sqlite3';
import { Database, open } from 'sqlite';

export class SQLiteService {
  private db?: Database<sqlite3.Database, sqlite3.Statement>;

  constructor(
    private readonly databasePath =
      process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'jarvis.sqlite'),
  ) {}

  async initialize(): Promise<void> {
    const databaseDirectory = path.dirname(this.databasePath);
    await mkdir(databaseDirectory, { recursive: true });

    this.db = await open({
      filename: this.databasePath,
      driver: sqlite3.Database,
    });

    await this.db.exec('PRAGMA journal_mode = WAL;');
    await this.db.exec('PRAGMA foreign_keys = ON;');
    await this.runMigrations();
  }

  getDatabase(): Database<sqlite3.Database, sqlite3.Statement> {
    if (!this.db) {
      throw new Error('SQLiteService has not been initialized');
    }

    return this.db;
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = undefined;
    }
  }

  private async runMigrations(): Promise<void> {
    const db = this.getDatabase();

    await db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_update_id INTEGER NOT NULL UNIQUE,
        telegram_message_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        message_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        chat_id INTEGER NOT NULL,
        message_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        concurrency_key TEXT,
        dedupe_key TEXT NOT NULL UNIQUE,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        error_json TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 2,
        locked_at TEXT,
        worker_id TEXT,
        started_at TEXT,
        completed_at TEXT,
        superseded_by_job_id TEXT,
        ack_message_id INTEGER,
        progress_message_id INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES messages(id)
      );

      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        message TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created_at
      ON jobs(status, priority, created_at);

      CREATE INDEX IF NOT EXISTS idx_jobs_concurrency_key_status
      ON jobs(concurrency_key, status);

      CREATE INDEX IF NOT EXISTS idx_job_events_job_id_created_at
      ON job_events(job_id, created_at);
    `);
  }
}
