// src/services/telegram/processors/text-processor.service.ts
import {
  TelemetryContext,
  extendTelemetryContext,
  hashContent,
  recordMessageProcessingFailure,
} from '../../../observability';
import { getLogger, serializeError } from '../../../utils/logger';
import { GPTService } from '../../ai';
import { ToolDispatcher } from '../../../types/tool.types';

/**
 * Service responsible for processing text messages
 */
export class TextProcessorService {
  private readonly gptService: GPTService;

  constructor(toolDispatcher?: ToolDispatcher) {
    // Initialize GPTService with tool dispatcher for function calling
    this.gptService = new GPTService(toolDispatcher);
  }

  /**
   * Processes text messages from users
   */
  async processTextMessage(
    text: string,
    userId?: number,
    context?: TelemetryContext,
  ): Promise<string> {
    const scopedContext = extendTelemetryContext(context, {
      component: 'text_processor',
      userId: userId ? String(userId) : undefined,
      messageType: 'text',
      stage: 'process',
    });
    const logger = getLogger(scopedContext);

    logger.info('message.route.started', {
      messageLength: text.length,
      messageHash: hashContent(text),
    });

    try {
      // Process the message using GPT
      const response = await this.gptService.processMessage(text, userId?.toString(), scopedContext);

      logger.info('message.route.completed', {
        messageLength: text.length,
        responseLength: response.length,
      });

      return response;
    } catch (error) {
      recordMessageProcessingFailure('text', 'text_processor');
      logger.error('message.route.failed', {
        messageLength: text.length,
        ...serializeError(error),
      });

      return this.handleTextProcessingError(error as Error, text);
    }
  }

  /**
   * Handles errors during text processing and returns user-friendly messages
   */
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

    // Fallback response for other errors
    return (
      `I encountered an issue processing your request.\n` +
      `💭 Message length: ${text.length} characters\n\n` +
      `🔄 Please try again, and I'll do my best to help!`
    );
  }
}
