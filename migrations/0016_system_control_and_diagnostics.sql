PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS service_test_runs (
  id TEXT PRIMARY KEY,
  service_code TEXT NOT NULL,
  service_label TEXT NOT NULL,
  test_mode TEXT NOT NULL DEFAULT 'safe' CHECK (test_mode IN ('safe','controlled')),
  status TEXT NOT NULL CHECK (status IN ('passed','warning','failed','skipped')),
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  started_by TEXT,
  request_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_service_test_runs_service ON service_test_runs(service_code,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_service_test_runs_status ON service_test_runs(status,started_at DESC);

INSERT INTO system_settings(setting_key,setting_group,value_json,description,updated_by,updated_at) VALUES
('system.portal_mode','system','"normal"','Controls normal, read-only or maintenance operation of the Head Office portal.','system',datetime('now')),
('system.test_centre_enabled','system','true','Allows authorised staff to run governed system service tests.','system',datetime('now')),
('system.external_test_actions_enabled','system','false','Allows controlled tests that contact an external recipient or create an external provider record.','system',datetime('now')),
('integrations.customer_directory_enabled','integrations','true','Allows JA Group Services ID connection and synchronisation actions.','system',datetime('now')),
('integrations.staff_directory_enabled','integrations','true','Allows JA Group Services Microsoft staff tenant synchronisation actions.','system',datetime('now')),
('integrations.stripe_planyx_enabled','integrations','true','Allows Planyx Stripe connection, reconciliation and webhook processing.','system',datetime('now')),
('integrations.stripe_profile_centre_enabled','integrations','true','Allows Profile Centre Stripe connection, reconciliation and webhook processing.','system',datetime('now')),
('integrations.didit_enabled','integrations','true','Allows new Didit identity-verification requests.','system',datetime('now')),
('integrations.resend_enabled','integrations','true','Allows customer email delivery through Resend.','system',datetime('now')),
('integrations.connected_systems_enabled','integrations','true','Allows approved connected websites and services to exchange operational data with Head Office.','system',datetime('now')),
('automation.customer_directory_enabled','automation','true','Allows scheduled JA Group Services ID reconciliation.','system',datetime('now')),
('automation.staff_directory_enabled','automation','true','Allows scheduled staff tenant reconciliation.','system',datetime('now')),
('automation.stripe_reconciliation_enabled','automation','true','Allows scheduled Stripe reconciliation for both divisions.','system',datetime('now')),
('notifications.customer_welcome_enabled','notifications','true','Allows automatic UCN welcome notifications to customers.','system',datetime('now')),
('notifications.system_test_failure_alerts','notifications','true','Records failed service tests as operational attention items.','system',datetime('now')),
('tests.result_retention_days','tests','90','Number of days service-test evidence is retained.','system',datetime('now')),
('tests.timeout_seconds','tests','12','Maximum external provider wait time for an individual safe test.','system',datetime('now'))
ON CONFLICT(setting_key) DO NOTHING;
