PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS security_marker_definitions (
  marker_type TEXT PRIMARY KEY REFERENCES security_marker_types(code),
  marker_code TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  crm_display_label TEXT NOT NULL,
  branch_instruction TEXT NOT NULL,
  customer_visible INTEGER NOT NULL DEFAULT 0 CHECK (customer_visible IN (0,1)),
  site_enforcement TEXT NOT NULL DEFAULT 'display_only'
    CHECK (site_enforcement IN ('display_only','step_up','manual_review','deny_sensitive_action')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_marker_references (
  marker_id TEXT PRIMARY KEY REFERENCES security_markers(id),
  marker_reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_notification_deliveries (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  notification_type TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'resend',
  recipient_email TEXT NOT NULL,
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','sent','failed','suppressed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(customer_id, notification_type)
);

CREATE TABLE IF NOT EXISTS platform_lockdowns (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  incident_reference TEXT NOT NULL,
  reason TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'critical' CHECK (severity='critical'),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','lifted','cancelled')),
  manual_initiation INTEGER NOT NULL DEFAULT 1 CHECK (manual_initiation=1),
  initiated_by TEXT NOT NULL,
  initiated_at TEXT NOT NULL,
  lifted_by TEXT,
  lifted_at TEXT,
  lift_reason TEXT,
  review_at TEXT
);

CREATE TABLE IF NOT EXISTS platform_security_commands (
  id TEXT PRIMARY KEY,
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  lockdown_id TEXT REFERENCES platform_lockdowns(id),
  command TEXT NOT NULL CHECK (command IN ('ENTER_SECURITY_LOCKDOWN','EXIT_SECURITY_LOCKDOWN','REFRESH_SECURITY_MARKERS')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','delivered','acknowledged','failed','cancelled')),
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  acknowledged_at TEXT,
  result_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
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
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS stripe_customer_links (
  stripe_customer_id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  email TEXT,
  name TEXT,
  livemode INTEGER NOT NULL DEFAULT 0 CHECK (livemode IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_payment_records (
  stripe_object_id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  stripe_customer_id TEXT,
  platform_code TEXT,
  status TEXT,
  amount_minor INTEGER,
  currency TEXT,
  description TEXT,
  receipt_email TEXT,
  occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS stripe_order_records (
  stripe_object_id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  stripe_customer_id TEXT,
  platform_code TEXT,
  status TEXT,
  payment_status TEXT,
  amount_total_minor INTEGER,
  currency TEXT,
  customer_email TEXT,
  occurred_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS stripe_subscription_records (
  stripe_subscription_id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  customer_number TEXT,
  stripe_customer_id TEXT,
  platform_code TEXT,
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
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_marker_reference ON security_marker_references(marker_reference);
CREATE INDEX IF NOT EXISTS idx_notification_status ON customer_notification_deliveries(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_lockdown_platform ON platform_lockdowns(platform_id, status, initiated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lockdown_one_active ON platform_lockdowns(platform_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_platform_security_commands ON platform_security_commands(platform_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_stripe_events_received ON stripe_webhook_events(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_payments_customer ON stripe_payment_records(customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_orders_customer ON stripe_order_records(customer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_customer ON stripe_subscription_records(customer_id, updated_at DESC);

INSERT INTO security_marker_definitions
  (marker_type,marker_code,category,crm_display_label,branch_instruction,customer_visible,site_enforcement,status,created_at,updated_at)
VALUES
  ('IDENTITY_CONCERN','SMC-IDC','identity','Identity verification concern','Do not make security-sensitive identity changes until Head Office instructions are satisfied.',0,'deny_sensitive_action','active',datetime('now'),datetime('now')),
  ('ACCOUNT_TAKEOVER_RISK','SMC-ATO','account_security','Account takeover protection','Treat the account as high risk. Require Head Office access decision before allowing sensitive activity.',0,'step_up','active',datetime('now'),datetime('now')),
  ('PAYMENT_RISK','SMC-PYR','payments','Payment and refund review','Route payments, refunds and billing changes for manual review in accordance with the active restrictions.',0,'manual_review','active',datetime('now'),datetime('now')),
  ('SAFEGUARDING_ALERT','SMC-SAF','safeguarding','Protected customer handling','Contact Head Office. Do not display confidential safeguarding information in the branch CRM.',0,'manual_review','active',datetime('now'),datetime('now')),
  ('ENHANCED_VERIFICATION','SMC-EIV','identity','Enhanced verification required','Complete the Head Office identity-verification instruction before sensitive access is granted.',0,'step_up','active',datetime('now'),datetime('now')),
  ('UNUSUAL_ACCOUNT_ACTIVITY','SMC-UAA','account_security','Unusual account activity','Use additional care and follow any current Head Office restriction or verification instruction.',0,'manual_review','active',datetime('now'),datetime('now')),
  ('CUSTOMER_VULNERABILITY','SMC-CVU','customer_care','Additional customer care','Use appropriate additional care and refer to Head Office without exposing confidential details.',0,'display_only','active',datetime('now'),datetime('now'))
ON CONFLICT(marker_type) DO UPDATE SET
  marker_code=excluded.marker_code,
  category=excluded.category,
  crm_display_label=excluded.crm_display_label,
  branch_instruction=excluded.branch_instruction,
  customer_visible=excluded.customer_visible,
  site_enforcement=excluded.site_enforcement,
  status='active',
  updated_at=excluded.updated_at;
