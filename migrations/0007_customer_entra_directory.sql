PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customer_directory_connectors (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  tenant_id TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (status IN ('not_configured','configured','testing','connected','syncing','degraded','suspended')),
  delta_link TEXT,
  last_tested_at TEXT,
  last_sync_started_at TEXT,
  last_sync_completed_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  users_discovered INTEGER NOT NULL DEFAULT 0,
  users_linked INTEGER NOT NULL DEFAULT 0,
  users_review_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_directory_identities (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  connector_id TEXT NOT NULL REFERENCES customer_directory_connectors(id),
  provider TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  given_name TEXT,
  surname TEXT,
  primary_email TEXT,
  user_principal_name TEXT,
  account_enabled INTEGER NOT NULL DEFAULT 1 CHECK (account_enabled IN (0,1)),
  directory_status TEXT NOT NULL DEFAULT 'active'
    CHECK (directory_status IN ('active','disabled','deleted','review_required')),
  identities_json TEXT NOT NULL DEFAULT '[]',
  source_created_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider, tenant_id, object_id)
);

CREATE TABLE IF NOT EXISTS customer_directory_reviews (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES customer_directory_connectors(id),
  identity_id TEXT NOT NULL REFERENCES customer_directory_identities(id),
  review_type TEXT NOT NULL CHECK (review_type IN ('email_match','email_conflict','missing_email','multiple_match','manual_review')),
  proposed_customer_id TEXT REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','linked','new_customer_created','dismissed')),
  reason TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(identity_id, review_type, status)
);

CREATE TABLE IF NOT EXISTS customer_directory_sync_runs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES customer_directory_connectors(id),
  mode TEXT NOT NULL CHECK (mode IN ('initial','full','delta','test')),
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled')),
  started_by TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  pages_processed INTEGER NOT NULL DEFAULT 0,
  users_received INTEGER NOT NULL DEFAULT 0,
  customers_created INTEGER NOT NULL DEFAULT 0,
  customers_updated INTEGER NOT NULL DEFAULT 0,
  identities_linked INTEGER NOT NULL DEFAULT 0,
  review_items_created INTEGER NOT NULL DEFAULT 0,
  disabled_accounts INTEGER NOT NULL DEFAULT 0,
  deleted_accounts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_directory_identity_customer ON customer_directory_identities(customer_id, directory_status);
CREATE INDEX IF NOT EXISTS idx_directory_identity_object ON customer_directory_identities(tenant_id, object_id);
CREATE INDEX IF NOT EXISTS idx_directory_identity_email ON customer_directory_identities(primary_email);
CREATE INDEX IF NOT EXISTS idx_directory_reviews_status ON customer_directory_reviews(status, created_at);
CREATE INDEX IF NOT EXISTS idx_directory_sync_runs ON customer_directory_sync_runs(started_at DESC);
