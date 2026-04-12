export interface ProcessingHooks {
  onStage?: (eventType: string, message?: string) => Promise<void> | void;
}
