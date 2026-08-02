import { cleanText } from "./_shared.js";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS support_branch_settings (
    platform_id TEXT PRIMARY KEY REFERENCES platforms(id), assistant_name TEXT NOT NULL DEFAULT 'Support Assistant',
    assistant_enabled INTEGER NOT NULL DEFAULT 0, ai_enabled INTEGER NOT NULL DEFAULT 0,
    human_takeover_enabled INTEGER NOT NULL DEFAULT 1, anonymous_enabled INTEGER NOT NULL DEFAULT 1,
    maintenance_enabled INTEGER NOT NULL DEFAULT 0, maintenance_message TEXT, emergency_notice TEXT,
    greeting TEXT, away_message TEXT, operating_hours_json TEXT NOT NULL DEFAULT '{}',
    appearance_json TEXT NOT NULL DEFAULT '{}', escalation_rules_json TEXT NOT NULL DEFAULT '{}',
    contact_options_json TEXT NOT NULL DEFAULT '{}', retention_days INTEGER NOT NULL DEFAULT 180,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS support_conversations (
    id TEXT PRIMARY KEY, conversation_reference TEXT NOT NULL UNIQUE,
    platform_id TEXT NOT NULL REFERENCES platforms(id), customer_id TEXT REFERENCES customers(id),
    platform_account_id TEXT REFERENCES customer_platform_accounts(id), external_conversation_id TEXT NOT NULL,
    visitor_reference_hash TEXT, status TEXT NOT NULL DEFAULT 'human_assistance_requested', handling_mode TEXT NOT NULL DEFAULT 'human_pending',
    category TEXT NOT NULL DEFAULT 'general', priority TEXT NOT NULL DEFAULT 'normal', current_page TEXT, page_title TEXT,
    authenticated INTEGER NOT NULL DEFAULT 0, identity_status TEXT NOT NULL DEFAULT 'anonymous',
    verified_email_snapshot TEXT, display_name_snapshot TEXT, customer_number_snapshot TEXT,
    service_context_json TEXT NOT NULL DEFAULT '{}', safe_support_flags_json TEXT NOT NULL DEFAULT '{}',
    assigned_staff_id TEXT REFERENCES staff_members(id), case_id TEXT REFERENCES cases(id), opened_at TEXT NOT NULL,
    last_customer_message_at TEXT, last_staff_message_at TEXT, last_ai_message_at TEXT,
    last_activity_at TEXT NOT NULL, closed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(platform_id, external_conversation_id))`,
  `CREATE TABLE IF NOT EXISTS support_messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
    external_message_id TEXT, sender_type TEXT NOT NULL, sender_id TEXT, sender_name TEXT,
    body TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'customer', delivery_status TEXT NOT NULL DEFAULT 'accepted',
    metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
    UNIQUE(conversation_id, external_message_id))`,
  `CREATE TABLE IF NOT EXISTS support_conversation_events (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, actor_type TEXT NOT NULL, actor_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}', occurred_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS support_knowledge_articles (
    id TEXT PRIMARY KEY, article_reference TEXT NOT NULL UNIQUE, title TEXT NOT NULL, summary TEXT,
    body_markdown TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'general', status TEXT NOT NULL DEFAULT 'draft',
    sensitivity TEXT NOT NULL DEFAULT 'public_support', created_by TEXT, reviewed_by TEXT, review_due_at TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS support_knowledge_assignments (
    id TEXT PRIMARY KEY, article_id TEXT NOT NULL REFERENCES support_knowledge_articles(id) ON DELETE CASCADE,
    platform_id TEXT REFERENCES platforms(id), service_code TEXT, account_type TEXT, plan_code TEXT,
    is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
    UNIQUE(article_id, platform_id, service_code, account_type, plan_code))`,
  `CREATE TABLE IF NOT EXISTS support_provider_escalations (
    id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES support_conversations(id), case_id TEXT REFERENCES cases(id),
    platform_id TEXT NOT NULL REFERENCES platforms(id), provider_name TEXT NOT NULL, provider_reference TEXT,
    status TEXT NOT NULL DEFAULT 'draft', summary TEXT NOT NULL, sent_at TEXT, response_due_at TEXT,
    response_received_at TEXT, customer_updated_at TEXT, created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS support_consents (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES support_conversations(id) ON DELETE CASCADE,
    customer_id TEXT REFERENCES customers(id), consent_type TEXT NOT NULL, consent_status TEXT NOT NULL,
    notice_version TEXT, evidence_json TEXT NOT NULL DEFAULT '{}', recorded_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS support_attachments (
    id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES support_conversations(id) ON DELETE CASCADE,
    message_id TEXT REFERENCES support_messages(id) ON DELETE CASCADE, case_id TEXT REFERENCES cases(id),
    storage_key TEXT NOT NULL, original_filename TEXT NOT NULL, content_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
    malware_status TEXT NOT NULL DEFAULT 'pending', visibility TEXT NOT NULL DEFAULT 'case_team',
    uploaded_by_type TEXT NOT NULL, uploaded_by_id TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS support_staff_branch_access (
    id TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff_members(id), platform_id TEXT NOT NULL REFERENCES platforms(id),
    can_read INTEGER NOT NULL DEFAULT 1, can_reply INTEGER NOT NULL DEFAULT 0,
    can_takeover INTEGER NOT NULL DEFAULT 0, can_configure INTEGER NOT NULL DEFAULT 0,
    granted_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(staff_id, platform_id))`,
  "CREATE INDEX IF NOT EXISTS idx_support_conversations_queue ON support_conversations(status,priority,last_activity_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_support_conversations_platform ON support_conversations(platform_id,status,last_activity_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_support_conversations_customer ON support_conversations(customer_id,last_activity_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_support_messages_conversation ON support_messages(conversation_id,created_at,id)",
  "CREATE INDEX IF NOT EXISTS idx_support_events_conversation ON support_conversation_events(conversation_id,occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_support_knowledge_status ON support_knowledge_articles(status,category,updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_support_assignments_platform ON support_knowledge_assignments(platform_id,is_active)",
  "CREATE INDEX IF NOT EXISTS idx_support_provider_status ON support_provider_escalations(platform_id,status,updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_support_staff_branch ON support_staff_branch_access(staff_id,platform_id)"
];

const ready = new WeakMap();
const FORBIDDEN_METADATA_KEY = /secret|token|password|credential|authorization|cookie|marker[ _-]?reason|safeguarding[ _-]?detail/i;
const LIVE_PLATFORM = /planyx|profile[ _-]?centre|ja[ _-]?domain[ _-]?hub|ja[ _-]?group[ _-]?services/i;

export function jsonValue(value, fallback = {}) {
  try { return JSON.stringify(value ?? fallback); }
  catch { return JSON.stringify(fallback); }
}

function safeJsonValue(value, maximumEntries, depth) {
  if (depth > 3) return undefined;
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return cleanText(value, 1000);
  if (Array.isArray(value)) {
    return value.slice(0, 30)
      .map(item => safeJsonValue(item, maximumEntries, depth + 1))
      .filter(item => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;

  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, maximumEntries)) {
    const key = cleanText(rawKey, 80);
    if (!key || FORBIDDEN_METADATA_KEY.test(key)) continue;
    const safeValue = safeJsonValue(rawValue, maximumEntries, depth + 1);
    if (safeValue !== undefined) output[key] = safeValue;
  }
  return output;
}

export function safeObject(value, maximumEntries = 40) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return safeJsonValue(value, Math.max(1, Math.min(100, Number(maximumEntries) || 40)), 0) || {};
}

export function normaliseSupportCategory(value) {
  const raw = cleanText(String(value || ""), 80).toLowerCase();
  const category = raw
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const aliases = {
    privacy: "data_protection",
    data_subject_rights: "data_protection",
    subject_access_request: "data_protection",
    sar: "data_protection",
    child_safety: "safeguarding",
    young_person: "safeguarding",
    vulnerable_person: "safeguarding",
    fraud: "security",
    account_compromise: "security",
    suspected_account_compromise: "security",
    login: "account_recovery",
    sign_in: "account_recovery",
    signin: "account_recovery"
  };
  return aliases[category] || category || "general";
}

export async function ensureSupportCentreSchema(env) {
  if (!env?.DB) throw new Error("The central customer database is unavailable.");
  if (ready.has(env.DB)) return ready.get(env.DB);
  const promise = (async () => {
    for (const statement of STATEMENTS) await env.DB.prepare(statement).run();
    return true;
  })();
  ready.set(env.DB, promise);
  try { return await promise; }
  catch (error) { ready.delete(env.DB); throw error; }
}

export function supportReference() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `CSC-${new Date().getUTCFullYear()}-${suffix}`;
}

function platformDescriptor(platform) {
  return `${cleanText(platform?.code, 100)} ${cleanText(platform?.name, 160)}`.trim();
}

function isPlanyx(platform) {
  return /planyx/i.test(platformDescriptor(platform));
}

export function isLiveSupportPlatform(platform) {
  return LIVE_PLATFORM.test(platformDescriptor(platform));
}

export async function ensureSupportCredentialScopes(env, platform) {
  if (!isLiveSupportPlatform(platform)) return [];
  const required = ["support:read", "support:write", ...(isPlanyx(platform) ? ["support:ai"] : [])];
  const rows = await env.DB.prepare(`SELECT id,scopes_json FROM platform_api_credentials
    WHERE platform_id=? AND status='active'`).bind(platform.id).all();
  for (const row of rows.results || []) {
    let scopes = [];
    try { scopes = JSON.parse(row.scopes_json || "[]"); } catch {}
    if (!Array.isArray(scopes)) scopes = [];
    const updated = [...new Set([...scopes.map(value => cleanText(String(value), 100)).filter(Boolean), ...required])];
    if (JSON.stringify(updated) !== JSON.stringify(scopes)) {
      await env.DB.prepare("UPDATE platform_api_credentials SET scopes_json=? WHERE id=?")
        .bind(JSON.stringify(updated), row.id).run();
    }
  }
  return required;
}

function branchDefaults(platform) {
  const descriptor = platformDescriptor(platform);
  const planyx = /planyx/i.test(descriptor);
  const profile = /profile[ _-]?centre/i.test(descriptor);
  const domain = /domain[ _-]?hub/i.test(descriptor);
  const assistantName = planyx
    ? "Planyx Support Assistant"
    : profile
      ? "Profile Centre Support Assistant"
      : domain
        ? "JA Domain Hub Support Assistant"
        : "JA Group Services Support Assistant";
  const greeting = planyx
    ? "Hello. I can help with Planyx planning tools and account questions, or connect you with a Head Office Customer Adviser."
    : profile
      ? "Hello. I can help with Profile Centre accounts, profiles and sharing, or connect you with a Head Office Customer Adviser."
      : domain
        ? "Hello. Start with guided domain troubleshooting. A Head Office Customer Adviser can help if the issue is not resolved."
        : "Hello. How can Head Office Customer Service help you today?";
  return {
    assistantName,
    greeting,
    aiEnabled: planyx ? 1 : 0,
    contactOptions: {
      email: "hello@jagroupservices.co.uk",
      complaintsEmail: "complaints@jagroupservices.co.uk",
      dataProtectionEmail: "dataprotection@jagroupservices.co.uk",
      phone: "020 3834 2790"
    }
  };
}

export async function ensureBranchSettings(env, platform) {
  await ensureSupportCentreSchema(env);
  await ensureSupportCredentialScopes(env, platform);
  const now = new Date().toISOString();
  const defaults = branchDefaults(platform);
  await env.DB.prepare(`INSERT INTO support_branch_settings
    (platform_id,assistant_name,assistant_enabled,ai_enabled,human_takeover_enabled,anonymous_enabled,
     maintenance_enabled,greeting,operating_hours_json,appearance_json,escalation_rules_json,
     contact_options_json,retention_days,created_at,updated_at)
    VALUES (?,?,1,?,1,1,0,?,'{}','{}','{}',?,180,?,?)
    ON CONFLICT(platform_id) DO NOTHING`)
    .bind(platform.id, defaults.assistantName, defaults.aiEnabled, defaults.greeting,
      JSON.stringify(defaults.contactOptions), now, now).run();

  await env.DB.prepare(`UPDATE support_branch_settings SET
      assistant_enabled=1,
      ai_enabled=?,
      assistant_name=CASE WHEN assistant_name='Support Assistant' OR assistant_name LIKE '% Support Assistant' THEN ? ELSE assistant_name END,
      greeting=COALESCE(NULLIF(greeting,''),?),
      contact_options_json=CASE WHEN contact_options_json='{}' OR contact_options_json='' THEN ? ELSE contact_options_json END,
      retention_days=CASE WHEN retention_days=365 THEN 180 ELSE retention_days END,
      updated_at=?
    WHERE platform_id=? AND assistant_enabled=0 AND created_at=updated_at`)
    .bind(defaults.aiEnabled, defaults.assistantName, defaults.greeting, JSON.stringify(defaults.contactOptions), now, platform.id).run();

  return env.DB.prepare("SELECT * FROM support_branch_settings WHERE platform_id=?").bind(platform.id).first();
}

export async function resolveSupportCustomer(env, platformId, identity = {}) {
  const centralCustomerId = cleanText(identity.centralCustomerId, 100);
  const customerNumber = cleanText(identity.customerNumber || identity.ucn, 40);
  const externalAccountId = cleanText(identity.platformAccountId || identity.platformCustomerId, 160);

  if (centralCustomerId) {
    const customer = await env.DB.prepare("SELECT * FROM customers WHERE id=? LIMIT 1").bind(centralCustomerId).first();
    return customer ? { customer, match: "central_customer_id" } : { customer: null, match: "central_customer_not_found" };
  }
  if (customerNumber) {
    const customer = await env.DB.prepare("SELECT * FROM customers WHERE customer_number=? LIMIT 1").bind(customerNumber).first();
    return customer ? { customer, match: "ucn" } : { customer: null, match: "ucn_not_found" };
  }
  if (externalAccountId) {
    const row = await env.DB.prepare(`SELECT c.*,a.id platform_account_id FROM customer_platform_accounts a
      JOIN customers c ON c.id=a.customer_id WHERE a.platform_id=? AND a.external_account_id=? LIMIT 1`)
      .bind(platformId, externalAccountId).first();
    return row ? { customer: row, platformAccountId: row.platform_account_id, match: "platform_account" }
      : { customer: null, match: "platform_account_not_found" };
  }
  return { customer: null, match: "anonymous" };
}
