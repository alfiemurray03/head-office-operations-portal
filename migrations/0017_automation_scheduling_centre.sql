PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS automation_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  job_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','paused','completed','disabled')),
  schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('once','interval','daily','weekly','monthly')),
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  schedule_json TEXT NOT NULL DEFAULT '{}',
  parameters_json TEXT NOT NULL DEFAULT '{}',
  next_run_at TEXT,
  last_run_at TEXT,
  last_run_status TEXT,
  last_error TEXT,
  run_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  retry_delay_minutes INTEGER NOT NULL DEFAULT 15,
  locked_until TEXT,
  locked_by TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_schedules_due
  ON automation_schedules(status,next_run_at);
CREATE INDEX IF NOT EXISTS idx_automation_schedules_job
  ON automation_schedules(job_code,status);

CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT,
  schedule_name TEXT,
  job_code TEXT NOT NULL,
  job_label TEXT NOT NULL,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('scheduled','manual','retry','test')),
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','skipped','cancelled')),
  attempt INTEGER NOT NULL DEFAULT 1,
  scheduled_for TEXT,
  initiated_by TEXT,
  request_id TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT,
  FOREIGN KEY (schedule_id) REFERENCES automation_schedules(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_runs_schedule
  ON automation_runs(schedule_id,started_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_runs_status
  ON automation_runs(status,started_at DESC);

INSERT INTO system_settings(setting_key,setting_group,value_json,description,updated_by,updated_at) VALUES
('automation.scheduler_enabled','automation','true','Allows the governed Automation and Scheduling Centre to execute due schedules.','system',datetime('now')),
('automation.default_timezone','automation','"Europe/London"','Default IANA time zone for newly created Head Office schedules.','system',datetime('now')),
('automation.max_jobs_per_tick','automation','3','Maximum due schedules processed during one scheduler cycle.','system',datetime('now')),
('automation.default_retry_delay_minutes','automation','15','Default delay before a failed scheduled job is retried.','system',datetime('now')),
('automation.run_retention_days','automation','180','Number of days automation execution evidence is retained.','system',datetime('now'))
ON CONFLICT(setting_key) DO NOTHING;

INSERT INTO automation_schedules(
  id,name,description,job_code,status,schedule_kind,timezone,schedule_json,parameters_json,
  next_run_at,max_attempts,retry_delay_minutes,created_by,created_at,updated_by,updated_at
) VALUES
('automation-default-customer-directory','JA Group Services ID reconciliation','Continue customer directory imports and Microsoft delta reconciliation.','customer_directory_sync','enabled','interval','Europe/London','{"intervalMinutes":60}','{}',datetime('now','+10 minutes'),2,15,'system',datetime('now'),'system',datetime('now')),
('automation-default-staff-directory','Staff tenant reconciliation','Continue Microsoft staff tenant imports and delta reconciliation.','staff_directory_sync','enabled','interval','Europe/London','{"intervalMinutes":60}','{}',datetime('now','+15 minutes'),2,15,'system',datetime('now'),'system',datetime('now')),
('automation-default-stripe','Stripe account reconciliation','Reconcile Planyx and Profile Centre Stripe records.','stripe_reconciliation','enabled','interval','Europe/London','{"intervalMinutes":60}','{"division":"all"}',datetime('now','+20 minutes'),2,15,'system',datetime('now'),'system',datetime('now'))
ON CONFLICT(id) DO NOTHING;