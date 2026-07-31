PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS portal_roles (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  security_level TEXT NOT NULL,
  access_level TEXT NOT NULL,
  authority_label TEXT NOT NULL,
  includes_future_high_level_permissions INTEGER NOT NULL DEFAULT 0 CHECK (includes_future_high_level_permissions IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_permissions (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  high_level INTEGER NOT NULL DEFAULT 1 CHECK (high_level IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_role_permissions (
  role_code TEXT NOT NULL REFERENCES portal_roles(code),
  permission_code TEXT NOT NULL REFERENCES portal_permissions(code),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE IF NOT EXISTS portal_users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  preferred_name TEXT NOT NULL,
  email TEXT,
  contact_details_json TEXT NOT NULL DEFAULT '{}',
  job_titles_json TEXT NOT NULL DEFAULT '[]',
  profile_image_reference TEXT,
  status TEXT NOT NULL DEFAULT 'pending_identity' CHECK (status IN ('pending_identity','active','suspended','disabled')),
  role_code TEXT NOT NULL REFERENCES portal_roles(code),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_successful_sign_in_at TEXT,
  last_failed_sign_in_at TEXT,
  last_activity_at TEXT
);

CREATE TABLE IF NOT EXISTS authorised_principals (
  id TEXT PRIMARY KEY,
  portal_user_id TEXT NOT NULL UNIQUE REFERENCES portal_users(id),
  entra_tenant_id TEXT NOT NULL,
  entra_object_id TEXT UNIQUE,
  entra_subject_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending_configuration' CHECK (status IN ('pending_configuration','active','suspended','revoked')),
  governance_reference TEXT NOT NULL,
  business_reason TEXT NOT NULL,
  configured_at TEXT,
  configured_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_user_preferences (
  portal_user_id TEXT PRIMARY KEY REFERENCES portal_users(id),
  theme TEXT NOT NULL DEFAULT 'system' CHECK (theme IN ('light','dark','system')),
  table_density TEXT NOT NULL DEFAULT 'comfortable' CHECK (table_density IN ('compact','comfortable','spacious')),
  locale TEXT NOT NULL DEFAULT 'en-GB',
  time_zone TEXT NOT NULL DEFAULT 'Europe/London',
  date_time_format TEXT NOT NULL DEFAULT 'en-GB',
  default_landing_page TEXT NOT NULL DEFAULT 'dashboard',
  sensitive_values_masked INTEGER NOT NULL DEFAULT 1 CHECK (sensitive_values_masked IN (0,1)),
  accessibility_json TEXT NOT NULL DEFAULT '{}',
  notifications_json TEXT NOT NULL DEFAULT '{}',
  dashboard_json TEXT NOT NULL DEFAULT '{"widgets":["security_overview","platform_health","active_incidents","pending_approvals"],"hidden":[],"pinnedPlatforms":[],"pinnedIncidents":[],"defaultPlatformView":"all"}',
  saved_filters_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portal_sessions (
  id TEXT PRIMARY KEY,
  portal_user_id TEXT NOT NULL REFERENCES portal_users(id),
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired','reported')),
  authentication_method TEXT NOT NULL,
  authentication_strength TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  revocation_reason TEXT,
  source_ip_hash TEXT,
  user_agent TEXT,
  device_label TEXT,
  last_mfa_at TEXT
);

CREATE TABLE IF NOT EXISTS portal_authentication_events (
  id TEXT PRIMARY KEY,
  portal_user_id TEXT REFERENCES portal_users(id),
  entra_object_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('success','failure','access_denied','sign_out','session_revoked','session_reported')),
  reason_code TEXT,
  authentication_method TEXT,
  authentication_strength TEXT,
  session_id TEXT REFERENCES portal_sessions(id),
  source_ip_hash TEXT,
  user_agent TEXT,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS portal_security_alerts (
  id TEXT PRIMARY KEY,
  portal_user_id TEXT NOT NULL REFERENCES portal_users(id),
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('information','low','medium','high','critical')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS principal_approval_requests (
  id TEXT PRIMARY KEY,
  command_type TEXT NOT NULL,
  command_payload_json TEXT NOT NULL,
  requested_by_user_id TEXT NOT NULL REFERENCES portal_users(id),
  requested_session_id TEXT NOT NULL REFERENCES portal_sessions(id),
  requested_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','expired','executed','cancelled')),
  approved_by_user_id TEXT REFERENCES portal_users(id),
  approved_session_id TEXT REFERENCES portal_sessions(id),
  approved_at TEXT,
  governance_reference TEXT,
  business_reason TEXT NOT NULL,
  executed_at TEXT,
  CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> requested_by_user_id)
);

CREATE INDEX IF NOT EXISTS idx_authorised_principals_object ON authorised_principals(entra_tenant_id,entra_object_id,status);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_user ON portal_sessions(portal_user_id,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_token ON portal_sessions(token_hash,status);
CREATE INDEX IF NOT EXISTS idx_portal_auth_events_user ON portal_authentication_events(portal_user_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_principal_approvals_status ON principal_approval_requests(status,expires_at);

-- Legacy signed staff sessions cannot be upgraded safely. Replacing the old
-- store deliberately revokes them and prevents two session systems coexisting.
DROP TABLE IF EXISTS microsoft_staff_sessions;

INSERT OR IGNORE INTO portal_roles(code,name,security_level,access_level,authority_label,includes_future_high_level_permissions,created_at,updated_at)
VALUES ('HEAD_OFFICE_PRINCIPAL','Head Office Principal','HIGHEST','FULL','Equal Principal',1,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO portal_permissions(code,description,high_level,created_at)
VALUES ('*','Full authority over all Head Office Portal functions, including future high-level permissions.',1,datetime('now'));
INSERT OR IGNORE INTO portal_role_permissions(role_code,permission_code,granted_at)
VALUES ('HEAD_OFFICE_PRINCIPAL','*',datetime('now'));

INSERT INTO role_definitions(code,name,description,permissions_json,is_system_role,status,created_at,updated_at)
VALUES ('HEAD_OFFICE_PRINCIPAL','Head Office Principal','Equal highest-level authority for the two individually authorised Head Office principals.','["*"]',1,'active',datetime('now'),datetime('now'))
ON CONFLICT(code) DO UPDATE SET name=excluded.name,description=excluded.description,permissions_json=excluded.permissions_json,status='active',updated_at=excluded.updated_at;

INSERT OR IGNORE INTO portal_users(id,full_name,preferred_name,job_titles_json,status,role_code,created_at,updated_at)
VALUES ('HOP-USER-001','Alfie Thomas Holywood Murray','Alfie','["Company Director","Chief Executive Officer","Data Protection Officer","Designated Safeguarding Officer","Head Office Principal"]','pending_identity','HEAD_OFFICE_PRINCIPAL',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO portal_users(id,full_name,preferred_name,job_titles_json,status,role_code,created_at,updated_at)
VALUES ('HOP-USER-002','Jack Nicolau Sousa Da Silva','Jack','["Chairman","Group Chief Executive Officer","Head Office Principal"]','pending_identity','HEAD_OFFICE_PRINCIPAL',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO authorised_principals(id,portal_user_id,entra_tenant_id,status,governance_reference,business_reason,created_at,updated_at)
VALUES ('HOP-PRINCIPAL-001','HOP-USER-001','53477196-db21-46d2-8123-00be3d6882da','pending_configuration','Initial two-principal operating model','Authorised Head Office principal',datetime('now'),datetime('now'));
INSERT OR IGNORE INTO authorised_principals(id,portal_user_id,entra_tenant_id,status,governance_reference,business_reason,created_at,updated_at)
VALUES ('HOP-PRINCIPAL-002','HOP-USER-002','53477196-db21-46d2-8123-00be3d6882da','pending_configuration','Initial two-principal operating model','Authorised Head Office principal',datetime('now'),datetime('now'));

INSERT OR IGNORE INTO portal_user_preferences(portal_user_id,updated_at) VALUES ('HOP-USER-001',datetime('now'));
INSERT OR IGNORE INTO portal_user_preferences(portal_user_id,updated_at) VALUES ('HOP-USER-002',datetime('now'));

CREATE TRIGGER IF NOT EXISTS principal_approval_distinct_users_insert
BEFORE INSERT ON principal_approval_requests
WHEN NEW.approved_by_user_id IS NOT NULL AND NEW.approved_by_user_id = NEW.requested_by_user_id
BEGIN SELECT RAISE(ABORT, 'Requester cannot approve their own command'); END;

CREATE TRIGGER IF NOT EXISTS principal_approval_distinct_users_update
BEFORE UPDATE OF approved_by_user_id ON principal_approval_requests
WHEN NEW.approved_by_user_id IS NOT NULL AND NEW.approved_by_user_id = NEW.requested_by_user_id
BEGIN SELECT RAISE(ABORT, 'Requester cannot approve their own command'); END;
