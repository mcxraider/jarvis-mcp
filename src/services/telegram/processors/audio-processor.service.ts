// src/services/telegram/processors/audio-processor.service.ts
import { logger } from '../../../utils/logger';
import { WhisperService } from '../../ai/whisper.service';
import { GPTService } from '../../ai/gpt.service';
import { ProcessorResponse, ProcessingContext } from '../../../types/processing.types';
import { UsageTrackingService } from '../../persistence';

/**
 * Service responsible for processing audio messages and documents
 */
export class AudioProcessorService {
  private readonly whisperService: WhisperService;
  private readonly gptService: GPTService;

  constructor(usageTrackingService?: UsageTrackingService) {
    // Initialize WhisperService with English-only enforcement
    this.whisperService = new WhisperService({
      enforceEnglishOnly: true,
      language: 'en',
    }, usageTrackingService);

    // Initialize GPTService for text processing
    this.gptService = new GPTService(undefined, undefined, usageTrackingService);
  }

  /**
   * Processes audio messages (voice notes, audio files)
   */
  async processAudioMessage(fileUrl: string, userId?: number, context?: ProcessingContext): Promise<string> {
    const result = await this.processAudioMessageDetailed(fileUrl, userId, context);
    return result.responseText;
  }

  async processAudioMessageDetailed(
    fileUrl: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<ProcessorResponse> {
    logger.info('Processing audio message', {
      userId,
      fileUrl: fileUrl.substring(0, 50) + '...', // Log partial URL for privacy
    });

    try {
      // Transcribe the audio using Whisper service
      const transcriptionResult = await this.whisperService.transcribeAudio(fileUrl, userId, context);

      const { text, processingTimeMs } = transcriptionResult;

      // If transcription is empty or too short, provide helpful feedback
      if (!text || text.trim().length < 2) {
        return {
          responseText:
            `🎵 Audio received and processed, but no speech was detected.\n` +
            `⏱️ Processing time: ${Math.round(processingTimeMs / 1000)}s\n`,
          processingTimeMs,
        };
      }

      // Process the transcribed text with GPT
      try {
        const response = await this.gptService.processMessageDetailed(text, userId?.toString(), context);

        const finalResponse =
          `📝 What you said: ${text}\n\n` +
          `🤖 Response: ${response.response}\n\n` +
          `⏱️ Transcription: ${Math.round(processingTimeMs / 1000)}s`;

        return {
          responseText: finalResponse,
          processingTimeMs,
          transcriptionText: text,
        };
      } catch (gptError) {
        logger.warn('Failed to process transcribed audio with GPT', {
          userId,
          transcribedText: text.substring(0, 100),
          error: (gptError as Error).message,
        });

        // Fallback to just showing transcription if GPT processing fails
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
      logger.error('Failed to process audio message', {
        userId,
        error: (error as Error).message,
      });

      return {
        responseText: this.handleAudioProcessingError(error as Error),
      };
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
    context?: ProcessingContext,
  ): Promise<string> {
    const result = await this.processAudioDocumentDetailed(fileUrl, fileName, mimeType, userId, context);
    return result.responseText;
  }

  async processAudioDocumentDetailed(
    fileUrl: string,
    fileName: string,
    mimeType: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<ProcessorResponse> {
    logger.info('Processing audio document', {
      userId,
      fileName,
      mimeType,
    });

    try {
      // Use the same transcription logic as audio messages
      const transcriptionResult = await this.whisperService.transcribeAudio(fileUrl, userId, context);

      const { text, processingTimeMs, fileSizeBytes } = transcriptionResult;

      // If transcription is empty or too short, provide helpful feedback
      if (!text || text.trim().length < 2) {
        return {
          responseText:
            `📁 Audio document "${fileName}" processed, but no speech was detected.\n` +
            `🎼 Type: ${mimeType}\n` +
            `⏱️ Processing time: ${Math.round(processingTimeMs / 1000)}s\n`,
          processingTimeMs,
        };
      }

      // Process the transcribed text with GPT
      try {
        const response = await this.gptService.processMessageDetailed(text, userId?.toString(), context);

        const finalResponse =
          `📁 Audio document "${fileName}" processed successfully!\n` +
          `🎼 Type: ${mimeType}\n\n` +
          `📝 What was said: ${text}\n\n` +
          `🤖 Response: ${response.response}\n\n` +
          `⏱️ Transcription: ${Math.round(processingTimeMs / 1000)}s`;

        return {
          responseText: finalResponse,
          processingTimeMs,
          transcriptionText: text,
        };
      } catch (gptError) {
        logger.warn('Failed to process transcribed audio document with GPT', {
          userId,
          fileName,
          transcribedText: text.substring(0, 100),
          error: (gptError as Error).message,
        });

        // Fallback to just showing transcription if GPT processing fails
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
      logger.error('Failed to process audio document', {
        userId,
        fileName,
        mimeType,
        error: (error as Error).message,
      });

      return {
        responseText: this.handleAudioDocumentError(error as Error, fileName, mimeType),
      };
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
