import { cleanText } from "./_shared.js";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS platform_operational_profiles (
    platform_id TEXT PRIMARY KEY REFERENCES platforms(id), public_url TEXT, environment TEXT NOT NULL DEFAULT 'production',
    hosting_provider TEXT, release_version TEXT, release_commit TEXT, health_status TEXT NOT NULL DEFAULT 'awaiting_connection',
    health_message TEXT, capabilities_json TEXT NOT NULL DEFAULT '[]', integrations_json TEXT NOT NULL DEFAULT '{}',
    customer_count INTEGER NOT NULL DEFAULT 0, active_session_count INTEGER NOT NULL DEFAULT 0,
    open_error_count INTEGER NOT NULL DEFAULT 0, last_heartbeat_at TEXT, last_deployment_at TEXT,
    last_customer_sync_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS platform_heartbeats (
    id TEXT PRIMARY KEY, platform_id TEXT NOT NULL REFERENCES platforms(id), environment TEXT NOT NULL,
    health_status TEXT NOT NULL, health_message TEXT, release_version TEXT, release_commit TEXT,
    customer_count INTEGER NOT NULL DEFAULT 0, active_session_count INTEGER NOT NULL DEFAULT 0,
    open_error_count INTEGER NOT NULL DEFAULT 0, metadata_json TEXT NOT NULL DEFAULT '{}',
    occurred_at TEXT NOT NULL, received_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS platform_deployments (
    id TEXT PRIMARY KEY, platform_id TEXT NOT NULL REFERENCES platforms(id), external_deployment_id TEXT NOT NULL,
    environment TEXT NOT NULL, release_version TEXT, commit_sha TEXT, status TEXT NOT NULL, deployed_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}', received_at TEXT NOT NULL, UNIQUE(platform_id,external_deployment_id))`,
  `CREATE TABLE IF NOT EXISTS customer_platform_snapshots (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), platform_id TEXT NOT NULL REFERENCES platforms(id),
    platform_account_id TEXT NOT NULL, account_status TEXT NOT NULL DEFAULT 'active', plan_code TEXT,
    subscription_status TEXT, entitlement_json TEXT NOT NULL DEFAULT '{}', registered_at TEXT,
    last_sign_in_at TEXT, last_activity_at TEXT, data_classification TEXT NOT NULL DEFAULT 'customer_confidential',
    metadata_json TEXT NOT NULL DEFAULT '{}', last_synced_at TEXT NOT NULL,
    UNIQUE(customer_id,platform_id), UNIQUE(platform_id,platform_account_id))`,
  `CREATE TABLE IF NOT EXISTS customer_subscriptions (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), platform_id TEXT NOT NULL REFERENCES platforms(id),
    provider TEXT NOT NULL, provider_customer_reference TEXT, provider_subscription_reference TEXT NOT NULL,
    plan_code TEXT, plan_name TEXT, status TEXT NOT NULL, amount_minor INTEGER, currency TEXT,
    started_at TEXT, current_period_start TEXT, current_period_end TEXT, cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    cancelled_at TEXT, metadata_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
    UNIQUE(provider,provider_subscription_reference))`,
  `CREATE TABLE IF NOT EXISTS customer_orders (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), platform_id TEXT NOT NULL REFERENCES platforms(id),
    provider TEXT, provider_order_reference TEXT NOT NULL, order_type TEXT NOT NULL, status TEXT NOT NULL,
    amount_minor INTEGER, currency TEXT, created_at TEXT NOT NULL, completed_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, UNIQUE(platform_id,provider_order_reference))`,
  `CREATE TABLE IF NOT EXISTS customer_sessions (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), platform_id TEXT NOT NULL REFERENCES platforms(id),
    external_session_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL, revoked_at TEXT, revocation_reason TEXT, device_summary TEXT, ip_country TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}', UNIQUE(platform_id,external_session_id))`,
  `CREATE TABLE IF NOT EXISTS customer_security_events (
    id TEXT PRIMARY KEY, external_event_id TEXT NOT NULL, customer_id TEXT REFERENCES customers(id),
    platform_id TEXT NOT NULL REFERENCES platforms(id), event_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'information',
    outcome TEXT, session_reference TEXT, ip_country TEXT, device_summary TEXT, occurred_at TEXT NOT NULL,
    received_at TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', UNIQUE(platform_id,external_event_id))`,
  `CREATE TABLE IF NOT EXISTS fraud_signals (
    id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id), platform_id TEXT REFERENCES platforms(id),
    source_event_id TEXT, signal_type TEXT NOT NULL, risk_score INTEGER NOT NULL DEFAULT 0,
    severity TEXT NOT NULL DEFAULT 'moderate', status TEXT NOT NULL DEFAULT 'open', reason TEXT NOT NULL,
    evidence_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS platform_enforcement_commands (
    id TEXT PRIMARY KEY, platform_id TEXT NOT NULL REFERENCES platforms(id), customer_id TEXT NOT NULL REFERENCES customers(id),
    restriction_id TEXT REFERENCES restrictions(id), command TEXT NOT NULL, reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, delivered_at TEXT,
    acknowledged_at TEXT, result_json TEXT NOT NULL DEFAULT '{}')`,
  `CREATE TABLE IF NOT EXISTS customer_access_decisions (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), platform_id TEXT NOT NULL REFERENCES platforms(id),
    decision TEXT NOT NULL, revoke_sessions INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL,
    restrictions_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS customer_timeline_events (
    id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), platform_id TEXT REFERENCES platforms(id),
    event_type TEXT NOT NULL, event_category TEXT NOT NULL, title TEXT NOT NULL, summary TEXT,
    occurred_at TEXT NOT NULL, source_reference TEXT, metadata_json TEXT NOT NULL DEFAULT '{}')`,
  "CREATE INDEX IF NOT EXISTS idx_platform_heartbeat_latest ON platform_heartbeats(platform_id,occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_customer_snapshots_customer ON customer_platform_snapshots(customer_id,last_synced_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON customer_subscriptions(customer_id,updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_orders_customer ON customer_orders(customer_id,created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_customer_sessions_active ON customer_sessions(customer_id,platform_id,status,last_seen_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_security_events_customer ON customer_security_events(customer_id,occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_fraud_signals_customer ON fraud_signals(customer_id,status,created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_enforcement_platform ON platform_enforcement_commands(platform_id,status,created_at)",
  "CREATE INDEX IF NOT EXISTS idx_customer_timeline ON customer_timeline_events(customer_id,occurred_at DESC)"
];

const ready = new WeakMap();
export const jsonValue = (value, fallback) => {
  try { return JSON.stringify(value ?? fallback); }
  catch { return JSON.stringify(fallback); }
};
export const isoDate = (value, fallback = null) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
};

