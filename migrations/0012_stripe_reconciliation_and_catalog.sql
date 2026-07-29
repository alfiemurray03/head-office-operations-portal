PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stripe_division_customer_records (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  stripe_customer_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  email TEXT,
  name TEXT,
  phone TEXT,
  currency TEXT,
  balance_minor INTEGER NOT NULL DEFAULT 0,
  delinquent INTEGER NOT NULL DEFAULT 0 CHECK (delinquent IN (0,1)),
  tax_exempt TEXT,
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0,1)),
  source_created_at TEXT,
  source_updated_at TEXT,
  deleted_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connector_code,stripe_customer_id)
);

CREATE TABLE IF NOT EXISTS stripe_division_balance_transactions (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  stripe_transaction_id TEXT NOT NULL,
  source_id TEXT,
  transaction_type TEXT NOT NULL,
  reporting_category TEXT,
  status TEXT,
  amount_minor INTEGER NOT NULL,
  fee_minor INTEGER NOT NULL DEFAULT 0,
  net_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  description TEXT,
  exchange_rate REAL,
  source_created_at TEXT NOT NULL,
  available_on TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connector_code,stripe_transaction_id)
);

CREATE TABLE IF NOT EXISTS stripe_division_refund_records (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  stripe_refund_id TEXT NOT NULL,
  charge_id TEXT,
  payment_intent_id TEXT,
  stripe_customer_id TEXT,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  status TEXT,
  reason TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  description TEXT,
  failure_reason TEXT,
  source_created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connector_code,stripe_refund_id)
);

CREATE TABLE IF NOT EXISTS stripe_division_dispute_records (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  stripe_dispute_id TEXT NOT NULL,
  charge_id TEXT,
  payment_intent_id TEXT,
  stripe_customer_id TEXT,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL,
  evidence_due_by TEXT,
  is_charge_refundable INTEGER NOT NULL DEFAULT 0 CHECK (is_charge_refundable IN (0,1)),
  source_created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connector_code,stripe_dispute_id)
);

CREATE TABLE IF NOT EXISTS stripe_division_product_records (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  stripe_product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  default_price_id TEXT,
  statement_descriptor TEXT,
  unit_label TEXT,
  shippable INTEGER CHECK (shippable IN (0,1)),
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0,1)),
  source_created_at TEXT,
  source_updated_at TEXT,
  deleted_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connector_code,stripe_product_id)
);

CREATE TABLE IF NOT EXISTS stripe_division_price_records (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  stripe_price_id TEXT NOT NULL,
  stripe_product_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  currency TEXT,
  unit_amount_minor INTEGER,
  price_type TEXT,
  recurring_interval TEXT,
  recurring_interval_count INTEGER,
  usage_type TEXT,
  lookup_key TEXT,
  nickname TEXT,
  tax_behavior TEXT,
  billing_scheme TEXT,
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0,1)),
  source_created_at TEXT,
  deleted_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connector_code,stripe_price_id)
);

CREATE TABLE IF NOT EXISTS stripe_division_sync_checkpoints (
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  resource_name TEXT NOT NULL,
  cursor TEXT,
  backfill_complete INTEGER NOT NULL DEFAULT 0 CHECK (backfill_complete IN (0,1)),
  last_started_at TEXT,
  last_completed_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(connector_code,resource_name)
);

CREATE TABLE IF NOT EXISTS stripe_division_sync_runs (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  sync_mode TEXT NOT NULL CHECK (sync_mode IN ('full','recent')),
  status TEXT NOT NULL CHECK (status IN ('running','completed','partial','failed')),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  stats_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_stripe_customer_records_connector
  ON stripe_division_customer_records(connector_code,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_balance_transactions_connector
  ON stripe_division_balance_transactions(connector_code,source_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_refunds_connector
  ON stripe_division_refund_records(connector_code,source_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_disputes_connector
  ON stripe_division_dispute_records(connector_code,source_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_products_connector
  ON stripe_division_product_records(connector_code,active,name);
CREATE INDEX IF NOT EXISTS idx_stripe_prices_connector
  ON stripe_division_price_records(connector_code,active,stripe_product_id);
CREATE INDEX IF NOT EXISTS idx_stripe_sync_runs_connector
  ON stripe_division_sync_runs(connector_code,started_at DESC);
