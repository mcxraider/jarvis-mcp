import { Context } from 'telegraf';
import { extendTelemetryContext, getTelemetryContext } from '../../../observability';
import { getLogger, serializeError } from '../../../utils/logger';
import { FileService } from '../file.service';
import { BotActivityService } from '../bot-activity.service';
import { TelegramUpdateIntakeService } from '../telegram-update-intake.service';
import { TelegramResponseService } from '../telegram-response.service';
import { JobService } from '../../jobs/job.service';

export class MessageHandlers {
  constructor(
    private readonly fileService: FileService,
    private readonly intakeService: TelegramUpdateIntakeService,
    private readonly activityService: BotActivityService,
    private readonly responseService: TelegramResponseService,
    private readonly jobService: JobService,
  ) {}

  async handleText(ctx: Context): Promise<void> {
    if (!ctx.message || !('text' in ctx.message)) return;

    const context = this.createMessageContext(ctx, 'text');
    const logger = getLogger(context);

    logger.info('telegram.message.received', {
      username: ctx.from?.username,
      messageLength: ctx.message.text.length,
    });
    this.activityService.recordActivity('message_text');

    try {
      const enqueued = await this.intakeService.enqueueText(ctx);
      const ack = await this.responseService.sendAcknowledgement(
        ctx.chat!.id,
        enqueued.acknowledgement,
        ctx.message.message_id,
      );
      await this.jobService.attachAcknowledgement(enqueued.job.id, ack.message_id);
      logger.info('telegram.reply.sent', { replyLength: enqueued.acknowledgement.length });
    } catch (error) {
      logger.error('message.route.failed', serializeError(error));
      await this.responseService.sendFailureResponse(
        ctx.chat!.id,
        '❌ Sorry, I had trouble queuing your message.',
      );
    }
  }

  async handleVoice(ctx: Context): Promise<void> {
    if (!ctx.message || !('voice' in ctx.message)) return;

    const context = this.createMessageContext(ctx, 'audio');
    const logger = getLogger(context);

    logger.info('telegram.message.received', {
      duration: ctx.message.voice.duration,
      fileSize: ctx.message.voice.file_size,
    });
    this.activityService.recordActivity('message_voice');

    try {
      const enqueued = await this.intakeService.enqueueVoice(ctx);
      const ack = await this.responseService.sendAcknowledgement(
        ctx.chat!.id,
        enqueued.acknowledgement,
        ctx.message.message_id,
      );
      await this.jobService.attachAcknowledgement(enqueued.job.id, ack.message_id);
      logger.info('telegram.reply.sent', { replyLength: enqueued.acknowledgement.length });
    } catch (error) {
      logger.error('message.route.failed', serializeError(error));
      await this.responseService.sendFailureResponse(
        ctx.chat!.id,
        '❌ Sorry, I had trouble queuing your voice message.',
      );
    }
  }

  async handleAudio(ctx: Context): Promise<void> {
    if (!ctx.message || !('audio' in ctx.message)) return;

    this.activityService.recordActivity('message_audio');
    await this.processAudioFile(ctx);
  }

  async handleDocument(ctx: Context): Promise<void> {
    if (!ctx.message || !('document' in ctx.message)) return;

    const document = ctx.message.document;
    const context = this.createMessageContext(ctx, 'audio_document');
    const logger = getLogger(context);

    if (!this.fileService.isAudioFile(document.mime_type)) {
      logger.info('telegram.message.received', {
        mimeType: document.mime_type,
        fileName: document.file_name,
      });
      await this.responseService.sendFailureResponse(
        ctx.chat!.id,
        '📄 I received a document, but I only process audio files. Please send an audio file.',
      );
      return;
    }

    this.activityService.recordActivity('message_document');

    try {
      const enqueued = await this.intakeService.enqueueAudioDocument(ctx);
      const ack = await this.responseService.sendAcknowledgement(
        ctx.chat!.id,
        enqueued.acknowledgement,
        ctx.message.message_id,
      );
      await this.jobService.attachAcknowledgement(enqueued.job.id, ack.message_id);
      logger.info('telegram.reply.sent', { replyLength: enqueued.acknowledgement.length });
    } catch (error) {
      logger.error('message.route.failed', {
        fileName: document.file_name,
        ...serializeError(error),
      });
      await this.responseService.sendFailureResponse(
        ctx.chat!.id,
        '❌ Sorry, I had trouble queuing your audio document.',
      );
    }
  }

  async handleUnknown(ctx: Context): Promise<void> {
    const logger = getLogger(this.createMessageContext(ctx, 'unknown'));

    logger.info('telegram.message.received', {
      messageType: 'unknown',
    });
    this.activityService.recordActivity('message_unknown');

    await this.responseService.sendFailureResponse(
      ctx.chat!.id,
      `🤔 I received your message, but I don't know how to handle this type yet. Try sending text or audio!`,
    );
  }

  private async processAudioFile(ctx: Context): Promise<void> {
    if (!ctx.message || !('audio' in ctx.message)) return;

    const logger = getLogger(this.createMessageContext(ctx, 'audio'));

    logger.info('telegram.message.received', {
      fileName: ctx.message.audio.file_name || 'audio_file',
      mimeType: ctx.message.audio.mime_type,
      fileSize: ctx.message.audio.file_size,
      duration: ctx.message.audio.duration,
    });

    try {
      const enqueued = await this.intakeService.enqueueAudio(ctx);
      const ack = await this.responseService.sendAcknowledgement(
        ctx.chat!.id,
        enqueued.acknowledgement,
        ctx.message.message_id,
      );
      await this.jobService.attachAcknowledgement(enqueued.job.id, ack.message_id);
      logger.info('telegram.reply.sent', { replyLength: enqueued.acknowledgement.length });
    } catch (error) {
      logger.error('message.route.failed', serializeError(error));
      await this.responseService.sendFailureResponse(
        ctx.chat!.id,
        '❌ Sorry, I had trouble queuing your audio file.',
      );
    }
  }

  private createMessageContext(
    ctx: Context,
    messageType: 'text' | 'audio' | 'audio_document' | 'unknown',
  ) {
    return extendTelemetryContext(getTelemetryContext(), {
      chatId: ctx.chat?.id,
      userId: ctx.from?.id ? String(ctx.from.id) : undefined,
      updateId: (ctx.update as any)?.update_id,
      messageType,
      component: 'telegram_message',
      stage: 'received',
    });
  }
}
