-- JA Group Services Ltd — AI Customer Service Centre full branch controls
-- Additive only. This migration does not change existing platform, authentication,
-- customer, payment, DNS or website-operating settings.

CREATE TABLE IF NOT EXISTS support_branch_connections (
  platform_id TEXT PRIMARY KEY REFERENCES platforms(id) ON DELETE CASCADE,
  connection_status TEXT NOT NULL DEFAULT 'never_connected',
  last_seen_at TEXT,
  last_config_fetch_at TEXT,
  last_user_agent TEXT,
  last_origin TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_support_branch_connections_status
  ON support_branch_connections(connection_status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS website_control_settings (
  platform_id TEXT PRIMARY KEY REFERENCES platforms(id) ON DELETE CASCADE,
  launch_gate_enabled INTEGER NOT NULL DEFAULT 0,
  launch_gate_mode TEXT NOT NULL DEFAULT 'prelaunch',
  launch_gate_title TEXT,
  launch_gate_message TEXT,
  launch_gate_cta_label TEXT,
  launch_gate_cta_href TEXT,
  launch_gate_background TEXT NOT NULL DEFAULT '#081426',
  launch_gate_accent TEXT NOT NULL DEFAULT '#2563eb',
  launch_gate_text_colour TEXT NOT NULL DEFAULT '#ffffff',
  launch_gate_show_company_details INTEGER NOT NULL DEFAULT 1,
  launch_gate_allow_search_engines INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Create disabled-by-default website-control records for the four approved branches.
-- No website is placed behind a gate by this migration.
INSERT INTO website_control_settings (
  platform_id,
  launch_gate_enabled,
  launch_gate_mode,
  launch_gate_title,
  launch_gate_message,
  launch_gate_cta_label,
  launch_gate_cta_href,
  created_at,
  updated_at
)
SELECT
  id,
  0,
  'prelaunch',
  CASE
    WHEN lower(name || ' ' || code) LIKE '%ja group services%' THEN 'JA Group Services'
    ELSE name
  END,
  'This website is not currently open to the public. Please use the published Company contact details if you need assistance.',
  'Contact JA Group Services',
  'mailto:contact@jagroupservices.co.uk',
  datetime('now'),
  datetime('now')
FROM platforms
WHERE lower(name || ' ' || code) LIKE '%ja group services%'
   OR lower(name || ' ' || code) LIKE '%ja domain hub%'
   OR lower(name || ' ' || code) LIKE '%planyx%'
   OR lower(name || ' ' || code) LIKE '%profile centre%'
   OR lower(name || ' ' || code) LIKE '%profile-centre%'
ON CONFLICT(platform_id) DO NOTHING;
