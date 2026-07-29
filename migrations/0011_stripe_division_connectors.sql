PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stripe_division_webhook_events (
  event_key TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0,1)),
  api_version TEXT,
  object_id TEXT,
  customer_reference TEXT,
  processing_status TEXT NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received','processed','ignored','failed')),
  payload_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error_message TEXT,
  UNIQUE(connector_code,event_id)
);

CREATE TABLE IF NOT EXISTS stripe_division_customer_links (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  stripe_customer_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  email TEXT,
  name TEXT,
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(connector_code,stripe_customer_id)
);

CREATE TABLE IF NOT EXISTS stripe_division_payment_records (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  stripe_object_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  stripe_customer_id TEXT,
  platform_code TEXT NOT NULL,
  status TEXT,
  amount_minor INTEGER,
  currency TEXT,
  description TEXT,
  receipt_email TEXT,
  occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(connector_code,stripe_object_id)
);

CREATE TABLE IF NOT EXISTS stripe_division_order_records (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  stripe_object_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  stripe_customer_id TEXT,
  platform_code TEXT NOT NULL,
  status TEXT,
  payment_status TEXT,
  amount_total_minor INTEGER,
  currency TEXT,
  customer_email TEXT,
  occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(connector_code,stripe_object_id)
);

CREATE TABLE IF NOT EXISTS stripe_division_subscription_records (
  id TEXT PRIMARY KEY,
  connector_code TEXT NOT NULL CHECK (connector_code IN ('PLANYX','PROFILE_CENTRE')),
  stripe_subscription_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  stripe_customer_id TEXT,
  platform_code TEXT NOT NULL,
  status TEXT NOT NULL,
  price_id TEXT,
  product_id TEXT,
  quantity INTEGER,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0,1)),
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(connector_code,stripe_subscription_id)
);

CREATE INDEX IF NOT EXISTS idx_stripe_division_events
  ON stripe_division_webhook_events(connector_code,received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_division_links
  ON stripe_division_customer_links(connector_code,stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_stripe_division_payments
  ON stripe_division_payment_records(connector_code,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_division_orders
  ON stripe_division_order_records(connector_code,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_division_subscriptions
  ON stripe_division_subscription_records(connector_code,updated_at DESC);
