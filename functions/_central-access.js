import { cleanText } from "./_shared.js";
import { ensureCustomerDirectorySchema, manageCustomerDirectoryAccount } from "./_customer-entra.js";
import { ensureCentralPlatformSchema, findPlatform, jsonValue } from "./_central-schema.js";
import { ageAssuranceForAccess } from "./_age-assurance.js";

export async function resolvePlatformCustomer(env, platform, input = {}) {
  await ensureCentralPlatformSchema(env);
  const ucn = cleanText(input.customerNumber || input.ucn, 20);
  if (ucn) {
    const customer = await env.DB.prepare("SELECT * FROM customers WHERE customer_number=? LIMIT 1").bind(ucn).first();
    if (customer) return customer;
  }
  const accountId = cleanText(input.platformCustomerId || input.platformAccountId, 180);
  if (accountId && platform?.id) {
    const customer = await env.DB.prepare(`SELECT c.* FROM customer_platform_accounts a
      JOIN customers c ON c.id=a.customer_id WHERE a.platform_id=? AND a.external_account_id=? LIMIT 1`)
      .bind(platform.id,accountId).first();
    if (customer) return customer;
  }
  const tenantId = cleanText(input.entraTenantId || input.tenantId, 120);
  const objectId = cleanText(input.entraObjectId || input.objectId, 120);
  if (tenantId && objectId) {
    const customer = await env.DB.prepare(`SELECT c.* FROM customer_directory_identities i
      JOIN customers c ON c.id=i.customer_id WHERE i.tenant_id=? AND i.object_id=? LIMIT 1`)
      .bind(tenantId,objectId).first();
    if (customer) return customer;
  }
  return null;
}

export async function activeRestrictionsForPlatform(env, customerId, platform) {
  await ensureCentralPlatformSchema(env);
  const now = new Date().toISOString();
  const result = await env.DB.prepare(`SELECT r.id,r.restriction_type,r.scope,r.reason,r.review_at,r.expires_at,
      t.label,t.enforcement_action
    FROM restrictions r LEFT JOIN restriction_types t ON t.code=r.restriction_type
    WHERE r.customer_id=? AND r.status='active' AND (r.expires_at IS NULL OR r.expires_at>?)
      AND (r.scope='company_wide' OR r.scope=? OR upper(r.scope)=upper(?))
    ORDER BY r.applied_at DESC`).bind(customerId,now,platform.id,platform.code).all();
  return result.results || [];
}

function branchRestrictionSummary(restriction) {
  return {
    id: restriction.id,
    restrictionType: restriction.restriction_type,
    label: restriction.label || restriction.restriction_type,
    scope: restriction.scope,
    enforcementAction: restriction.enforcement_action || restriction.restriction_type,
    reviewAt: restriction.review_at || null,
    expiresAt: restriction.expires_at || null,
    instruction: "Apply the Head Office access decision and contact Head Office for confidential case reasoning.",
    confidentialReasonWithheld: true
  };
}

export async function calculateAccessDecision(env, customer, platform, record = true) {
  const [restrictions, ageAssurance] = await Promise.all([
    activeRestrictionsForPlatform(env,customer.id,platform),
    ageAssuranceForAccess(env,customer,platform)
  ]);
  const actions = new Set(restrictions.map(item => item.enforcement_action || item.restriction_type));
  let decision = "allow";
  let revokeSessions = false;
  let reason = "No Head Office access-blocking control is active.";
  if (["closed","archived"].includes(customer.account_status)) {
    decision = "deny"; revokeSessions = true; reason = "The universal customer record is closed or archived.";
  } else if (customer.account_status === "suspended") {
    decision = "deny"; revokeSessions = true; reason = "The universal customer account is suspended by Head Office.";
  } else if (actions.has("deny_authentication") || restrictions.some(item => item.restriction_type === "BLOCK_SIGN_IN")) {
    decision = "deny"; revokeSessions = true; reason = "Head Office has blocked customer sign-in for this service.";
  } else if (actions.has("require_enhanced_verification")) {
    decision = "step_up"; reason = "Enhanced identity verification is required before access can continue.";
  } else if (actions.has("revoke_sessions")) {
    decision = "review"; revokeSessions = true; reason = "Existing sessions must be revoked and the customer must sign in again.";
  } else if (customer.security_status === "critical") {
    decision = "review"; reason = "The customer is subject to a critical Head Office security review.";
  } else if (ageAssurance.decision === "deny") {
    decision = "deny"; reason = ageAssurance.reason;
  } else if (ageAssurance.decision === "step_up") {
    decision = "step_up"; reason = ageAssurance.reason;
  }
  const result = {
    decision,
    revokeSessions,
    reason,
    restrictions: restrictions.map(branchRestrictionSummary),
    confidentialRestrictionReasonsWithheld: true,
    ageAssurance
  };
  if (record) await env.DB.prepare(`INSERT INTO customer_access_decisions
    (id,customer_id,platform_id,decision,revoke_sessions,reason,restrictions_json,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),customer.id,platform.id,decision,revokeSessions?1:0,
      reason,jsonValue(restrictions,[]),new Date().toISOString()).run();
  return result;
}

async function targetPlatforms(env, scope) {
  if (scope === "company_wide") {
    const rows = await env.DB.prepare("SELECT * FROM platforms WHERE status!='disabled' ORDER BY name").all();
    return rows.results || [];
  }
  const platform = await findPlatform(env,scope);
  return platform ? [platform] : [];
}

async function queueCommand(env, platformId, customerId, restrictionId, command, reason) {
  const existing = await env.DB.prepare(`SELECT id FROM platform_enforcement_commands
    WHERE platform_id=? AND customer_id=? AND restriction_id IS ? AND command=?
      AND status IN ('pending','delivered') LIMIT 1`).bind(platformId,customerId,restrictionId || null,command).first();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO platform_enforcement_commands
    (id,platform_id,customer_id,restriction_id,command,reason,status,created_at)
    VALUES (?,?,?,?,?,?,'pending',?)`).bind(id,platformId,customerId,restrictionId || null,command,
      cleanText(reason,1000),new Date().toISOString()).run();
  return id;
}

