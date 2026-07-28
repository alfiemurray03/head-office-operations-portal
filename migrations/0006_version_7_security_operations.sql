PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS security_level_definitions (
  dimension TEXT NOT NULL,
  code TEXT NOT NULL,
  rank INTEGER NOT NULL,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  default_action TEXT,
  colour_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (dimension, code)
);

CREATE TABLE IF NOT EXISTS detection_rules (
  code TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  event_type TEXT NOT NULL,
  base_score INTEGER NOT NULL,
  threshold_count INTEGER NOT NULL DEFAULT 1,
  threshold_window_minutes INTEGER NOT NULL DEFAULT 0,
  risk_floor TEXT NOT NULL,
  recommended_enforcement TEXT NOT NULL,
  alert_severity TEXT NOT NULL,
  data_classification TEXT NOT NULL,
  confidentiality_level TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_events (
  id TEXT PRIMARY KEY,
  event_reference TEXT NOT NULL UNIQUE,
  tenant_code TEXT NOT NULL DEFAULT 'JA_GROUP',
  source_type TEXT NOT NULL,
  source_id TEXT,
  external_event_id TEXT,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  platform_id TEXT REFERENCES platforms(id),
  case_id TEXT REFERENCES cases(id),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  amount_minor INTEGER,
  currency TEXT,
  country_code TEXT,
  ip_hash TEXT,
  device_hash TEXT,
  payment_fingerprint_hash TEXT,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT UNIQUE,
  processing_status TEXT NOT NULL DEFAULT 'received',
  risk_score INTEGER NOT NULL DEFAULT 0,
  risk_level TEXT NOT NULL DEFAULT 'R0',
  enforcement_level TEXT NOT NULL DEFAULT 'A0',
  data_classification TEXT NOT NULL DEFAULT 'D2',
  confidentiality_level TEXT NOT NULL DEFAULT 'K1',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_signals (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES security_events(id),
  rule_code TEXT NOT NULL REFERENCES detection_rules(code),
  points INTEGER NOT NULL,
  label TEXT NOT NULL,
  rationale TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, rule_code)
);

CREATE TABLE IF NOT EXISTS security_alerts (
  id TEXT PRIMARY KEY,
  alert_reference TEXT NOT NULL UNIQUE,
  customer_id TEXT REFERENCES customers(id),
  platform_id TEXT REFERENCES platforms(id),
  case_id TEXT REFERENCES cases(id),
  incident_id TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  risk_score INTEGER NOT NULL,
  risk_level TEXT NOT NULL,
  enforcement_level TEXT NOT NULL,
  severity TEXT NOT NULL,
  data_classification TEXT NOT NULL,
  confidentiality_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'triage', 'investigating', 'actioned', 'false_positive', 'closed')),
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  first_detected_at TEXT NOT NULL,
  last_detected_at TEXT NOT NULL,
  assigned_staff_id TEXT REFERENCES staff_members(id),
  recommended_action TEXT,
  decision TEXT,
  decision_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS security_incidents (
  id TEXT PRIMARY KEY,
  incident_reference TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'triage', 'contained', 'investigating', 'remediating', 'recovering', 'monitoring', 'closed')),
  confidentiality_level TEXT NOT NULL DEFAULT 'K2',
  data_classification TEXT NOT NULL DEFAULT 'D3',
  customer_id TEXT REFERENCES customers(id),
  case_id TEXT REFERENCES cases(id),
  discovered_at TEXT NOT NULL,
  occurred_at TEXT,
  contained_at TEXT,
  resolved_at TEXT,
  data_breach_status TEXT NOT NULL DEFAULT 'not_assessed'
    CHECK (data_breach_status IN ('not_assessed', 'not_a_breach', 'assessment_required', 'not_reportable', 'reportable', 'reported')),
  ico_deadline_at TEXT,
  ico_reported_at TEXT,
  affected_records INTEGER,
  affected_data_subjects INTEGER,
  affected_data_categories_json TEXT NOT NULL DEFAULT '[]',
  owner_staff_id TEXT REFERENCES staff_members(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS incident_timeline (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES security_incidents(id),
  entry_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  recorded_by TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_breach_assessments (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL UNIQUE REFERENCES security_incidents(id),
  awareness_at TEXT NOT NULL,
  risk_to_rights TEXT NOT NULL DEFAULT 'not_assessed',
  high_risk_to_rights INTEGER NOT NULL DEFAULT 0 CHECK (high_risk_to_rights IN (0, 1)),
  report_to_ico INTEGER CHECK (report_to_ico IN (0, 1)),
  notify_individuals INTEGER CHECK (notify_individuals IN (0, 1)),
  rationale TEXT,
  personal_data_categories_json TEXT NOT NULL DEFAULT '[]',
  approximate_records INTEGER,
  approximate_people INTEGER,
  decision_by TEXT,
  decision_at TEXT,
  ico_deadline_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS complaint_records (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES cases(id),
  complaint_stage TEXT NOT NULL DEFAULT 'received',
  received_at TEXT NOT NULL,
  acknowledgement_due_at TEXT,
  final_response_due_at TEXT,
  outcome TEXT,
  remedy TEXT,
  compensation_minor INTEGER,
  currency TEXT,
  root_cause TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS financial_operations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE REFERENCES cases(id),
  operation_type TEXT NOT NULL
    CHECK (operation_type IN ('refund', 'payment_dispute', 'chargeback', 'payment_review')),
  provider TEXT,
  transaction_reference TEXT,
  amount_minor INTEGER,
  currency TEXT,
  reason_code TEXT,
  fraud_suspected INTEGER NOT NULL DEFAULT 0 CHECK (fraud_suspected IN (0, 1)),
  dispute_stage TEXT,
  evidence_status TEXT,
  approval_status TEXT,
  outcome TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operations_tasks (
  id TEXT PRIMARY KEY,
  task_reference TEXT NOT NULL UNIQUE,
  service_area TEXT NOT NULL,
  task_type TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id),
  case_id TEXT REFERENCES cases(id),
  incident_id TEXT REFERENCES security_incidents(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'awaiting_customer', 'awaiting_internal', 'approval_required', 'completed', 'cancelled')),
  due_at TEXT,
  assigned_staff_id TEXT REFERENCES staff_members(id),
  checklist_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_customer_time
  ON security_events(customer_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_security_events_type_time
  ON security_events(event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_security_events_payment_fingerprint
  ON security_events(payment_fingerprint_hash, occurred_at);
CREATE INDEX IF NOT EXISTS idx_alerts_status_risk
  ON security_alerts(status, risk_score, last_detected_at);
CREATE INDEX IF NOT EXISTS idx_alerts_customer
  ON security_alerts(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_status_severity
  ON security_incidents(status, severity, discovered_at);
CREATE INDEX IF NOT EXISTS idx_incident_timeline
  ON incident_timeline(incident_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_operations_tasks_queue
  ON operations_tasks(status, priority, due_at);
