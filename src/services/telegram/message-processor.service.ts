import {
  extendTelemetryContext,
  recordMessageProcessingDuration,
  recordMessageProcessingFailure,
} from '../../observability';
import { getLogger, serializeError } from '../../utils/logger';
import { TextProcessorService } from './processors/text-processor.service';
import { AudioProcessorService } from './processors/audio-processor.service';
import { ToolDispatcher } from '../../types/tool.types';
import { ProcessorResponse, ProcessingContext } from '../../types/processing.types';
import { UsageTrackingService } from '../persistence';

export class MessageProcessorService {
  private readonly textProcessor: TextProcessorService;
  private readonly audioProcessor: AudioProcessorService;

  constructor(toolDispatcher?: ToolDispatcher, usageTrackingService?: UsageTrackingService) {
    this.textProcessor = new TextProcessorService(toolDispatcher, usageTrackingService);
    this.audioProcessor = new AudioProcessorService(toolDispatcher, usageTrackingService);
  }

  async processTextMessage(
    text: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<string> {
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
      component: 'message_processor',
      userId: userId ? String(userId) : context?.userId,
      chatId: context?.chatId,
      jobId: context?.jobId,
      messageType: 'text',
      stage: 'route',
    });
    const logger = getLogger(scopedContext);
    const startTime = Date.now();

    logger.info('message.route.started', {
      messageLength: text.length,
    });

    try {
      const response = await this.textProcessor.processTextMessageDetailed(text, userId, context);
      recordMessageProcessingDuration('text', Date.now() - startTime);
      logger.info('message.route.completed', {
        durationMs: Date.now() - startTime,
      });
      return response;
    } catch (error) {
      recordMessageProcessingFailure('text', 'route');
      logger.error('message.route.failed', {
        ...serializeError(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  async processAudioMessage(
    fileUrl: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<string> {
    const result = await this.processAudioMessageDetailed(fileUrl, userId, context);
    return result.responseText;
  }

  async processAudioMessageDetailed(
    fileUrl: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<ProcessorResponse> {
    const scopedContext = extendTelemetryContext(context, {
      requestId: context?.requestId || context?.jobId,
      component: 'message_processor',
      userId: userId ? String(userId) : context?.userId,
      chatId: context?.chatId,
      jobId: context?.jobId,
      messageType: 'audio',
      stage: 'route',
    });
    const logger = getLogger(scopedContext);
    const startTime = Date.now();

    logger.info('message.route.started', {
      hasFileUrl: !!fileUrl,
    });

    try {
      const response = await this.audioProcessor.processAudioMessageDetailed(fileUrl, userId, context);
      recordMessageProcessingDuration('audio', Date.now() - startTime);
      logger.info('message.route.completed', {
        durationMs: Date.now() - startTime,
      });
      return response;
    } catch (error) {
      recordMessageProcessingFailure('audio', 'route');
      logger.error('message.route.failed', {
        ...serializeError(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  async processAudioDocument(
    fileUrl: string,
    fileName: string,
    mimeType: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<string> {
    const result = await this.processAudioDocumentDetailed(
      fileUrl,
      fileName,
      mimeType,
      userId,
      context,
    );
    return result.responseText;
  }

  async processAudioDocumentDetailed(
    fileUrl: string,
    fileName: string,
    mimeType: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<ProcessorResponse> {
    const scopedContext = extendTelemetryContext(context, {
      requestId: context?.requestId || context?.jobId,
      component: 'message_processor',
      userId: userId ? String(userId) : context?.userId,
      chatId: context?.chatId,
      jobId: context?.jobId,
      messageType: 'audio_document',
      stage: 'route',
    });
    const logger = getLogger(scopedContext);
    const startTime = Date.now();

    logger.info('message.route.started', {
      fileName,
      mimeType,
    });

    try {
      const response = await this.audioProcessor.processAudioDocumentDetailed(
        fileUrl,
        fileName,
        mimeType,
        userId,
        context,
      );
      recordMessageProcessingDuration('audio_document', Date.now() - startTime);
      logger.info('message.route.completed', {
        durationMs: Date.now() - startTime,
      });
      return response;
    } catch (error) {
      recordMessageProcessingFailure('audio_document', 'route');
      logger.error('message.route.failed', {
        ...serializeError(error),
        durationMs: Date.now() - startTime,
      });
      throw error;
    }
  }

  async processMessage(
    messageData: {
      type: 'text' | 'audio' | 'audio_document';
      content: string;
      fileName?: string;
      mimeType?: string;
    },
    userId?: number,
  ): Promise<string> {
    const logger = getLogger(
      extendTelemetryContext(undefined, {
        component: 'message_processor',
        userId: userId ? String(userId) : undefined,
        messageType: messageData.type,
        stage: 'route',
      }),
    );

    logger.info('message.route.started', { messageType: messageData.type });

    switch (messageData.type) {
      case 'text':
        return this.processTextMessage(messageData.content, userId);
      case 'audio':
        return this.processAudioMessage(messageData.content, userId);
      case 'audio_document':
        if (!messageData.fileName || !messageData.mimeType) {
          throw new Error('Audio document processing requires fileName and mimeType');
        }
        return this.processAudioDocument(
          messageData.content,
          messageData.fileName,
          messageData.mimeType,
          userId,
        );
      default:
        logger.warn('message.route.failed', { messageType: messageData.type });
        return (
          `🤖 I received a message, but I'm not sure how to process this type of content.\n` +
          `📝 Supported types: text messages, voice notes, and audio files.\n` +
          `🔄 Please try sending a different type of message.`
        );
    }
  }
}
