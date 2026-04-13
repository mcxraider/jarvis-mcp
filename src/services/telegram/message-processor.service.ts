import { logger } from '../../utils/logger';
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
    logger.info('Delegating text message processing', {
      jobId: context?.jobId,
      userId,
      messageLength: text.length,
    });

    return this.textProcessor.processTextMessage(text, userId, context);
  }

  async processTextMessageDetailed(
    text: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<ProcessorResponse> {
    return this.textProcessor.processTextMessageDetailed(text, userId, context);
  }

  async processAudioMessage(
    fileUrl: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<string> {
    logger.info('Delegating audio message processing', {
      jobId: context?.jobId,
      userId,
      fileUrl: fileUrl.substring(0, 50) + '...',
    });

    return this.audioProcessor.processAudioMessage(fileUrl, userId, context);
  }

  async processAudioMessageDetailed(
    fileUrl: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<ProcessorResponse> {
    return this.audioProcessor.processAudioMessageDetailed(fileUrl, userId, context);
  }

  async processAudioDocument(
    fileUrl: string,
    fileName: string,
    mimeType: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<string> {
    logger.info('Delegating audio document processing', {
      jobId: context?.jobId,
      userId,
      fileName,
      mimeType,
    });

    return this.audioProcessor.processAudioDocument(fileUrl, fileName, mimeType, userId, context);
  }

  async processAudioDocumentDetailed(
    fileUrl: string,
    fileName: string,
    mimeType: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<ProcessorResponse> {
    return this.audioProcessor.processAudioDocumentDetailed(
      fileUrl,
      fileName,
      mimeType,
      userId,
      context,
    );
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
