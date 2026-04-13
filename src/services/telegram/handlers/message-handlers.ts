// src/services/telegram/handlers/message-handlers.ts
import { Context } from 'telegraf';
import { logger } from '../../../utils/logger';
import { FileService } from '../file.service';
import { MessageProcessorService } from '../message-processor.service';
import { BotActivityService } from '../bot-activity.service';
import { ConversationStoreService, JobStateService, UsageTrackingService } from '../../persistence';
import { Message } from 'telegraf/typings/core/types/typegram';
import { ProcessorResponse } from '../../../types/processing.types';

/**
 * Handles different types of messages
 */
export class MessageHandlers {
  constructor(
    private readonly fileService: FileService,
    private readonly messageProcessor: MessageProcessorService,
    private readonly activityService: BotActivityService,
    private readonly conversationStore?: ConversationStoreService,
    private readonly jobStateService?: JobStateService,
    private readonly usageTrackingService?: UsageTrackingService,
  ) {}

  async handleText(ctx: Context): Promise<void> {
    if (!ctx.message || !('text' in ctx.message)) return;

    const messageText = ctx.message.text;
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const updateId = ctx.update && 'update_id' in ctx.update ? ctx.update.update_id : undefined;
    let inboundMessageId: string | undefined;
    let jobId: string | undefined;

    logger.info('Received text message', {
      userId,
      username: ctx.from?.username,
      messageLength: messageText.length
    });
    this.activityService.recordActivity('message_text');

    try {
      const inboundMessage = userId && chatId
        ? await this.conversationStore?.createIncomingMessage({
            telegramUpdateId: updateId,
            telegramMessageId: ctx.message.message_id,
            chatId: chatId.toString(),
            userId: userId.toString(),
            messageType: 'text',
            contentText: messageText,
          })
        : null;
      inboundMessageId = inboundMessage?.id;
      const job = userId && chatId
        ? await this.jobStateService?.createJob({
            userId: userId.toString(),
            chatId: chatId.toString(),
            sourceMessageId: inboundMessage?.id,
            jobType: 'text_processing',
            payload: {
              messageType: 'text',
              input: {
                text: messageText,
              },
              telegram: {
                updateId: updateId ?? null,
                messageId: ctx.message.message_id,
              },
            },
          })
        : null;
      jobId = job?.id;

      if (inboundMessage) {
        await this.conversationStore?.markMessageProcessing(inboundMessage.id, 'processing', undefined, job?.id);
      }
      if (job) {
        await this.jobStateService?.markInProgress(job.id);
      }

      const response = await this.messageProcessor.processTextMessageDetailed(messageText, userId, {
        jobId,
        sourceMessageId: inboundMessageId,
        chatId: chatId?.toString(),
      });
      await this.replyAndPersist(ctx, response, {
        inboundMessageId,
        jobId,
        userId,
        chatId,
        outgoingType: 'text',
      });
    } catch (error) {
      logger.error('Error processing text message', {
        error: (error as Error).message,
        userId
      });
      await this.replyWithFailure(ctx, {
        userId,
        chatId,
        inboundMessageId,
        jobId,
        outgoingType: 'error',
        fallbackText: '❌ Sorry, I had trouble processing your message.',
        inboundType: 'text',
      }, error as Error);
    }
  }

  async handleVoice(ctx: Context): Promise<void> {
    if (!ctx.message || !('voice' in ctx.message)) return;

    const voice = ctx.message.voice;
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const updateId = ctx.update && 'update_id' in ctx.update ? ctx.update.update_id : undefined;
    let inboundMessageId: string | undefined;
    let jobId: string | undefined;

    logger.info('Voice message received', {
      userId,
      duration: voice.duration,
      fileSize: voice.file_size
    });
    this.activityService.recordActivity('message_voice');

    try {
      const fileUrl = await this.fileService.getFileUrl(voice.file_id);
      const inboundMessage = userId && chatId
        ? await this.conversationStore?.createIncomingMessage({
            telegramUpdateId: updateId,
            telegramMessageId: ctx.message.message_id,
            chatId: chatId.toString(),
            userId: userId.toString(),
            messageType: 'voice',
            fileId: voice.file_id,
            fileUrl,
            mimeType: 'audio/ogg',
          })
        : null;
      inboundMessageId = inboundMessage?.id;
      const job = userId && chatId
        ? await this.jobStateService?.createJob({
            userId: userId.toString(),
            chatId: chatId.toString(),
            sourceMessageId: inboundMessage?.id,
            jobType: 'voice_processing',
            payload: {
              messageType: 'voice',
              input: {
                text: null,
                fileUrl,
                fileName: null,
                mimeType: 'audio/ogg',
              },
              telegram: {
                updateId: updateId ?? null,
                messageId: ctx.message.message_id,
              },
            },
          })
        : null;
      jobId = job?.id;

      if (inboundMessage) {
        await this.conversationStore?.markMessageProcessing(inboundMessage.id, 'processing', undefined, job?.id);
      }
      if (job) {
        await this.jobStateService?.markInProgress(job.id);
      }

      const response = await this.messageProcessor.processAudioMessageDetailed(fileUrl, userId, {
        jobId,
        sourceMessageId: inboundMessageId,
        chatId: chatId?.toString(),
      });
      await this.replyAndPersist(ctx, response, {
        inboundMessageId,
        jobId,
        userId,
        chatId,
        outgoingType: 'audio',
      });
    } catch (error) {
      logger.error('Error processing voice message', {
        error: (error as Error).message,
        userId
      });
      await this.replyWithFailure(ctx, {
        userId,
        chatId,
        inboundMessageId,
        jobId,
        outgoingType: 'error',
        fallbackText: '❌ Sorry, I had trouble processing your voice message.',
        inboundType: 'voice',
      }, error as Error);
    }
  }

