import {
  extendTelemetryContext,
  recordMessageProcessingFailure,
} from '../../../observability';
import { getLogger, serializeError } from '../../../utils/logger';
import { WhisperService } from '../../ai/whisper.service';
import { GPTService } from '../../ai/gpt.service';
import { ProcessorResponse, ProcessingContext } from '../../../types/processing.types';
import { UsageTrackingService } from '../../persistence';
import { ToolDispatcher } from '../../../types/tool.types';

export class AudioProcessorService {
  private readonly whisperService: WhisperService;
  private readonly gptService: GPTService;

  constructor(toolDispatcher?: ToolDispatcher, usageTrackingService?: UsageTrackingService) {
    this.whisperService = new WhisperService(
      {
        enforceEnglishOnly: true,
        language: 'en',
      },
      usageTrackingService,
    );

    this.gptService = new GPTService(toolDispatcher, undefined, usageTrackingService);
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
      component: 'audio_processor',
      userId: userId ? String(userId) : context?.userId,
      chatId: context?.chatId,
      jobId: context?.jobId,
      messageType: 'audio',
      stage: 'process',
    });
    const logger = getLogger(scopedContext);

    logger.info('message.route.started', {
      hasFileUrl: !!fileUrl,
    });

    try {
      await context?.onStage?.('audio.transcribing');
      const transcriptionResult = await this.whisperService.transcribeAudio(fileUrl, userId, context);
      const { text, processingTimeMs } = transcriptionResult;

      if (!text || text.trim().length < 2) {
        return {
          responseText:
            `🎵 Audio received and processed, but no speech was detected.\n` +
            `⏱️ Processing time: ${Math.round(processingTimeMs / 1000)}s\n`,
          processingTimeMs,
        };
      }

      try {
        await context?.onStage?.('gpt.processing');
        const response = await this.gptService.processMessageDetailed(text, userId?.toString(), context);

        return {
          responseText:
            `📝 What you said: ${text}\n\n` +
            `🤖 Response: ${response.response}\n\n` +
            `⏱️ Transcription: ${Math.round(processingTimeMs / 1000)}s`,
          processingTimeMs,
          transcriptionText: text,
        };
      } catch (gptError) {
        logger.warn('openai.chat.failed', serializeError(gptError));

        return {
          responseText:
            `🎵 Audio transcribed successfully!\n\n` +
            `📝 What you said: ${text}\n\n` +
            `⏱️ ${Math.round(processingTimeMs / 1000)}s\n` +
            `🤖 (Response generation temporarily unavailable)`,
          processingTimeMs,
          transcriptionText: text,
        };
      }
    } catch (error) {
      recordMessageProcessingFailure('audio', 'audio_processor');
      logger.error('message.route.failed', serializeError(error));

      return {
        responseText: this.handleAudioProcessingError(error as Error),
      };
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
      component: 'audio_processor',
      userId: userId ? String(userId) : context?.userId,
      chatId: context?.chatId,
      jobId: context?.jobId,
      messageType: 'audio_document',
      stage: 'process',
    });
    const logger = getLogger(scopedContext);

    logger.info('message.route.started', {
      fileName,
      mimeType,
    });

    try {
      await context?.onStage?.('audio.transcribing');
      const transcriptionResult = await this.whisperService.transcribeAudio(fileUrl, userId, context);
      const { text, processingTimeMs } = transcriptionResult;

      if (!text || text.trim().length < 2) {
        return {
          responseText:
            `📁 Audio document "${fileName}" processed, but no speech was detected.\n` +
            `🎼 Type: ${mimeType}\n` +
            `⏱️ Processing time: ${Math.round(processingTimeMs / 1000)}s\n`,
          processingTimeMs,
        };
      }

      try {
        await context?.onStage?.('gpt.processing');
        const response = await this.gptService.processMessageDetailed(text, userId?.toString(), context);

        return {
          responseText:
            `📁 Audio document "${fileName}" processed successfully!\n` +
            `🎼 Type: ${mimeType}\n\n` +
            `📝 What was said: ${text}\n\n` +
            `🤖 Response: ${response.response}\n\n` +
            `⏱️ Transcription: ${Math.round(processingTimeMs / 1000)}s`,
          processingTimeMs,
          transcriptionText: text,
        };
      } catch (gptError) {
        logger.warn('openai.chat.failed', {
          fileName,
          ...serializeError(gptError),
        });

        return {
          responseText:
            `📁 Audio document "${fileName}" transcribed successfully!\n` +
            `🎼 Type: ${mimeType}\n\n` +
            `📝 What was said: ${text}\n\n` +
            `⏱️ ${Math.round(processingTimeMs / 1000)}s\n` +
            `🤖 (Response generation temporarily unavailable)`,
          processingTimeMs,
          transcriptionText: text,
        };
      }
    } catch (error) {
      recordMessageProcessingFailure('audio_document', 'audio_processor');
      logger.error('message.route.failed', {
        fileName,
        mimeType,
        ...serializeError(error),
      });

      return {
        responseText: this.handleAudioDocumentError(error as Error, fileName, mimeType),
      };
    }
  }

  private handleAudioProcessingError(error: Error): string {
    const errorMessage = error.message;

    if (errorMessage.includes('File size') && errorMessage.includes('exceeds')) {
      return (
        `🎵 Audio received, but the file is too large for processing.\n` +
        `📏 Please send audio files smaller than 25MB.`
      );
    }

    if (errorMessage.includes('Unsupported audio format')) {
      return (
        `🎵 Audio received, but the format is not supported.\n` +
        `🔧 Please use common audio formats like MP3, OGG, WAV, or M4A.`
      );
    }

    if (errorMessage.includes('Audio format conversion is not available')) {
      return (
        `🎵 Audio received in a format that needs conversion, but the conversion service is not available.\n` +
        `🔧 Please convert your audio to MP3, WAV, or OGG format and try again.`
      );
    }

    if (errorMessage.includes('Audio format conversion failed')) {
      return (
        `🎵 Audio received, but format conversion failed.\n` +
        `🔧 Please try converting your audio to MP3, WAV, or OGG format and send again.`
      );
    }

    if (errorMessage.includes('Failed to download')) {
      return (
        `🎵 Audio received, but there was an issue downloading the file.\n` +
        `🔄 Please try sending the audio again.`
      );
    }

    return (
      `🎵 Audio received, but processing failed.\n` +
      `❌ Error: Unable to transcribe the audio file.\n` +
      `🔄 Please try again or contact support if the issue persists.`
    );
  }

  private handleAudioDocumentError(error: Error, fileName: string, mimeType: string): string {
    const errorMessage = error.message;

    if (errorMessage.includes('File size') && errorMessage.includes('exceeds')) {
      return (
        `📁 Audio document "${fileName}" received, but the file is too large for processing.\n` +
        `🎼 Type: ${mimeType}\n` +
        `📏 Please send audio files smaller than 25MB.`
      );
    }

    if (errorMessage.includes('Unsupported audio format')) {
      return (
        `📁 Audio document "${fileName}" received, but the format is not supported.\n` +
        `🎼 Type: ${mimeType}\n` +
        `🔧 Please use common audio formats like MP3, OGG, WAV, or M4A.`
      );
    }

    if (errorMessage.includes('Audio format conversion is not available')) {
      return (
        `📁 Audio document "${fileName}" received in a format that needs conversion, but the conversion service is not available.\n` +
        `🎼 Type: ${mimeType}\n` +
        `🔧 Please convert your audio to MP3, WAV, or OGG format and try again.`
      );
    }

    if (errorMessage.includes('Audio format conversion failed')) {
      return (
        `📁 Audio document "${fileName}" received, but format conversion failed.\n` +
        `🎼 Type: ${mimeType}\n` +
        `🔧 Please try converting your audio to MP3, WAV, or OGG format and send again.`
      );
    }

    return (
      `📁 Audio document "${fileName}" received, but processing failed.\n` +
      `🎼 Type: ${mimeType}\n` +
      `❌ Error: Unable to transcribe the audio file.\n` +
      `🔄 Please try again or contact support if the issue persists.`
    );
  }
}
