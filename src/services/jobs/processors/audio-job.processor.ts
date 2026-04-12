import { MessageProcessorService } from '../../telegram/message-processor.service';
import { FileService } from '../../telegram/file.service';
import { JobContext, JobExecutionResult, JobProcessor } from '../../../types/job.types';

export class AudioJobProcessor implements JobProcessor {
  constructor(
    private readonly messageProcessor: MessageProcessorService,
    private readonly fileService: FileService,
  ) {}

  async process(context: JobContext): Promise<JobExecutionResult> {
    await context.progressReporter.report('job.started');
    await context.progressReporter.report('media.downloading');

    const fileId = context.payload.fileId;
    if (!fileId) {
      throw new Error('Audio job is missing file_id');
    }

    const fileUrl = await this.fileService.getFileUrl(fileId);
    const finalMessage =
      context.job.type === 'audio_document'
        ? await this.messageProcessor.processAudioDocument(
            fileUrl,
            context.payload.fileName || 'audio_file',
            context.payload.mimeType || 'application/octet-stream',
            context.job.userId,
            {
              onStage: async (eventType, message) => {
                await context.progressReporter.report(eventType, message);
              },
            },
            context.job.id,
          )
        : await this.messageProcessor.processAudioMessage(
            fileUrl,
            context.job.userId,
            {
              onStage: async (eventType, message) => {
                await context.progressReporter.report(eventType, message);
              },
            },
            context.job.id,
          );

    return {
      finalMessage,
      metrics: {
        attempts: context.job.attempts,
      },
    };
  }
}
