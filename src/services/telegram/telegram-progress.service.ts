import { JobRecord } from '../../types/job.types';
import { logger } from '../../utils/logger';
import { JobRepository } from '../../repositories/job.repository';
import { TelegramResponseService } from './telegram-response.service';

const PROGRESS_MESSAGES: Record<string, string> = {
  'job.started': 'Working on it.',
  'media.downloading': 'Downloading media from Telegram.',
  'audio.transcribing': 'Transcribing your audio now.',
  'gpt.processing': 'Thinking through the request.',
  'tools.executing': 'Running the requested actions.',
};

export class TelegramProgressService {
  constructor(
    private readonly responseService: TelegramResponseService,
    private readonly jobRepository: JobRepository,
  ) {}

  async updateProgress(job: JobRecord, eventType: string, message?: string): Promise<void> {
    const progressText = message || PROGRESS_MESSAGES[eventType];
    if (!progressText || !job.ackMessageId) {
      return;
    }

    try {
      await this.responseService.updateMessage(job.chatId, job.ackMessageId, progressText);
      await this.jobRepository.updateProgressMessage(job.id, job.ackMessageId);
    } catch (error) {
      logger.debug('Progress message update skipped', {
        jobId: job.id,
        eventType,
        error: (error as Error).message,
      });
    }
  }
}
