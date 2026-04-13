import { MessageProcessorService } from '../../telegram/message-processor.service';
import { JobContext, JobExecutionResult, JobProcessor } from '../../../types/job.types';

export class TextJobProcessor implements JobProcessor {
  constructor(private readonly messageProcessor: MessageProcessorService) {}

  async process(context: JobContext): Promise<JobExecutionResult> {
    await context.progressReporter.report('job.started');
    await context.progressReporter.report('gpt.processing');

    const finalMessage = await this.messageProcessor.processTextMessage(
      context.payload.text || '',
      Number(context.job.userId),
      {
        jobId: context.job.id,
        sourceMessageId: context.job.messageId || undefined,
        chatId: context.job.chatId,
        onStage: async (eventType, message) => {
          await context.progressReporter.report(eventType, message);
        },
      },
    );

    return {
      finalMessage,
      metrics: {
        attempts: context.job.attempts,
      },
    };
  }
}
