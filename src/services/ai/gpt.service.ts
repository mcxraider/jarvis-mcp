import OpenAI from 'openai';
import { ToolDispatcher } from '../../types/tool.types';
import {
  estimateOpenAICostUsd,
  extendTelemetryContext,
  recordOpenAIRequest,
} from '../../observability';
import { getLogger, serializeError } from '../../utils/logger';
import { GPT_CONSTANTS } from './constants/gpt.constants';
import { GPTConfig, InternalGPTConfig, MessageProcessingResult } from '../../types/gpt.types';
import { GPTValidator } from './validators/gpt.validator';
import { GPTErrorHandler } from './errors/gpt-error-handler.service';
import { FunctionCallingProcessor } from './processors/function-calling.processor';
import { SimpleTextProcessor } from './processors/simple-text.processor';
import { UsageTrackingService } from '../persistence';
import { ProcessingContext } from '../../types/processing.types';

export interface GPTProcessingContext extends ProcessingContext {}

export class GPTService {
  private readonly openai: OpenAI;
  private readonly config: InternalGPTConfig;
  private readonly enableFunctionCalling: boolean;
  private readonly functionCallingProcessor: FunctionCallingProcessor;
  private readonly simpleTextProcessor: SimpleTextProcessor;
  private readonly usageTrackingService?: UsageTrackingService;

  constructor(
    toolDispatcher?: ToolDispatcher,
    config?: Partial<GPTConfig>,
    usageTrackingService?: UsageTrackingService,
  ) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;
    GPTValidator.validateConfig(apiKey!);

    this.openai = new OpenAI({ apiKey });
    this.usageTrackingService = usageTrackingService;
    this.enableFunctionCalling = config?.enableFunctionCalling !== false && !!toolDispatcher;
    this.config = {
      apiKey: apiKey!,
      model: config?.model || GPT_CONSTANTS.DEFAULT_MODEL,
      maxInputLength: config?.maxInputLength || GPT_CONSTANTS.MAX_INPUT_LENGTH,
      temperature: config?.temperature || GPT_CONSTANTS.TEMPERATURE,
    };

    this.functionCallingProcessor = new FunctionCallingProcessor(
      toolDispatcher,
      usageTrackingService,
    );
    this.simpleTextProcessor = new SimpleTextProcessor();

    getLogger({ requestId: 'startup', component: 'gpt_service' }).info('openai.service.initialized', {
      model: this.config.model,
      maxInputLength: this.config.maxInputLength,
      temperature: this.config.temperature,
      functionCallingEnabled: this.enableFunctionCalling,
      hasToolDispatcher: !!toolDispatcher,
    });
  }

  async processMessage(message: string, userId?: string, context?: GPTProcessingContext): Promise<string> {
    const result = await this.processMessageDetailed(message, userId, context);
    return result.response;
  }

  async processMessageDetailed(
    message: string,
    userId?: string,
    context?: GPTProcessingContext,
  ): Promise<MessageProcessingResult> {
    const startTime = Date.now();
    const scopedContext = extendTelemetryContext(context, {
      requestId: context?.requestId || context?.jobId,
      component: 'gpt_service',
      userId,
      chatId: context?.chatId,
      jobId: context?.jobId,
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
        GPTValidator.validateInputMessage(message, this.config.maxInputLength);

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
        let operation: 'function_calling' | 'simple_text';

        if (this.enableFunctionCalling) {
          operation = 'function_calling';
          result = await this.functionCallingProcessor.processWithFunctionCalling(
            this.openai,
            this.config.model,
            this.config.temperature,
            message,
            userId || 'anonymous',
            context,
          );
        } else {
          operation = 'simple_text';
          result = await this.simpleTextProcessor.processSimpleMessage(
            this.openai,
            this.config.model,
            this.config.temperature,
            message,
            userId,
            context,
          );
        }

        result.usage = result.usage || {
          promptTokens: result.inputTokens,
          completionTokens: result.outputTokens,
          totalTokens: result.totalTokens,
        };
        result.inputTokens = result.inputTokens ?? result.usage?.promptTokens;
        result.outputTokens = result.outputTokens ?? result.usage?.completionTokens;
        result.totalTokens = result.totalTokens ?? result.usage?.totalTokens;
        result.estimatedCostUsd =
          result.estimatedCostUsd ??
          estimateOpenAICostUsd({
            model: result.model,
            promptTokens: result.inputTokens,
            completionTokens: result.outputTokens,
          });

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

        recordOpenAIRequest(
          { model: result.model, operation, status: 'success' },
          result.processingTimeMs,
          result.usage,
        );
        logger.info('openai.chat.succeeded', {
          model: result.model,
          durationMs: result.processingTimeMs,
          operation,
          promptTokens: result.inputTokens,
          completionTokens: result.outputTokens,
          totalTokens: result.totalTokens,
          estimatedCostUsd: result.estimatedCostUsd,
        });

        return result;
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

  getConfig(): Omit<GPTConfig, 'apiKey'> {
    return {
      model: this.config.model,
      maxInputLength: this.config.maxInputLength,
      temperature: this.config.temperature,
      enableFunctionCalling: this.enableFunctionCalling,
    };
  }
}