  async handleAudio(ctx: Context): Promise<void> {
    if (!ctx.message || !('audio' in ctx.message)) return;

    const audio = ctx.message.audio;
    this.activityService.recordActivity('message_audio');
    await this.processAudioFile(ctx, audio);
  }

  async handleDocument(ctx: Context): Promise<void> {
    if (!ctx.message || !('document' in ctx.message)) return;

    const document = ctx.message.document;
    const userId = ctx.from?.id;

    if (this.fileService.isAudioFile(document.mime_type)) {
      this.activityService.recordActivity('message_document');
      const fileName = document.file_name || 'audio_file';
      const mimeType = document.mime_type || 'application/octet-stream';
      const chatId = ctx.chat?.id;
      const updateId = ctx.update && 'update_id' in ctx.update ? ctx.update.update_id : undefined;
      let inboundMessageId: string | undefined;
      let jobId: string | undefined;

      logger.info('Audio document received', {
        userId,
        fileName,
        mimeType,
        fileSize: document.file_size,
      });

      try {
        const fileUrl = await this.fileService.getFileUrl(document.file_id);
        const inboundMessage = userId && chatId
          ? await this.conversationStore?.createIncomingMessage({
              telegramUpdateId: updateId,
              telegramMessageId: ctx.message.message_id,
              chatId: chatId.toString(),
              userId: userId.toString(),
              messageType: 'audio_document',
              fileId: document.file_id,
              fileUrl,
              fileName,
              mimeType,
            })
          : null;
        inboundMessageId = inboundMessage?.id;
        const job = userId && chatId
          ? await this.jobStateService?.createJob({
              userId: userId.toString(),
              chatId: chatId.toString(),
              sourceMessageId: inboundMessage?.id,
              jobType: 'audio_document_processing',
              payload: {
                messageType: 'audio_document',
                input: {
                  text: null,
                  fileUrl,
                  fileName,
                  mimeType,
                },
                telegram: {
                  updateId: updateId ?? null,
                  messageId: ctx.message.message_id,
                },
              },
            })
          : null;
        jobId = job?.id;

        if (inboundMessage) {
          await this.conversationStore?.markMessageProcessing(inboundMessage.id, 'processing', undefined, job?.id);
        }
        if (job) {
          await this.jobStateService?.markInProgress(job.id);
        }

        const response = await this.messageProcessor.processAudioDocumentDetailed(
          fileUrl,
          fileName,
          mimeType,
          userId,
          {
            jobId,
            sourceMessageId: inboundMessageId,
            chatId: chatId?.toString(),
          },
        );
        await this.replyAndPersist(ctx, response, {
          inboundMessageId,
          jobId,
          userId,
          chatId,
          outgoingType: 'audio_document',
        });
      } catch (error) {
        logger.error('Error processing audio document', {
          error: (error as Error).message,
          userId,
          fileName,
        });
        await this.replyWithFailure(ctx, {
          userId,
          chatId: ctx.chat?.id,
          inboundMessageId,
          jobId,
          outgoingType: 'error',
          fallbackText: '❌ Sorry, I had trouble processing your audio document.',
          inboundType: 'audio_document',
        }, error as Error);
      }
    } else {
      logger.info('Non-audio document received', {
        userId,
        mimeType: document.mime_type,
        fileName: document.file_name
      });
      await ctx.reply('📄 I received a document, but I only process audio files. Please send an audio file.');
    }
  }

  async handleUnknown(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;

    logger.info('Unhandled message type received', {
      userId,
      messageType: 'unknown'
    });
    this.activityService.recordActivity('message_unknown');

    await ctx.reply(
      '🤔 I received your message, but I don\'t know how to handle this type yet. Try sending text or audio!'
    );
  }

  private async processAudioFile(ctx: Context, audioFile: any): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const updateId = ctx.update && 'update_id' in ctx.update ? ctx.update.update_id : undefined;
    const fileName = audioFile.file_name || 'audio_file';
    const mimeType = audioFile.mime_type;
    let inboundMessageId: string | undefined;
    let jobId: string | undefined;

    logger.info('Audio file received', {
      userId,
      fileName,
      mimeType,
      fileSize: audioFile.file_size,
      duration: audioFile.duration
    });

