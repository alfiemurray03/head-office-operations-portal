PRAGMA foreign_keys = ON;

-- A successful Microsoft principal session must complete a separate personal
-- PIN challenge before protected Head Office APIs are released.
ALTER TABLE portal_sessions ADD COLUMN pin_verified_at TEXT;

CREATE TABLE principal_pin_credentials (
  portal_user_id TEXT PRIMARY KEY REFERENCES portal_users(id) ON DELETE CASCADE,
  pin_salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  hash_algorithm TEXT NOT NULL DEFAULT 'PBKDF2-SHA-256' CHECK (hash_algorithm = 'PBKDF2-SHA-256'),
  hash_iterations INTEGER NOT NULL CHECK (hash_iterations >= 100000 AND hash_iterations <= 1000000),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','reset_required','disabled')),
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0 AND failed_attempts <= 4),
  locked_until TEXT,
  last_failed_at TEXT,
  last_verified_at TEXT,
  configured_at TEXT NOT NULL,
  configured_session_id TEXT REFERENCES portal_sessions(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE principal_pin_events (
  id TEXT PRIMARY KEY,
  portal_user_id TEXT NOT NULL REFERENCES portal_users(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES portal_sessions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('configured','verified','failed','locked','reset_required','disabled')),
  source_ip_hash TEXT,
  user_agent TEXT,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE customer_notices (
  id TEXT PRIMARY KEY,
  notice_reference TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  platform_id TEXT REFERENCES platforms(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'service' CHECK (category IN ('service','account','security','billing','complaint','data_protection','safeguarding','general')),
  severity TEXT NOT NULL DEFAULT 'information' CHECK (severity IN ('information','important','urgent','critical')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  action_label TEXT,
  action_href TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','withdrawn','expired')),
  published_at TEXT,
  expires_at TEXT,
  created_by TEXT NOT NULL REFERENCES portal_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE customer_notice_receipts (
  notice_id TEXT NOT NULL REFERENCES customer_notices(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  platform_id TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  external_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'delivered' CHECK (status IN ('delivered','read','dismissed')),
  delivered_at TEXT NOT NULL,
  first_read_at TEXT,
  dismissed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (notice_id, customer_id, platform_id)
);

CREATE INDEX idx_principal_pin_events_user ON principal_pin_events(portal_user_id, occurred_at DESC);
CREATE INDEX idx_principal_pin_lockout ON principal_pin_credentials(status, locked_until);
CREATE INDEX idx_customer_notices_customer ON customer_notices(customer_id, status, published_at DESC);
CREATE INDEX idx_customer_notices_platform ON customer_notices(platform_id, status, published_at DESC);
CREATE INDEX idx_customer_notice_receipts_customer ON customer_notice_receipts(customer_id, platform_id, status, updated_at DESC);
