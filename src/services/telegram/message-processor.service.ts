// src/services/telegram/message-processor.service.ts
import {
  TelemetryContext,
  extendTelemetryContext,
  recordMessageProcessingDuration,
  recordMessageProcessingFailure,
} from '../../observability';
import { getLogger, serializeError } from '../../utils/logger';
import { TextProcessorService } from './processors/text-processor.service';
import { AudioProcessorService } from './processors/audio-processor.service';
import { ToolDispatcher } from '../../types/tool.types';

/**
 * Main service responsible for coordinating message processing
 * Delegates to specialized processors based on message type
 */
export class MessageProcessorService {
  private readonly textProcessor: TextProcessorService;
  private readonly audioProcessor: AudioProcessorService;

  constructor(toolDispatcher?: ToolDispatcher) {
    this.textProcessor = new TextProcessorService(toolDispatcher);
    this.audioProcessor = new AudioProcessorService();
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
      component: 'message_processor',
      userId: userId ? String(userId) : undefined,
      messageType: 'text',
      stage: 'route',
    });
    const logger = getLogger(scopedContext);

    logger.info('message.route.started', {
      messageLength: text.length,
    });

    const startTime = Date.now();
    try {
      const response = await this.textProcessor.processTextMessage(text, userId, scopedContext);
      recordMessageProcessingDuration('text', Date.now() - startTime);
      logger.info('message.route.completed', { durationMs: Date.now() - startTime });
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

  /**
   * Processes audio messages (voice notes, audio files)
   */
  async processAudioMessage(
    fileUrl: string,
    userId?: number,
    context?: TelemetryContext,
  ): Promise<string> {
    const scopedContext = extendTelemetryContext(context, {
      component: 'message_processor',
      userId: userId ? String(userId) : undefined,
      messageType: 'audio',
      stage: 'route',
    });
    const logger = getLogger(scopedContext);

    logger.info('message.route.started', {
      hasFileUrl: !!fileUrl,
    });

    const startTime = Date.now();
    try {
      const response = await this.audioProcessor.processAudioMessage(fileUrl, userId, scopedContext);
      recordMessageProcessingDuration('audio', Date.now() - startTime);
      logger.info('message.route.completed', { durationMs: Date.now() - startTime });
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

  /**
   * Processes documents that contain audio
   */
  async processAudioDocument(
    fileUrl: string,
    fileName: string,
    mimeType: string,
    userId?: number,
    context?: TelemetryContext,
  ): Promise<string> {
    const scopedContext = extendTelemetryContext(context, {
      component: 'message_processor',
      userId: userId ? String(userId) : undefined,
      messageType: 'audio_document',
      stage: 'route',
    });
    const logger = getLogger(scopedContext);

    logger.info('message.route.started', {
      fileName,
      mimeType,
    });

    const startTime = Date.now();
    try {
      const response = await this.audioProcessor.processAudioDocument(
        fileUrl,
        fileName,
        mimeType,
        userId,
        scopedContext,
      );
      recordMessageProcessingDuration('audio_document', Date.now() - startTime);
      logger.info('message.route.completed', { durationMs: Date.now() - startTime });
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

  /**
   * Determines message type and routes to appropriate processor
   * This method can be used for automatic routing based on message content
   */
  async processMessage(
    messageData: {
      type: 'text' | 'audio' | 'audio_document';
      content: string;
      fileName?: string;
      mimeType?: string;
    },
    userId?: number,
  ): Promise<string> {
    const scopedContext = extendTelemetryContext(undefined, {
      component: 'message_processor',
      userId: userId ? String(userId) : undefined,
      messageType: messageData.type,
      stage: 'route',
    });
    const logger = getLogger(scopedContext);

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
