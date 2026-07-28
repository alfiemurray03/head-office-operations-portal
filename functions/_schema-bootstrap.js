const TABLES = [
  `CREATE TABLE IF NOT EXISTS customer_contact_points (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    contact_type TEXT NOT NULL CHECK (contact_type IN ('email','mobile','telephone','postal_address')),
    contact_value TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
    verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified','pending','verified','failed','revoked')),
    verified_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS customer_relationships (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    related_customer_id TEXT REFERENCES customers(id),
    relationship_type TEXT NOT NULL,
    authority_basis TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS case_notes (
    id TEXT PRIMARY KEY,
    case_id TEXT NOT NULL REFERENCES cases(id),
    note_type TEXT NOT NULL DEFAULT 'internal' CHECK (note_type IN ('internal','customer_contact','decision','system')),
    body TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'case_team' CHECK (visibility IN ('case_team','head_office','restricted_dpo','restricted_safeguarding')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    supersedes_note_id TEXT REFERENCES case_notes(id)
  )`,
  `CREATE TABLE IF NOT EXISTS communications (
    id TEXT PRIMARY KEY,
    customer_id TEXT REFERENCES customers(id),
    case_id TEXT REFERENCES cases(id),
    direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound','internal')),
    channel TEXT NOT NULL CHECK (channel IN ('email','telephone','whatsapp','letter','web_form','system')),
    subject TEXT,
    summary TEXT NOT NULL,
    external_message_id TEXT,
    occurred_at TEXT NOT NULL,
    recorded_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS payment_references (
    id TEXT PRIMARY KEY,
    customer_id TEXT REFERENCES customers(id),
    platform_id TEXT REFERENCES platforms(id),
    provider TEXT NOT NULL,
    provider_customer_reference TEXT,
    provider_payment_reference TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (length(currency)=3),
    amount_minor INTEGER NOT NULL CHECK (amount_minor>=0),
    status TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(provider,provider_payment_reference)
  )`,
  `CREATE TABLE IF NOT EXISTS approval_requests (
    id TEXT PRIMARY KEY,
    case_id TEXT REFERENCES cases(id),
    approval_type TEXT NOT NULL,
    requested_by TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    required_role_code TEXT NOT NULL,
    amount_minor INTEGER,
    currency TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','withdrawn','expired')),
    decided_by TEXT,
    decided_at TEXT,
    decision_reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS platform_api_credentials (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL REFERENCES platforms(id),
    key_prefix TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    secret_hash TEXT NOT NULL UNIQUE,
    scopes_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked','expired')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    expires_at TEXT,
    revoked_by TEXT,
    revoked_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS platform_webhook_events (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL REFERENCES platforms(id),
    external_event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT,
    entity_external_id TEXT,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    processing_status TEXT NOT NULL DEFAULT 'received' CHECK (processing_status IN ('received','processed','rejected','failed')),
    payload_hash TEXT NOT NULL,
    error_code TEXT,
    UNIQUE(platform_id,external_event_id)
  )`,
  `CREATE TABLE IF NOT EXISTS organisation_units (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    unit_type TEXT NOT NULL CHECK (unit_type IN ('head_office','division','service')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('setup','active','restricted','disabled')),
    parent_unit_id TEXT REFERENCES organisation_units(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS system_settings (
    setting_key TEXT PRIMARY KEY,
    setting_group TEXT NOT NULL,
    value_json TEXT NOT NULL,
    description TEXT,
    updated_by TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS security_marker_types (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    default_risk_level TEXT NOT NULL CHECK (default_risk_level IN ('low','moderate','high','critical')),
    default_visibility TEXT NOT NULL,
    requires_case INTEGER NOT NULL DEFAULT 1 CHECK (requires_case IN (0,1)),
    review_days INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS restriction_types (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    enforcement_action TEXT NOT NULL,
    approval_role_code TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS role_definitions (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    permissions_json TEXT NOT NULL,
    is_system_role INTEGER NOT NULL DEFAULT 0 CHECK (is_system_role IN (0,1)),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS configuration_changes (
    id TEXT PRIMARY KEY,
    setting_key TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT NOT NULL,
    changed_by TEXT NOT NULL,
    changed_at TEXT NOT NULL
  )`
];

const INDEXES = [
  "CREATE INDEX IF NOT EXISTS idx_contact_points_customer ON customer_contact_points(customer_id,contact_type)",
  "CREATE INDEX IF NOT EXISTS idx_relationships_customer ON customer_relationships(customer_id)",
  "CREATE INDEX IF NOT EXISTS idx_case_notes_case ON case_notes(case_id,created_at)",
  "CREATE INDEX IF NOT EXISTS idx_communications_customer ON communications(customer_id,occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_communications_case ON communications(case_id,occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_payments_customer ON payment_references(customer_id,occurred_at)",
  "CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_requests(status,requested_at)",
  "CREATE INDEX IF NOT EXISTS idx_platform_credentials_platform ON platform_api_credentials(platform_id,status)",
  "CREATE INDEX IF NOT EXISTS idx_platform_webhooks_platform ON platform_webhook_events(platform_id,received_at)",
  "CREATE INDEX IF NOT EXISTS idx_units_parent ON organisation_units(parent_unit_id,status)",
  "CREATE INDEX IF NOT EXISTS idx_settings_group ON system_settings(setting_group)",
  "CREATE INDEX IF NOT EXISTS idx_configuration_changes ON configuration_changes(setting_key,changed_at)"
];

export async function ensureProductionSchema(env) {
  if (!env.DB) throw new Error("The Head Office database is not connected.");

  for (const statement of TABLES) await env.DB.prepare(statement).run();
  for (const statement of INDEXES) await env.DB.prepare(statement).run();

  const now = new Date().toISOString();
  const units = [
    ["unit-head-office","HEAD_OFFICE","JA Group Services Ltd — Head Office","head_office","active",null],
    ["unit-planyx","PLANYX","Planyx","division","active","unit-head-office"],
    ["unit-profile-centre","PROFILE_CENTRE","Profile Centre","division","active","unit-head-office"],
    ["unit-domain-hub","JA_DOMAIN_HUB","JA Domain Hub","division","active","unit-head-office"]
  ];
  for (const unit of units) {
    await env.DB.prepare(`INSERT INTO organisation_units
      (id,code,name,unit_type,status,parent_unit_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING`)
      .bind(...unit, now, now).run();
  }

  const settings = [
    ["security.session_hours","security","8","Maximum staff session duration in hours."],
    ["security.failed_login_threshold","security","5","Failed sign-in attempts before escalation."],
    ["security.default_marker_review_days","security","14","Default marker review interval."],
    ["operations.case_reference_prefix","operations","\"HOC\"","Prefix for Head Office case references."],
    ["operations.customer_number_length","operations","10","Length of universal customer numbers."],
    ["notifications.critical_case_alerts","notifications","true","Send alerts for critical cases."]
  ];
  for (const setting of settings) {
    await env.DB.prepare(`INSERT INTO system_settings
      (setting_key,setting_group,value_json,description,updated_by,updated_at)
      VALUES (?,?,?,?, 'system', ?) ON CONFLICT(setting_key) DO NOTHING`)
      .bind(...setting, now).run();
  }
}
