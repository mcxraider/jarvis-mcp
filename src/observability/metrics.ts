const METRICS_ENABLED = process.env.METRICS_ENABLED !== 'false';

type Labels = Record<string, string>;

interface MetricRecord {
  value: number;
  labels: Labels;
}

interface HistogramRecord {
  sum: number;
  count: number;
  buckets: Map<number, number>;
  labels: Labels;
}

const metricHelp = new Map<string, string>();
const counters = new Map<string, Map<string, MetricRecord>>();
const gauges = new Map<string, Map<string, MetricRecord>>();
const histograms = new Map<string, Map<string, HistogramRecord>>();

const webhookBuckets = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const messageBuckets = [25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
const openAIBuckets = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
const toolBuckets = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

function isEnabled(): boolean {
  return METRICS_ENABLED;
}

function ensureHelp(name: string, help: string): void {
  if (!metricHelp.has(name)) {
    metricHelp.set(name, help);
  }
}

function serializeLabels(labels: Labels): string {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join('|');
}

function formatLabels(labels: Labels): string {
  const entries = Object.entries(labels).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return '';
  }

  return `{${entries
    .map(([key, value]) => `${key}="${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')}}`;
}

function incrementCounter(name: string, help: string, labels: Labels, value = 1): void {
  ensureHelp(name, help);
  const bucket = counters.get(name) || new Map<string, MetricRecord>();
  const key = serializeLabels(labels);
  const current = bucket.get(key) || { value: 0, labels };
  current.value += value;
  bucket.set(key, current);
  counters.set(name, bucket);
}

function setGauge(name: string, help: string, labels: Labels, value: number): void {
  ensureHelp(name, help);
  const bucket = gauges.get(name) || new Map<string, MetricRecord>();
  bucket.set(serializeLabels(labels), { value, labels });
  gauges.set(name, bucket);
}

function observeHistogram(
  name: string,
  help: string,
  labels: Labels,
  value: number,
  buckets: number[],
): void {
  ensureHelp(name, help);
  const histogram = histograms.get(name) || new Map<string, HistogramRecord>();
  const key = serializeLabels(labels);
  const current =
    histogram.get(key) ||
    ({
      sum: 0,
      count: 0,
      buckets: new Map<number, number>(buckets.map((bucket) => [bucket, 0])),
      labels,
    } satisfies HistogramRecord);

  current.sum += value;
  current.count += 1;
  for (const bucket of buckets) {
    if (value <= bucket) {
      current.buckets.set(bucket, (current.buckets.get(bucket) || 0) + 1);
    }
  }

  histogram.set(key, current);
  histograms.set(name, histogram);
}

type OpenAIUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export function recordWebhook(status: 'success' | 'rejected' | 'error', durationMs: number): void {
  if (!isEnabled()) return;
  incrementCounter(
    'jarvis_webhook_requests_total',
    'Total webhook requests by status',
    { status },
  );
  observeHistogram(
    'jarvis_webhook_duration_ms',
    'Webhook request duration in milliseconds',
    {},
    durationMs,
    webhookBuckets,
  );
}

export function recordTelegramUpdate(type: string): void {
  if (!isEnabled()) return;
  incrementCounter(
    'jarvis_telegram_updates_total',
    'Telegram updates processed by type',
    { type: type || 'unknown' },
  );
}

export function recordMessageProcessingDuration(messageType: string, durationMs: number): void {
  if (!isEnabled()) return;
  observeHistogram(
    'jarvis_message_processing_duration_ms',
    'Message processing duration by message type',
    { message_type: messageType || 'unknown' },
    durationMs,
    messageBuckets,
  );
}

export function recordMessageProcessingFailure(messageType: string, stage: string): void {
  if (!isEnabled()) return;
  incrementCounter(
    'jarvis_message_processing_failures_total',
    'Message processing failures by message type and stage',
    { message_type: messageType || 'unknown', stage: stage || 'unknown' },
  );
}

