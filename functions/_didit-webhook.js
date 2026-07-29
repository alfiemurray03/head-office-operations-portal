import { cleanText, hmac, safeEqual, sha256 } from "./_shared.js";
import { ensureCentralPlatformSchema, jsonValue } from "./_central-schema.js";
import { liftRestrictionEnforcement } from "./_central-access.js";
import { recalculateCustomerSecurity } from "./_operations.js";

const MAX_BODY_BYTES = 1_048_576;
const MAX_CLOCK_SKEW_SECONDS = 300;
const DIDIT_PROVIDER = "didit";
const TERMINAL_STATUSES = new Set(["Approved", "Declined", "Expired", "Abandoned", "Kyc Expired"]);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS identity_verification_sessions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    platform_id TEXT REFERENCES platforms(id),
    restriction_id TEXT REFERENCES restrictions(id),
    provider TEXT NOT NULL DEFAULT 'didit',
    provider_session_id TEXT NOT NULL UNIQUE,
    workflow_id TEXT,
    environment TEXT NOT NULL DEFAULT 'live',
    status TEXT NOT NULL DEFAULT 'Not Started',
    decision TEXT,
    verification_url_hash TEXT,
    vendor_data TEXT NOT NULL,
    return_url TEXT,
    consent_recorded_at TEXT,
    consent_version TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    expires_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS identity_verification_webhook_events (
    event_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL DEFAULT 'didit',
    provider_session_id TEXT,
    webhook_type TEXT NOT NULL,
    status TEXT,
    environment TEXT,
    signature_method TEXT NOT NULL,
    received_at TEXT NOT NULL,
    processed_at TEXT,
    processing_status TEXT NOT NULL DEFAULT 'received',
    error_message TEXT,
    payload_hash TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  )`,
  "CREATE INDEX IF NOT EXISTS idx_identity_verification_customer ON identity_verification_sessions(customer_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_identity_verification_restriction ON identity_verification_sessions(restriction_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_identity_verification_status ON identity_verification_sessions(status, updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_identity_verification_webhook_session ON identity_verification_webhook_events(provider_session_id, received_at DESC)"
];

const schemaReady = new WeakMap();

export async function ensureDiditWebhookSchema(env) {
  if (!env?.DB) throw new Error("The CustomerOps database is unavailable.");
  if (schemaReady.has(env.DB)) return schemaReady.get(env.DB);
  const promise = (async () => {
    await ensureCentralPlatformSchema(env);
    for (const statement of SCHEMA) await env.DB.prepare(statement).run();
    return true;
  })();
  schemaReady.set(env.DB, promise);
  try { return await promise; }
  catch (error) { schemaReady.delete(env.DB); throw error; }
}

function sortRecursively(value) {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortRecursively(value[key]);
    return result;
  }, {});
}

export function canonicalDiditJson(payload) {
  return JSON.stringify(sortRecursively(payload));
}

function normaliseStatus(value) {
  const raw = cleanText(String(value || ""), 80).replaceAll("_", " ").trim();
  const key = raw.toLowerCase();
  const known = {
    "not started": "Not Started",
    "in progress": "In Progress",
    "approved": "Approved",
    "declined": "Declined",
    "in review": "In Review",
    "expired": "Expired",
    "abandoned": "Abandoned",
    "kyc expired": "Kyc Expired",
    "resubmitted": "Resubmitted",
    "awaiting user": "Awaiting User"
  };
  return known[key] || raw || "Unknown";
}

function epochToIso(value, fallback = new Date().toISOString()) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  const milliseconds = number > 10_000_000_000 ? number : number * 1000;
  const parsed = new Date(milliseconds);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

async function readRawBody(request) {
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) throw Object.assign(new Error("The webhook body is too large."), { status: 413, code: "REQUEST_TOO_LARGE" });
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_BODY_BYTES) throw Object.assign(new Error("The webhook body is too large."), { status: 413, code: "REQUEST_TOO_LARGE" });
  return new TextDecoder().decode(bytes);
}

export async function verifyDiditWebhookRequest(request, env) {
  const secret = cleanText(env?.DIDIT_WEBHOOK_SECRET, 500);
  if (!secret) throw Object.assign(new Error("The Didit webhook secret has not been configured."), { status: 503, code: "DIDIT_WEBHOOK_NOT_CONFIGURED" });

  const timestampHeader = cleanText(request.headers.get("X-Timestamp"), 40);
  const signatureV2 = cleanText(request.headers.get("X-Signature-V2"), 200).toLowerCase();
  if (!timestampHeader || !signatureV2) {
    throw Object.assign(new Error("Required Didit signature headers are missing."), { status: 401, code: "DIDIT_SIGNATURE_REQUIRED" });
  }
  const incomingTimestamp = Number.parseInt(timestampHeader, 10);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(incomingTimestamp) || Math.abs(now - incomingTimestamp) > MAX_CLOCK_SKEW_SECONDS) {
    throw Object.assign(new Error("The Didit webhook timestamp is stale or invalid."), { status: 401, code: "DIDIT_TIMESTAMP_REJECTED" });
  }

  const rawBody = await readRawBody(request);
  let payload;
  try { payload = JSON.parse(rawBody); }
  catch { throw Object.assign(new Error("The Didit webhook body is not valid JSON."), { status: 400, code: "INVALID_JSON" }); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new Error("The Didit webhook body must be a JSON object."), { status: 400, code: "INVALID_DIDIT_PAYLOAD" });
  }

  const bodyTimestamp = Number.parseInt(String(payload.timestamp || ""), 10);
  if (Number.isFinite(bodyTimestamp) && bodyTimestamp !== incomingTimestamp) {
    throw Object.assign(new Error("The Didit body timestamp does not match the signed header."), { status: 401, code: "DIDIT_TIMESTAMP_MISMATCH" });
  }

  const canonical = canonicalDiditJson(payload);
  const expected = (await hmac(canonical, secret)).toLowerCase();
  if (!safeEqual(expected, signatureV2)) {
    throw Object.assign(new Error("The Didit webhook signature is invalid."), { status: 401, code: "DIDIT_SIGNATURE_INVALID" });
  }

  const sessionId = cleanText(String(payload.session_id || payload.business_session_id || ""), 180);
  const webhookType = cleanText(String(payload.webhook_type || ""), 120);
  const status = normaliseStatus(payload.status);
  if (!sessionId || !webhookType) {
    throw Object.assign(new Error("The Didit webhook is missing its session or event type."), { status: 400, code: "INVALID_DIDIT_PAYLOAD" });
  }

  const payloadHash = await sha256(rawBody);
  const eventId = cleanText(String(payload.event_id || ""), 180)
    || await sha256(`${sessionId}:${webhookType}:${status}:${incomingTimestamp}:${payloadHash}`);
  return { payload, rawBody, payloadHash, eventId, sessionId, webhookType, status, signatureMethod: "X-Signature-V2", incomingTimestamp };
}

function webhookMetadata(payload) {
  return {
    workflowId: cleanText(String(payload.workflow_id || ""), 180) || null,
    workflowVersion: Number.isFinite(Number(payload.workflow_version)) ? Number(payload.workflow_version) : null,
    vendorData: cleanText(String(payload.vendor_data || ""), 220) || null,
    sessionKind: cleanText(String(payload.session_kind || "user"), 40) || "user",
    applicationId: cleanText(String(payload.application_id || ""), 180) || null,
    createdAt: payload.created_at || null,
    hasDecision: Boolean(payload.decision)
  };
}

export async function acceptDiditWebhook(env, verified) {
  await ensureDiditWebhookSchema(env);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`INSERT INTO identity_verification_webhook_events
    (event_id,provider,provider_session_id,webhook_type,status,environment,signature_method,received_at,
     processing_status,payload_hash,metadata_json)
    VALUES (?,'didit',?,?,?,?,? ,?,'received',?,?)
    ON CONFLICT(event_id) DO NOTHING`)
    .bind(
      verified.eventId,
      verified.sessionId,
      verified.webhookType,
      verified.status,
      cleanText(String(verified.payload.environment || "live"), 40) || "live",
      verified.signatureMethod,
      now,
      verified.payloadHash,
      jsonValue(webhookMetadata(verified.payload), {})
    ).run();
  return { accepted: Number(result?.meta?.changes || 0) > 0, eventId: verified.eventId, receivedAt: now };
}

function vendorCandidates(value) {
  const raw = cleanText(String(value || ""), 220);
  const values = new Set([raw]);
  for (const prefix of ["ucn:", "customer:", "customer_id:"]) {
    if (raw.toLowerCase().startsWith(prefix)) values.add(raw.slice(prefix.length));
  }
  return [...values].filter(Boolean);
}

async function resolveWebhookCustomer(env, payload, session) {
  if (session?.customer_id) return env.DB.prepare("SELECT * FROM customers WHERE id=? LIMIT 1").bind(session.customer_id).first();
  for (const candidate of vendorCandidates(payload.vendor_data)) {
    const customer = await env.DB.prepare("SELECT * FROM customers WHERE id=? OR customer_number=? LIMIT 1").bind(candidate, candidate).first();
    if (customer) return customer;
  }
  const metadataCustomer = cleanText(String(payload.metadata?.customer_id || payload.metadata?.customerNumber || payload.metadata?.ucn || ""), 220);
  if (metadataCustomer) return env.DB.prepare("SELECT * FROM customers WHERE id=? OR customer_number=? LIMIT 1").bind(metadataCustomer, metadataCustomer).first();
  return null;
}

async function activeEnhancedVerificationRestriction(env, customerId, preferredId = null) {
  if (preferredId) {
    const preferred = await env.DB.prepare(`SELECT * FROM restrictions
      WHERE id=? AND customer_id=? AND status='active' AND restriction_type='REQUIRE_ENHANCED_VERIFICATION' LIMIT 1`)
      .bind(preferredId, customerId).first();
    if (preferred) return preferred;
  }
  return env.DB.prepare(`SELECT * FROM restrictions
    WHERE customer_id=? AND status='active' AND restriction_type='REQUIRE_ENHANCED_VERIFICATION'
      AND (expires_at IS NULL OR expires_at>?) ORDER BY applied_at DESC LIMIT 1`)
    .bind(customerId, new Date().toISOString()).first();
}

async function writeTimeline(env, customer, sessionId, status, webhookType, eventId) {
  const title = status === "Approved" ? "Identity verification approved"
    : status === "Declined" ? "Identity verification declined"
      : status === "In Review" ? "Identity verification sent for review"
        : `Identity verification ${status.toLowerCase()}`;
  await env.DB.prepare(`INSERT INTO customer_timeline_events
    (id,customer_id,platform_id,event_type,event_category,title,summary,occurred_at,source_reference,metadata_json)
    VALUES (?,?,NULL,'identity.verification.status','security',?,?,?,?,?)`)
    .bind(
      crypto.randomUUID(), customer.id, title,
      `Didit verification session ${sessionId} changed to ${status}.`,
      new Date().toISOString(), sessionId,
      jsonValue({ provider: DIDIT_PROVIDER, webhookType, eventId, status }, {})
    ).run();
}

async function writeSystemAudit(env, customer, sessionId, status, eventId, restrictionId = null) {
  await env.DB.prepare(`INSERT INTO audit_events
    (id,occurred_at,actor_type,actor_id,actor_name,action,action_label,entity_type,entity_id,
     entity_reference,customer_id,request_id,before_json,after_json,metadata_json)
    VALUES (?,?,'system','didit','Didit Identity Verification','identity.verification.status',?,
      'identity_verification',?,?,?,?,NULL,NULL,?,?)`)
    .bind(
      crypto.randomUUID(), new Date().toISOString(),
      `Didit verification ${status.toLowerCase()}`,
      sessionId, sessionId, customer.id,
      jsonValue({ status, restrictionId }, {}),
      jsonValue({ provider: DIDIT_PROVIDER, eventId }, {})
    ).run();
}

async function recordDeclinedSignal(env, customer, eventId, sessionId) {
  const existing = await env.DB.prepare("SELECT id FROM fraud_signals WHERE source_event_id=? AND signal_type='IDENTITY_VERIFICATION_DECLINED' LIMIT 1")
    .bind(eventId).first();
  if (existing) return;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO fraud_signals
    (id,customer_id,platform_id,source_event_id,signal_type,risk_score,severity,status,reason,evidence_json,created_at,updated_at)
    VALUES (?,?,NULL,?,'IDENTITY_VERIFICATION_DECLINED',70,'high','open',?,?,?,?)`)
    .bind(crypto.randomUUID(), customer.id, eventId,
      "The enhanced identity-verification provider returned a declined result.",
      jsonValue({ provider: DIDIT_PROVIDER, sessionId }, {}), now, now).run();
}

