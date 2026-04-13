// src/services/ai/gpt.service.ts

/**
 * Service for generating text content using OpenAI GPT models with function calling capabilities.
 * Handles intelligent function calling, text processing, and response formatting.
 *
 * @example
 * ```typescript
 * const gptService = new GPTService(toolDispatcher);
 * const response = await gptService.processMessage('Create a task to buy groceries', 'user123');
 * ```
 */

import OpenAI from 'openai';
import { ToolDispatcher } from '../../types/tool.types';
import {
  TelemetryContext,
  estimateOpenAICostUsd,
  extendTelemetryContext,
  recordOpenAIRequest,
} from '../../observability';
import { getLogger, serializeError } from '../../utils/logger';

// Import modularized components
import { GPT_CONSTANTS } from './constants/gpt.constants';
import { GPTConfig, InternalGPTConfig, MessageProcessingResult } from '../../types/gpt.types';
import { GPTValidator } from './validators/gpt.validator';
import { GPTErrorHandler } from './errors/gpt-error-handler.service';
import { FunctionCallingProcessor } from './processors/function-calling.processor';
import { SimpleTextProcessor } from './processors/simple-text.processor';

/**
 * Service for generating text content using OpenAI GPT models with function calling
 */
export class GPTService {
  private readonly openai: OpenAI;
  private readonly config: InternalGPTConfig;
  private readonly enableFunctionCalling: boolean;
  private readonly functionCallingProcessor: FunctionCallingProcessor;
  private readonly simpleTextProcessor: SimpleTextProcessor;
  private readonly toolDispatcher?: ToolDispatcher;

  /**
   * Creates a new GPTService instance
   *
   * @param toolDispatcher - Optional tool dispatcher for function calling
   * @param config - Configuration options for the service
   * @throws {Error} If OpenAI API key is not provided
   */
  constructor(toolDispatcher?: ToolDispatcher, config?: Partial<GPTConfig>) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;

    // Validate configuration
    GPTValidator.validateConfig(apiKey!);

    this.openai = new OpenAI({ apiKey });
    this.toolDispatcher = toolDispatcher;
    this.enableFunctionCalling = config?.enableFunctionCalling !== false && !!toolDispatcher;

    // Set default configuration with provided overrides
    this.config = {
      apiKey: apiKey!,
      model: config?.model || GPT_CONSTANTS.DEFAULT_MODEL,
      maxInputLength: config?.maxInputLength || GPT_CONSTANTS.MAX_INPUT_LENGTH,
      temperature: config?.temperature || GPT_CONSTANTS.TEMPERATURE,
    };

    // Initialize processors
    this.functionCallingProcessor = new FunctionCallingProcessor(toolDispatcher);
    this.simpleTextProcessor = new SimpleTextProcessor();

    getLogger({ requestId: 'startup', component: 'gpt_service' }).info('openai.service.initialized', {
      model: this.config.model,
      maxInputLength: this.config.maxInputLength,
      temperature: this.config.temperature,
      functionCallingEnabled: this.enableFunctionCalling,
      hasToolDispatcher: !!toolDispatcher,
    });
  }

  /**
   * Main method to process user messages with intelligent function calling
   * @param message - The user's natural language message
   * @param userId - User identifier for context/authorization
   * @returns Promise<string> - The final response to send back to user
   */
  async processMessage(
    message: string,
    userId?: string,
    context?: TelemetryContext,
  ): Promise<string> {
    const startTime = Date.now();
    const scopedContext = extendTelemetryContext(context, {
      component: 'gpt_service',
      userId,
      stage: 'openai_chat',
    });
    const logger = getLogger(scopedContext);

    logger.info('openai.chat.requested', {
      messageLength: message.length,
      functionCallingEnabled: this.enableFunctionCalling,
      operation: this.enableFunctionCalling ? 'function_calling' : 'simple_text',
      model: this.config.model,
    });

    const MAX_RETRIES = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Validate input message
        GPTValidator.validateInputMessage(message, this.config.maxInputLength);

        // Process with function calling if enabled
        if (this.enableFunctionCalling) {
          const result = await this.functionCallingProcessor.processWithFunctionCalling(
            this.openai,
            this.config.model,
            this.config.temperature,
            message,
            userId || 'anonymous',
            scopedContext,
          );
          const durationMs = Date.now() - startTime;
          recordOpenAIRequest(
            { model: this.config.model, operation: 'function_calling', status: 'success' },
            durationMs,
            result.usage,
          );
          logger.info('openai.chat.succeeded', {
            model: this.config.model,
            durationMs,
            operation: 'function_calling',
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
            totalTokens: result.usage?.totalTokens,
            estimatedCostUsd: estimateOpenAICostUsd({
              model: this.config.model,
              promptTokens: result.usage?.promptTokens,
              completionTokens: result.usage?.completionTokens,
            }),
          });
          return result.response;
        }

        // Fallback to simple text generation
        const result = await this.simpleTextProcessor.processSimpleMessage(
          this.openai,
          this.config.model,
          this.config.temperature,
          message,
          userId,
          scopedContext,
        );
        const durationMs = Date.now() - startTime;
        recordOpenAIRequest(
          { model: this.config.model, operation: 'simple_text', status: 'success' },
          durationMs,
          result.usage,
        );
        logger.info('openai.chat.succeeded', {
          model: this.config.model,
          durationMs,
          operation: 'simple_text',
          promptTokens: result.usage?.promptTokens,
          completionTokens: result.usage?.completionTokens,
          totalTokens: result.usage?.totalTokens,
          estimatedCostUsd: estimateOpenAICostUsd({
            model: this.config.model,
            promptTokens: result.usage?.promptTokens,
            completionTokens: result.usage?.completionTokens,
          }),
        });
        return result.response;
      } catch (error) {
        lastError = error as Error;

        if (attempt < MAX_RETRIES && GPTErrorHandler.isRetryableError(lastError)) {
          const delay = GPTErrorHandler.getRetryDelay(attempt);
          logger.warn('openai.chat.retry_scheduled', {
            attempt,
            delayMs: delay,
            ...serializeError(lastError),
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        break;
      }
    }

    const processingTimeMs = Date.now() - startTime;

    logger.error('openai.chat.failed', {
      messageLength: message.length,
      processingTimeMs,
      model: this.config.model,
      ...serializeError(lastError),
    });
    recordOpenAIRequest(
      {
        model: this.config.model,
        operation: this.enableFunctionCalling ? 'function_calling' : 'simple_text',
        status: 'error',
      },
      processingTimeMs,
    );

    return GPTErrorHandler.handleProcessingError(lastError!);
  }

  /**
   * Gets current service configuration
   *
   * @returns Service configuration (excluding sensitive data)
   */
  getConfig(): Omit<GPTConfig, 'apiKey'> {
    return {
      model: this.config.model,
      maxInputLength: this.config.maxInputLength,
      temperature: this.config.temperature,
      enableFunctionCalling: this.enableFunctionCalling,
    };
  }
}
