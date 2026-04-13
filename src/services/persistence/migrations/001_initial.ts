export const migration001Initial = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  telegram_update_id INTEGER,
  telegram_message_id INTEGER,
  chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  message_type TEXT NOT NULL,
  content_text TEXT,
  file_id TEXT,
  file_url TEXT,
  file_name TEXT,
  mime_type TEXT,
  reply_to_message_id TEXT,
  job_id TEXT,
  status TEXT NOT NULL DEFAULT 'processed',
  error_message TEXT,
  created_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_update_direction
  ON messages (telegram_update_id, direction)
  WHERE telegram_update_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_user_created_at ON messages (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_chat_created_at ON messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_job_id ON messages (job_id);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  source_message_id TEXT,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_created_at ON jobs (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_chat_created_at ON jobs (chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_status_created_at ON jobs (status, created_at);

CREATE TABLE IF NOT EXISTS pending_clarifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  source_message_id TEXT,
  job_id TEXT,
  status TEXT NOT NULL,
  intent_name TEXT,
  confidence_score REAL,
  question_text TEXT NOT NULL,
  proposed_action_json TEXT,
  answer_message_id TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_clarifications_active_user_chat
  ON pending_clarifications (user_id, chat_id)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_pending_clarifications_user_status_created
  ON pending_clarifications (user_id, status, created_at);

CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  preference_key TEXT NOT NULL,
  preference_value_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_preferences_user_key
  ON user_preferences (user_id, preference_key);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  chat_id TEXT,
  job_id TEXT,
  message_id TEXT,
  event_type TEXT NOT NULL,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd REAL,
  duration_ms INTEGER,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_created_at ON usage_events (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_job_created_at ON usage_events (job_id, created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_type_created_at ON usage_events (event_type, created_at);
`;