async function liftEnhancedVerificationRestriction(env, customer, restriction, sessionId, eventId) {
  if (!restriction) return { lifted: false, reason: "No active enhanced-verification restriction was linked." };
  const now = new Date().toISOString();
  const update = await env.DB.prepare(`UPDATE restrictions SET status='lifted',lifted_by=NULL,lifted_at=?
    WHERE id=? AND customer_id=? AND status='active' AND restriction_type='REQUIRE_ENHANCED_VERIFICATION'`)
    .bind(now, restriction.id, customer.id).run();
  if (Number(update?.meta?.changes || 0) === 0) return { lifted: false, reason: "The restriction was already inactive." };
  await recalculateCustomerSecurity(env, customer.id);
  const enforcement = await liftRestrictionEnforcement(env, restriction);
  await env.DB.prepare(`INSERT INTO customer_timeline_events
    (id,customer_id,platform_id,event_type,event_category,title,summary,occurred_at,source_reference,metadata_json)
    VALUES (?,?,NULL,'restriction.lifted_after_verification','security','Enhanced-verification restriction lifted',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), customer.id,
      "Didit approved the linked identity-verification session. Connected websites were instructed to refresh access.",
      now, restriction.id,
      jsonValue({ provider: DIDIT_PROVIDER, sessionId, eventId, enforcement }, {})).run();
  return { lifted: true, restrictionId: restriction.id, enforcement };
}

export async function processDiditWebhook(env, verified) {
  await ensureDiditWebhookSchema(env);
  const event = await env.DB.prepare("SELECT processing_status FROM identity_verification_webhook_events WHERE event_id=? LIMIT 1")
    .bind(verified.eventId).first();
  if (!event) throw new Error("The accepted Didit webhook event could not be found.");
  if (["processed", "unmatched", "ignored"].includes(event.processing_status)) return { duplicate: true, status: event.processing_status };

  const payload = verified.payload;
  const now = new Date().toISOString();
  const existingSession = await env.DB.prepare("SELECT * FROM identity_verification_sessions WHERE provider_session_id=? LIMIT 1")
    .bind(verified.sessionId).first();
  const customer = await resolveWebhookCustomer(env, payload, existingSession);
  if (!customer) {
    await env.DB.prepare(`UPDATE identity_verification_webhook_events
      SET processing_status='unmatched',processed_at=?,error_message=? WHERE event_id=?`)
      .bind(now, "No universal customer record matched the Didit vendor data or session.", verified.eventId).run();
    return { unmatched: true };
  }

  const restriction = await activeEnhancedVerificationRestriction(env, customer.id, existingSession?.restriction_id || null);
  const createdAt = epochToIso(payload.created_at || payload.timestamp, now);
  const metadata = {
    workflowVersion: Number.isFinite(Number(payload.workflow_version)) ? Number(payload.workflow_version) : null,
    sessionKind: cleanText(String(payload.session_kind || "user"), 40) || "user",
    latestWebhookEventId: verified.eventId,
    latestWebhookType: verified.webhookType,
    decisionPresent: Boolean(payload.decision)
  };

  if (existingSession) {
    await env.DB.prepare(`UPDATE identity_verification_sessions SET customer_id=?,restriction_id=COALESCE(restriction_id,?),
      workflow_id=COALESCE(?,workflow_id),environment=?,status=?,decision=?,updated_at=?,
      completed_at=CASE WHEN ?=1 THEN COALESCE(completed_at,?) ELSE completed_at END,metadata_json=?
      WHERE id=?`)
      .bind(customer.id, restriction?.id || null, cleanText(String(payload.workflow_id || ""), 180) || null,
        cleanText(String(payload.environment || existingSession.environment || "live"), 40) || "live",
        verified.status, verified.status, now, TERMINAL_STATUSES.has(verified.status) ? 1 : 0, now,
        jsonValue(metadata, {}), existingSession.id).run();
  } else {
    await env.DB.prepare(`INSERT INTO identity_verification_sessions
      (id,customer_id,platform_id,restriction_id,provider,provider_session_id,workflow_id,environment,status,decision,
       vendor_data,created_at,updated_at,completed_at,metadata_json)
      VALUES (?,?,NULL,?,'didit',?,?,?,?,?,?,?, ?,?,?,?)`)
      .bind(crypto.randomUUID(), customer.id, restriction?.id || null, verified.sessionId,
        cleanText(String(payload.workflow_id || ""), 180) || null,
        cleanText(String(payload.environment || "live"), 40) || "live",
        verified.status, verified.status,
        cleanText(String(payload.vendor_data || customer.customer_number || customer.id), 220),
        createdAt, now, TERMINAL_STATUSES.has(verified.status) ? now : null, jsonValue(metadata, {})).run();
  }

  let restrictionOutcome = null;
  if (verified.status === "Approved") {
    restrictionOutcome = await liftEnhancedVerificationRestriction(env, customer, restriction, verified.sessionId, verified.eventId);
  } else if (verified.status === "Declined") {
    await recordDeclinedSignal(env, customer, verified.eventId, verified.sessionId);
  }

  await writeTimeline(env, customer, verified.sessionId, verified.status, verified.webhookType, verified.eventId);
  await writeSystemAudit(env, customer, verified.sessionId, verified.status, verified.eventId, restriction?.id || null);
  await env.DB.prepare(`UPDATE identity_verification_webhook_events
    SET processing_status='processed',processed_at=?,error_message=NULL WHERE event_id=?`)
    .bind(now, verified.eventId).run();
  return { processed: true, customerId: customer.id, customerNumber: customer.customer_number, restrictionOutcome };
}

export async function markDiditWebhookFailed(env, eventId, error) {
  if (!env?.DB || !eventId) return;
  await ensureDiditWebhookSchema(env).catch(() => null);
  await env.DB.prepare(`UPDATE identity_verification_webhook_events
    SET processing_status='failed',processed_at=?,error_message=? WHERE event_id=?`)
    .bind(new Date().toISOString(), cleanText(error instanceof Error ? error.message : String(error), 1000), eventId).run().catch(() => null);
}
