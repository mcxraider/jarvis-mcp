// Interface for OpenAI function calls
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string containing function parameters
  };
}

// Interface for tool execution results
export interface ToolResult {
  tool_call_id: string; // Maps back to the original tool call
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any; // The actual result from the function
  error?: string; // Error message if execution failed
}

export type ToolExecutionMode = 'parallel_read' | 'ordered_write';

export interface ToolExecutionPolicy {
  mutatesState: boolean;
  resourceType: string;
  executionMode: ToolExecutionMode;
}

export interface ToolExecutionContext {
  jobId?: string;
  userId: string;
  onStage?: (eventType: string, message?: string) => Promise<void> | void;
}

// Common interface for tool dispatchers
export interface ToolDispatcher {
  executeToolCalls(
    toolCalls: ToolCall[],
    context: ToolExecutionContext,
  ): Promise<ToolResult[]>;
  isFunctionSupported(functionName: string): boolean;
  getExecutionPolicy(functionName: string): ToolExecutionPolicy | undefined;
}
