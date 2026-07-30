import { audit, cleanText, sha256 } from "./_shared.js";
import { ensureDiditWebhookSchema } from "./_didit-webhook.js";
import { findCustomer, recalculateCustomerSecurity } from "./_operations.js";
import { applyRestrictionEnforcement, liftRestrictionEnforcement } from "./_central-access.js";
import { findPlatform, jsonValue } from "./_central-schema.js";
import { ageAssuranceDeployment, ensureAgeAssuranceSchema } from "./_age-assurance.js";

const DIDIT_BASE_URL = "https://verification.didit.me";
const ACTIVE_STATUSES = new Set(["Not Started", "Awaiting User", "In Progress", "In Review", "Resubmitted"]);
const TERMINAL_STATUSES = new Set(["Approved", "Declined", "Expired", "Abandoned", "Kyc Expired", "Cancelled"]);
const PURPOSES = new Set(["identity_security", "fraud_investigation", "account_recovery", "random_selection", "age_verification"]);
const ACCESS_MODES = new Set(["request_only", "require_before_access"]);

function normaliseStatus(value) {
  const raw = cleanText(String(value || ""), 80).replaceAll("_", " ").trim();
  const known = {
    "not started": "Not Started",
    "awaiting user": "Awaiting User",
    "in progress": "In Progress",
    "in review": "In Review",
    approved: "Approved",
    declined: "Declined",
    expired: "Expired",
    abandoned: "Abandoned",
    "kyc expired": "Kyc Expired",
    resubmitted: "Resubmitted",
    cancelled: "Cancelled"
  };
  return known[raw.toLowerCase()] || raw || "Unknown";
}

function workflowForPurpose(env, purpose) {
  if (purpose === "age_verification") return cleanText(env.DIDIT_AGE_WORKFLOW_ID, 180);
  return cleanText(env.DIDIT_WORKFLOW_ID, 180);
}

export function diditConfiguration(env) {
  return {
    apiKeyConfigured: Boolean(cleanText(env.DIDIT_API_KEY, 500)),
    webhookSecretConfigured: Boolean(cleanText(env.DIDIT_WEBHOOK_SECRET, 500)),
    identityWorkflowConfigured: Boolean(cleanText(env.DIDIT_WORKFLOW_ID, 180)),
    ageWorkflowConfigured: Boolean(cleanText(env.DIDIT_AGE_WORKFLOW_ID, 180))
  };
}

