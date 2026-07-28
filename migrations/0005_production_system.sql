PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS operational_schema_state (
  schema_key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS case_reference_sequences (
  sequence_key TEXT PRIMARY KEY,
  next_value INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cases_type_status ON cases(case_type, status, created_at);
CREATE INDEX IF NOT EXISTS idx_cases_assigned ON cases(assigned_staff_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_markers_review ON security_markers(status, review_at);
CREATE INDEX IF NOT EXISTS idx_restrictions_review ON restrictions(status, review_at);
CREATE INDEX IF NOT EXISTS idx_payments_reference ON payment_references(provider, provider_payment_reference);

INSERT INTO system_settings(setting_key,setting_group,value_json,description,updated_by,updated_at)
VALUES ('payments.refund_approval_threshold_minor','payments','5000','Refund amount in minor currency units requiring approval.','system',datetime('now'))
ON CONFLICT(setting_key) DO NOTHING;

INSERT INTO system_settings(setting_key,setting_group,value_json,description,updated_by,updated_at)
VALUES ('operations.default_case_due_hours','operations','72','Default due time for normal-priority cases.','system',datetime('now'))
ON CONFLICT(setting_key) DO NOTHING;

INSERT INTO role_definitions(code,name,description,permissions_json,is_system_role,status,created_at,updated_at) VALUES
('SYSTEM_ADMINISTRATOR','System Administrator','Full technical, operational and configuration authority.','["*"]',1,'active',datetime('now'),datetime('now')),
('HEAD_OFFICE_OPERATIONS','Head Office Operations','Company-wide customer operations, communications, payments, complaints and cases.','["dashboard:read","customers:*","cases:*","communications:*","payments:*","approvals:*","complaints:*","security:read","audit:read","platforms:read"]',1,'active',datetime('now'),datetime('now')),
('SECURITY_OFFICER','Security Officer','Security markers, restrictions, account recovery and controlled investigations.','["dashboard:read","customers:read","cases:*","communications:read","security:*","audit:read","platforms:read"]',1,'active',datetime('now'),datetime('now')),
('BRANCH_OPERATOR','Branch Operator','Customer operations limited to a connected division.','["dashboard:read","customers:read","cases:read","cases:create","communications:*"]',1,'active',datetime('now'),datetime('now')),
('DPO_RESTRICTED','Data Protection Officer','Restricted data protection case and audit authority.','["dashboard:read","customers:read","cases:read","cases:create","data_protection:*","communications:read","audit:read"]',1,'active',datetime('now'),datetime('now')),
('SAFEGUARDING_RESTRICTED','Designated Safeguarding Officer','Restricted safeguarding concern authority.','["dashboard:read","customers:read","cases:read","cases:create","safeguarding:*","communications:read","audit:read"]',1,'active',datetime('now'),datetime('now'))
ON CONFLICT(code) DO UPDATE SET
  name=excluded.name,
  description=excluded.description,
  permissions_json=excluded.permissions_json,
  status='active',
  updated_at=excluded.updated_at;

INSERT INTO security_marker_types(code,label,default_risk_level,default_visibility,requires_case,review_days,status,created_at,updated_at) VALUES
('IDENTITY_CONCERN','Identity concern','high','head_office_only',1,7,'active',datetime('now'),datetime('now')),
('ACCOUNT_TAKEOVER_RISK','Account takeover risk','critical','system_enforced',1,1,'active',datetime('now'),datetime('now')),
('PAYMENT_RISK','Payment or refund risk','high','branch_instruction',1,14,'active',datetime('now'),datetime('now')),
('SAFEGUARDING_ALERT','Safeguarding alert','critical','head_office_only',1,1,'active',datetime('now'),datetime('now')),
('ENHANCED_VERIFICATION','Enhanced verification required','moderate','approved_branch_summary',1,30,'active',datetime('now'),datetime('now')),
('UNUSUAL_ACCOUNT_ACTIVITY','Unusual account activity','moderate','branch_instruction',1,14,'active',datetime('now'),datetime('now')),
('CUSTOMER_VULNERABILITY','Customer vulnerability','moderate','head_office_only',1,30,'active',datetime('now'),datetime('now'))
ON CONFLICT(code) DO UPDATE SET
  label=excluded.label,
  default_risk_level=excluded.default_risk_level,
  default_visibility=excluded.default_visibility,
  requires_case=excluded.requires_case,
  review_days=excluded.review_days,
  status='active',
  updated_at=excluded.updated_at;

INSERT INTO restriction_types(code,label,enforcement_action,approval_role_code,status,created_at,updated_at) VALUES
('BLOCK_SIGN_IN','Block customer sign-in','deny_authentication','SECURITY_OFFICER','active',datetime('now'),datetime('now')),
('BLOCK_PROFILE_CHANGES','Block security-sensitive profile changes','deny_sensitive_update','HEAD_OFFICE_OPERATIONS','active',datetime('now'),datetime('now')),
('BLOCK_PAYMENTS','Block new payments','deny_payment','SECURITY_OFFICER','active',datetime('now'),datetime('now')),
('BLOCK_REFUNDS','Block automatic refunds','require_manual_approval','HEAD_OFFICE_OPERATIONS','active',datetime('now'),datetime('now')),
('FORCE_REAUTHENTICATION','Force reauthentication','revoke_sessions','SECURITY_OFFICER','active',datetime('now'),datetime('now')),
('REQUIRE_ENHANCED_VERIFICATION','Require enhanced identity verification','require_enhanced_verification','SECURITY_OFFICER','active',datetime('now'),datetime('now')),
('BLOCK_EMAIL_CHANGE','Block email address changes','deny_email_change','SECURITY_OFFICER','active',datetime('now'),datetime('now')),
('BLOCK_ACCOUNT_CLOSURE','Block automatic account closure','require_manual_approval','HEAD_OFFICE_OPERATIONS','active',datetime('now'),datetime('now'))
ON CONFLICT(code) DO UPDATE SET
  label=excluded.label,
  enforcement_action=excluded.enforcement_action,
  approval_role_code=excluded.approval_role_code,
  status='active',
  updated_at=excluded.updated_at;

INSERT INTO operational_schema_state(schema_key,version,applied_at)
VALUES ('production_system',1,datetime('now'))
ON CONFLICT(schema_key) DO UPDATE SET version=excluded.version,applied_at=excluded.applied_at;
