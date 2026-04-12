// src/services/telegram/message-processor.service.ts
import { logger } from '../../utils/logger';
import { TextProcessorService } from './processors/text-processor.service';
import { AudioProcessorService } from './processors/audio-processor.service';
import { ToolDispatcher } from '../../types/tool.types';
import { ProcessingHooks } from '../../types/processing.types';

/**
 * Main service responsible for coordinating message processing
 * Delegates to specialized processors based on message type
 */
export class MessageProcessorService {
  private readonly textProcessor: TextProcessorService;
  private readonly audioProcessor: AudioProcessorService;

  constructor(toolDispatcher?: ToolDispatcher) {
    this.textProcessor = new TextProcessorService(toolDispatcher);
    this.audioProcessor = new AudioProcessorService(toolDispatcher);
  }

  /**
   * Processes text messages from users
   */
  async processTextMessage(
    text: string,
    userId?: number,
    hooks?: ProcessingHooks,
    jobId?: string,
  ): Promise<string> {
    logger.info('Delegating text message processing', {
      jobId,
      userId,
      messageLength: text.length,
    });

    return this.textProcessor.processTextMessage(text, userId, hooks, jobId);
  }

  /**
   * Processes audio messages (voice notes, audio files)
   */
  async processAudioMessage(
    fileUrl: string,
    userId?: number,
    hooks?: ProcessingHooks,
    jobId?: string,
  ): Promise<string> {
    logger.info('Delegating audio message processing', {
      jobId,
      userId,
      fileUrl: fileUrl.substring(0, 50) + '...', // Log partial URL for privacy
    });

    return this.audioProcessor.processAudioMessage(fileUrl, userId, hooks, jobId);
  }

  /**
   * Processes documents that contain audio
   */
  async processAudioDocument(
    fileUrl: string,
    fileName: string,
    mimeType: string,
    userId?: number,
    hooks?: ProcessingHooks,
    jobId?: string,
  ): Promise<string> {
    logger.info('Delegating audio document processing', {
      jobId,
      userId,
      fileName,
      mimeType,
    });

    return this.audioProcessor.processAudioDocument(fileUrl, fileName, mimeType, userId, hooks, jobId);
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
    logger.info('Processing message with automatic routing', {
      userId,
      messageType: messageData.type,
    });

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
        logger.warn('Unknown message type received', {
          userId,
          messageType: messageData.type,
        });
        return (
          `🤖 I received a message, but I'm not sure how to process this type of content.\n` +
          `📝 Supported types: text messages, voice notes, and audio files.\n` +
          `🔄 Please try sending a different type of message.`
        );
    }
  }
}
