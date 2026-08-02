import { cleanNullableText, cleanText, sha256 } from "./_shared.js";

export const PRINCIPAL_ROLE = "HEAD_OFFICE_PRINCIPAL";
export const PRINCIPAL_PERMISSION = "*";
const SESSION_COOKIE = "__Host-ho_session";
const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

function objectIdConfiguration(env) {
  return [
    ["HOP-USER-001", String(env.ALFIE_ENTRA_OBJECT_ID || "").trim()],
    ["HOP-USER-002", String(env.JACK_ENTRA_OBJECT_ID || "").trim()]
  ];
}

function cookieValue(request, name = SESSION_COOKIE) {
  const prefix = `${name}=`;
  const part = (request.headers.get("Cookie") || "").split(";").map(value => value.trim()).find(value => value.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : "";
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function principalSessionCookie(token, maxAge = 28_800) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearPrincipalSessionCookie() {
  return principalSessionCookie("", 0);
}

export function hasFreshPrincipalAuthentication(session, maximumAgeMs = 15 * 60 * 1000) {
  const verifiedAt = Date.parse(session?.lastMfaAt || session?.createdAt || "");
  return Number.isFinite(verifiedAt) && Date.now() - verifiedAt <= maximumAgeMs;
}

export async function synchroniseConfiguredPrincipals(env) {
  const configured = objectIdConfiguration(env).filter(([, objectId]) => objectId);
  if (!configured.length) return;
  const now = new Date().toISOString();
  for (const [userId, objectId] of configured) {
    await env.DB.batch([
      env.DB.prepare(`UPDATE authorised_principals SET entra_object_id=?,status='active',configured_at=COALESCE(configured_at,?),
        configured_by='cloudflare_environment',updated_at=? WHERE portal_user_id=? AND (entra_object_id IS NULL OR entra_object_id=?)`).bind(objectId, now, now, userId, objectId),
      env.DB.prepare(`UPDATE portal_users SET status='active',updated_at=? WHERE id=? AND EXISTS
        (SELECT 1 FROM authorised_principals WHERE portal_user_id=? AND entra_object_id=? AND status='active')`).bind(now, userId, userId, objectId)
    ]);
  }
}

export async function recordAuthenticationEvent(env, request, event) {
  let sourceIpHash = null;
  const ip = request.headers.get("CF-Connecting-IP") || "";
  if (ip) sourceIpHash = await sha256(`${ip}:${String(env.AUDIT_IP_SALT || "portal")}`);
  await env.DB.prepare(`INSERT INTO portal_authentication_events
    (id,portal_user_id,entra_object_id,event_type,reason_code,authentication_method,authentication_strength,session_id,source_ip_hash,user_agent,occurred_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      crypto.randomUUID(), event.userId || null, event.objectId || null, event.type,
      event.reason || null, "microsoft_entra", event.strength || null, event.sessionId || null,
      sourceIpHash, cleanText(request.headers.get("User-Agent") || "", 500), new Date().toISOString(),
      JSON.stringify(event.metadata || {})
    ).run();
  return sourceIpHash;
}

export async function resolveAuthorisedPrincipal(env, request, identity) {
  await synchroniseConfiguredPrincipals(env);
  const principal = await env.DB.prepare(`SELECT u.id,u.full_name,u.preferred_name,u.email,u.job_titles_json,u.profile_image_reference,
      u.status,p.entra_object_id,p.entra_subject_id,u.role_code,r.name role_name,r.security_level,r.access_level,r.authority_label
    FROM authorised_principals p JOIN portal_users u ON u.id=p.portal_user_id JOIN portal_roles r ON r.code=u.role_code
    WHERE p.entra_tenant_id=? AND p.entra_object_id=? AND p.status='active' AND u.status='active' LIMIT 1`)
    .bind(identity.tenantId, identity.objectId).first();
  if (!principal || principal.role_code !== PRINCIPAL_ROLE) {
    await recordAuthenticationEvent(env, request, { objectId: identity.objectId, type: "access_denied", reason: "PRINCIPAL_NOT_AUTHORISED" });
    throw Object.assign(new Error("This Microsoft identity is not authorised for the Head Office Portal."), { code: "PRINCIPAL_NOT_AUTHORISED", status: 403 });
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE portal_users SET email=COALESCE(?,email),last_successful_sign_in_at=?,last_activity_at=?,updated_at=? WHERE id=?`)
    .bind(identity.email || null, now, now, now, principal.id).run();
  return { ...principal, email: identity.email || principal.email };
}

export async function createPrincipalSession(env, request, principal, identity, strength) {
  const token = randomToken();
  const id = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_LIFETIME_MS);
  const mfaVerified = /(^|\+)(mfa|otp|fido|rsa|wia|passwordless)(\+|$)/i.test(String(strength || ""));
  await env.DB.prepare(`INSERT INTO portal_sessions
    (id,portal_user_id,token_hash,status,authentication_method,authentication_strength,created_at,last_seen_at,expires_at,source_ip_hash,user_agent,device_label,last_mfa_at)
    VALUES (?,?,?,'active','microsoft_entra',?,?,?,?,?,?,?,?)`).bind(
      id, principal.id, await sha256(token), strength || null, now.toISOString(), now.toISOString(), expires.toISOString(),
      null, cleanText(request.headers.get("User-Agent") || "", 500), "Browser session", mfaVerified ? now.toISOString() : null
    ).run();
  const sourceIpHash = await recordAuthenticationEvent(env, request, {
    userId: principal.id, objectId: identity.objectId, type: "success", strength, sessionId: id
  });
  await env.DB.prepare("UPDATE portal_sessions SET source_ip_hash=? WHERE id=?").bind(sourceIpHash, id).run();
  return { token, id, expiresAt: expires.toISOString() };
}

export async function inspectPrincipalSession(request, env) {
  const token = cookieValue(request);
  if (!token || !env.DB) return { session: null, status: "session_cookie_missing" };
  const row = await env.DB.prepare(`SELECT s.id session_id,s.portal_user_id,s.status session_status,s.expires_at,s.authentication_method,
      s.authentication_strength,s.created_at,s.last_seen_at,s.last_mfa_at,s.pin_verified_at,u.full_name,u.preferred_name,u.email,u.job_titles_json,
      u.profile_image_reference,u.status user_status,u.role_code,r.name role_name,r.security_level,r.access_level,r.authority_label,
      p.entra_object_id
    FROM portal_sessions s JOIN portal_users u ON u.id=s.portal_user_id
    JOIN portal_roles r ON r.code=u.role_code JOIN authorised_principals p ON p.portal_user_id=u.id
    WHERE s.token_hash=? LIMIT 1`).bind(await sha256(token)).first();
  if (!row) return { session: null, status: "session_not_found" };
  if (row.session_status !== "active") return { session: null, status: "session_revoked" };
  if (row.user_status !== "active" || row.role_code !== PRINCIPAL_ROLE) return { session: null, status: "principal_inactive" };
  if (Date.parse(row.expires_at) <= Date.now()) {
    await env.DB.prepare("UPDATE portal_sessions SET status='expired' WHERE id=?").bind(row.session_id).run();
    return { session: null, status: "session_expired" };
  }
  await env.DB.prepare("UPDATE portal_sessions SET last_seen_at=? WHERE id=?").bind(new Date().toISOString(), row.session_id).run();
  return { status: "authenticated", session: {
    sub: row.portal_user_id, sessionId: row.session_id, objectId: row.entra_object_id,
    username: row.email, displayName: row.preferred_name || row.full_name, fullName: row.full_name,
    preferredName: row.preferred_name, jobTitles: JSON.parse(row.job_titles_json || "[]"), profileImage: row.profile_image_reference,
    roleName: row.role_name, roleCode: row.role_code, securityLevel: row.security_level, accessLevel: row.access_level,
    authority: row.authority_label, authSource: row.authentication_method, authenticationStrength: row.authentication_strength,
    createdAt: row.created_at, lastSeenAt: row.last_seen_at, lastMfaAt: row.last_mfa_at, pinVerifiedAt: row.pin_verified_at
  }};
}

export async function revokeSession(env, request, session, targetId, reason = "User requested revocation") {
  const target = await env.DB.prepare("SELECT id,status FROM portal_sessions WHERE id=? AND portal_user_id=? LIMIT 1")
    .bind(targetId, session.sub).first();
  if (!target) return false;
  await env.DB.prepare("UPDATE portal_sessions SET status='revoked',revoked_at=?,revocation_reason=? WHERE id=? AND status='active'")
    .bind(new Date().toISOString(), cleanText(reason, 300), target.id).run();
  await recordAuthenticationEvent(env, request, { userId: session.sub, objectId: session.objectId, type: "session_revoked", sessionId: target.id });
  return true;
}

export function validatePreferences(input, current = {}) {
  const allowedWidgets = new Set(["security_overview","platform_health","active_incidents","pending_approvals","recent_audit","customer_operations"]);
  const dashboard = input.dashboard && typeof input.dashboard === "object" && !Array.isArray(input.dashboard) ? input.dashboard : current.dashboard || {};
  const widgets = [...new Set((Array.isArray(dashboard.widgets) ? dashboard.widgets : []).filter(value => allowedWidgets.has(value)))];
  const hidden = [...new Set((Array.isArray(dashboard.hidden) ? dashboard.hidden : []).filter(value => allowedWidgets.has(value)))];
  return {
    theme: ["light","dark","system"].includes(input.theme) ? input.theme : (current.theme || "system"),
    tableDensity: ["compact","comfortable","spacious"].includes(input.tableDensity) ? input.tableDensity : (current.tableDensity || "comfortable"),
    timeZone: cleanText(input.timeZone || current.timeZone || "Europe/London", 80),
    dateTimeFormat: cleanText(input.dateTimeFormat || current.dateTimeFormat || "en-GB", 40),
    defaultLandingPage: cleanText(input.defaultLandingPage || current.defaultLandingPage || "dashboard", 80),
    sensitiveValuesMasked: input.sensitiveValuesMasked !== undefined ? Boolean(input.sensitiveValuesMasked) : current.sensitiveValuesMasked !== false,
    accessibility: input.accessibility && typeof input.accessibility === "object" && !Array.isArray(input.accessibility) ? input.accessibility : current.accessibility || {},
    notifications: input.notifications && typeof input.notifications === "object" && !Array.isArray(input.notifications) ? input.notifications : current.notifications || {},
    dashboard: {
      widgets: widgets.length ? widgets : ["security_overview","platform_health","active_incidents","pending_approvals"], hidden,
      pinnedPlatforms: [...new Set((Array.isArray(dashboard.pinnedPlatforms) ? dashboard.pinnedPlatforms : []).map(value => cleanText(value, 100)).filter(Boolean))].slice(0, 50),
      pinnedIncidents: [...new Set((Array.isArray(dashboard.pinnedIncidents) ? dashboard.pinnedIncidents : []).map(value => cleanText(value, 100)).filter(Boolean))].slice(0, 50),
      defaultPlatformView: cleanText(dashboard.defaultPlatformView || "all", 60)
    },
    savedFilters: input.savedFilters && typeof input.savedFilters === "object" && !Array.isArray(input.savedFilters) ? input.savedFilters : current.savedFilters || {}
  };
}

export function validateProfile(input) {
  return {
    preferredName: cleanText(input.preferredName, 100),
    displayName: cleanText(input.displayName, 200),
    profileImage: cleanNullableText(input.profileImage, 500),
    contactDetails: input.contactDetails && typeof input.contactDetails === "object" && !Array.isArray(input.contactDetails) ? input.contactDetails : {},
    jobTitles: [...new Set((Array.isArray(input.jobTitles) ? input.jobTitles : []).map(value => cleanText(value, 120)).filter(Boolean))].slice(0, 12)
  };
}
