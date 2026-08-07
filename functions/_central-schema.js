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

export const CURRENT_PLATFORM_FAMILIES = Object.freeze([
  Object.freeze({
    key: "JA_GROUP_SERVICES",
    name: "JA Group Services Ltd",
    canonicalCode: "JA_GROUP_SERVICES",
    canonicalId: "platform-ja-group-services",
    aliases: Object.freeze(["JA_GROUP_SERVICES"]),
    publicUrl: "https://jagroupservices.co.uk",
  }),
  Object.freeze({
    key: "SOUSA_MURRAY_DOMAINS",
    name: "Sousa Murray Domains",
    canonicalCode: "SOUSA_MURRAY_DOMAINS",
    canonicalId: "platform-sousa-murray-domains",
    aliases: Object.freeze(["SOUSA_MURRAY_DOMAINS", "JA_DOMAIN_HUB", "SOUSA_MURRAY_SITES"]),
    publicUrl: "https://sousamurraydomains.jagroupservices.co.uk",
  }),
  Object.freeze({
    key: "SOUSA_MURRAY_PLANEIA",
    name: "Sousa Murray Planeia",
    canonicalCode: "SOUSA_MURRAY_PLANEIA",
    canonicalId: "platform-sousa-murray-planeia",
    aliases: Object.freeze(["SOUSA_MURRAY_PLANEIA", "PLANYX"]),
    publicUrl: "https://sousamurrayplaneia.jagroupservices.co.uk",
  }),
  Object.freeze({
    key: "SOUSA_MURRAY_PROFILES",
    name: "Sousa Murray Profiles",
    canonicalCode: "SOUSA_MURRAY_PROFILES",
    canonicalId: "platform-sousa-murray-profiles",
    aliases: Object.freeze(["SOUSA_MURRAY_PROFILES", "PROFILE_CENTRE", "PROFILE_CENTER", "PROFILECENTRE"]),
    publicUrl: "https://sousamurrayprofiles.jagroupservices.co.uk",
  }),
  Object.freeze({
    key: "SOUSA_MURRAY_ELEARNING",
    name: "Sousa Murray eLearning",
    canonicalCode: "SOUSA_MURRAY_ELEARNING",
    canonicalId: "platform-sousa-murray-elearning",
    aliases: Object.freeze(["SOUSA_MURRAY_ELEARNING", "APTENVO", "COURSE_SELECT"]),
    publicUrl: "https://sousamurrayelearning.jagroupservices.co.uk",
  }),
]);

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

async function retireIncorrectAssumedProfileCentre(env) {
  const assumed = await env.DB.prepare(`SELECT p.id,p.status,o.public_url,o.hosting_provider,
      (SELECT COUNT(*) FROM platform_api_credentials c WHERE c.platform_id=p.id) credential_count,
      (SELECT COUNT(*) FROM customer_platform_accounts a WHERE a.platform_id=p.id) account_count
    FROM platforms p LEFT JOIN platform_operational_profiles o ON o.platform_id=p.id
    WHERE p.id='platform-profile-centre' AND p.code='PROFILE_CENTRE' LIMIT 1`).first().catch(() => null);
  if (!assumed) return;
  const isUnchangedAssumption = assumed.public_url === "https://profilecenter.co.uk"
    && assumed.hosting_provider === "GoDaddy Airo"
    && Number(assumed.credential_count || 0) === 0
    && Number(assumed.account_count || 0) === 0;
  if (!isUnchangedAssumption) return;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM platform_operational_profiles WHERE platform_id=?").bind(assumed.id),
    env.DB.prepare("UPDATE platforms SET status='disabled',updated_at=? WHERE id=?").bind(now, assumed.id)
  ]);
}

async function reconcileCurrentPlatformRegister(env) {
  const now = new Date().toISOString();
  for (const family of CURRENT_PLATFORM_FAMILIES) {
    const placeholders = family.aliases.map(() => "?").join(",");

    await env.DB.prepare(`UPDATE platforms SET name=?,updated_at=? WHERE upper(code) IN (${placeholders})`)
      .bind(family.name, now, ...family.aliases).run();

    let platform = await env.DB.prepare(`SELECT p.id,p.code,p.status,
        (SELECT COUNT(*) FROM platform_api_credentials c WHERE c.platform_id=p.id AND c.status='active') active_credentials
      FROM platforms p WHERE upper(p.code) IN (${placeholders})
      ORDER BY CASE WHEN p.status!='disabled' THEN 0 ELSE 1 END,
        CASE WHEN (SELECT COUNT(*) FROM platform_api_credentials c WHERE c.platform_id=p.id AND c.status='active')>0 THEN 0 ELSE 1 END,
        CASE WHEN upper(p.code)=? THEN 0 ELSE 1 END,
        p.created_at ASC LIMIT 1`)
      .bind(...family.aliases, family.canonicalCode).first();

    if (!platform) {
      await env.DB.prepare(`INSERT INTO platforms(id,code,name,status,created_at,updated_at)
        VALUES (?,?,?,'setup',?,?)`)
        .bind(family.canonicalId, family.canonicalCode, family.name, now, now).run();
      platform = { id: family.canonicalId, code: family.canonicalCode, status: "setup", active_credentials: 0 };
    } else if (platform.status === "disabled") {
      await env.DB.prepare("UPDATE platforms SET status='setup',updated_at=? WHERE id=?")
        .bind(now, platform.id).run();
    }

    await env.DB.prepare(`UPDATE platform_operational_profiles
      SET public_url=?,environment='production',updated_at=?
      WHERE platform_id IN (SELECT id FROM platforms WHERE upper(code) IN (${placeholders}))`)
      .bind(family.publicUrl, now, ...family.aliases).run();

    await env.DB.prepare(`INSERT INTO platform_operational_profiles
      (platform_id,public_url,environment,hosting_provider,health_status,health_message,
       capabilities_json,integrations_json,metadata_json,created_at,updated_at)
      VALUES (?,?,'production','Cloudflare Pages','awaiting_connection',?,?,'{}',?, ?, ?)
      ON CONFLICT(platform_id) DO NOTHING`)
      .bind(
        platform.id,
        family.publicUrl,
        `${family.name} is registered with JA Group Services Head Office; awaiting or using its governed production connection.`,
        JSON.stringify(["customer_platform", "central_payments"]),
        JSON.stringify({ currentPlatformFamily: family.key, registrationManagedBy: "Head Office" }),
        now,
        now,
      ).run();
  }
}

export async function ensureCentralPlatformSchema(env) {
  if (!env?.DB) throw new Error("The central customer database is unavailable.");
  if (ready.has(env.DB)) return ready.get(env.DB);
  const promise = (async () => {
    for (const statement of STATEMENTS) await env.DB.prepare(statement).run();
    await retireIncorrectAssumedProfileCentre(env);
    await reconcileCurrentPlatformRegister(env);
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
