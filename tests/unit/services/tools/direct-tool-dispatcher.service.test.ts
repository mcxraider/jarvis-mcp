import { DirectToolCallDispatcher } from '../../../../src/services/tools/direct-tool-dispatcher.service';

describe('DirectToolCallDispatcher', () => {
  const originalApiKey = process.env.TODOIST_API_KEY;

  beforeEach(() => {
    process.env.TODOIST_API_KEY = 'todoist-key';
  });

  afterEach(() => {
    if (originalApiKey === undefined) {
      delete process.env.TODOIST_API_KEY;
    } else {
      process.env.TODOIST_API_KEY = originalApiKey;
    }
  });

  it('classifies read-only tools as parallel-safe', () => {
    const dispatcher = new DirectToolCallDispatcher();

    expect(dispatcher.getExecutionPolicy('get_tasks')).toEqual({
      mutatesState: false,
      resourceType: 'todoist_task',
      executionMode: 'parallel_read',
    });
  });

  it('classifies mutating tools as ordered writes', () => {
    const dispatcher = new DirectToolCallDispatcher();

    expect(dispatcher.getExecutionPolicy('delete_todoist_task')).toEqual({
      mutatesState: true,
      resourceType: 'todoist_task',
      executionMode: 'ordered_write',
    });
  });
});
