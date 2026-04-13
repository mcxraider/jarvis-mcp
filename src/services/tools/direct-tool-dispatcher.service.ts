import { extendTelemetryContext, recordToolCall } from '../../observability';
import { getLogger, serializeError } from '../../utils/logger';
import {
  ToolCall,
  ToolExecutionContext,
  ToolExecutionPolicy,
  ToolResult,
  ToolDispatcher,
} from '../../types/tool.types';
import { TodoistAPIService } from '../external/todoist-api.service';

export class DirectToolCallDispatcher implements ToolDispatcher {
  private readonly todoistService: TodoistAPIService;
  private static readonly userWriteLocks = new Map<string, Promise<void>>();
  private readonly executionPolicies: Record<string, ToolExecutionPolicy> = {
    add_todoist_task: { mutatesState: true, resourceType: 'todoist_task', executionMode: 'ordered_write' },
    get_todoist_task: { mutatesState: false, resourceType: 'todoist_task', executionMode: 'parallel_read' },
    get_tasks: { mutatesState: false, resourceType: 'todoist_task', executionMode: 'parallel_read' },
    update_todoist_task: { mutatesState: true, resourceType: 'todoist_task', executionMode: 'ordered_write' },
    complete_task: { mutatesState: true, resourceType: 'todoist_task', executionMode: 'ordered_write' },
    delete_todoist_task: { mutatesState: true, resourceType: 'todoist_task', executionMode: 'ordered_write' },
    get_completed_todoist_tasks: { mutatesState: false, resourceType: 'todoist_task', executionMode: 'parallel_read' },
  };

  constructor() {
    const todoistApiKey = process.env.TODOIST_API_KEY;
    if (!todoistApiKey) {
      throw new Error('TODOIST_API_KEY environment variable is required');
    }

    this.todoistService = new TodoistAPIService(todoistApiKey);

    getLogger({ requestId: 'startup', component: 'tool_dispatcher' }).info('tool.dispatcher.initialized', {
      hasTodoistService: !!this.todoistService,
    });
  }

  async executeToolCalls(toolCalls: ToolCall[], context: ToolExecutionContext): Promise<ToolResult[]> {
    const logger = getLogger(
      extendTelemetryContext(context, {
        requestId: context.requestId || context.jobId,
        component: 'tool_dispatcher',
        userId: context.userId,
        chatId: context.chatId,
        jobId: context.jobId,
      }),
    );
    logger.info('tool.dispatch.started', {
      toolCallsCount: toolCalls.length,
      functionNames: toolCalls.map((tc) => tc.function.name),
    });

    const mustSerialize = toolCalls.some(
      (toolCall) => this.getExecutionPolicy(toolCall.function.name)?.mutatesState,
    );

    if (mustSerialize) {
      await context.onStage?.('tools.executing', 'Running the requested actions.');
      const release = await this.acquireUserWriteLock(context.userId);
      const results: ToolResult[] = [];
      try {
        for (const toolCall of toolCalls) {
          try {
            const value = await this.executeToolCall(toolCall, context);
            results.push({
              tool_call_id: toolCall.id,
              content: value,
            });
          } catch (error) {
            results.push({
              tool_call_id: toolCall.id,
              content: null,
              error: (error as Error).message,
            });
          }
        }
      } finally {
        release();
      }
      return results;
    }

    const promises = toolCalls.map((toolCall) => this.executeToolCall(toolCall, context));
    const results = await Promise.allSettled(promises);

    return results.map((result, index) => ({
      tool_call_id: toolCalls[index].id,
      content: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason?.message || 'Tool execution failed' : undefined,
    }));
  }

