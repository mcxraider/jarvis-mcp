// src/services/telegram/file.service.ts
import { extendTelemetryContext, getTelemetryContext } from '../../observability';
import { createComponentLogger, serializeError } from '../../utils/logger';
import { Telegram } from 'telegraf';
import { AudioMimeTypes } from '../../utils/constants';

/**
 * Handles file operations for Telegram bot
 */
export class FileService {
  constructor(
    private readonly botToken: string,
    private readonly telegram: Telegram
  ) {}

  /**
   * Checks if a file is an audio file based on mime type
   */
  isAudioFile(mimeType?: string): boolean {
    if (!mimeType) return false;
    return (AudioMimeTypes as readonly string[]).includes(mimeType);
  }

  /**
   * Gets the download URL for a file from Telegram
   */
  async getFileUrl(fileId: string): Promise<string> {
    const logger = createComponentLogger(
      'telegram_file',
      extendTelemetryContext(getTelemetryContext(), { stage: 'file_url' }),
    );
    try {
      const file = await this.telegram.getFile(fileId);
      if (!file.file_path) {
        throw new Error('File path not available');
      }
      return `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`;
    } catch (error) {
      logger.error('audio.download.failed', {
        fileId,
        ...serializeError(error),
      });
      throw new Error(`Failed to get file URL: ${(error as Error).message}`);
    }
  }

  /**
   * Downloads a file from Telegram
   */
  async downloadFile(fileId: string): Promise<Buffer> {
    const logger = createComponentLogger(
      'telegram_file',
      extendTelemetryContext(getTelemetryContext(), { stage: 'download' }),
    );
    try {
      const fileUrl = await this.getFileUrl(fileId);
      const response = await fetch(fileUrl);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      logger.error('audio.download.failed', {
        fileId,
        ...serializeError(error),
      });
      throw error;
    }
  }
}