async function diditRequest(env, path, options = {}) {
  const apiKey = cleanText(env.DIDIT_API_KEY, 500);
  if (!apiKey) throw Object.assign(new Error("The Didit API key is not configured in CustomerOps."), { code: "DIDIT_API_NOT_CONFIGURED", status: 503 });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${DIDIT_BASE_URL}${path}`, {
      ...options,
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = cleanText(
        typeof payload?.detail === "string" ? payload.detail
          : payload?.error?.message || payload?.message || `Didit returned HTTP ${response.status}.`,
        1000
      );
      throw Object.assign(new Error(message || "Didit could not complete the request."), {
        code: response.status === 401 ? "DIDIT_API_KEY_REJECTED" : response.status === 403 ? "DIDIT_API_PERMISSION_DENIED" : "DIDIT_API_REQUEST_FAILED",
        status: response.status >= 500 ? 502 : response.status,
        providerStatus: response.status
      });
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") throw Object.assign(new Error("Didit did not respond within the secure timeout."), { code: "DIDIT_TIMEOUT", status: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function platformForScope(env, reference) {
  const value = cleanText(reference, 120);
  if (!value || value === "company_wide") return null;
  return findPlatform(env, value);
}

async function requiredAgeForPurpose(env, input, purpose, platform) {
  if (purpose !== "age_verification") return null;
  const supplied = Number(input.requiredAge);
  if (Number.isInteger(supplied) && supplied >= 13 && supplied <= 25) return supplied;
  if (platform) {
    const deployment = await ageAssuranceDeployment(env, platform);
    if (deployment.configured && Number.isInteger(deployment.minimumAge)) return deployment.minimumAge;
  }
  throw Object.assign(new Error("Select the customer age threshold required for this verification."), {
    code: "AGE_THRESHOLD_REQUIRED",
    status: 400
  });
}

async function activeVerificationRestriction(env, customerId, scope) {
  return env.DB.prepare(`SELECT r.*,t.enforcement_action,t.label restriction_label
    FROM restrictions r LEFT JOIN restriction_types t ON t.code=r.restriction_type
    WHERE r.customer_id=? AND r.restriction_type='REQUIRE_ENHANCED_VERIFICATION' AND r.status='active'
      AND r.scope=? AND (r.expires_at IS NULL OR r.expires_at>?)
    ORDER BY r.applied_at DESC LIMIT 1`)
    .bind(customerId, scope, new Date().toISOString()).first();
}

async function ensureVerificationRestriction(env, session, customer, scope, reason) {
  const existing = await activeVerificationRestriction(env, customer.id, scope);
  if (existing) return { restriction: existing, created: false, enforcement: null };
  const type = await env.DB.prepare("SELECT * FROM restriction_types WHERE code='REQUIRE_ENHANCED_VERIFICATION' AND status='active' LIMIT 1").first();
  if (!type) throw Object.assign(new Error("The enhanced-verification restriction catalogue is unavailable."), { code: "VERIFICATION_RESTRICTION_UNAVAILABLE", status: 503 });
  const now = new Date().toISOString();
  const restriction = {
    id: crypto.randomUUID(),
    customer_id: customer.id,
    restriction_type: "REQUIRE_ENHANCED_VERIFICATION",
    scope,
    reason,
    applied_at: now
  };
  await env.DB.prepare(`INSERT INTO restrictions
    (id,customer_id,case_id,marker_id,restriction_type,scope,reason,status,applied_by,applied_at,review_at,expires_at)
    VALUES (?,?,NULL,NULL,'REQUIRE_ENHANCED_VERIFICATION',?,?,'active',?,?,?,NULL)`)
    .bind(restriction.id, customer.id, scope, reason, session.sub, now, new Date(Date.now() + 14 * 86_400_000).toISOString()).run();
  await recalculateCustomerSecurity(env, customer.id);
  const enforcement = await applyRestrictionEnforcement(env, restriction, type);
  return { restriction: { ...restriction, enforcement_action: type.enforcement_action }, created: true, enforcement };
}

async function liftLinkedRestriction(env, row) {
  if (!row?.restriction_id) return { lifted: false, reason: "No linked access requirement." };
  const restriction = await env.DB.prepare("SELECT * FROM restrictions WHERE id=? AND customer_id=? LIMIT 1")
    .bind(row.restriction_id, row.customer_id).first();
  if (!restriction || restriction.status !== "active") return { lifted: false, reason: "The linked access requirement is already inactive." };
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE restrictions SET status='cancelled',lifted_by=NULL,lifted_at=? WHERE id=? AND status='active'")
    .bind(now, restriction.id).run();
  await recalculateCustomerSecurity(env, row.customer_id);
  const enforcement = await liftRestrictionEnforcement(env, restriction);
  return { lifted: true, restrictionId: restriction.id, enforcement };
}

function sessionMetadata(input, actor, provider) {
  return {
    purpose: input.purpose,
    reason: input.reason,
    accessMode: input.accessMode,
    scope: input.scope,
    source: input.source || "manual",
    requiredAge: input.requiredAge || null,
    accountPopulation: "customers_only",
    staffAccountsExcluded: true,
    initiatedBy: actor.sub,
    initiatedByName: actor.displayName,
    notificationRequested: Boolean(input.sendNotificationEmails),
    providerSessionNumber: provider.session_number || null,
    workflowVersion: provider.workflow_version || null,
    sessionKind: provider.session_kind || "user"
  };
}

async function writeTimeline(env, customerId, title, summary, sourceReference, metadata = {}) {
  await env.DB.prepare(`INSERT INTO customer_timeline_events
    (id,customer_id,platform_id,event_type,event_category,title,summary,occurred_at,source_reference,metadata_json)
    VALUES (?,?,NULL,'identity.verification.request','security',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), customerId, title, summary, new Date().toISOString(), sourceReference || null, jsonValue(metadata, {})).run();
}

