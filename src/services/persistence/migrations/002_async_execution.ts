export const migration002AsyncExecution = `
ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 100;
ALTER TABLE jobs ADD COLUMN concurrency_key TEXT;
ALTER TABLE jobs ADD COLUMN dedupe_key TEXT;
ALTER TABLE jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 2;
ALTER TABLE jobs ADD COLUMN locked_at TEXT;
ALTER TABLE jobs ADD COLUMN worker_id TEXT;
ALTER TABLE jobs ADD COLUMN superseded_by_job_id TEXT;
ALTER TABLE jobs ADD COLUMN ack_message_id TEXT;
ALTER TABLE jobs ADD COLUMN progress_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created_at
  ON jobs (status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_concurrency_key_status
  ON jobs (concurrency_key, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe_key
  ON jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_job_events_job_id_created_at
  ON job_events (job_id, created_at);
`;
