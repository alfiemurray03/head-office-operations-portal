import { cleanText } from "./_shared.js";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS support_branch_settings (
    platform_id TEXT PRIMARY KEY REFERENCES platforms(id), assistant_name TEXT NOT NULL DEFAULT 'Support Assistant',
    assistant_enabled INTEGER NOT NULL DEFAULT 0, ai_enabled INTEGER NOT NULL DEFAULT 0,
    human_takeover_enabled INTEGER NOT NULL DEFAULT 1, anonymous_enabled INTEGER NOT NULL DEFAULT 1,
    maintenance_enabled INTEGER NOT NULL DEFAULT 0, maintenance_message TEXT, emergency_notice TEXT,
    greeting TEXT, away_message TEXT, operating_hours_json TEXT NOT NULL DEFAULT '{}',
    appearance_json TEXT NOT NULL DEFAULT '{}', escalation_rules_json TEXT NOT NULL DEFAULT '{}',
    contact_options_json TEXT NOT NULL DEFAULT '{}', retention_days INTEGER NOT NULL DEFAULT 365,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS support_conversations (
    id TEXT PRIMARY KEY, conversation_reference TEXT NOT NULL UNIQUE,
    platform_id TEXT NOT NULL REFERENCES platforms(id), customer_id TEXT REFERENCES customers(id),
    platform_account_id TEXT REFERENCES customer_platform_accounts(id), external_conversation_id TEXT NOT NULL,
    visitor_reference_hash TEXT, status TEXT NOT NULL DEFAULT 'ai_handling', handling_mode TEXT NOT NULL DEFAULT 'ai',
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

export function jsonValue(value, fallback = {}) {
  try { return JSON.stringify(value ?? fallback); }
  catch { return JSON.stringify(fallback); }
}

export function safeObject(value, maximumEntries = 40) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, maximumEntries)) {
    const key = cleanText(rawKey, 80);
    if (!key || /secret|token|password|credential|authorization|cookie|marker_reason/i.test(key)) continue;
    if (rawValue === null || ["string", "number", "boolean"].includes(typeof rawValue)) {
      output[key] = typeof rawValue === "string" ? cleanText(rawValue, 500) : rawValue;
    }
  }
  return output;
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

export async function ensureBranchSettings(env, platform) {
  await ensureSupportCentreSchema(env);
  const now = new Date().toISOString();
  const defaultName = `${cleanText(platform?.name, 80) || "Customer"} Support Assistant`;
  await env.DB.prepare(`INSERT INTO support_branch_settings
    (platform_id,assistant_name,assistant_enabled,ai_enabled,human_takeover_enabled,anonymous_enabled,
     maintenance_enabled,greeting,operating_hours_json,appearance_json,escalation_rules_json,
     contact_options_json,retention_days,created_at,updated_at)
    VALUES (?,?,0,0,1,1,0,?,'{}','{}','{}','{}',365,?,?)
    ON CONFLICT(platform_id) DO NOTHING`)
    .bind(platform.id, defaultName, `Hello. You are speaking with the ${defaultName}. How can we help?`, now, now).run();
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