export async function createIdentityVerification(env, actor, input) {
  await ensureDiditWebhookSchema(env);
  await ensureAgeAssuranceSchema(env);
  const purpose = cleanText(input.purpose || "identity_security", 60);
  const accessMode = cleanText(input.accessMode || "request_only", 40);
  const reason = cleanText(input.reason, 2000);
  const source = cleanText(input.source || "manual", 60);
  if (!PURPOSES.has(purpose)) throw Object.assign(new Error("Select a valid verification purpose."), { code: "INVALID_VERIFICATION_PURPOSE", status: 400 });
  if (!ACCESS_MODES.has(accessMode)) throw Object.assign(new Error("Select a valid access-handling option."), { code: "INVALID_ACCESS_MODE", status: 400 });
  if (reason.length < 5) throw Object.assign(new Error("Enter a clear reason for requesting identity verification."), { code: "VERIFICATION_REASON_REQUIRED", status: 400 });
  const workflowId = workflowForPurpose(env, purpose);
  if (!workflowId) {
    const variable = purpose === "age_verification" ? "DIDIT_AGE_WORKFLOW_ID" : "DIDIT_WORKFLOW_ID";
    throw Object.assign(new Error(`${variable} is not configured in CustomerOps.`), { code: "DIDIT_WORKFLOW_NOT_CONFIGURED", status: 503 });
  }
  const customer = await findCustomer(env, cleanText(input.customerId || input.customerNumber, 120));
  if (!customer) throw Object.assign(new Error("The Universal Customer Record was not found."), { code: "CUSTOMER_NOT_FOUND", status: 404 });
  const requestedScope = cleanText(input.scope || input.platformId || "company_wide", 120);
  const platform = await platformForScope(env, requestedScope);
  if (requestedScope !== "company_wide" && !platform) throw Object.assign(new Error("Select a valid connected website or company-wide scope."), { code: "INVALID_VERIFICATION_SCOPE", status: 400 });
  const scope = platform?.id || "company_wide";
  const requiredAge = await requiredAgeForPurpose(env, input, purpose, platform);

  let restrictionOutcome = { restriction: null, created: false, enforcement: null };
  if (accessMode === "require_before_access") {
    restrictionOutcome = await ensureVerificationRestriction(env, actor, customer, scope, reason);
  }

  const providerPayload = await diditRequest(env, "/v3/session/", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: workflowId,
      vendor_data: `ucn:${customer.customer_number}`,
      callback_method: "both",
      language: "en",
      metadata: {
        customer_id: customer.id,
        customer_number: customer.customer_number,
        restriction_id: restrictionOutcome.restriction?.id || null,
        platform_id: platform?.id || null,
        purpose,
        required_age: requiredAge,
        account_population: "customers_only",
        source
      },
      contact_details: {
        email: customer.verified_email,
        send_notification_emails: Boolean(input.sendNotificationEmails),
        email_lang: "en"
      }
    })
  });
  const providerSessionId = cleanText(providerPayload.session_id, 180);
  const verificationUrl = cleanText(providerPayload.url || providerPayload.session_url, 1000);
  if (!providerSessionId || !verificationUrl) throw Object.assign(new Error("Didit did not return a usable hosted verification session."), { code: "DIDIT_INVALID_SESSION_RESPONSE", status: 502 });
  const now = new Date().toISOString();
  const status = normaliseStatus(providerPayload.status || "Not Started");
  const localId = crypto.randomUUID();
  const metadata = sessionMetadata({ purpose, accessMode, reason, scope, source, requiredAge, sendNotificationEmails: input.sendNotificationEmails }, actor, providerPayload);
  await env.DB.prepare(`INSERT INTO identity_verification_sessions
    (id,customer_id,platform_id,restriction_id,provider,provider_session_id,workflow_id,environment,status,decision,
     verification_url_hash,vendor_data,return_url,consent_recorded_at,consent_version,created_at,updated_at,completed_at,expires_at,
     verification_purpose,required_age,metadata_json)
    VALUES (?,?,?,?,'didit',?,?,'live',?,NULL,?,?,NULL,NULL,NULL,?,?,NULL,NULL,?,?,?)
    ON CONFLICT(provider_session_id) DO UPDATE SET customer_id=excluded.customer_id,platform_id=excluded.platform_id,
      restriction_id=COALESCE(identity_verification_sessions.restriction_id,excluded.restriction_id),workflow_id=excluded.workflow_id,
      status=excluded.status,verification_url_hash=excluded.verification_url_hash,updated_at=excluded.updated_at,
      verification_purpose=excluded.verification_purpose,required_age=excluded.required_age,metadata_json=excluded.metadata_json`)
    .bind(localId, customer.id, platform?.id || null, restrictionOutcome.restriction?.id || null,
      providerSessionId, workflowId, status, await sha256(verificationUrl), `ucn:${customer.customer_number}`, now, now,
      purpose, requiredAge, jsonValue(metadata, {})).run();
  const stored = await env.DB.prepare("SELECT id FROM identity_verification_sessions WHERE provider_session_id=? LIMIT 1").bind(providerSessionId).first();
  const sessionId = stored?.id || localId;
  await writeTimeline(env, customer.id, purpose === "age_verification" ? "Age assurance requested" : "Identity verification requested", `${actor.displayName} started a Didit ${purpose.replaceAll("_", " ")} request.`, providerSessionId, {
    purpose, requiredAge, accessMode, scope, platformId: platform?.id || null, restrictionId: restrictionOutcome.restriction?.id || null,
    accountPopulation: "customers_only", staffAccountsExcluded: true
  });
  await audit(env, actor, "identity.verification.create", "identity_verification", sessionId, {
    label: purpose === "age_verification" ? "Didit customer age assurance started" : "Didit identity verification started",
    reference: customer.customer_number,
    customerId: customer.id,
    after: { providerSessionId, purpose, requiredAge, accessMode, scope, status, platformId: platform?.id || null, restrictionId: restrictionOutcome.restriction?.id || null },
    metadata: { provider: "didit", source, accountPopulation: "customers_only", staffAccountsExcluded: true }
  });
  return {
    session: { id: sessionId, providerSessionId, status, purpose, requiredAge, accessMode, scope, customerNumber: customer.customer_number, customerName: customer.display_name },
    verificationUrl,
    restriction: restrictionOutcome.restriction,
    enforcement: restrictionOutcome.enforcement
  };
}

