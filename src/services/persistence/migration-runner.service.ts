import { logger } from '../../utils/logger';
import { DatabaseService } from './database.service';
import { nowIso } from './utils';
import { migration001Initial } from './migrations/001_initial';

interface MigrationDefinition {
  version: number;
  name: string;
  sql: string;
}

const MIGRATIONS: MigrationDefinition[] = [
  {
    version: 1,
    name: 'initial_persistence_schema',
    sql: migration001Initial,
  },
];

interface AppliedMigrationRow {
  version: number;
}

export class MigrationRunner {
  constructor(private readonly database: DatabaseService) {}

  async runMigrations(): Promise<void> {
    await this.database.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);',
    );

    const appliedRows = await this.database.all<AppliedMigrationRow>(
      'SELECT version FROM schema_migrations',
    );
    const applied = new Set(appliedRows.map((row) => row.version));

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) {
        continue;
      }

      await this.database.transaction(async () => {
        await this.database.exec(migration.sql);
        await this.database.run(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
          [migration.version, migration.name, nowIso()],
        );
      });

      logger.info('Applied database migration', {
        dbOperation: 'migration',
        version: migration.version,
        name: migration.name,
      });
    }
  }
}
