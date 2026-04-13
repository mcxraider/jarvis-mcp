import OpenAI from 'openai';
import {
  extendTelemetryContext,
  hashContent,
  recordWhisperRequest,
} from '../../observability';
import { getLogger, serializeError } from '../../utils/logger';
import { AudioMimeTypes } from '../../utils/constants';
import { validateFileSize } from '../../utils/ai/fileValidation';
import { AudioConverter } from '../../utils/ai/audioConverter';
import { UsageTrackingService } from '../persistence';
import { ProcessingContext } from '../../types/processing.types';

const WHISPER_CONSTANTS = {
  DEFAULT_MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  DEFAULT_MODEL: 'gpt-4o-transcribe',
  DEFAULT_RESPONSE_FORMAT: 'text' as const,
  DEFAULT_LANGUAGE: 'en',
  MAX_LOG_TEXT_LENGTH: 100,
} as const;

interface WhisperConfig {
  apiKey: string;
  maxFileSizeBytes?: number;
  model?: string;
  language?: string;
  responseFormat?: 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';
  enforceEnglishOnly?: boolean;
}

interface TranscriptionResult {
  text: string;
  fileUrl: string;
  processingTimeMs: number;
  detectedLanguage?: string;
  fileSizeBytes: number;
}

export class WhisperService {
  private readonly openai: OpenAI;
  private readonly config: Required<Omit<WhisperConfig, 'language'>>;
  private readonly language: string;
  private readonly usageTrackingService?: UsageTrackingService;

  constructor(config?: Partial<WhisperConfig>, usageTrackingService?: UsageTrackingService) {
    const apiKey = config?.apiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error(
        'OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass it in config.',
      );
    }

    this.openai = new OpenAI({ apiKey });
    this.usageTrackingService = usageTrackingService;

    const enforceEnglishOnly = config?.enforceEnglishOnly !== false;
    this.config = {
      apiKey,
      maxFileSizeBytes: config?.maxFileSizeBytes || WHISPER_CONSTANTS.DEFAULT_MAX_FILE_SIZE_BYTES,
      model: config?.model || WHISPER_CONSTANTS.DEFAULT_MODEL,
      responseFormat: config?.responseFormat || WHISPER_CONSTANTS.DEFAULT_RESPONSE_FORMAT,
      enforceEnglishOnly,
    };

    this.language = enforceEnglishOnly
      ? WHISPER_CONSTANTS.DEFAULT_LANGUAGE
      : config?.language || WHISPER_CONSTANTS.DEFAULT_LANGUAGE;

