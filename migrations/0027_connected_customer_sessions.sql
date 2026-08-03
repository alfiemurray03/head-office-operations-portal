PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS connected_customer_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  external_session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','revocation_required','revoked','expired','signed_out')),
  device_category TEXT,
  device_name TEXT,
  browser_name TEXT,
  operating_system TEXT,
  user_agent_summary TEXT,
  country_code TEXT,
  country_name TEXT,
  region_name TEXT,
  city_name TEXT,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT,
  revocation_requested_at TEXT,
  revoked_at TEXT,
  signed_out_at TEXT,
  revocation_source TEXT,
  revocation_actor TEXT,
  revocation_reason TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform_id, external_session_id)
);

CREATE INDEX IF NOT EXISTS idx_connected_sessions_customer_status
  ON connected_customer_sessions(customer_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_connected_sessions_platform_status
  ON connected_customer_sessions(platform_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_connected_sessions_expiry
  ON connected_customer_sessions(status, expires_at)
  WHERE expires_at IS NOT NULL;
