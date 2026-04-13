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
import { logger } from '../../utils/logger';
import { ToolDispatcher } from '../../types/tool.types';

// Import modularized components
import { GPT_CONSTANTS } from './constants/gpt.constants';
import { GPTConfig, InternalGPTConfig, MessageProcessingResult } from '../../types/gpt.types';
import { GPTValidator } from './validators/gpt.validator';
import { GPTErrorHandler } from './errors/gpt-error-handler.service';
import { FunctionCallingProcessor } from './processors/function-calling.processor';
import { SimpleTextProcessor } from './processors/simple-text.processor';
import { UsageTrackingService } from '../persistence';
import { ProcessingContext } from '../../types/processing.types';

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
  private readonly usageTrackingService?: UsageTrackingService;

  /**
   * Creates a new GPTService instance
   *
   * @param toolDispatcher - Optional tool dispatcher for function calling
   * @param config - Configuration options for the service
   * @throws {Error} If OpenAI API key is not provided
   */
  constructor(
    toolDispatcher?: ToolDispatcher,
    config?: Partial<GPTConfig>,
    usageTrackingService?: UsageTrackingService,
  ) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;

    // Validate configuration
    GPTValidator.validateConfig(apiKey!);

    this.openai = new OpenAI({ apiKey });
    this.toolDispatcher = toolDispatcher;
    this.usageTrackingService = usageTrackingService;
    this.enableFunctionCalling = config?.enableFunctionCalling !== false && !!toolDispatcher;

    // Set default configuration with provided overrides
    this.config = {
      apiKey: apiKey!,
      model: config?.model || GPT_CONSTANTS.DEFAULT_MODEL,
      maxInputLength: config?.maxInputLength || GPT_CONSTANTS.MAX_INPUT_LENGTH,
      temperature: config?.temperature || GPT_CONSTANTS.TEMPERATURE,
    };

    // Initialize processors
    this.functionCallingProcessor = new FunctionCallingProcessor(
      toolDispatcher,
      usageTrackingService,
    );
    this.simpleTextProcessor = new SimpleTextProcessor();

    logger.info('GPTService initialized', {
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
  async processMessage(message: string, userId?: string, context?: ProcessingContext): Promise<string> {
    const result = await this.processMessageDetailed(message, userId, context);
    return result.response;
  }

  async processMessageDetailed(
    message: string,
    userId?: string,
    context?: ProcessingContext,
  ): Promise<MessageProcessingResult> {
    const startTime = Date.now();

    logger.info('Processing message with GPT', {
      userId,
      messageLength: message.length,
      functionCallingEnabled: this.enableFunctionCalling,
    });

    const MAX_RETRIES = 3;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Validate input message
        GPTValidator.validateInputMessage(message, this.config.maxInputLength);

        // Process with function calling if enabled
        await this.usageTrackingService?.recordEvent({
          userId,
          chatId: context?.chatId,
          jobId: context?.jobId,
          messageId: context?.sourceMessageId,
          eventType: 'gpt_request',
          model: this.config.model,
          metadata: {
            functionCallingEnabled: this.enableFunctionCalling,
            messageLength: message.length,
          },
        });

        let result: MessageProcessingResult;

        if (this.enableFunctionCalling) {
          result = await this.functionCallingProcessor.processWithFunctionCalling(
            this.openai,
            this.config.model,
            this.config.temperature,
            message,
            userId || 'anonymous',
          );
        } else {
          result = await this.simpleTextProcessor.processSimpleMessage(
            this.openai,
            this.config.model,
            this.config.temperature,
            message,
            userId,
          );
        }

        await this.usageTrackingService?.recordEvent({
          userId,
          chatId: context?.chatId,
          jobId: context?.jobId,
          messageId: context?.sourceMessageId,
          eventType: 'gpt_response',
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostUsd: result.estimatedCostUsd,
          durationMs: result.processingTimeMs,
          metadata: {
            functionCallsCount: result.functionCallsCount,
            usedFunctionCalling: result.usedFunctionCalling,
          },
        });

        return result;
      } catch (error) {
        lastError = error as Error;

        if (attempt < MAX_RETRIES && GPTErrorHandler.isRetryableError(lastError)) {
          const delay = GPTErrorHandler.getRetryDelay(attempt);
          logger.warn('Retryable error encountered, retrying', {
            userId,
            attempt,
            delayMs: delay,
            error: lastError.message,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        break;
      }
    }

    const processingTimeMs = Date.now() - startTime;

    logger.error('Message processing failed', {
      userId,
      messageLength: message.length,
      error: lastError!.message,
      processingTimeMs,
    });

    await this.usageTrackingService?.recordEvent({
      userId,
      chatId: context?.chatId,
      jobId: context?.jobId,
      messageId: context?.sourceMessageId,
      eventType: 'error',
      model: this.config.model,
      durationMs: processingTimeMs,
      metadata: {
        source: 'gpt',
        error: lastError!.message,
      },
    });

    return {
      response: GPTErrorHandler.handleProcessingError(lastError!),
      originalMessage: message,
      processingTimeMs,
      usedFunctionCalling: this.enableFunctionCalling,
      functionCallsCount: 0,
      model: this.config.model,
    };
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
