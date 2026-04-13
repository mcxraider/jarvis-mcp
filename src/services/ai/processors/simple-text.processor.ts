import OpenAI from 'openai';
import { extendTelemetryContext } from '../../../observability';
import { getLogger, serializeError } from '../../../utils/logger';
import { GPT_CONSTANTS } from '../constants/gpt.constants';
import { SIMPLE_CONVERSATION_PROMPT } from '../../../types/gpt.prompts';
import { MessageProcessingResult } from '../../../types/gpt.types';
import { ProcessingContext } from '../../../types/processing.types';

export class SimpleTextProcessor {
  async processSimpleMessage(
    openai: OpenAI,
    model: string,
    temperature: number,
    message: string,
    userId?: string,
    context?: ProcessingContext,
  ): Promise<MessageProcessingResult> {
    const startTime = Date.now();
    const logger = getLogger(
      extendTelemetryContext(context, {
        requestId: context?.requestId || context?.jobId,
        component: 'simple_text_processor',
        userId,
        chatId: context?.chatId,
        jobId: context?.jobId,
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
        processingTimeMs: Date.now() - startTime,
        usedFunctionCalling: false,
        functionCallsCount: 0,
        model,
        usage: {
          promptTokens: completion.usage?.prompt_tokens,
          completionTokens: completion.usage?.completion_tokens,
          totalTokens: completion.usage?.total_tokens,
        },
        inputTokens: completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens,
        totalTokens: completion.usage?.total_tokens,
      };
    } catch (error) {
      logger.error('openai.chat.failed', serializeError(error));
      throw error;
    }
  }
}
