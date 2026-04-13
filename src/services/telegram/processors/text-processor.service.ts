import {
  extendTelemetryContext,
  hashContent,
  recordMessageProcessingFailure,
} from '../../../observability';
import { getLogger, serializeError } from '../../../utils/logger';
import { GPTService } from '../../ai';
import { ToolDispatcher } from '../../../types/tool.types';
import { ProcessorResponse, ProcessingContext } from '../../../types/processing.types';
import { UsageTrackingService } from '../../persistence';

export class TextProcessorService {
  private readonly gptService: GPTService;

  constructor(toolDispatcher?: ToolDispatcher, usageTrackingService?: UsageTrackingService) {
    this.gptService = new GPTService(toolDispatcher, undefined, usageTrackingService);
  }

  async processTextMessage(text: string, userId?: number, context?: ProcessingContext): Promise<string> {
    const result = await this.processTextMessageDetailed(text, userId, context);
    return result.responseText;
  }

  async processTextMessageDetailed(
    text: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<ProcessorResponse> {
    const scopedContext = extendTelemetryContext(context, {
      requestId: context?.requestId || context?.jobId,
      component: 'text_processor',
      userId: userId ? String(userId) : context?.userId,
      chatId: context?.chatId,
      jobId: context?.jobId,
      messageType: 'text',
      stage: 'process',
    });
    const logger = getLogger(scopedContext);

    logger.info('message.route.started', {
      messageLength: text.length,
      messageHash: hashContent(text),
    });

    try {
      await context?.onStage?.('gpt.processing');
      const response = await this.gptService.processMessageDetailed(text, userId?.toString(), context);

      logger.info('message.route.completed', {
        messageLength: text.length,
        responseLength: response.response.length,
      });

      return {
        responseText: response.response,
        processingTimeMs: response.processingTimeMs,
      };
    } catch (error) {
      recordMessageProcessingFailure('text', 'text_processor');
      logger.error('message.route.failed', {
        messageLength: text.length,
        ...serializeError(error),
      });

      return {
        responseText: this.handleTextProcessingError(error as Error, text),
      };
    }
  }

  private handleTextProcessingError(error: Error, text: string): string {
    const errorMessage = error.message;

    if (errorMessage.includes('Message cannot be empty')) {
      return `I need some text to process! Please send me a message.`;
    }

    if (errorMessage.includes('exceeds maximum allowed length')) {
      return (
        `Your message is a bit too long for me to process!\n` +
        `📏 Please try with a shorter message (under 4000 characters).`
      );
    }

    if (errorMessage.includes('Service is temporarily busy')) {
      return `I'm a bit busy right now!\n` + `🔄 Please try again in a moment.`;
    }

    return (
      `I encountered an issue processing your request.\n` +
      `💭 Message length: ${text.length} characters\n\n` +
      `🔄 Please try again, and I'll do my best to help!`
    );
  }
}
