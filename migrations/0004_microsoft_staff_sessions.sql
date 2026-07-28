CREATE TABLE IF NOT EXISTS microsoft_staff_sessions (
  token_hash TEXT PRIMARY KEY,
  session_json TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_microsoft_staff_sessions_expiry
  ON microsoft_staff_sessions(expires_at);
