import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ConversationStoreService,
  DatabaseService,
  JobEventRepository,
  JobRepository,
  JobStateService,
  MessageRepository,
  MigrationRunner,
  PendingClarificationRepository,
  UsageEventRepository,
  UsageTrackingService,
  UserPreferencesRepository,
} from '../../../../src/services/persistence';
import { MessageHandlers } from '../../../../src/services/telegram/handlers/message-handlers';
import { JobService } from '../../../../src/services/jobs/job.service';
import { TelegramUpdateIntakeService } from '../../../../src/services/telegram/telegram-update-intake.service';

describe('Persistence layer', () => {
  async function createPersistence() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-db-'));
    const databasePath = path.join(tempDir, 'jarvis.db');
    const database = new DatabaseService({
      path: databasePath,
      verboseLogging: false,
    });

    await database.init();
    const migrationRunner = new MigrationRunner(database);
    await migrationRunner.runMigrations();

    const messageRepository = new MessageRepository(database);
    const jobRepository = new JobRepository(database);
    const clarificationRepository = new PendingClarificationRepository(database);
    const preferencesRepository = new UserPreferencesRepository(database);
    const usageRepository = new UsageEventRepository(database);
    const jobEventRepository = new JobEventRepository(database);

    return {
      tempDir,
      database,
      migrationRunner,
      messageRepository,
      jobRepository,
      clarificationRepository,
      preferencesRepository,
      usageRepository,
      jobEventRepository,
      conversationStore: new ConversationStoreService(messageRepository),
      jobStateService: new JobStateService(jobRepository),
      usageTrackingService: new UsageTrackingService(usageRepository),
    };
  }

  afterEach(async () => {
    // cleanup handled per-test to preserve explicit close ordering
  });

  it('applies migrations idempotently', async () => {
    const persistence = await createPersistence();

    await persistence.migrationRunner.runMigrations();

    const migrationRows = await persistence.database.all<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version ASC',
    );
    const tables = await persistence.database.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('messages', 'jobs', 'pending_clarifications', 'user_preferences', 'usage_events')",
    );

    expect(migrationRows).toEqual([{ version: 1 }, { version: 2 }]);
    expect(tables.map((table) => table.name).sort()).toEqual([
      'jobs',
      'messages',
      'pending_clarifications',
      'usage_events',
      'user_preferences',
    ]);

    await persistence.database.close();
    fs.rmSync(persistence.tempDir, { recursive: true, force: true });
  });

  it('supports preference upserts, clarification state, and usage summaries', async () => {
    const persistence = await createPersistence();

    const firstPreference = await persistence.preferencesRepository.setPreference('123', 'tone', {
      value: 'concise',
    });
    const secondPreference = await persistence.preferencesRepository.setPreference('123', 'tone', {
      value: 'detailed',
    });
    const clarification = await persistence.clarificationRepository.createPendingClarification({
      userId: '123',
      chatId: '456',
      questionText: 'Delete the task?',
      proposedAction: { action: 'delete_task' },
    });
    await persistence.clarificationRepository.resolveClarification(clarification.id, 'answered');
    await persistence.usageRepository.recordEvent({
      userId: '123',
      chatId: '456',
      eventType: 'gpt_response',
      inputTokens: 10,
      outputTokens: 5,
      estimatedCostUsd: 0.01,
    });
    await persistence.usageRepository.recordEvent({
      userId: '123',
      chatId: '456',
      eventType: 'tool_completed',
      inputTokens: 2,
      outputTokens: 1,
      estimatedCostUsd: 0.005,
    });

    const storedPreference = await persistence.preferencesRepository.getPreference('123', 'tone');
    const activeClarification = await persistence.clarificationRepository.findActiveByUser('123');
    const usageSummary = await persistence.usageRepository.summarizeUsageForUser(
      '123',
      '1970-01-01T00:00:00.000Z',
    );

    expect(firstPreference.preferenceValue).toEqual({ value: 'concise' });
    expect(secondPreference.preferenceValue).toEqual({ value: 'detailed' });
    expect(storedPreference?.preferenceValue).toEqual({ value: 'detailed' });
    expect(activeClarification).toBeNull();
    expect(usageSummary).toEqual({
      eventCount: 2,
      totalInputTokens: 12,
      totalOutputTokens: 6,
      totalEstimatedCostUsd: 0.015,
    });

    await persistence.database.close();
    fs.rmSync(persistence.tempDir, { recursive: true, force: true });
  });

  it('queues inbound text messages and persists the pending job state', async () => {
    const persistence = await createPersistence();
    const jobService = new JobService(persistence.conversationStore, persistence.jobStateService);
    const intakeService = new TelegramUpdateIntakeService(jobService);
    const handlers = new MessageHandlers(
      {} as any,
      intakeService,
      { recordActivity: jest.fn() } as any,
      {
        sendAcknowledgement: jest.fn().mockResolvedValue({ message_id: 654 }),
        sendFailureResponse: jest.fn(),
      } as any,
      jobService,
    );

    await handlers.handleText({
      from: { id: 123, username: 'tester' },
      chat: { id: 456 },
      update: { update_id: 789 },
      message: { message_id: 321, text: 'hello persistence' },
    } as any);

    const messages = await persistence.messageRepository.listRecentMessagesByUser('123', 10);
    const jobs = await persistence.jobRepository.listQueuedJobs();
    const storedJob = await persistence.database.get<{ status: string; dedupe_key: string | null; ack_message_id: string | null }>(
      'SELECT status, dedupe_key, ack_message_id FROM jobs LIMIT 1',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].direction).toBe('incoming');
    expect(messages[0].status).toBe('processing');
    expect(jobs).toHaveLength(1);
    expect(storedJob).toEqual({
      status: 'queued',
      dedupe_key: '123:789:text',
      ack_message_id: '654',
    });

    await persistence.database.close();
    fs.rmSync(persistence.tempDir, { recursive: true, force: true });
  });

  it('records job progress events in the async schema', async () => {
    const persistence = await createPersistence();
    const job = await persistence.jobRepository.createJob({
      userId: '123',
      chatId: '456',
      jobType: 'text_processing',
      payload: { text: 'hello' },
      dedupeKey: '123:1:text',
    });

    await persistence.jobEventRepository.create(job.id, 'job.started', 'Working on it.');

    const events = await persistence.jobEventRepository.listForJob(job.id);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        jobId: job.id,
        eventType: 'job.started',
        message: 'Working on it.',
      }),
    );

    await persistence.database.close();
    fs.rmSync(persistence.tempDir, { recursive: true, force: true });
  });
});
