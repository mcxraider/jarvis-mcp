import { Context } from 'telegraf';
import { EnqueuedJob, InboundTask, JobType } from '../../types/job.types';
import { JobService } from '../jobs/job.service';

export class TelegramUpdateIntakeService {
  constructor(private readonly jobService: JobService) {}

  async enqueueText(ctx: Context): Promise<EnqueuedJob> {
    if (!ctx.message || !('text' in ctx.message) || !ctx.from || !ctx.chat) {
      throw new Error('Text message context is incomplete');
    }

    return this.jobService.enqueue(
      this.createTask(ctx, 'text', {
        text: ctx.message.text,
        metadata: {
          username: ctx.from.username,
        },
      }),
    );
  }

  async enqueueVoice(ctx: Context): Promise<EnqueuedJob> {
    if (!ctx.message || !('voice' in ctx.message) || !ctx.from || !ctx.chat) {
      throw new Error('Voice message context is incomplete');
    }

    return this.jobService.enqueue(
      this.createTask(ctx, 'voice', {
        fileId: ctx.message.voice.file_id,
        duration: ctx.message.voice.duration,
        metadata: {
          fileSize: ctx.message.voice.file_size,
          username: ctx.from.username,
        },
      }),
    );
  }

  async enqueueAudio(ctx: Context): Promise<EnqueuedJob> {
    if (!ctx.message || !('audio' in ctx.message) || !ctx.from || !ctx.chat) {
      throw new Error('Audio message context is incomplete');
    }

    return this.jobService.enqueue(
      this.createTask(ctx, 'audio_document', {
        fileId: ctx.message.audio.file_id,
        fileName: ctx.message.audio.file_name || 'audio_file',
        mimeType: ctx.message.audio.mime_type || 'application/octet-stream',
        duration: ctx.message.audio.duration,
        metadata: {
          fileSize: ctx.message.audio.file_size,
          performer: ctx.message.audio.performer,
          title: ctx.message.audio.title,
          username: ctx.from.username,
        },
      }),
    );
  }

  async enqueueAudioDocument(ctx: Context): Promise<EnqueuedJob> {
    if (!ctx.message || !('document' in ctx.message) || !ctx.from || !ctx.chat) {
      throw new Error('Audio document context is incomplete');
    }

    return this.jobService.enqueue(
      this.createTask(ctx, 'audio_document', {
        fileId: ctx.message.document.file_id,
        fileName: ctx.message.document.file_name || 'audio_file',
        mimeType: ctx.message.document.mime_type || 'application/octet-stream',
        metadata: {
          fileSize: ctx.message.document.file_size,
          username: ctx.from.username,
        },
      }),
    );
  }

  private createTask(
    ctx: Context,
    kind: JobType,
    partial: Partial<InboundTask>,
  ): InboundTask {
    return {
      chatId: ctx.chat!.id,
      userId: ctx.from!.id,
      telegramUpdateId: ctx.update.update_id,
      telegramMessageId: (ctx.message as { message_id: number }).message_id,
      kind,
      text: partial.text,
      fileId: partial.fileId,
      fileName: partial.fileName,
      mimeType: partial.mimeType,
      duration: partial.duration,
      metadata: partial.metadata || {},
    };
  }
}