    try {
      const fileUrl = await this.fileService.getFileUrl(audioFile.file_id);
      const inboundMessage = userId && chatId
        ? await this.conversationStore?.createIncomingMessage({
            telegramUpdateId: updateId,
            telegramMessageId: ctx.message && 'message_id' in ctx.message ? ctx.message.message_id : undefined,
            chatId: chatId.toString(),
            userId: userId.toString(),
            messageType: 'audio',
            fileId: audioFile.file_id,
            fileUrl,
            fileName,
            mimeType,
          })
        : null;
      inboundMessageId = inboundMessage?.id;
      const job = userId && chatId
        ? await this.jobStateService?.createJob({
            userId: userId.toString(),
            chatId: chatId.toString(),
            sourceMessageId: inboundMessage?.id,
            jobType: 'voice_processing',
            payload: {
              messageType: 'audio',
              input: {
                text: null,
                fileUrl,
                fileName,
                mimeType,
              },
              telegram: {
                updateId: updateId ?? null,
                messageId: ctx.message && 'message_id' in ctx.message ? ctx.message.message_id : null,
              },
            },
          })
        : null;
      jobId = job?.id;

      if (inboundMessage) {
        await this.conversationStore?.markMessageProcessing(inboundMessage.id, 'processing', undefined, job?.id);
      }
      if (job) {
        await this.jobStateService?.markInProgress(job.id);
      }

      const response = await this.messageProcessor.processAudioMessageDetailed(fileUrl, userId, {
        jobId,
        sourceMessageId: inboundMessageId,
        chatId: chatId?.toString(),
      });
      await this.replyAndPersist(ctx, response, {
        inboundMessageId,
        jobId,
        userId,
        chatId,
        outgoingType: 'audio',
      });
    } catch (error) {
      logger.error('Error processing audio file', {
        error: (error as Error).message,
        userId,
        fileName
      });
      await this.replyWithFailure(ctx, {
        userId,
        chatId,
        inboundMessageId,
        jobId,
        outgoingType: 'error',
        fallbackText: '❌ Sorry, I had trouble processing your audio file.',
        inboundType: 'audio',
      }, error as Error);
    }
  }

  private async replyAndPersist(
    ctx: Context,
    response: ProcessorResponse,
    details: {
      inboundMessageId?: string;
      jobId?: string;
      userId?: number;
      chatId?: number;
      outgoingType: 'text' | 'audio' | 'audio_document';
    },
  ): Promise<void> {
    const reply = (await ctx.reply(response.responseText)) as Message.TextMessage;

    if (details.inboundMessageId) {
      await this.conversationStore?.markMessageProcessing(details.inboundMessageId, 'processed');
    }
    if (details.jobId) {
      await this.jobStateService?.markCompleted(details.jobId, {
        responseText: response.responseText,
        processingTimeMs: response.processingTimeMs ?? null,
        transcriptionText: response.transcriptionText ?? null,
      });
    }
    if (details.userId && details.chatId) {
      await this.conversationStore?.createOutgoingMessage({
        telegramMessageId: reply.message_id,
        chatId: details.chatId.toString(),
        userId: details.userId.toString(),
        messageType: details.outgoingType,
        contentText: response.responseText,
        replyToMessageId: details.inboundMessageId,
        jobId: details.jobId,
      });
      await this.usageTrackingService?.recordEvent({
        userId: details.userId.toString(),
        chatId: details.chatId.toString(),
        jobId: details.jobId,
        messageId: details.inboundMessageId,
        eventType: 'message_processed',
        durationMs: response.processingTimeMs,
        metadata: {
          responseLength: response.responseText.length,
          messageType: details.outgoingType,
        },
      });
    }
  }

  private async replyWithFailure(
    ctx: Context,
    details: {
      userId?: number;
      chatId?: number;
      inboundMessageId?: string;
      jobId?: string;
      outgoingType: 'error';
      fallbackText: string;
      inboundType: string;
    },
    error: Error,
  ): Promise<void> {
    const reply = (await ctx.reply(details.fallbackText)) as Message.TextMessage;

    if (details.inboundMessageId) {
      await this.conversationStore?.markMessageProcessing(
        details.inboundMessageId,
        'failed',
        error.message,
        details.jobId,
      );
    }
    if (details.jobId) {
      await this.jobStateService?.markFailed(details.jobId, error.message, {
        responseText: details.fallbackText,
      });
    }
    if (details.userId && details.chatId) {
      await this.conversationStore?.createOutgoingMessage({
        telegramMessageId: reply.message_id,
        chatId: details.chatId.toString(),
        userId: details.userId.toString(),
        messageType: details.outgoingType,
        contentText: details.fallbackText,
        status: 'processed',
        replyToMessageId: details.inboundMessageId,
        jobId: details.jobId,
      });
      await this.usageTrackingService?.recordEvent({
        userId: details.userId.toString(),
        chatId: details.chatId.toString(),
        jobId: details.jobId,
        messageId: details.inboundMessageId,
        eventType: 'error',
        metadata: {
          source: 'telegram_handler',
          inboundType: details.inboundType,
          error: error.message,
        },
      });
    }
  }
}
