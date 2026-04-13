import { DatabaseService } from '../database.service';
import { UserPreferenceRecord } from '../types';
import { generateId, nowIso, parseJsonObject } from '../utils';

interface UserPreferenceRow {
  id: string;
  user_id: string;
  preference_key: string;
  preference_value_json: string;
  created_at: string;
  updated_at: string;
}

export class UserPreferencesRepository {
  constructor(private readonly database: DatabaseService) {}

  async getPreference(userId: string, key: string): Promise<UserPreferenceRecord | null> {
    const row = await this.database.get<UserPreferenceRow>(
      `SELECT * FROM user_preferences WHERE user_id = ? AND preference_key = ?`,
      [userId, key],
    );

    return row ? this.mapRow(row) : null;
  }

  async setPreference(
    userId: string,
    key: string,
    value: Record<string, unknown>,
  ): Promise<UserPreferenceRecord> {
    const existing = await this.getPreference(userId, key);
    const now = nowIso();
    const id = existing?.id || generateId('pref');

    await this.database.run(
      `INSERT INTO user_preferences (
        id, user_id, preference_key, preference_value_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, preference_key) DO UPDATE SET
        preference_value_json = excluded.preference_value_json,
        updated_at = excluded.updated_at`,
      [id, userId, key, JSON.stringify(value), existing?.createdAt || now, now],
    );

    return {
      id,
      userId,
      preferenceKey: key,
      preferenceValue: value,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
  }

  async listPreferences(userId: string): Promise<UserPreferenceRecord[]> {
    const rows = await this.database.all<UserPreferenceRow>(
      `SELECT * FROM user_preferences WHERE user_id = ? ORDER BY preference_key ASC`,
      [userId],
    );

    return rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: UserPreferenceRow): UserPreferenceRecord {
    return {
      id: row.id,
      userId: row.user_id,
      preferenceKey: row.preference_key,
      preferenceValue: parseJsonObject(row.preference_value_json) || {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
