PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS identity_verification_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  platform_id TEXT REFERENCES platforms(id),
  restriction_id TEXT REFERENCES restrictions(id),
  provider TEXT NOT NULL DEFAULT 'didit',
  provider_session_id TEXT NOT NULL UNIQUE,
  workflow_id TEXT,
  environment TEXT NOT NULL DEFAULT 'live',
  status TEXT NOT NULL DEFAULT 'Not Started',
  decision TEXT,
  verification_url_hash TEXT,
  vendor_data TEXT NOT NULL,
  return_url TEXT,
  consent_recorded_at TEXT,
  consent_version TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  expires_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS identity_verification_webhook_events (
  event_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'didit',
  provider_session_id TEXT,
  webhook_type TEXT NOT NULL,
  status TEXT,
  environment TEXT,
  signature_method TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received',
  error_message TEXT,
  payload_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_identity_verification_customer
  ON identity_verification_sessions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_verification_restriction
  ON identity_verification_sessions(restriction_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_verification_status
  ON identity_verification_sessions(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_identity_verification_webhook_session
  ON identity_verification_webhook_events(provider_session_id, received_at DESC);
