const integer = (minimum, maximum) => value => Number.isInteger(Number(value)) && Number(value) >= minimum && Number(value) <= maximum;
const boolean = value => typeof value === "boolean";
const oneOf = values => value => values.includes(String(value || ""));
const prefix = value => /^[A-Z0-9]{2,8}$/.test(String(value || "").toUpperCase());
const readinessByDatabase = new WeakMap();

export const SYSTEM_SETTING_DEFINITIONS = new Map([
  ["system.portal_mode", { group: "system", defaultValue: "normal", validate: oneOf(["normal", "read_only", "maintenance"]), description: "Controls normal, read-only or maintenance operation of the Head Office portal." }],
  ["system.test_centre_enabled", { group: "system", defaultValue: true, validate: boolean, description: "Allows authorised staff to run governed system service tests." }],
  ["system.external_test_actions_enabled", { group: "system", defaultValue: false, validate: boolean, description: "Allows controlled tests that contact an external recipient or create an external provider record." }],
  ["security.session_hours", { group: "security", defaultValue: 8, validate: integer(1, 24), description: "Maximum staff session duration in hours." }],
  ["security.failed_login_threshold", { group: "security", defaultValue: 5, validate: integer(3, 20), description: "Failed sign-in attempts before escalation." }],
  ["security.default_marker_review_days", { group: "security", defaultValue: 14, validate: integer(1, 365), description: "Default marker review interval." }],
  ["operations.case_reference_prefix", { group: "operations", defaultValue: "HOC", validate: prefix, normalise: value => String(value).toUpperCase(), description: "Prefix for Head Office case references." }],
  ["operations.default_case_due_hours", { group: "operations", defaultValue: 72, validate: integer(1, 720), description: "Default due time for normal-priority cases." }],
  ["payments.refund_approval_threshold_minor", { group: "payments", defaultValue: 5000, validate: integer(0, 10_000_000), description: "Refund amount in minor currency units requiring approval." }],
  ["notifications.critical_case_alerts", { group: "notifications", defaultValue: true, validate: boolean, description: "Send alerts for critical cases." }],
  ["notifications.customer_welcome_enabled", { group: "notifications", defaultValue: true, validate: boolean, description: "Allows automatic UCN welcome notifications to customers." }],
  ["notifications.system_test_failure_alerts", { group: "notifications", defaultValue: true, validate: boolean, description: "Records failed service tests as operational attention items." }],
  ["integrations.customer_directory_enabled", { group: "integrations", defaultValue: true, validate: boolean, description: "Allows JA Group Services ID connection and synchronisation actions." }],
  ["integrations.staff_directory_enabled", { group: "integrations", defaultValue: true, validate: boolean, description: "Allows JA Group Services Microsoft staff tenant synchronisation actions." }],
  ["integrations.stripe_planyx_enabled", { group: "integrations", defaultValue: true, validate: boolean, description: "Allows Planyx Stripe API and reconciliation actions; signed inbound evidence remains retained." }],
  ["integrations.stripe_profile_centre_enabled", { group: "integrations", defaultValue: true, validate: boolean, description: "Allows Profile Centre Stripe API and reconciliation actions; signed inbound evidence remains retained." }],
  ["integrations.didit_enabled", { group: "integrations", defaultValue: true, validate: boolean, description: "Allows new Didit identity-verification requests." }],
  ["integrations.resend_enabled", { group: "integrations", defaultValue: true, validate: boolean, description: "Allows customer email delivery through Resend." }],
  ["integrations.connected_systems_enabled", { group: "integrations", defaultValue: true, validate: boolean, description: "Allows approved connected websites and services to exchange operational data with Head Office." }],
  ["automation.customer_directory_enabled", { group: "automation", defaultValue: true, validate: boolean, description: "Allows scheduled JA Group Services ID reconciliation." }],
  ["automation.staff_directory_enabled", { group: "automation", defaultValue: true, validate: boolean, description: "Allows scheduled staff tenant reconciliation." }],
  ["automation.stripe_reconciliation_enabled", { group: "automation", defaultValue: true, validate: boolean, description: "Allows scheduled Stripe reconciliation for enabled divisions." }],
  ["tests.result_retention_days", { group: "tests", defaultValue: 90, validate: integer(7, 365), description: "Number of days service-test evidence is retained." }],
  ["tests.timeout_seconds", { group: "tests", defaultValue: 12, validate: integer(5, 30), description: "Maximum external provider wait time for an individual safe test." }]
]);

async function initialiseSystemSettings(env) {
  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS service_test_runs (
      id TEXT PRIMARY KEY,service_code TEXT NOT NULL,service_label TEXT NOT NULL,
      test_mode TEXT NOT NULL DEFAULT 'safe' CHECK (test_mode IN ('safe','controlled')),
      status TEXT NOT NULL CHECK (status IN ('passed','warning','failed','skipped')),
      summary TEXT NOT NULL,details_json TEXT NOT NULL DEFAULT '{}',started_by TEXT,request_id TEXT,
      started_at TEXT NOT NULL,completed_at TEXT NOT NULL,duration_ms INTEGER NOT NULL DEFAULT 0
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_service_test_runs_service ON service_test_runs(service_code,started_at DESC)")
  ];
  for (const [key, definition] of SYSTEM_SETTING_DEFINITIONS) {
    statements.push(env.DB.prepare(`INSERT INTO system_settings(setting_key,setting_group,value_json,description,updated_by,updated_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(setting_key) DO NOTHING`)
      .bind(key, definition.group, JSON.stringify(definition.defaultValue), definition.description, "system", now));
  }
  await env.DB.batch(statements);
}

export async function ensureSystemSettingsReady(env) {
  if (!env?.DB) throw new Error("The Head Office database is not connected.");
  if (!readinessByDatabase.has(env.DB)) {
    const promise = initialiseSystemSettings(env).catch(cause => {
      readinessByDatabase.delete(env.DB);
      throw cause;
    });
    readinessByDatabase.set(env.DB, promise);
  }
  return readinessByDatabase.get(env.DB);
}

export function parseSettingValue(value, fallback = null) {
  try { return JSON.parse(value); }
  catch { return fallback; }
}

export async function getSystemSetting(env, key, fallback = undefined) {
  try {
    const row = await env.DB.prepare("SELECT value_json FROM system_settings WHERE setting_key=?").bind(key).first();
    if (!row) return fallback;
    return parseSettingValue(row.value_json, fallback);
  } catch {
    return fallback;
  }
}

export async function getSystemSettings(env) {
  await ensureSystemSettingsReady(env);
  const rows = await env.DB.prepare("SELECT setting_key,setting_group,value_json,description,updated_by,updated_at FROM system_settings ORDER BY setting_group,setting_key").all();
  const values = {};
  for (const row of rows.results || []) values[row.setting_key] = parseSettingValue(row.value_json, row.value_json);
  return { rows: rows.results || [], values };
}

export function normaliseSystemSetting(key, value) {
  const definition = SYSTEM_SETTING_DEFINITIONS.get(key);
  if (!definition || !definition.validate(value)) {
    throw Object.assign(new Error("That setting or value cannot be changed here."), { code: "INVALID_SETTING", status: 400 });
  }
  return definition.normalise ? definition.normalise(value) : value;
}