    getLogger({ requestId: 'startup', component: 'whisper_service' }).info('audio.service.initialized', {
      model: this.config.model,
      maxFileSizeMB: Math.round(this.config.maxFileSizeBytes / (1024 * 1024)),
      responseFormat: this.config.responseFormat,
      language: this.language,
      enforceEnglishOnly: this.config.enforceEnglishOnly,
    });
  }

  async transcribeAudio(
    fileUrl: string,
    userId?: number,
    context?: ProcessingContext,
  ): Promise<TranscriptionResult> {
    const startTime = Date.now();
    const scopedContext = extendTelemetryContext(context, {
      requestId: context?.requestId || context?.jobId,
      component: 'whisper_service',
      userId: userId ? String(userId) : context?.userId,
      chatId: context?.chatId,
      jobId: context?.jobId,
      stage: 'transcription',
    });
    const logger = getLogger(scopedContext);

    logger.info('audio.transcription.started', {
      fileUrlHash: hashContent(fileUrl),
    });

    try {
      const audioBuffer = await this.downloadAudioFile(fileUrl, context);
      validateFileSize(audioBuffer.length, this.config.maxFileSizeBytes);

      const originalExtension = this.extractFileExtension(fileUrl) || 'ogg';
      let processedBuffer = audioBuffer;
      let fileExtension = originalExtension;
      let conversionTimeMs = 0;

      if (AudioConverter.needsConversion(originalExtension)) {
        logger.info('audio.conversion.started', {
          originalFormat: originalExtension,
          targetFormat: AudioConverter.getTargetFormat(),
        });

        try {
          const conversionResult = await AudioConverter.convertToMp3(
            audioBuffer,
            originalExtension,
            userId,
            scopedContext,
          );

          processedBuffer = conversionResult.convertedBuffer;
          fileExtension = conversionResult.targetFormat;
          conversionTimeMs = conversionResult.conversionTimeMs;

          validateFileSize(processedBuffer.length, this.config.maxFileSizeBytes);

          logger.info('audio.conversion.succeeded', {
            originalFormat: originalExtension,
            targetFormat: fileExtension,
            originalSize: audioBuffer.length,
            convertedSize: processedBuffer.length,
            conversionTimeMs,
          });
        } catch (conversionError) {
          logger.error('audio.conversion.failed', {
            originalFormat: originalExtension,
            ...serializeError(conversionError),
          });

          const errorMessage = (conversionError as Error).message;
          if (errorMessage.includes('FFmpeg is not available')) {
            throw new Error(
              'Audio format conversion is not available. ' +
                'This audio format requires conversion but FFmpeg is not installed.',
            );
          }

          throw new Error(`Audio format conversion failed: ${errorMessage}`);
        }
      }

      const audioFile = new File([new Uint8Array(processedBuffer)], `audio.${fileExtension}`, {
        type: this.getMimeTypeFromExtension(fileExtension),
      });

      const transcription = await this.performTranscription(audioFile, context);
      const processingTimeMs = Date.now() - startTime;

      const result: TranscriptionResult = {
        text: transcription,
        fileUrl,
        processingTimeMs,
        fileSizeBytes: processedBuffer.length,
      };

      const logData: any = {
        textHash: hashContent(result.text.substring(0, WHISPER_CONSTANTS.MAX_LOG_TEXT_LENGTH)),
        textLength: transcription.length,
        processingTimeMs,
        fileSizeBytes: processedBuffer.length,
      };

      if (conversionTimeMs > 0) {
        logData.originalFormat = originalExtension;
        logData.convertedFormat = fileExtension;
        logData.conversionTimeMs = conversionTimeMs;
        logData.transcriptionTimeMs = processingTimeMs - conversionTimeMs;
      }

      logger.info('audio.transcription.succeeded', logData);
      recordWhisperRequest('success', processingTimeMs);

      await this.usageTrackingService?.recordEvent({
        userId: userId?.toString(),
        chatId: context?.chatId,
        jobId: context?.jobId,
        messageId: context?.sourceMessageId,
        eventType: 'audio_transcription',
        model: this.config.model,
        durationMs: processingTimeMs,
        metadata: {
          fileSizeBytes: processedBuffer.length,
          detectedLanguage: result.detectedLanguage ?? null,
        },
      });

      return result;
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;

      logger.error('audio.transcription.failed', {
        fileUrlHash: hashContent(fileUrl),
        ...serializeError(error),
        processingTimeMs,
      });
      recordWhisperRequest('error', processingTimeMs);

      await this.usageTrackingService?.recordEvent({
        userId: userId?.toString(),
        chatId: context?.chatId,
        jobId: context?.jobId,
        messageId: context?.sourceMessageId,
        eventType: 'error',
        model: this.config.model,
        durationMs: processingTimeMs,
        metadata: {
          source: 'whisper',
          error: (error as Error).message,
        },
      });

      throw new Error(`Transcription failed: ${(error as Error).message}`);
    }
  }

  private async downloadAudioFile(fileUrl: string, context?: ProcessingContext): Promise<Buffer> {
    const logger = getLogger(
      extendTelemetryContext(context, {
        requestId: context?.requestId || context?.jobId,
        component: 'whisper_download',
        chatId: context?.chatId,
        jobId: context?.jobId,
      }),
    );
    try {
      logger.info('audio.download.started', { fileUrlHash: hashContent(fileUrl) });
      const response = await fetch(fileUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType && !this.isValidAudioMimeType(contentType)) {
        logger.warn('audio.download.unexpected_content_type', { contentType });
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      logger.error('audio.download.failed', {
        fileUrlHash: hashContent(fileUrl),
        ...serializeError(error),
      });
      throw new Error(`Failed to download audio file: ${(error as Error).message}`);
    }
  }

  private async performTranscription(audioFile: File, context?: ProcessingContext): Promise<string> {
    const logger = getLogger(
      extendTelemetryContext(context, {
        requestId: context?.requestId || context?.jobId,
        component: 'whisper_api',
        chatId: context?.chatId,
        jobId: context?.jobId,
      }),
    );
    try {
      const transcription = await this.openai.audio.transcriptions.create({
        file: audioFile,
        model: this.config.model,
        language: this.language,
        response_format: this.config.responseFormat,
      });

      let transcribedText = '';
      if (typeof transcription === 'object' && 'text' in transcription) {
        transcribedText = transcription.text || '';
      } else {
        transcribedText = String(transcription || '');
      }

      if (this.config.enforceEnglishOnly && transcribedText) {
        this.validateEnglishContent(transcribedText);
      }

      return transcribedText;
    } catch (error) {
      logger.error('audio.transcription.failed', serializeError(error));
      if (error instanceof Error) {
        if (error.message.includes('Invalid file format')) {
          throw new Error('Unsupported audio format. Please use a supported audio file format.');
        }
        if (error.message.includes('File too large')) {
          throw new Error('Audio file is too large for processing.');
        }
      }

      throw new Error(`OpenAI API error: ${(error as Error).message}`);
    }
  }

  private validateEnglishContent(text: string): void {
    const logger = getLogger({ requestId: 'whisper-validation', component: 'whisper_service' });
    const nonLatinChars = /[^\x00-\x7F\s\p{P}]/u.test(text);
    const commonNonEnglishPatterns =
      /[\u00C0-\u017F\u0100-\u024F\u4E00-\u9FFF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF]/u.test(
        text,
      );

    if (nonLatinChars || commonNonEnglishPatterns) {
      logger.warn('Potential non-English content detected in transcription', {
        textSampleHash: hashContent(text.substring(0, 50)),
        hasNonLatinChars: nonLatinChars,
        hasNonEnglishPatterns: commonNonEnglishPatterns,
        enforceEnglishOnly: this.config.enforceEnglishOnly,
      });
    }
  }

  private extractFileExtension(url: string): string | null {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const lastDotIndex = pathname.lastIndexOf('.');

      if (lastDotIndex > 0 && lastDotIndex < pathname.length - 1) {
        return pathname.substring(lastDotIndex + 1).toLowerCase();
      }

      return null;
    } catch {
      return null;
    }
  }

  private getMimeTypeFromExtension(extension: string): string {
    const normalized = extension.toLowerCase();
    const mimeTypeMap: Record<string, string> = {
      mp3: 'audio/mpeg',
      mpeg: 'audio/mpeg',
      ogg: 'audio/ogg',
      oga: 'audio/ogg',
      wav: 'audio/wav',
      m4a: 'audio/mp4',
      mp4: 'audio/mp4',
      webm: 'audio/webm',
      flac: 'audio/flac',
    };

    return mimeTypeMap[normalized] || 'application/octet-stream';
  }

  private isValidAudioMimeType(contentType: string): boolean {
    return (AudioMimeTypes as readonly string[]).some((mimeType) =>
      contentType.toLowerCase().includes(mimeType.toLowerCase()),
    );
  }
}