async function linkedDirectoryIdentity(env, customerId) {
  await ensureCustomerDirectorySchema(env);
  return env.DB.prepare(`SELECT id FROM customer_directory_identities
    WHERE customer_id=? AND directory_status!='deleted' ORDER BY last_synced_at DESC LIMIT 1`).bind(customerId).first();
}

async function applyMicrosoftControl(env, customerId, action) {
  const identity = await linkedDirectoryIdentity(env,customerId);
  if (!identity) return { status:"not_linked",message:"No JA Group Services ID identity is linked to this UCN." };
  if (action === "suspend") {
    const account = await manageCustomerDirectoryAccount(env,identity.id,"suspend");
    const sessions = await manageCustomerDirectoryAccount(env,identity.id,"revoke_sessions");
    return { status:"enforced",account,sessions };
  }
  if (action === "reactivate") {
    const account = await manageCustomerDirectoryAccount(env,identity.id,"reactivate");
    return { status:"enforced",account };
  }
  const sessions = await manageCustomerDirectoryAccount(env,identity.id,"revoke_sessions");
  return { status:"enforced",sessions };
}

async function writeTimeline(env, customerId, type, title, summary, reference, metadata) {
  await env.DB.prepare(`INSERT INTO customer_timeline_events
    (id,customer_id,platform_id,event_type,event_category,title,summary,occurred_at,source_reference,metadata_json)
    VALUES (?,?,NULL,?,'security',?,?,?,?,?)`).bind(crypto.randomUUID(),customerId,type,title,summary,
      new Date().toISOString(),reference || null,jsonValue(metadata,{})).run();
}

export async function applyRestrictionEnforcement(env, restriction, restrictionType) {
  await ensureCentralPlatformSchema(env);
  const platforms = await targetPlatforms(env,restriction.scope);
  const action = restrictionType?.enforcement_action || restriction.restriction_type;
  const command = action === "deny_authentication" ? "deny_access_and_revoke_sessions"
    : action === "revoke_sessions" ? "revoke_sessions"
    : action === "require_enhanced_verification" ? "require_enhanced_verification" : action;
  const commandIds = [];
  for (const platform of platforms) commandIds.push(await queueCommand(env,platform.id,restriction.customer_id,restriction.id,command,restriction.reason));
  let microsoft = { status:"not_required" };
  if (restriction.scope === "company_wide" && ["deny_authentication","revoke_sessions"].includes(action)) {
    try { microsoft = await applyMicrosoftControl(env,restriction.customer_id,action === "deny_authentication" ? "suspend" : "revoke_sessions"); }
    catch (error) { microsoft = { status:"failed",message:cleanText(error?.message || String(error),1000) }; }
  }
  if (["deny_authentication","revoke_sessions"].includes(action) && platforms.length) {
    const placeholders = platforms.map(() => "?").join(",");
    await env.DB.prepare(`UPDATE customer_sessions SET status='revocation_required',revocation_reason=?,
      revoked_at=COALESCE(revoked_at,?) WHERE customer_id=? AND platform_id IN (${placeholders}) AND status='active'`)
      .bind(restriction.reason,new Date().toISOString(),restriction.customer_id,...platforms.map(item=>item.id)).run();
  }
  await writeTimeline(env,restriction.customer_id,"restriction.applied","Head Office restriction applied",
    `${restriction.restriction_type} · ${restriction.scope} · ${restriction.reason}`,restriction.id,{action,commandIds,microsoft});
  return { action,commandIds,microsoft,targetPlatforms:platforms.map(item=>item.code) };
}

export async function liftRestrictionEnforcement(env, restriction) {
  await ensureCentralPlatformSchema(env);
  const platforms = await targetPlatforms(env,restriction.scope);
  const commandIds = [];
  for (const platform of platforms) commandIds.push(await queueCommand(env,platform.id,restriction.customer_id,restriction.id,
    "refresh_access_controls","Head Office lifted or cancelled a restriction."));
  let microsoft = { status:"not_required" };
  if (restriction.scope === "company_wide" && restriction.restriction_type === "BLOCK_SIGN_IN") {
    const remaining = await env.DB.prepare(`SELECT COUNT(*) count FROM restrictions
      WHERE customer_id=? AND status='active' AND scope='company_wide' AND restriction_type='BLOCK_SIGN_IN'
        AND id<>? AND (expires_at IS NULL OR expires_at>?)`).bind(restriction.customer_id,restriction.id,new Date().toISOString()).first();
    const customer = await env.DB.prepare("SELECT account_status FROM customers WHERE id=?").bind(restriction.customer_id).first();
    if (Number(remaining?.count || 0) === 0 && !["closed","archived"].includes(customer?.account_status)) {
      try { microsoft = await applyMicrosoftControl(env,restriction.customer_id,"reactivate"); }
      catch (error) { microsoft = { status:"failed",message:cleanText(error?.message || String(error),1000) }; }
    } else microsoft = { status:"retained",message:"Another company-wide block or closed record still applies." };
  }
  await writeTimeline(env,restriction.customer_id,"restriction.lifted","Head Office restriction lifted",
    `${restriction.restriction_type} · ${restriction.scope}`,restriction.id,{commandIds,microsoft});
  return { commandIds,microsoft,targetPlatforms:platforms.map(item=>item.code) };
}
