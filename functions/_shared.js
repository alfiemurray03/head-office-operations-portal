export const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Robots-Tag": "noindex, nofollow, noarchive"
};

export function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: { ...securityHeaders, "Cache-Control": "no-store", ...extraHeaders }
  });
}

export function error(code, message, status = 400, details = undefined) {
  return json({ error: { code, message, ...(details ? { details } : {}) } }, status);
}

const encoder = new TextEncoder();
const bytesToHex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");

export async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(String(value))));
}

export async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export function safeEqual(a = "", b = "") {
  const first = String(a);
  const second = String(b);
  if (first.length !== second.length) return false;
  let result = 0;
  for (let index = 0; index < first.length; index++) result |= first.charCodeAt(index) ^ second.charCodeAt(index);
  return result === 0;
}

export function cookies(request) {
  return Object.fromEntries(
    (request.headers.get("Cookie") || "")
      .split(";")
      .map(value => value.trim().split(/=(.*)/s))
      .filter(value => value[0])
  );
}

function requestWithPreferredAuthCookies(request) {
  const rawCookieHeader = request.headers.get("Cookie") || "";
  const parts = rawCookieHeader.split(";").map(value => value.trim()).filter(Boolean);
  const hostSession = parts.find(value => value.startsWith("__Host-ho_session="));
  const hostTransaction = parts.find(value => value.startsWith("__Host-ho_oidc_tx="));
  if (!hostSession && !hostTransaction) return request;

  const preferred = [];
  if (hostSession) preferred.push(`ho_session=${hostSession.slice("__Host-ho_session=".length)}`);
  if (hostTransaction) preferred.push(`ho_oidc_tx=${hostTransaction.slice("__Host-ho_oidc_tx=".length)}`);
  const remaining = parts.filter(value => !value.startsWith("ho_session=") && !value.startsWith("ho_oidc_tx="));
  const headers = new Headers(request.headers);
  headers.set("Cookie", [...preferred, ...remaining].join("; "));
  return new Request(request, { headers });
}

export async function getSession(request, env) {
  const canonicalRequest = requestWithPreferredAuthCookies(request);
  const { getMicrosoftSession } = await import("./_microsoft-auth.js");
  const microsoftSession = await getMicrosoftSession(canonicalRequest, env);
  if (microsoftSession) return microsoftSession;

  const token = cookies(canonicalRequest).ho_session;
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(await hmac(payload, env.SESSION_SECRET), signature)) return null;
  try {
    const session = JSON.parse(atob(payload.replaceAll("-", "+").replaceAll("_", "/")));
    if (session.exp < Date.now() || session.version !== 1) return null;
    return session;
  } catch {
    return null;
  }
}

export async function createSession(user, env) {
  const raw = btoa(JSON.stringify({
    sub: user.id,
    username: user.username,
    displayName: user.displayName,
    roleName: user.roleName,
    exp: Date.now() + 8 * 60 * 60 * 1000,
    version: 1
  })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${raw}.${await hmac(raw, env.SESSION_SECRET)}`;
}

export async function requireSession(context) {
  const session = await getSession(context.request, context.env);
  if (!session) return { response: error("AUTHENTICATION_REQUIRED", "Your staff session is not valid.", 401) };
  return { session };
}

export function assertSameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (origin && origin !== url.origin) return error("CROSS_ORIGIN_REQUEST_BLOCKED", "This request was not made by the Head Office portal.", 403);
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return error("CROSS_SITE_REQUEST_BLOCKED", "Cross-site requests are not permitted.", 403);
  }
  return null;
}

export async function readJson(request, maximumBytes = 65_536) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > maximumBytes) {
    throw Object.assign(new Error("The request body is too large."), { status: 413, code: "REQUEST_TOO_LARGE" });
  }

  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("request too large");
        throw Object.assign(new Error("The request body is too large."), { status: 413, code: "REQUEST_TOO_LARGE" });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("The request body is not valid JSON."), { status: 400, code: "INVALID_JSON" });
  }
}

export function cleanText(value, max = 200) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/[\u0000-\u001F\u007F]/g, "").slice(0, max);
}

export function cleanNullableText(value, max = 200) {
  const cleaned = cleanText(value, max);
  return cleaned || null;
}

export function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

export function normaliseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function audit(env, session, action, entityType, entityId, details = {}) {
  await env.DB.prepare(`INSERT INTO audit_events
    (id, occurred_at, actor_type, actor_id, actor_name, action, action_label,
     entity_type, entity_id, entity_reference, customer_id, case_id, request_id,
     before_json, after_json, metadata_json)
    VALUES (?, ?, 'staff', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
    .bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      session.sub,
      session.displayName,
      action,
      details.label || action,
      entityType,
      entityId,
      details.reference || entityId,
      details.customerId || null,
      details.caseId || null,
      details.requestId || null,
      details.before === undefined ? null : JSON.stringify(details.before),
      details.after === undefined ? null : JSON.stringify(details.after),
      JSON.stringify(details.metadata || {})
    ).run();
}

export async function platformAudit(env, platform, action, entityType, entityId, details = {}) {
  await env.DB.prepare(`INSERT INTO audit_events
    (id, occurred_at, actor_type, actor_id, actor_name, action, action_label,
     entity_type, entity_id, entity_reference, customer_id, request_id, metadata_json)
    VALUES (?, ?, 'platform', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
    .bind(
      crypto.randomUUID(),
      new Date().toISOString(),
      platform.id,
      platform.name,
      action,
      details.label || action,
      entityType,
      entityId,
      details.reference || entityId,
      details.customerId || null,
      details.requestId || null,
      JSON.stringify(details.metadata || {})
    ).run();
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
