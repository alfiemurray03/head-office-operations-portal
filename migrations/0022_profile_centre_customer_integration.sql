PRAGMA foreign_keys = ON;

ALTER TABLE customer_platform_accounts ADD COLUMN platform_code TEXT;
ALTER TABLE customer_platform_accounts ADD COLUMN external_person_id TEXT;
ALTER TABLE customer_platform_accounts ADD COLUMN registration_date TEXT;
ALTER TABLE customer_platform_accounts ADD COLUMN last_activity_date TEXT;
ALTER TABLE customer_platform_accounts ADD COLUMN source_system TEXT;
ALTER TABLE customer_platform_accounts ADD COLUMN synchronisation_status TEXT NOT NULL DEFAULT 'linked';
ALTER TABLE customer_platform_accounts ADD COLUMN updated_at TEXT;
ALTER TABLE customer_platform_accounts ADD COLUMN secure_record_url TEXT;

UPDATE customer_platform_accounts
SET platform_code = COALESCE(platform_code, (SELECT code FROM platforms WHERE platforms.id=customer_platform_accounts.platform_id)),
    source_system = COALESCE(source_system, (SELECT name FROM platforms WHERE platforms.id=customer_platform_accounts.platform_id)),
    registration_date = COALESCE(registration_date, linked_at),
    last_activity_date = COALESCE(last_activity_date, last_synced_at),
    updated_at = COALESCE(updated_at, last_synced_at, linked_at),
    synchronisation_status = COALESCE(NULLIF(synchronisation_status,''), 'linked');

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_platform_account_identity
  ON customer_platform_accounts(platform_id, external_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_platform_person_identity
  ON customer_platform_accounts(platform_id, external_person_id)
  WHERE external_person_id IS NOT NULL AND TRIM(external_person_id)<>'';
CREATE INDEX IF NOT EXISTS idx_customer_platform_customer_code
  ON customer_platform_accounts(customer_id, platform_code);
CREATE INDEX IF NOT EXISTS idx_customer_platform_ucn_lookup
  ON customers(customer_number);
CREATE INDEX IF NOT EXISTS idx_customer_platform_sync_status
  ON customer_platform_accounts(platform_code, synchronisation_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS platform_reconciliation_failures (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  platform_code TEXT NOT NULL,
  external_account_id TEXT NOT NULL,
  external_person_id TEXT,
  supplied_customer_id TEXT,
  supplied_customer_number TEXT,
  reason_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unresolved' CHECK(status IN ('unresolved','resolved','dismissed')),
  safe_metadata_json TEXT NOT NULL DEFAULT '{}',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_customer_id TEXT REFERENCES customers(id),
  UNIQUE(platform_id, external_account_id, reason_code)
);
CREATE INDEX IF NOT EXISTS idx_platform_reconciliation_status
  ON platform_reconciliation_failures(platform_code, status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS platform_customer_event_receipts (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  external_event_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  platform_account_link_id TEXT NOT NULL REFERENCES customer_platform_accounts(id),
  event_type TEXT NOT NULL,
  event_category TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_identifier TEXT,
  outcome TEXT NOT NULL,
  target_type TEXT,
  target_reference TEXT,
  correlation_id TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  safe_metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(platform_id, external_event_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_customer_event_customer
  ON platform_customer_event_receipts(customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_customer_event_idempotency
  ON platform_customer_event_receipts(platform_id, external_event_id);

