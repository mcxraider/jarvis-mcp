// src/services/telegram/processors/audio-processor.service.ts
import {
  TelemetryContext,
  extendTelemetryContext,
  recordMessageProcessingFailure,
} from '../../../observability';
import { getLogger, serializeError } from '../../../utils/logger';
import { WhisperService } from '../../ai/whisper.service';
import { GPTService } from '../../ai/gpt.service';

/**
 * Service responsible for processing audio messages and documents
 */
export class AudioProcessorService {
  private readonly whisperService: WhisperService;
  private readonly gptService: GPTService;

  constructor() {
    // Initialize WhisperService with English-only enforcement
    this.whisperService = new WhisperService({
      enforceEnglishOnly: true,
      language: 'en',
    });

    // Initialize GPTService for text processing
    this.gptService = new GPTService();
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
      component: 'audio_processor',
      userId: userId ? String(userId) : undefined,
      messageType: 'audio',
      stage: 'process',
    });
    const logger = getLogger(scopedContext);

    logger.info('message.route.started', {
      hasFileUrl: !!fileUrl,
    });

    try {
      // Transcribe the audio using Whisper service
      const transcriptionResult = await this.whisperService.transcribeAudio(
        fileUrl,
        userId,
        scopedContext,
      );

      const { text, processingTimeMs } = transcriptionResult;

      // If transcription is empty or too short, provide helpful feedback
      if (!text || text.trim().length < 2) {
        return (
          `🎵 Audio received and processed, but no speech was detected.\n` +
          `⏱️ Processing time: ${Math.round(processingTimeMs / 1000)}s\n`
        );
      }

      // Process the transcribed text with GPT
      try {
        const response = await this.gptService.processMessage(text, userId?.toString(), scopedContext);

        const finalResponse =
          `📝 What you said: ${text}\n\n` +
          `🤖 Response: ${response}\n\n` +
          `⏱️ Transcription: ${Math.round(processingTimeMs / 1000)}s`;

        return finalResponse;
      } catch (gptError) {
        logger.warn('openai.chat.failed', serializeError(gptError));

        // Fallback to just showing transcription if GPT processing fails
        return (
          `🎵 Audio transcribed successfully!\n\n` +
          `📝 What you said: ${text}\n\n` +
          `⏱️ ${Math.round(processingTimeMs / 1000)}s\n` +
          `🤖 (Response generation temporarily unavailable)`
        );
      }
    } catch (error) {
      recordMessageProcessingFailure('audio', 'audio_processor');
      logger.error('message.route.failed', serializeError(error));

      return this.handleAudioProcessingError(error as Error);
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
      component: 'audio_processor',
      userId: userId ? String(userId) : undefined,
      messageType: 'audio_document',
      stage: 'process',
    });
    const logger = getLogger(scopedContext);

    logger.info('message.route.started', {
      fileName,
      mimeType,
    });

    try {
      // Use the same transcription logic as audio messages
      const transcriptionResult = await this.whisperService.transcribeAudio(
        fileUrl,
        userId,
        scopedContext,
      );

      const { text, processingTimeMs, fileSizeBytes } = transcriptionResult;

      // If transcription is empty or too short, provide helpful feedback
      if (!text || text.trim().length < 2) {
        return (
          `📁 Audio document "${fileName}" processed, but no speech was detected.\n` +
          `🎼 Type: ${mimeType}\n` +
          `⏱️ Processing time: ${Math.round(processingTimeMs / 1000)}s\n`
        );
      }

      // Process the transcribed text with GPT
      try {
        const response = await this.gptService.processMessage(text, userId?.toString(), scopedContext);

        const finalResponse =
          `📁 Audio document "${fileName}" processed successfully!\n` +
          `🎼 Type: ${mimeType}\n\n` +
          `📝 What was said: ${text}\n\n` +
          `🤖 Response: ${response}\n\n` +
          `⏱️ Transcription: ${Math.round(processingTimeMs / 1000)}s`;

        return finalResponse;
      } catch (gptError) {
        logger.warn('openai.chat.failed', {
          fileName,
          ...serializeError(gptError),
        });

        // Fallback to just showing transcription if GPT processing fails
        return (
          `📁 Audio document "${fileName}" transcribed successfully!\n` +
          `🎼 Type: ${mimeType}\n\n` +
          `📝 What was said: ${text}\n\n` +
          `⏱️ ${Math.round(processingTimeMs / 1000)}s\n` +
          `🤖 (Response generation temporarily unavailable)`
        );
      }
    } catch (error) {
      recordMessageProcessingFailure('audio_document', 'audio_processor');
      logger.error('message.route.failed', {
        fileName,
        mimeType,
        ...serializeError(error),
      });

      return this.handleAudioDocumentError(error as Error, fileName, mimeType);
    }
  }

  /**
   * Handles errors during audio message processing
   */
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

    // Generic error message for other failures
    return (
      `🎵 Audio received, but processing failed.\n` +
      `❌ Error: Unable to transcribe the audio file.\n` +
      `🔄 Please try again or contact support if the issue persists.`
    );
  }

  /**
   * Handles errors during audio document processing
   */
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

    // Generic error message for other failures
    return (
      `📁 Audio document "${fileName}" received, but processing failed.\n` +
      `🎼 Type: ${mimeType}\n` +
      `❌ Error: Unable to transcribe the audio file.\n` +
      `🔄 Please try again or contact support if the issue persists.`
    );
  }
}
