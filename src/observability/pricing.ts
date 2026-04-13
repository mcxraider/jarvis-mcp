const OPENAI_PRICING_USD_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.005, output: 0.015 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o-transcribe': { input: 0.006, output: 0 },
};

export interface CostEstimateInput {
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

export function estimateOpenAICostUsd({
  model,
  promptTokens = 0,
  completionTokens = 0,
}: CostEstimateInput): number | undefined {
  const pricing = OPENAI_PRICING_USD_PER_1K_TOKENS[model];
  if (!pricing) {
    return undefined;
  }

  return Number(
    (
      (promptTokens / 1000) * pricing.input +
      (completionTokens / 1000) * pricing.output
    ).toFixed(6),
  );
}