export function recordOpenAIRequest(
  labels: { model: string; operation: string; status: string },
  durationMs: number,
  usage?: OpenAIUsage,
): void {
  if (!isEnabled()) return;

  const safeLabels = {
    model: labels.model || 'unknown',
    operation: labels.operation || 'unknown',
    status: labels.status || 'unknown',
  };

  incrementCounter(
    'jarvis_openai_requests_total',
    'OpenAI requests by model, operation, and status',
    safeLabels,
  );
  observeHistogram(
    'jarvis_openai_request_duration_ms',
    'OpenAI request duration by model and operation',
    { model: safeLabels.model, operation: safeLabels.operation },
    durationMs,
    openAIBuckets,
  );

  if (usage?.promptTokens !== undefined) {
    incrementCounter(
      'jarvis_openai_tokens_total',
      'OpenAI token usage by model and direction',
      { model: safeLabels.model, direction: 'prompt' },
      usage.promptTokens,
    );
  }
  if (usage?.completionTokens !== undefined) {
    incrementCounter(
      'jarvis_openai_tokens_total',
      'OpenAI token usage by model and direction',
      { model: safeLabels.model, direction: 'completion' },
      usage.completionTokens,
    );
  }
  if (usage?.totalTokens !== undefined) {
    incrementCounter(
      'jarvis_openai_tokens_total',
      'OpenAI token usage by model and direction',
      { model: safeLabels.model, direction: 'total' },
      usage.totalTokens,
    );
  }
}

export function recordWhisperRequest(status: 'success' | 'error', durationMs: number): void {
  if (!isEnabled()) return;
  incrementCounter(
    'jarvis_whisper_requests_total',
    'Whisper requests by status',
    { status },
  );
  observeHistogram(
    'jarvis_whisper_duration_ms',
    'Whisper processing duration in milliseconds',
    {},
    durationMs,
    openAIBuckets,
  );
}

export function recordToolCall(tool: string, status: 'success' | 'error', durationMs: number): void {
  if (!isEnabled()) return;
  incrementCounter(
    'jarvis_tool_calls_total',
    'Tool calls by tool name and status',
    { tool: tool || 'unknown', status },
  );
  observeHistogram(
    'jarvis_tool_call_duration_ms',
    'Tool call duration by tool name',
    { tool: tool || 'unknown' },
    durationMs,
    toolBuckets,
  );
}

export function recordUncaughtError(kind: string): void {
  if (!isEnabled()) return;
  incrementCounter(
    'jarvis_uncaught_errors_total',
    'Uncaught process errors by kind',
    { kind: kind || 'unknown' },
  );
}

function renderCounter(name: string, values: Map<string, MetricRecord>): string[] {
  return Array.from(values.values()).map(
    (record) => `${name}${formatLabels(record.labels)} ${record.value}`,
  );
}

function renderGauge(name: string, values: Map<string, MetricRecord>): string[] {
  return Array.from(values.values()).map(
    (record) => `${name}${formatLabels(record.labels)} ${record.value}`,
  );
}

function renderHistogram(name: string, values: Map<string, HistogramRecord>): string[] {
  const lines: string[] = [];

  for (const value of values.values()) {
    const sortedBuckets = Array.from(value.buckets.entries()).sort(([left], [right]) => left - right);
    for (const [bucket, count] of sortedBuckets) {
      lines.push(`${name}_bucket${formatLabels({ ...value.labels, le: String(bucket) })} ${count}`);
    }
    lines.push(`${name}_bucket${formatLabels({ ...value.labels, le: '+Inf' })} ${value.count}`);
    lines.push(`${name}_sum${formatLabels(value.labels)} ${value.sum}`);
    lines.push(`${name}_count${formatLabels(value.labels)} ${value.count}`);
  }

  return lines;
}

export async function getMetricsSnapshot(): Promise<string> {
  if (!isEnabled()) {
    return '';
  }

  setGauge('jarvis_process_uptime_seconds', 'Current process uptime in seconds', {}, process.uptime());

  const lines: string[] = [];
  for (const [name, help] of metricHelp.entries()) {
    lines.push(`# HELP ${name} ${help}`);
    const type = counters.has(name) ? 'counter' : gauges.has(name) ? 'gauge' : 'histogram';
    lines.push(`# TYPE ${name} ${type}`);

    if (counters.has(name)) {
      lines.push(...renderCounter(name, counters.get(name)!));
    } else if (gauges.has(name)) {
      lines.push(...renderGauge(name, gauges.get(name)!));
    } else if (histograms.has(name)) {
      lines.push(...renderHistogram(name, histograms.get(name)!));
    }
  }

  return `${lines.join('\n')}\n`;
}

export function getMetricsContentType(): string {
  return 'text/plain; version=0.0.4; charset=utf-8';
}

export function resetMetrics(): void {
  counters.clear();
  gauges.clear();
  histograms.clear();
  metricHelp.clear();
}

export { METRICS_ENABLED };
