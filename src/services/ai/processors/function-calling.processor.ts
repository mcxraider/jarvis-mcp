import OpenAI from 'openai';
import { logger } from '../../../utils/logger';
import { MessageProcessingResult } from '../../../types/gpt.types';
import { GPT_CONSTANTS } from '../constants/gpt.constants';
import { getFunctionCallingSystemPrompt, FINAL_RESPONSE_PROMPT } from '../../../types/gpt.prompts';
import { GPTToolsService } from '../../tools/todoist-tools.service';
import { ToolDispatcher, ToolCall } from '../../../types/tool.types';
import { UsageTrackingService } from '../../persistence';
import { GPTProcessingContext } from '../gpt.service';

export class FunctionCallingProcessor {
  private readonly toolsService: GPTToolsService;

  constructor(
    private readonly toolDispatcher?: ToolDispatcher,
    private readonly usageTrackingService?: UsageTrackingService,
  ) {
    this.toolsService = new GPTToolsService(toolDispatcher);
  }

  async processWithFunctionCalling(
    openai: OpenAI,
    model: string,
    temperature: number,
    message: string,
    userId: string,
    context?: GPTProcessingContext,
  ): Promise<MessageProcessingResult> {
    const startTime = Date.now();

    try {
      const response = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: getFunctionCallingSystemPrompt(),
          },
          {
            role: 'user',
            content: message,
          },
        ],
        tools: this.toolsService.getAvailableTools(),
        tool_choice: 'auto',
        max_tokens: GPT_CONSTANTS.MAX_TOKENS,
        temperature,
      });

      const responseMessage = response.choices[0].message;
      const initialInputTokens = response.usage?.prompt_tokens || 0;
      const initialOutputTokens = response.usage?.completion_tokens || 0;

      logger.debug('GPT function calling response', {
        jobId: context?.jobId,
        userId,
        hasToolCalls: !!(responseMessage.tool_calls && responseMessage.tool_calls.length > 0),
        toolCallsCount: responseMessage.tool_calls?.length || 0,
        content: responseMessage.content,
      });

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        const finalResponse = await this.handleToolCalls(
          responseMessage,
          openai,
          model,
          temperature,
          message,
          userId,
          context,
        );

        return {
          response: finalResponse,
          originalMessage: message,
          processingTimeMs: Date.now() - startTime,
          usedFunctionCalling: true,
          functionCallsCount: responseMessage.tool_calls.length,
          model,
          inputTokens: initialInputTokens,
          outputTokens: initialOutputTokens,
          totalTokens: response.usage?.total_tokens,
        };
      }

      return {
        response:
          responseMessage.content || "I apologize, but I couldn't process your request.",
        originalMessage: message,
        processingTimeMs: Date.now() - startTime,
        usedFunctionCalling: false,
        functionCallsCount: 0,
        model,
        inputTokens: initialInputTokens,
        outputTokens: initialOutputTokens,
        totalTokens: response.usage?.total_tokens,
      };
    } catch (error) {
      logger.error('Function calling processing failed', {
        jobId: context?.jobId,
        userId,
        error: (error as Error).message,
      });

      throw error;
    }
  }

  private async handleToolCalls(
    responseMessage: OpenAI.Chat.Completions.ChatCompletionMessage,
    openai: OpenAI,
    model: string,
    temperature: number,
    originalMessage: string,
    userId: string,
    context?: GPTProcessingContext,
  ): Promise<string> {
    if (!this.toolDispatcher || !responseMessage.tool_calls) {
      return "I'd like to help you with that, but I'm currently unable to execute the required actions.";
    }

    try {
      const toolCalls: ToolCall[] = responseMessage.tool_calls.map((toolCall) => ({
        id: toolCall.id,
        type: 'function',
        function: {
          name: toolCall.function.name,
          arguments: toolCall.function.arguments,
        },
      }));

      logger.info('Executing tool calls', {
        jobId: context?.jobId,
        userId,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
        })),
      });

      for (const toolCall of toolCalls) {
        await this.usageTrackingService?.recordEvent({
          userId,
          chatId: context?.chatId,
          jobId: context?.jobId,
          messageId: context?.sourceMessageId,
          eventType: 'tool_called',
          metadata: {
            toolCallId: toolCall.id,
            functionName: toolCall.function.name,
          },
        });
      }

      const supportedCalls = toolCalls.filter((tc) => {
        if (this.toolDispatcher!.isFunctionSupported(tc.function.name)) {
          return true;
        }
        logger.warn('Skipping unsupported function', { name: tc.function.name, userId });
        return false;
      });

      if (supportedCalls.length === 0) {
        return "I'm not able to perform that action right now.";
      }

      await context?.onStage?.('tools.executing');
      const toolResults = await this.toolDispatcher.executeToolCalls(supportedCalls, {
        userId,
        jobId: context?.jobId,
        onStage: context?.onStage,
      });

      logger.info('Tool execution completed', {
        jobId: context?.jobId,
        userId,
        results: toolResults.map((result) => ({
          tool_call_id: result.tool_call_id,
          success: !result.error,
          error: result.error,
        })),
      });

      for (const result of toolResults) {
        await this.usageTrackingService?.recordEvent({
          userId,
          chatId: context?.chatId,
          jobId: context?.jobId,
          messageId: context?.sourceMessageId,
          eventType: 'tool_completed',
          metadata: {
            toolCallId: result.tool_call_id,
            success: !result.error,
            error: result.error ?? null,
          },
        });
      }

      return this.generateFinalResponse(
        openai,
        model,
        temperature,
        originalMessage,
        responseMessage,
        toolResults,
      );
    } catch (error) {
      logger.error('Tool call execution failed', {
        jobId: context?.jobId,
        userId,
        error: (error as Error).message,
      });

      return `I encountered an error while trying to help you: ${(error as Error).message}. Please try again or rephrase your request.`;
    }
  }

  private async generateFinalResponse(
    openai: OpenAI,
    model: string,
    temperature: number,
    originalMessage: string,
    toolCallMessage: OpenAI.Chat.Completions.ChatCompletionMessage,
    toolResults: any[],
  ): Promise<string> {
    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        {
          role: 'system',
          content: FINAL_RESPONSE_PROMPT,
        },
        {
          role: 'user',
          content: originalMessage,
        },
        {
          role: 'assistant',
          content: toolCallMessage.content || null,
          tool_calls: toolCallMessage.tool_calls,
        },
      ];

      toolResults.forEach((result) => {
        messages.push({
          role: 'tool',
          tool_call_id: result.tool_call_id,
          content: JSON.stringify(result.content),
        });
      });

      const finalResponse = await openai.chat.completions.create({
        model,
        messages,
        max_tokens: GPT_CONSTANTS.MAX_TOKENS,
        temperature,
      });

      return (
        finalResponse.choices[0].message.content ||
        'I completed the requested actions successfully.'
      );
    } catch (error) {
      logger.error('Failed to generate final response', {
        error: (error as Error).message,
      });

      const successfulActions = toolResults.filter((result) => !result.error);
      if (successfulActions.length > 0) {
        return `I successfully completed ${successfulActions.length} action(s) for you.`;
      }

      return 'I encountered some issues while processing your request. Please try again.';
    }
  }
}
