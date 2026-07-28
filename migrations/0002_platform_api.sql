PRAGMA foreign_keys = ON;

CREATE TABLE platform_api_credentials (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  key_prefix TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  revoked_by TEXT,
  revoked_at TEXT
);

CREATE TABLE platform_webhook_events (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_external_id TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'rejected', 'failed')),
  payload_hash TEXT NOT NULL,
  error_code TEXT,
  UNIQUE(platform_id, external_event_id)
);

CREATE INDEX idx_platform_credentials_platform ON platform_api_credentials(platform_id, status);
CREATE INDEX idx_platform_webhooks_platform ON platform_webhook_events(platform_id, received_at);
