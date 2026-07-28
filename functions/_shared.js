export const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin"
};

export function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, { status, headers: { ...securityHeaders, "Cache-Control": "no-store", ...extraHeaders } });
}

export function error(code, message, status = 400) {
  return json({ error: { code, message } }, status);
}

const encoder = new TextEncoder();
const bytesToHex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");

export async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export function safeEqual(a = "", b = "") {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export function cookies(request) {
  return Object.fromEntries((request.headers.get("Cookie") || "").split(";").map(v => v.trim().split(/=(.*)/s)).filter(v => v[0]));
}

export async function getSession(request, env) {
  const token = cookies(request).ho_session;
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(await hmac(payload, env.SESSION_SECRET), signature)) return null;
  try {
    const session = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    if (session.exp < Date.now() || session.version !== 1) return null;
    return session;
  } catch { return null; }
}

export async function createSession(user, env) {
  const raw = btoa(JSON.stringify({ sub: user.id, username: user.username, displayName: user.displayName, roleName: user.roleName, exp: Date.now() + 8 * 60 * 60 * 1000, version: 1 })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${raw}.${await hmac(raw, env.SESSION_SECRET)}`;
}

export async function requireSession(context) {
  const session = await getSession(context.request, context.env);
  if (!session) return { response: error("AUTHENTICATION_REQUIRED", "Your staff session is not valid.", 401) };
  return { session };
}

export function cleanText(value, max = 200) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\u0000-\u001F\u007F]/g, "").slice(0, max);
}

export async function audit(env, session, action, entityType, entityId, details = {}) {
  await env.DB.prepare(`INSERT INTO audit_events
    (id, occurred_at, actor_type, actor_id, actor_name, action, action_label, entity_type, entity_id, entity_reference, metadata_json)
    VALUES (?, ?, 'staff', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), new Date().toISOString(), session.sub, session.displayName, action, details.label || action, entityType, entityId, details.reference || entityId, JSON.stringify(details.metadata || {})).run();
}

export async function platformAudit(env, platform, action, entityType, entityId, details = {}) {
  await env.DB.prepare(`INSERT INTO audit_events
    (id, occurred_at, actor_type, actor_id, actor_name, action, action_label, entity_type, entity_id, entity_reference, customer_id, request_id, metadata_json)
    VALUES (?, ?, 'platform', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), new Date().toISOString(), platform.id, platform.name, action,
      details.label || action, entityType, entityId, details.reference || entityId,
      details.customerId || null, details.requestId || null, JSON.stringify(details.metadata || {})).run();
}

export async function requirePlatform(context, requiredScopes = []) {
  const header = context.request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || token.length > 300) return { response: error("PLATFORM_AUTHENTICATION_REQUIRED", "A valid platform API key is required.", 401) };
  const credential = await context.env.DB.prepare(`SELECT c.id credential_id,c.platform_id,c.scopes_json,c.expires_at,p.code,p.name,p.status
    FROM platform_api_credentials c JOIN platforms p ON p.id=c.platform_id
    WHERE c.secret_hash=? AND c.status='active'`).bind(await sha256(token)).first();
  if (!credential || credential.status !== "active" || (credential.expires_at && Date.parse(credential.expires_at) <= Date.now())) {
    return { response: error("INVALID_PLATFORM_CREDENTIAL", "The platform API credential is invalid or inactive.", 401) };
  }
  let scopes = [];
  try { scopes = JSON.parse(credential.scopes_json); } catch {}
  if (requiredScopes.some(scope => !scopes.includes(scope))) {
    return { response: error("INSUFFICIENT_PLATFORM_SCOPE", "The platform credential is not authorised for this operation.", 403) };
  }
  await context.env.DB.prepare("UPDATE platform_api_credentials SET last_used_at=? WHERE id=?")
    .bind(new Date().toISOString(), credential.credential_id).run();
  return { platform: { id: credential.platform_id, code: credential.code, name: credential.name, credentialId: credential.credential_id, scopes } };
}
