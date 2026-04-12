import { TelegramUpdateIntakeService } from '../../../../src/services/telegram/telegram-update-intake.service';

describe('TelegramUpdateIntakeService', () => {
  const jobService = {
    enqueue: jest.fn().mockResolvedValue({
      job: { id: 'job-1' },
      acknowledgement: 'Received. Working on it.',
    }),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes text messages into text jobs', async () => {
    const service = new TelegramUpdateIntakeService(jobService);
    const ctx = {
      update: { update_id: 10 },
      chat: { id: 20 },
      from: { id: 30, username: 'tester' },
      message: { message_id: 40, text: 'hello' },
    } as any;

    await service.enqueueText(ctx);

    expect(jobService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 20,
        userId: 30,
        telegramUpdateId: 10,
        telegramMessageId: 40,
        kind: 'text',
        text: 'hello',
      }),
    );
  });

  it('normalizes voice messages into voice jobs', async () => {
    const service = new TelegramUpdateIntakeService(jobService);
    const ctx = {
      update: { update_id: 11 },
      chat: { id: 21 },
      from: { id: 31, username: 'tester' },
      message: {
        message_id: 41,
        voice: { file_id: 'voice-file', duration: 12, file_size: 999 },
      },
    } as any;

    await service.enqueueVoice(ctx);

    expect(jobService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'voice',
        fileId: 'voice-file',
        duration: 12,
      }),
    );
  });

  it('normalizes audio documents into audio_document jobs', async () => {
    const service = new TelegramUpdateIntakeService(jobService);
    const ctx = {
      update: { update_id: 12 },
      chat: { id: 22 },
      from: { id: 32, username: 'tester' },
      message: {
        message_id: 42,
        document: {
          file_id: 'doc-file',
          file_name: 'memo.mp3',
          mime_type: 'audio/mpeg',
          file_size: 111,
        },
      },
    } as any;

    await service.enqueueAudioDocument(ctx);

    expect(jobService.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'audio_document',
        fileId: 'doc-file',
        fileName: 'memo.mp3',
        mimeType: 'audio/mpeg',
      }),
    );
  });
});
