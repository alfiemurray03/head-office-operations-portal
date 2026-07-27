PRAGMA foreign_keys = ON;

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  customer_number TEXT NOT NULL UNIQUE CHECK (length(customer_number) = 10),
  entra_object_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  verified_email TEXT NOT NULL,
  originating_platform_id TEXT,
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('pending', 'active', 'restricted', 'suspended', 'closed', 'archived')),
  security_status TEXT NOT NULL DEFAULT 'clear'
    CHECK (security_status IN ('clear', 'monitor', 'review', 'high', 'critical')),
  first_registered_at TEXT NOT NULL,
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE platforms (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'setup'
    CHECK (status IN ('setup', 'active', 'degraded', 'offline', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE customer_platform_accounts (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  platform_id TEXT NOT NULL REFERENCES platforms(id),
  external_account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  linked_at TEXT NOT NULL,
  last_synced_at TEXT,
  UNIQUE(platform_id, external_account_id),
  UNIQUE(customer_id, platform_id)
);

CREATE TABLE cases (
  id TEXT PRIMARY KEY,
  case_reference TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id),
  platform_id TEXT REFERENCES platforms(id),
  case_type TEXT NOT NULL CHECK (case_type IN (
    'security', 'complaint', 'refund', 'payment_dispute', 'account_recovery',
    'data_protection', 'safeguarding', 'general'
  )),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('draft', 'open', 'triage', 'investigating', 'awaiting_customer',
      'awaiting_internal', 'approval_required', 'resolved', 'closed', 'cancelled')),
  assigned_staff_id TEXT,
  due_at TEXT,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE security_markers (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  case_id TEXT REFERENCES cases(id),
  marker_type TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'moderate', 'high', 'critical')),
  reason TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN (
    'head_office_only', 'branch_instruction', 'approved_branch_summary', 'system_enforced'
  )),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'under_review', 'cleared', 'expired', 'cancelled')),
  review_at TEXT,
  expires_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  cleared_by TEXT,
  cleared_at TEXT
);

CREATE TABLE restrictions (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  case_id TEXT REFERENCES cases(id),
  marker_id TEXT REFERENCES security_markers(id),
  restriction_type TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'company_wide',
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'lifted', 'expired', 'cancelled')),
  applied_by TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  review_at TEXT,
  expires_at TEXT,
  lifted_by TEXT,
  lifted_at TEXT
);

CREATE TABLE staff_members (
  id TEXT PRIMARY KEY,
  entra_object_id TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'suspended', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE staff_role_assignments (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL REFERENCES staff_members(id),
  role_code TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  expires_at TEXT,
  UNIQUE(staff_id, role_code)
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'system', 'platform', 'customer')),
  actor_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  case_id TEXT REFERENCES cases(id),
  request_id TEXT,
  source_ip_hash TEXT,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT
);

CREATE INDEX idx_customers_email ON customers(verified_email);
CREATE INDEX idx_customers_status ON customers(account_status, security_status);
CREATE INDEX idx_cases_customer ON cases(customer_id, status);
CREATE INDEX idx_cases_status_due ON cases(status, due_at);
CREATE INDEX idx_markers_customer ON security_markers(customer_id, status);
CREATE INDEX idx_restrictions_customer ON restrictions(customer_id, status);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id, occurred_at);
CREATE INDEX idx_audit_customer ON audit_events(customer_id, occurred_at);

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'Audit events are append-only');
END;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'Audit events are append-only');
END;
