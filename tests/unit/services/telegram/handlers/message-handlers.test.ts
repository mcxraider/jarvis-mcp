import { MessageHandlers } from '../../../../../src/services/telegram/handlers/message-handlers';

describe('MessageHandlers', () => {
  function createContext(message: Record<string, unknown>) {
    return {
      from: { id: 123, username: 'tester' },
      chat: { id: 456 },
      update: { update_id: 789 },
      message,
      reply: jest.fn().mockResolvedValue(undefined),
    } as any;
  }

  it('queues audio documents and acknowledges immediately', async () => {
    const fileService = {
      isAudioFile: jest.fn().mockReturnValue(true),
    } as any;
    const intakeService = {
      enqueueAudioDocument: jest.fn().mockResolvedValue({
        job: { id: 'job-1' },
        acknowledgement: 'Audio file received. I’m processing it now.',
      }),
    } as any;
    const activityService = {
      recordActivity: jest.fn(),
    } as any;
    const responseService = {
      sendAcknowledgement: jest.fn().mockResolvedValue({ message_id: 999 }),
      sendFailureResponse: jest.fn(),
    } as any;
    const jobService = {
      attachAcknowledgement: jest.fn().mockResolvedValue(undefined),
    } as any;

    const handlers = new MessageHandlers(
      fileService,
      intakeService,
      activityService,
      responseService,
      jobService,
    );
    const ctx = createContext({
      message_id: 456,
      document: {
        file_id: 'file-1',
        file_name: 'meeting.mp3',
        mime_type: 'audio/mpeg',
        file_size: 1234,
      },
    });

    await handlers.handleDocument(ctx);

    expect(fileService.isAudioFile).toHaveBeenCalledWith('audio/mpeg');
    expect(intakeService.enqueueAudioDocument).toHaveBeenCalledWith(ctx);
    expect(responseService.sendAcknowledgement).toHaveBeenCalledWith(
      456,
      'Audio file received. I’m processing it now.',
      456,
    );
    expect(jobService.attachAcknowledgement).toHaveBeenCalledWith('job-1', 999);
    expect(activityService.recordActivity).toHaveBeenCalledWith('message_document');
  });

  it('rejects non-audio documents with a helpful reply', async () => {
    const fileService = {
      isAudioFile: jest.fn().mockReturnValue(false),
    } as any;
    const intakeService = {} as any;
    const activityService = {
      recordActivity: jest.fn(),
    } as any;
    const responseService = {
      sendFailureResponse: jest.fn().mockResolvedValue(undefined),
    } as any;
    const jobService = {} as any;

    const handlers = new MessageHandlers(
      fileService,
      intakeService,
      activityService,
      responseService,
      jobService,
    );
    const ctx = createContext({
      message_id: 457,
      document: {
        file_id: 'file-1',
        file_name: 'notes.pdf',
        mime_type: 'application/pdf',
      },
    });

    await handlers.handleDocument(ctx);

    expect(activityService.recordActivity).not.toHaveBeenCalled();
    expect(responseService.sendFailureResponse).toHaveBeenCalledWith(
      456,
      '📄 I received a document, but I only process audio files. Please send an audio file.',
    );
  });

  it('returns a queueing failure for audio documents when enqueue fails', async () => {
    const fileService = {
      isAudioFile: jest.fn().mockReturnValue(true),
    } as any;
    const intakeService = {
      enqueueAudioDocument: jest.fn().mockRejectedValue(new Error('queue failed')),
    } as any;
    const activityService = {
      recordActivity: jest.fn(),
    } as any;
    const responseService = {
      sendAcknowledgement: jest.fn(),
      sendFailureResponse: jest.fn().mockResolvedValue(undefined),
    } as any;
    const jobService = {} as any;

    const handlers = new MessageHandlers(
      fileService,
      intakeService,
      activityService,
      responseService,
      jobService,
    );
    const ctx = createContext({
      message_id: 458,
      document: {
        file_id: 'file-1',
        file_name: 'meeting.mp3',
        mime_type: 'audio/mpeg',
      },
    });

    await handlers.handleDocument(ctx);

    expect(responseService.sendFailureResponse).toHaveBeenCalledWith(
      456,
      '❌ Sorry, I had trouble queuing your audio document.',
    );
    expect(activityService.recordActivity).toHaveBeenCalledWith('message_document');
  });
});