  private async executeToolCall(toolCall: ToolCall, context: ToolExecutionContext): Promise<any> {
    const logger = getLogger(
      extendTelemetryContext(context, {
        requestId: context.requestId || context.jobId,
        component: 'tool_dispatcher',
        userId: context.userId,
        chatId: context.chatId,
        jobId: context.jobId,
        stage: 'tool_call',
      }),
    );
    const startTime = Date.now();

    try {
      const functionName = toolCall.function.name;
      const parameters = JSON.parse(toolCall.function.arguments);

      logger.info('tool.call.started', {
        functionName,
        toolCallId: toolCall.id,
        parameters: Object.keys(parameters),
      });

      const result = await this.routeFunctionCall(functionName, parameters);

      logger.info('tool.call.succeeded', {
        functionName,
        toolCallId: toolCall.id,
        hasResult: !!result,
        durationMs: Date.now() - startTime,
      });
      recordToolCall(functionName, 'success', Date.now() - startTime);

      return result;
    } catch (error) {
      logger.error('tool.call.failed', {
        functionName: toolCall.function.name,
        toolCallId: toolCall.id,
        ...serializeError(error),
      });
      recordToolCall(toolCall.function.name, 'error', Date.now() - startTime);
      throw error;
    }
  }

  private async routeFunctionCall(functionName: string, parameters: any): Promise<any> {
    switch (functionName) {
      case 'add_todoist_task':
        return this.todoistService.addTask({
          content: parameters.content,
          description: parameters.description,
          project_id: parameters.project_id,
          section_id: parameters.section_id,
          parent_id: parameters.parent_id,
          order: parameters.order,
          labels: parameters.labels,
          priority: parameters.priority,
          due_string: parameters.due_string,
          due_date: parameters.due_date,
          due_datetime: parameters.due_datetime,
          assignee_id: parameters.assignee_id,
        });
      case 'get_todoist_task':
        return this.todoistService.getTask(parameters.task_id);
      case 'get_tasks':
        return this.todoistService.getTasks({
          project_id: parameters.project_id,
          section_id: parameters.section_id,
          label: parameters.label,
          filter: parameters.filter,
          lang: parameters.lang,
          ids: parameters.ids,
        });
      case 'update_todoist_task':
        return this.todoistService.updateTask(parameters.task_id, {
          content: parameters.content,
          description: parameters.description,
          labels: parameters.labels,
          priority: parameters.priority,
          due_string: parameters.due_string,
          due_date: parameters.due_date,
          due_datetime: parameters.due_datetime,
          assignee_id: parameters.assignee_id,
        });
      case 'complete_task':
        await this.todoistService.completeTask(parameters.task_id);
        return { success: true, message: `Task ${parameters.task_id} marked as completed` };
      case 'delete_todoist_task':
        await this.todoistService.deleteTask(parameters.task_id);
        return { success: true, message: `Task ${parameters.task_id} deleted permanently` };
      case 'get_completed_todoist_tasks':
        return this.todoistService.getCompletedTasks({
          since: parameters.since,
          until: parameters.until,
          project_id: parameters.project_id,
          limit: parameters.limit,
          offset: parameters.offset,
        });
      default:
        throw new Error(`Unknown function: ${functionName}`);
    }
  }

  getSupportedFunctions(): string[] {
    return [
      'add_todoist_task',
      'get_todoist_task',
      'get_tasks',
      'update_todoist_task',
      'complete_task',
      'delete_todoist_task',
      'get_completed_todoist_tasks',
    ];
  }

  isFunctionSupported(functionName: string): boolean {
    return this.getSupportedFunctions().includes(functionName);
  }

  getExecutionPolicy(functionName: string): ToolExecutionPolicy | undefined {
    return this.executionPolicies[functionName];
  }

  private async acquireUserWriteLock(userId: string): Promise<() => void> {
    const current = DirectToolCallDispatcher.userWriteLocks.get(userId);
    if (current) {
      await current;
    }

    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    DirectToolCallDispatcher.userWriteLocks.set(userId, next);

    return () => {
      if (DirectToolCallDispatcher.userWriteLocks.get(userId) === next) {
        DirectToolCallDispatcher.userWriteLocks.delete(userId);
      }
      release();
    };
  }
}
