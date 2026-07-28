PRAGMA foreign_keys = ON;

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  customer_number TEXT NOT NULL UNIQUE CHECK (length(customer_number) = 10),
  external_identity_id TEXT UNIQUE,
  display_name TEXT NOT NULL,
  verified_email TEXT NOT NULL UNIQUE,
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
  last_health_check_at TEXT,
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
  external_identity_id TEXT UNIQUE,
  authentication_source TEXT NOT NULL DEFAULT 'local'
    CHECK (authentication_source IN ('local', 'microsoft_entra')),
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
  actor_name TEXT,
  action TEXT NOT NULL,
  action_label TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_reference TEXT,
  customer_id TEXT REFERENCES customers(id),
  case_id TEXT REFERENCES cases(id),
  request_id TEXT,
  source_ip_hash TEXT,
  before_json TEXT,
  after_json TEXT,
  metadata_json TEXT
);

CREATE INDEX idx_customers_email ON customers(verified_email);
CREATE INDEX idx_customers_external_identity ON customers(external_identity_id);
CREATE INDEX idx_customers_status ON customers(account_status, security_status);
CREATE INDEX idx_cases_customer ON cases(customer_id, status);
CREATE INDEX idx_cases_status_due ON cases(status, due_at);
CREATE INDEX idx_markers_customer ON security_markers(customer_id, status);
CREATE INDEX idx_restrictions_customer ON restrictions(customer_id, status);
CREATE INDEX idx_audit_entity ON audit_events(entity_type, entity_id, occurred_at);
CREATE INDEX idx_audit_customer ON audit_events(customer_id, occurred_at);

CREATE TABLE customer_contact_points (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  contact_type TEXT NOT NULL CHECK (contact_type IN ('email', 'mobile', 'telephone', 'postal_address')),
  contact_value TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  verification_status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending', 'verified', 'failed', 'revoked')),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE customer_relationships (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  related_customer_id TEXT REFERENCES customers(id),
  relationship_type TEXT NOT NULL,
  authority_basis TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE case_notes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES cases(id),
  note_type TEXT NOT NULL DEFAULT 'internal'
    CHECK (note_type IN ('internal', 'customer_contact', 'decision', 'system')),
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'case_team'
    CHECK (visibility IN ('case_team', 'head_office', 'restricted_dpo', 'restricted_safeguarding')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  supersedes_note_id TEXT REFERENCES case_notes(id)
);

CREATE TABLE communications (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  case_id TEXT REFERENCES cases(id),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'internal')),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'telephone', 'whatsapp', 'letter', 'web_form', 'system')),
  subject TEXT,
  summary TEXT NOT NULL,
  external_message_id TEXT,
  occurred_at TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE payment_references (
  id TEXT PRIMARY KEY,
  customer_id TEXT REFERENCES customers(id),
  platform_id TEXT REFERENCES platforms(id),
  provider TEXT NOT NULL,
  provider_customer_reference TEXT,
  provider_payment_reference TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  amount_minor INTEGER NOT NULL CHECK (amount_minor >= 0),
  status TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider, provider_payment_reference)
);

CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES cases(id),
  approval_type TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  required_role_code TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'declined', 'withdrawn', 'expired')),
  decided_by TEXT,
  decided_at TEXT,
  decision_reason TEXT
);

CREATE INDEX idx_contact_points_customer ON customer_contact_points(customer_id, contact_type);
CREATE INDEX idx_relationships_customer ON customer_relationships(customer_id);
CREATE INDEX idx_case_notes_case ON case_notes(case_id, created_at);
CREATE INDEX idx_communications_customer ON communications(customer_id, occurred_at);
CREATE INDEX idx_communications_case ON communications(case_id, occurred_at);
CREATE INDEX idx_payments_customer ON payment_references(customer_id, occurred_at);
CREATE INDEX idx_approvals_status ON approval_requests(status, requested_at);

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