export async function refreshIdentityVerification(env, actor, id) {
  await ensureDiditWebhookSchema(env);
  const row = await env.DB.prepare(`SELECT s.*,c.customer_number,c.display_name FROM identity_verification_sessions s
    JOIN customers c ON c.id=s.customer_id WHERE s.id=? OR s.provider_session_id=? LIMIT 1`).bind(id, id).first();
  if (!row) throw Object.assign(new Error("The identity-verification request was not found."), { code: "VERIFICATION_NOT_FOUND", status: 404 });
  const provider = await diditRequest(env, `/v3/session/${encodeURIComponent(row.provider_session_id)}/decision/`, { method: "GET" });
  const status = normaliseStatus(provider.status || provider.decision?.status || row.status);
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE identity_verification_sessions SET status=?,decision=?,updated_at=?,
    completed_at=CASE WHEN ?=1 THEN COALESCE(completed_at,?) ELSE completed_at END,
    metadata_json=? WHERE id=?`)
    .bind(status, status, now, TERMINAL_STATUSES.has(status) ? 1 : 0, now,
      jsonValue({ ...(JSON.parse(row.metadata_json || "{}")), refreshedBy: actor.sub, refreshedAt: now, providerDecisionPresent: Boolean(provider.decision || provider.id_verifications) }, {}), row.id).run();
  let restrictionOutcome = null;
  if (status === "Approved" && row.restriction_id) restrictionOutcome = await liftLinkedRestriction(env, row);
  await audit(env, actor, "identity.verification.refresh", "identity_verification", row.id, {
    label: "Didit verification status refreshed",
    reference: row.customer_number,
    customerId: row.customer_id,
    before: { status: row.status },
    after: { status, restrictionOutcome },
    metadata: { provider: "didit", providerSessionId: row.provider_session_id }
  });
  return { id: row.id, status, restrictionOutcome };
}

export async function resumeIdentityVerification(env, actor, id) {
  await ensureDiditWebhookSchema(env);
  const row = await env.DB.prepare(`SELECT s.*,c.customer_number,c.display_name,c.verified_email FROM identity_verification_sessions s
    JOIN customers c ON c.id=s.customer_id WHERE s.id=? OR s.provider_session_id=? LIMIT 1`).bind(id, id).first();
  if (!row) throw Object.assign(new Error("The identity-verification request was not found."), { code: "VERIFICATION_NOT_FOUND", status: 404 });
  const metadata = (() => { try { return JSON.parse(row.metadata_json || "{}"); } catch { return {}; } })();
  const provider = await diditRequest(env, "/v3/session/", {
    method: "POST",
    body: JSON.stringify({
      workflow_id: row.workflow_id,
      vendor_data: row.vendor_data,
      callback_method: "both",
      language: "en",
      metadata: { customer_id: row.customer_id, customer_number: row.customer_number, restriction_id: row.restriction_id || null, purpose: metadata.purpose || "identity_security", required_age: row.required_age || metadata.requiredAge || null, account_population: "customers_only", source: "resume" },
      contact_details: { email: row.verified_email, send_notification_emails: false, email_lang: "en" }
    })
  });
  const verificationUrl = cleanText(provider.url || provider.session_url, 1000);
  if (!verificationUrl) throw Object.assign(new Error("Didit did not return the hosted verification URL."), { code: "DIDIT_INVALID_SESSION_RESPONSE", status: 502 });
  const status = normaliseStatus(provider.status || row.status);
  await env.DB.prepare("UPDATE identity_verification_sessions SET status=?,verification_url_hash=?,updated_at=? WHERE id=?")
    .bind(status, await sha256(verificationUrl), new Date().toISOString(), row.id).run();
  await audit(env, actor, "identity.verification.resume", "identity_verification", row.id, {
    label: "Didit verification link resumed",
    reference: row.customer_number,
    customerId: row.customer_id,
    after: { status },
    metadata: { provider: "didit", providerSessionId: row.provider_session_id }
  });
  return { id: row.id, status, verificationUrl };
}

export async function cancelIdentityVerification(env, actor, id, reason) {
  await ensureDiditWebhookSchema(env);
  const row = await env.DB.prepare(`SELECT s.*,c.customer_number,c.display_name FROM identity_verification_sessions s
    JOIN customers c ON c.id=s.customer_id WHERE s.id=? OR s.provider_session_id=? LIMIT 1`).bind(id, id).first();
  if (!row) throw Object.assign(new Error("The identity-verification request was not found."), { code: "VERIFICATION_NOT_FOUND", status: 404 });
  const cancellationReason = cleanText(reason, 1000);
  if (cancellationReason.length < 5) throw Object.assign(new Error("Enter a reason for cancelling the request."), { code: "CANCELLATION_REASON_REQUIRED", status: 400 });
  const restrictionOutcome = await liftLinkedRestriction(env, row);
  const now = new Date().toISOString();
  const metadata = (() => { try { return JSON.parse(row.metadata_json || "{}"); } catch { return {}; } })();
  await env.DB.prepare("UPDATE identity_verification_sessions SET status='Cancelled',decision='Cancelled',updated_at=?,completed_at=COALESCE(completed_at,?),metadata_json=? WHERE id=?")
    .bind(now, now, jsonValue({ ...metadata, cancelledBy: actor.sub, cancelledAt: now, cancellationReason }, {}), row.id).run();
  await writeTimeline(env, row.customer_id, "Identity verification cancelled", cancellationReason, row.provider_session_id, { restrictionOutcome });
  await audit(env, actor, "identity.verification.cancel", "identity_verification", row.id, {
    label: "Didit verification request cancelled",
    reference: row.customer_number,
    customerId: row.customer_id,
    before: { status: row.status },
    after: { status: "Cancelled", restrictionOutcome },
    metadata: { provider: "didit", reason: cancellationReason }
  });
  return { id: row.id, status: "Cancelled", restrictionOutcome };
}

export async function randomVerificationCandidates(env, count = 5) {
  await ensureDiditWebhookSchema(env);
  const limit = Math.max(1, Math.min(25, Number(count) || 5));
  const result = await env.DB.prepare(`SELECT c.id,c.customer_number,c.display_name,c.verified_email,c.account_status,c.security_status
    FROM customers c
    WHERE c.account_status='active'
      AND NOT EXISTS (SELECT 1 FROM identity_verification_sessions s WHERE s.customer_id=c.id AND s.status IN ('Not Started','Awaiting User','In Progress','In Review','Resubmitted'))
      AND NOT EXISTS (SELECT 1 FROM restrictions r WHERE r.customer_id=c.id AND r.status='active' AND r.restriction_type='REQUIRE_ENHANCED_VERIFICATION')
    ORDER BY RANDOM() LIMIT ?`).bind(limit).all();
  return result.results || [];
}

export async function listIdentityVerifications(env, filters = {}) {
  await ensureDiditWebhookSchema(env);
  await ensureAgeAssuranceSchema(env);
  const q = cleanText(filters.q, 160);
  const status = cleanText(filters.status, 80);
  const customerId = cleanText(filters.customerId || filters.customerNumber, 120);
  const purpose = cleanText(filters.purpose, 60);
  const where = ["1=1"];
  const binds = [];
  if (q) { where.push("(c.customer_number LIKE ? OR c.display_name LIKE ? OR c.verified_email LIKE ? OR s.provider_session_id LIKE ?)"); const term = `%${q}%`; binds.push(term, term, term, term); }
  if (status) { where.push("s.status=?"); binds.push(status); }
  if (customerId) { where.push("(c.id=? OR c.customer_number=?)"); binds.push(customerId, customerId); }
  if (purpose) { where.push("(s.verification_purpose=? OR json_extract(s.metadata_json,'$.purpose')=?)"); binds.push(purpose, purpose); }
  const rows = await env.DB.prepare(`SELECT s.*,c.customer_number,c.display_name customer_name,c.verified_email customer_email,
      p.code platform_code,p.name platform_name,r.status restriction_status,r.scope restriction_scope
    FROM identity_verification_sessions s JOIN customers c ON c.id=s.customer_id
    LEFT JOIN platforms p ON p.id=s.platform_id LEFT JOIN restrictions r ON r.id=s.restriction_id
    WHERE ${where.join(" AND ")} ORDER BY s.updated_at DESC LIMIT 250`).bind(...binds).all();
  const events = await env.DB.prepare(`SELECT event_id,provider_session_id,webhook_type,status,processing_status,received_at,processed_at,error_message
    FROM identity_verification_webhook_events ORDER BY received_at DESC LIMIT 50`).all();
  const counts = await env.DB.prepare(`SELECT status,COUNT(*) count FROM identity_verification_sessions GROUP BY status`).all();
  const latestWebhook = events.results?.[0] || null;
  return {
    configuration: diditConfiguration(env),
    sessions: (rows.results || []).map(row => ({ ...row, metadata: (() => { try { return JSON.parse(row.metadata_json || "{}"); } catch { return {}; } })() })),
    webhookEvents: events.results || [],
    counts: Object.fromEntries((counts.results || []).map(row => [row.status, Number(row.count || 0)])),
    latestWebhook
  };
}

export { ACTIVE_STATUSES, PURPOSES, ACCESS_MODES };
