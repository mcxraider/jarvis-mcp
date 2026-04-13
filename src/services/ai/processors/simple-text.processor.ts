/**
 * Simple text processor for GPT service
 *
 * @module SimpleTextProcessor
 */

import OpenAI from 'openai';
import { TelemetryContext, extendTelemetryContext } from '../../../observability';
import { getLogger, serializeError } from '../../../utils/logger';
import { GPT_CONSTANTS } from '../constants/gpt.constants';
import { SIMPLE_CONVERSATION_PROMPT } from '../../../types/gpt.prompts';
import { MessageProcessingResult } from '../../../types/gpt.types';

/**
 * Processor for handling simple text generation without function calling
 */
export class SimpleTextProcessor {
  /**
   * Process message with simple text generation (no function calling)
   *
   * @param openai - OpenAI client instance
   * @param model - Model to use for processing
   * @param temperature - Temperature setting for the model
   * @param message - User message
   * @param userId - User ID (optional)
   * @returns Promise<MessageProcessingResult> - Generated response and usage
   */
  async processSimpleMessage(
    openai: OpenAI,
    model: string,
    temperature: number,
    message: string,
    userId?: string,
    context?: TelemetryContext,
  ): Promise<MessageProcessingResult> {
    const logger = getLogger(
      extendTelemetryContext(context, {
        component: 'simple_text_processor',
        userId,
      }),
    );
    try {
      const completion = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: SIMPLE_CONVERSATION_PROMPT,
          },
          {
            role: 'user',
            content: message,
          },
        ],
        max_tokens: GPT_CONSTANTS.MAX_TOKENS,
        temperature,
      });

      return {
        response:
          completion.choices[0]?.message?.content ||
          "I apologize, but I couldn't generate a response.",
        originalMessage: message,
        processingTimeMs: 0,
        usedFunctionCalling: false,
        functionCallsCount: 0,
        model,
        usage: {
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
        },
      };
    } catch (error) {
      logger.error('openai.chat.failed', serializeError(error));

      throw error;
    }
  }
}
