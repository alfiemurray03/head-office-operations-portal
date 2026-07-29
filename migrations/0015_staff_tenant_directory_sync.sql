-- Microsoft Entra staff-tenant discovery is separate from customer identity and portal access.
-- The same existing Head Office Entra application is reused for app-only Graph reads.

CREATE TABLE IF NOT EXISTS staff_directory_connectors (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL UNIQUE,
  tenant_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'configured'
    CHECK (status IN ('not_configured','configured','connected','syncing','degraded','suspended')),
  delta_link TEXT,
  last_sync_started_at TEXT,
  last_sync_completed_at TEXT,
  last_success_at TEXT,
  last_error_code TEXT,
  last_error_message TEXT,
  users_discovered INTEGER NOT NULL DEFAULT 0,
  active_users INTEGER NOT NULL DEFAULT 0,
  disabled_users INTEGER NOT NULL DEFAULT 0,
  guest_users INTEGER NOT NULL DEFAULT 0,
  deleted_users INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO staff_directory_connectors
  (id,provider,tenant_id,display_name,status,created_at,updated_at)
VALUES
  ('staff-entra-tenant','microsoft_entra','53477196-db21-46d2-8123-00be3d6882da',
   'JA Group Services Microsoft tenant','configured',datetime('now'),datetime('now'));

CREATE TABLE IF NOT EXISTS staff_directory_identities (
  id TEXT PRIMARY KEY,
  staff_profile_id TEXT NOT NULL UNIQUE REFERENCES staff_directory_profiles(id),
  connector_id TEXT NOT NULL REFERENCES staff_directory_connectors(id),
  provider TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  object_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  given_name TEXT,
  surname TEXT,
  mail TEXT,
  user_principal_name TEXT,
  user_type TEXT,
  account_enabled INTEGER NOT NULL DEFAULT 1 CHECK (account_enabled IN (0,1)),
  directory_status TEXT NOT NULL DEFAULT 'active'
    CHECK (directory_status IN ('active','disabled','guest','deleted','unclassified')),
  employee_id TEXT,
  employee_type TEXT,
  job_title TEXT,
  department TEXT,
  office_location TEXT,
  company_name TEXT,
  mobile_phone TEXT,
  business_phones_json TEXT NOT NULL DEFAULT '[]',
  creation_type TEXT,
  external_user_state TEXT,
  profile_created_by_sync INTEGER NOT NULL DEFAULT 0 CHECK (profile_created_by_sync IN (0,1)),
  source_created_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_synced_at TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(provider,tenant_id,object_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_directory_identity_object
  ON staff_directory_identities(tenant_id,object_id);
CREATE INDEX IF NOT EXISTS idx_staff_directory_identity_status
  ON staff_directory_identities(directory_status,user_type,last_synced_at);
CREATE INDEX IF NOT EXISTS idx_staff_directory_identity_mail
  ON staff_directory_identities(mail,user_principal_name);

CREATE TABLE IF NOT EXISTS staff_directory_sync_checkpoints (
  connector_id TEXT PRIMARY KEY REFERENCES staff_directory_connectors(id),
  mode TEXT,
  next_link TEXT,
  stats_json TEXT NOT NULL DEFAULT '{}',
  started_by TEXT,
  started_at TEXT,
  last_chunk_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_directory_sync_runs (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL REFERENCES staff_directory_connectors(id),
  mode TEXT NOT NULL CHECK (mode IN ('initial','full','delta')),
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  started_by TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  pages_processed INTEGER NOT NULL DEFAULT 0,
  users_received INTEGER NOT NULL DEFAULT 0,
  profiles_created INTEGER NOT NULL DEFAULT 0,
  profiles_linked INTEGER NOT NULL DEFAULT 0,
  identities_updated INTEGER NOT NULL DEFAULT 0,
  disabled_accounts INTEGER NOT NULL DEFAULT 0,
  guest_accounts INTEGER NOT NULL DEFAULT 0,
  deleted_accounts INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  summary_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_staff_directory_sync_runs
  ON staff_directory_sync_runs(started_at DESC,status);
