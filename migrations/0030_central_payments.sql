PRAGMA foreign_keys = ON;

-- JA Group Services Ltd — Central Payments
-- Board-approved central payment control plane for the Sousa Murray brand family.

CREATE TABLE IF NOT EXISTS central_payment_schema_state (
  schema_key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS central_payment_catalogue_products (
  id TEXT PRIMARY KEY,
  brand_code TEXT NOT NULL,
  product_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  service_type TEXT NOT NULL DEFAULT 'service',
  stripe_product_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS central_payment_catalogue_prices (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  price_code TEXT NOT NULL UNIQUE,
  stripe_price_id TEXT NOT NULL UNIQUE,
  amount_minor INTEGER,
  currency TEXT NOT NULL DEFAULT 'GBP',
  billing_type TEXT NOT NULL DEFAULT 'one_time',
  recurring_interval TEXT,
  recurring_interval_count INTEGER,
  tax_behavior TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES central_payment_catalogue_products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS central_payment_customer_links (
  customer_id TEXT PRIMARY KEY,
  customer_number TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS central_payment_platform_origins (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform_id, origin),
  FOREIGN KEY (platform_id) REFERENCES platforms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS central_payment_checkout_requests (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL,
  brand_code TEXT NOT NULL,
  product_code TEXT NOT NULL,
  price_code TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  customer_number TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  stripe_checkout_session_id TEXT UNIQUE,
  order_reference TEXT,
  service_reference TEXT,
  success_url TEXT NOT NULL,
  cancel_url TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  amount_minor INTEGER,
  currency TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (platform_id) REFERENCES platforms(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS central_payment_transactions (
  id TEXT PRIMARY KEY,
  stripe_object_id TEXT NOT NULL UNIQUE,
  object_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  platform_id TEXT,
  brand_code TEXT,
  product_code TEXT,
  price_code TEXT,
  customer_id TEXT,
  customer_number TEXT,
  stripe_customer_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_subscription_id TEXT,
  stripe_invoice_id TEXT,
  order_reference TEXT,
  service_reference TEXT,
  status TEXT,
  amount_minor INTEGER,
  currency TEXT,
  occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS central_payment_subscriptions (
  id TEXT PRIMARY KEY,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  platform_id TEXT,
  brand_code TEXT,
  product_code TEXT,
  price_code TEXT,
  customer_id TEXT,
  customer_number TEXT,
  stripe_customer_id TEXT,
  status TEXT NOT NULL,
  quantity INTEGER,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  cancelled_at TEXT,
  order_reference TEXT,
  service_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS central_payment_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  livemode INTEGER NOT NULL DEFAULT 0,
  api_version TEXT,
  object_id TEXT,
  payload_hash TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  received_at TEXT NOT NULL,
  processed_at TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS central_payment_event_outbox (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  central_reference TEXT,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  UNIQUE(platform_id, event_type, central_reference)
);

CREATE INDEX IF NOT EXISTS idx_central_prices_product
  ON central_payment_catalogue_prices(product_id, status);
CREATE INDEX IF NOT EXISTS idx_central_checkout_customer
  ON central_payment_checkout_requests(customer_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_central_checkout_platform
  ON central_payment_checkout_requests(platform_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_central_tx_customer
  ON central_payment_transactions(customer_number, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_central_tx_brand
  ON central_payment_transactions(brand_code, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_central_sub_customer
  ON central_payment_subscriptions(customer_number, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_central_outbox_platform
  ON central_payment_event_outbox(platform_id, status, created_at);

INSERT INTO central_payment_schema_state(schema_key, version, applied_at)
VALUES ('central_payments', 2, CURRENT_TIMESTAMP)
ON CONFLICT(schema_key) DO UPDATE SET
  version = excluded.version,
  applied_at = excluded.applied_at;
