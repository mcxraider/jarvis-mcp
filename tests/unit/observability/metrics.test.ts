import {
  getMetricsContentType,
  getMetricsSnapshot,
  recordOpenAIRequest,
  recordWebhook,
  resetMetrics,
} from '../../../src/observability';

describe('observability metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('renders prometheus metrics text for recorded counters and histograms', async () => {
    recordWebhook('success', 42);
    recordOpenAIRequest(
      { model: 'gpt-4o', operation: 'simple_text', status: 'success' },
      120,
      { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
    );

    const output = await getMetricsSnapshot();

    expect(getMetricsContentType()).toContain('text/plain');
    expect(output).toContain('jarvis_webhook_requests_total{status="success"} 1');
    expect(output).toContain(
      'jarvis_openai_requests_total{model="gpt-4o",operation="simple_text",status="success"} 1',
    );
    expect(output).toContain('jarvis_openai_tokens_total{direction="total",model="gpt-4o"} 14');
    expect(output).toContain('jarvis_webhook_duration_ms_bucket');
  });
});
