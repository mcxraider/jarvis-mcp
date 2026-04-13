type MockLogger = {
  info: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  debug: jest.Mock;
  child: jest.Mock;
};

const mockedLogger: MockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  child: jest.fn(),
};

mockedLogger.child.mockImplementation(() => mockedLogger);

jest.mock('../src/utils/logger', () => ({
  logger: mockedLogger,
  getLogger: jest.fn(() => mockedLogger),
  createComponentLogger: jest.fn(() => mockedLogger),
  serializeError: jest.fn((error: unknown) => ({
    errorMessage: error instanceof Error ? error.message : String(error),
  })),
  sanitizeForLogging: jest.fn((value: unknown) => value),
}));
