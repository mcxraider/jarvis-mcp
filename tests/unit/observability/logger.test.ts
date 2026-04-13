describe('logger utilities', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('redacts secrets and telegram file urls from log payloads', () => {
    process.env.OPENAI_API_KEY = 'openai-secret';
    process.env.BOT_TOKEN = 'bot-secret';

    const { sanitizeForLogging, serializeError } = jest.requireActual('../../../src/utils/logger');

    expect(
      sanitizeForLogging({
        apiKey: 'openai-secret',
        fileUrl: 'https://api.telegram.org/file/botbot-secret/private/file.ogg',
      }),
    ).toEqual({
      apiKey: '[REDACTED]',
      fileUrl: '[REDACTED]',
    });

    expect(serializeError(new Error('boom openai-secret'))).toEqual(
      expect.objectContaining({
        errorMessage: 'boom [REDACTED]',
      }),
    );
  });
});
