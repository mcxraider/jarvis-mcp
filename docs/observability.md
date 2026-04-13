# Observability

Jarvis now exposes a local-first observability surface:

- Structured JSON logs with request-scoped correlation fields
- `/metrics` in Prometheus text format
- Token and latency metrics for OpenAI requests
- Whisper and tool execution timing/failure metrics

## Correlation fields

Every inbound webhook request creates a `requestId`. That context is threaded through the Telegram update pipeline and can include:

- `requestId`
- `updateId`
- `chatId`
- `userId`
- `messageType`
- `jobId` for future async work
- `component`
- `stage`

## Log behavior

Logs are JSON by default and redact:

- `BOT_TOKEN`
- `TELEGRAM_SECRET_TOKEN`
- `OPENAI_API_KEY`
- `TODOIST_API_KEY`
- Telegram file download URLs

User message bodies are not logged directly. The system records lengths, counts, IDs, and hashes instead.

## Metrics

Use the metrics endpoint locally:

```bash
curl http://localhost:3000/metrics
```

Primary metrics exposed:

- `jarvis_webhook_requests_total`
- `jarvis_webhook_duration_ms`
- `jarvis_telegram_updates_total`
- `jarvis_message_processing_duration_ms`
- `jarvis_message_processing_failures_total`
- `jarvis_openai_requests_total`
- `jarvis_openai_request_duration_ms`
- `jarvis_openai_tokens_total`
- `jarvis_whisper_requests_total`
- `jarvis_whisper_duration_ms`
- `jarvis_tool_calls_total`
- `jarvis_tool_call_duration_ms`
- `jarvis_process_uptime_seconds`
- `jarvis_uncaught_errors_total`

## Suggested local dashboard panels

- Webhook request rate and error rate
- Webhook p50/p95 latency
- OpenAI request latency by operation
- OpenAI token volume over time
- Whisper success/error count and latency
- Tool call success/error count by tool
- Fatal runtime error count

## Useful env vars

```env
LOG_LEVEL=debug
LOG_PRETTY=false
METRICS_ENABLED=true
SERVICE_NAME=jarvis-mcp
SERVICE_VERSION=1.0.0
```
