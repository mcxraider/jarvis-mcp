import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ConversationStoreService,
  DatabaseService,
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

    return {
      tempDir,
      database,
      migrationRunner,
      messageRepository,
      jobRepository,
      clarificationRepository,
      preferencesRepository,
      usageRepository,
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

    expect(migrationRows).toEqual([{ version: 1 }]);
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

  it('persists inbound messages, completed jobs, and outbound replies for text handling', async () => {
    const persistence = await createPersistence();
    const handlers = new MessageHandlers(
      {} as any,
      {
        processTextMessageDetailed: jest.fn().mockResolvedValue({
          responseText: 'stored response',
          processingTimeMs: 1200,
        }),
      } as any,
      { recordActivity: jest.fn() } as any,
      persistence.conversationStore,
      persistence.jobStateService,
      persistence.usageTrackingService,
    );

    await handlers.handleText({
      from: { id: 123, username: 'tester' },
      chat: { id: 456 },
      update: { update_id: 789 },
      message: { message_id: 321, text: 'hello persistence' },
      reply: jest.fn().mockResolvedValue({ message_id: 654 }),
    } as any);

    const messages = await persistence.messageRepository.listRecentMessagesByUser('123', 10);
    const jobs = await persistence.jobRepository.listActiveJobsByUser('123');
    const completedJob = await persistence.database.get<{ status: string; result_json: string }>(
      'SELECT status, result_json FROM jobs LIMIT 1',
    );
    const usageEvents = await persistence.usageRepository.listEventsForUser('123', 10);

    expect(messages).toHaveLength(2);
    expect(messages[0].direction).toBe('outgoing');
    expect(messages[1].direction).toBe('incoming');
    expect(messages[1].status).toBe('processed');
    expect(jobs).toEqual([]);
    expect(completedJob?.status).toBe('completed');
    expect(completedJob?.result_json).toContain('stored response');
    expect(usageEvents.some((event) => event.eventType === 'message_processed')).toBe(true);

    await persistence.database.close();
    fs.rmSync(persistence.tempDir, { recursive: true, force: true });
  });

  it('marks message and job as failed when text processing throws', async () => {
    const persistence = await createPersistence();
    const handlers = new MessageHandlers(
      {} as any,
      {
        processTextMessageDetailed: jest.fn().mockRejectedValue(new Error('processor blew up')),
      } as any,
      { recordActivity: jest.fn() } as any,
      persistence.conversationStore,
      persistence.jobStateService,
      persistence.usageTrackingService,
    );

    await handlers.handleText({
      from: { id: 123, username: 'tester' },
      chat: { id: 456 },
      update: { update_id: 790 },
      message: { message_id: 322, text: 'this will fail' },
      reply: jest.fn().mockResolvedValue({ message_id: 655 }),
    } as any);

    const failedMessage = await persistence.database.get<{ status: string; error_message: string | null }>(
      "SELECT status, error_message FROM messages WHERE direction = 'incoming' LIMIT 1",
    );
    const failedJob = await persistence.database.get<{ status: string; error_message: string | null }>(
      'SELECT status, error_message FROM jobs LIMIT 1',
    );
    const usageEvents = await persistence.usageRepository.listEventsForUser('123', 10);

    expect(failedMessage).toEqual({
      status: 'failed',
      error_message: 'processor blew up',
    });
    expect(failedJob).toEqual({
      status: 'failed',
      error_message: 'processor blew up',
    });
    expect(usageEvents.some((event) => event.eventType === 'error')).toBe(true);

    await persistence.database.close();
    fs.rmSync(persistence.tempDir, { recursive: true, force: true });
  });
});