export async function ensureCentralPlatformSchema(env) {
  if (!env?.DB) throw new Error("The central customer database is unavailable.");
  if (ready.has(env.DB)) return ready.get(env.DB);
  const promise = (async () => {
    for (const statement of STATEMENTS) await env.DB.prepare(statement).run();
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO platforms(id,code,name,status,created_at,updated_at)
      VALUES ('platform-profile-centre','PROFILE_CENTRE','Profile Centre','setup',?,?)
      ON CONFLICT(code) DO UPDATE SET name='Profile Centre',updated_at=excluded.updated_at`).bind(now, now).run();
    const platform = await env.DB.prepare("SELECT id FROM platforms WHERE code='PROFILE_CENTRE'").first();
    if (platform) await env.DB.prepare(`INSERT INTO platform_operational_profiles
      (platform_id,public_url,environment,hosting_provider,health_status,health_message,capabilities_json,integrations_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform_id) DO UPDATE SET
      public_url=excluded.public_url,hosting_provider=excluded.hosting_provider,
      capabilities_json=excluded.capabilities_json,integrations_json=excluded.integrations_json,
      updated_at=excluded.updated_at`).bind(platform.id,"https://profilecenter.co.uk","production","GoDaddy Airo",
        "awaiting_connection","Connector prepared; live connection not yet activated.",
        jsonValue(["customer_identity","security_enforcement","subscriptions","orders"],[]),
        jsonValue({customerIdentity:"JA Group Services ID",customerOps:"awaiting_connection"},{}),now,now).run();
    return true;
  })();
  ready.set(env.DB, promise);
  try { return await promise; }
  catch (error) { ready.delete(env.DB); throw error; }
}

export async function findPlatform(env, reference) {
  await ensureCentralPlatformSchema(env);
  const value = cleanText(reference, 120);
  if (!value) return null;
  return env.DB.prepare("SELECT * FROM platforms WHERE id=? OR upper(code)=upper(?) LIMIT 1").bind(value,value).first();
}
