import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { logger } from '../../utils/logger';
import { DatabaseConfig } from './types';

type SQLiteDatabase = sqlite3.Database;

export class DatabaseService {
  private db: SQLiteDatabase | null = null;

  constructor(private readonly config: DatabaseConfig) {}

  async init(): Promise<void> {
    const dbDirectory = path.dirname(this.config.path);
    fs.mkdirSync(dbDirectory, { recursive: true });

    this.db = await new Promise<SQLiteDatabase>((resolve, reject) => {
      const database = new sqlite3.Database(this.config.path, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(database);
      });
    });

    await this.exec('PRAGMA foreign_keys = ON;');
    await this.exec('PRAGMA journal_mode = WAL;');
    await this.exec('PRAGMA busy_timeout = 5000;');

    logger.info('Database initialized', {
      dbOperation: 'init',
      path: this.config.path,
      verboseLogging: this.config.verboseLogging,
    });
  }

  async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    const db = this.db;
    this.db = null;

    await new Promise<void>((resolve, reject) => {
      db.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async run(sql: string, params: unknown[] = []): Promise<{ lastID: number; changes: number }> {
    const db = this.getDb();
    this.logQuery('run', sql, params);

    return new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(error) {
        if (error) {
          reject(error);
          return;
        }

        resolve({
          lastID: this.lastID,
          changes: this.changes,
        });
      });
    });
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const db = this.getDb();
    this.logQuery('get', sql, params);

    return new Promise((resolve, reject) => {
      db.get(sql, params, (error, row) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(row as T | undefined);
      });
    });
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const db = this.getDb();
    this.logQuery('all', sql, params);

    return new Promise((resolve, reject) => {
      db.all(sql, params, (error, rows) => {
        if (error) {
          reject(error);
          return;
        }

        resolve((rows as T[]) || []);
      });
    });
  }

  async exec(sql: string): Promise<void> {
    const db = this.getDb();
    this.logQuery('exec', sql);

    await new Promise<void>((resolve, reject) => {
      db.exec(sql, (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    await this.exec('BEGIN');

    try {
      const result = await fn();
      await this.exec('COMMIT');
      return result;
    } catch (error) {
      await this.exec('ROLLBACK');
      throw error;
    }
  }

  private getDb(): SQLiteDatabase {
    if (!this.db) {
      throw new Error('Database has not been initialized');
    }

    return this.db;
  }

  private logQuery(kind: string, sql: string, params?: unknown[]): void {
    if (!this.config.verboseLogging) {
      return;
    }

    logger.debug('Executing database query', {
      dbOperation: kind,
      sql,
      params,
    });
  }
}
