PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS platform_operational_profiles (
  platform_id TEXT PRIMARY KEY REFERENCES platforms(id),
  public_url TEXT,
  environment TEXT NOT NULL DEFAULT 'production',
  hosting_provider TEXT,
  release_version TEXT,
  release_commit TEXT,
  health_status TEXT NOT NULL DEFAULT 'awaiting_connection'
    CHECK (health_status IN ('awaiting_connection','operational','degraded','maintenance','offline','disabled')),
  health_message TEXT,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  integrations_json TEXT NOT NULL DEFAULT '{}',
  customer_count INTEGER NOT NULL DEFAULT 0,
  active_session_count INTEGER NOT NULL DEFAULT 0,
  open_error_count INTEGER NOT NULL DEFAULT 0,
  last_heartbeat_at TEXT,
  last_deployment_at TEXT,
  last_customer_sync_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_heartbeats (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  environment TEXT NOT NULL,
  health_status TEXT NOT NULL,
  health_message TEXT,
  release_version TEXT,
  release_commit TEXT,
  customer_count INTEGER NOT NULL DEFAULT 0,
  active_session_count INTEGER NOT NULL DEFAULT 0,
  open_error_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_deployments (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  external_deployment_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  release_version TEXT,
  commit_sha TEXT,
  status TEXT NOT NULL,
  deployed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  received_at TEXT NOT NULL,
  UNIQUE(platform_id, external_deployment_id)
);

CREATE TABLE IF NOT EXISTS customer_platform_snapshots (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  platform_account_id TEXT NOT NULL,
  account_status TEXT NOT NULL DEFAULT 'active',
  plan_code TEXT,
  subscription_status TEXT,
  entitlement_json TEXT NOT NULL DEFAULT '{}',
  registered_at TEXT,
  last_sign_in_at TEXT,
  last_activity_at TEXT,
  data_classification TEXT NOT NULL DEFAULT 'customer_confidential',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  last_synced_at TEXT NOT NULL,
  UNIQUE(customer_id, platform_id),
  UNIQUE(platform_id, platform_account_id)
);

CREATE TABLE IF NOT EXISTS customer_subscriptions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  provider TEXT NOT NULL,
  provider_customer_reference TEXT,
  provider_subscription_reference TEXT NOT NULL,
  plan_code TEXT,
  plan_name TEXT,
  status TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
  started_at TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0 CHECK (cancel_at_period_end IN (0,1)),
  cancelled_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(provider, provider_subscription_reference)
);

CREATE TABLE IF NOT EXISTS customer_orders (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  provider TEXT,
  provider_order_reference TEXT NOT NULL,
  order_type TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT CHECK (currency IS NULL OR length(currency) = 3),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(platform_id, provider_order_reference)
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  external_session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','revocation_required','revoked','expired','signed_out')),
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT,
  device_summary TEXT,
  ip_country TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(platform_id, external_session_id)
);

CREATE TABLE IF NOT EXISTS customer_security_events (
  id TEXT PRIMARY KEY,
  external_event_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'information'
    CHECK (severity IN ('information','low','moderate','high','critical')),
  outcome TEXT,
  session_reference TEXT,
  ip_country TEXT,
  device_summary TEXT,
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(platform_id, external_event_id)
);

CREATE TABLE IF NOT EXISTS fraud_signals (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  platform_id TEXT REFERENCES platforms(id),
  source_event_id TEXT,
  signal_type TEXT NOT NULL,
  risk_score INTEGER NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  severity TEXT NOT NULL DEFAULT 'moderate'
    CHECK (severity IN ('low','moderate','high','critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','under_review','confirmed','dismissed','resolved')),
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_enforcement_commands (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  restriction_id TEXT REFERENCES restrictions(id),
  command TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivered','acknowledged','failed','cancelled')),
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  acknowledged_at TEXT,
  result_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS customer_access_decisions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  decision TEXT NOT NULL CHECK (decision IN ('allow','deny','step_up','review')),
  revoke_sessions INTEGER NOT NULL DEFAULT 0 CHECK (revoke_sessions IN (0,1)),
  reason TEXT NOT NULL,
  restrictions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_timeline_events (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  platform_id TEXT REFERENCES platforms(id),
  event_type TEXT NOT NULL,
  event_category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  occurred_at TEXT NOT NULL,
  source_reference TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_platform_heartbeat_latest ON platform_heartbeats(platform_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_deployments_latest ON platform_deployments(platform_id, deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_snapshots_customer ON customer_platform_snapshots(customer_id, last_synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON customer_subscriptions(customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON customer_orders(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_sessions_active ON customer_sessions(customer_id, platform_id, status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_customer ON customer_security_events(customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_customer ON fraud_signals(customer_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_enforcement_platform ON platform_enforcement_commands(platform_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_access_decisions_customer ON customer_access_decisions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_timeline ON customer_timeline_events(customer_id, occurred_at DESC);
