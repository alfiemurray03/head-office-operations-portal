PRAGMA foreign_keys = ON;

CREATE TABLE organisation_units (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL CHECK (unit_type IN ('head_office','division','service')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('setup','active','restricted','disabled')),
  parent_unit_id TEXT REFERENCES organisation_units(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE system_settings (
  setting_key TEXT PRIMARY KEY,
  setting_group TEXT NOT NULL,
  value_json TEXT NOT NULL,
  description TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE security_marker_types (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  default_risk_level TEXT NOT NULL CHECK (default_risk_level IN ('low','moderate','high','critical')),
  default_visibility TEXT NOT NULL,
  requires_case INTEGER NOT NULL DEFAULT 1 CHECK (requires_case IN (0,1)),
  review_days INTEGER,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE restriction_types (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  enforcement_action TEXT NOT NULL,
  approval_role_code TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE role_definitions (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  is_system_role INTEGER NOT NULL DEFAULT 0 CHECK (is_system_role IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE configuration_changes (
  id TEXT PRIMARY KEY,
  setting_key TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL
);

CREATE INDEX idx_units_parent ON organisation_units(parent_unit_id, status);
CREATE INDEX idx_settings_group ON system_settings(setting_group);
CREATE INDEX idx_configuration_changes ON configuration_changes(setting_key, changed_at);

INSERT INTO organisation_units VALUES
('unit-head-office','HEAD_OFFICE','JA Group Services Ltd — Head Office','head_office','active',NULL,datetime('now'),datetime('now')),
('unit-planyx','PLANYX','Planyx','division','active','unit-head-office',datetime('now'),datetime('now')),
('unit-profile-centre','PROFILE_CENTRE','Profile Centre','division','active','unit-head-office',datetime('now'),datetime('now')),
('unit-domain-hub','JA_DOMAIN_HUB','JA Domain Hub','division','active','unit-head-office',datetime('now'),datetime('now'));

INSERT INTO role_definitions VALUES
('SYSTEM_ADMINISTRATOR','System Administrator','Full technical and configuration authority.','["*"]',1,'active',datetime('now'),datetime('now')),
('HEAD_OFFICE_OPERATIONS','Head Office Operations','Company-wide customer operations and case handling.','["dashboard:read","customers:write","cases:write","communications:write","security:read"]',1,'active',datetime('now'),datetime('now')),
('SECURITY_OFFICER','Security Officer','Security markers, restrictions and controlled investigations.','["dashboard:read","customers:read","cases:write","security:write","audit:read"]',1,'active',datetime('now'),datetime('now')),
('BRANCH_OPERATOR','Branch Operator','Customer operations limited to an assigned division.','["dashboard:read","customers:read","cases:write","communications:write"]',1,'active',datetime('now'),datetime('now')),
('DPO_RESTRICTED','Data Protection Officer','Restricted data protection case and audit access.','["data_protection:*","customers:read","cases:write","audit:read"]',1,'active',datetime('now'),datetime('now')),
('SAFEGUARDING_RESTRICTED','Designated Safeguarding Officer','Restricted safeguarding concern access.','["safeguarding:*","customers:read","cases:write","audit:read"]',1,'active',datetime('now'),datetime('now'));

INSERT INTO security_marker_types VALUES
('IDENTITY_CONCERN','Identity concern','high','head_office_only',1,7,'active',datetime('now'),datetime('now')),
('ACCOUNT_TAKEOVER_RISK','Account takeover risk','critical','system_enforced',1,1,'active',datetime('now'),datetime('now')),
('PAYMENT_RISK','Payment or refund risk','high','branch_instruction',1,14,'active',datetime('now'),datetime('now')),
('SAFEGUARDING_ALERT','Safeguarding alert','critical','head_office_only',1,1,'active',datetime('now'),datetime('now')),
('ENHANCED_VERIFICATION','Enhanced verification required','moderate','approved_branch_summary',1,30,'active',datetime('now'),datetime('now'));

INSERT INTO restriction_types VALUES
('BLOCK_SIGN_IN','Block customer sign-in','deny_authentication','SECURITY_OFFICER','active',datetime('now'),datetime('now')),
('BLOCK_PROFILE_CHANGES','Block security-sensitive profile changes','deny_sensitive_update','HEAD_OFFICE_OPERATIONS','active',datetime('now'),datetime('now')),
('BLOCK_PAYMENTS','Block new payments','deny_payment','SECURITY_OFFICER','active',datetime('now'),datetime('now')),
('BLOCK_REFUNDS','Block automatic refunds','require_manual_approval','HEAD_OFFICE_OPERATIONS','active',datetime('now'),datetime('now')),
('FORCE_REAUTHENTICATION','Force reauthentication','revoke_sessions','SECURITY_OFFICER','active',datetime('now'),datetime('now'));

INSERT INTO system_settings VALUES
('security.session_hours','security','8','Maximum staff session duration in hours.','system',datetime('now')),
('security.failed_login_threshold','security','5','Failed sign-in attempts before escalation.','system',datetime('now')),
('security.default_marker_review_days','security','14','Default marker review interval.','system',datetime('now')),
('operations.case_reference_prefix','operations','"HOC"','Prefix for Head Office case references.','system',datetime('now')),
('operations.customer_number_length','operations','10','Length of universal customer numbers.','system',datetime('now')),
('notifications.critical_case_alerts','notifications','true','Send alerts for critical cases.','system',datetime('now'));
