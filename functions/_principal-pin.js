import { cleanText, safeEqual, sha256 } from "./_shared.js";

const encoder = new TextEncoder();
const PIN_PATTERN = /^\d{4}$/;
const PIN_ITERATIONS = 210_000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function pepper(env) {
  return String(env.PORTAL_PIN_PEPPER || "").trim();
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalised = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalised.padEnd(normalised.length + ((4 - normalised.length % 4) % 4), "="));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function randomSalt() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function derivePinHash(pin, salt, secret, iterations = PIN_ITERATIONS) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(`${pin}\u0000${secret}`),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: decodeBase64Url(salt),
    iterations
  }, material, 256);
  return [...new Uint8Array(bits)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function assertPin(pin) {
  const value = String(pin || "");
  if (!PIN_PATTERN.test(value)) {
    throw Object.assign(new Error("Enter exactly four numbers."), { code: "INVALID_PRINCIPAL_PIN", status: 400 });
  }
  return value;
}

export function principalPinSystemConfigured(env) {
  return pepper(env).length >= 32;
}

async function sourceIpHash(env, request) {
  const address = request.headers.get("CF-Connecting-IP") || "";
  return address ? sha256(`${address}:${String(env.AUDIT_IP_SALT || "portal-pin")}`) : null;
}

async function recordPinEvent(env, request, session, eventType, metadata = {}) {
  await env.DB.prepare(`INSERT INTO principal_pin_events
    (id,portal_user_id,session_id,event_type,source_ip_hash,user_agent,occurred_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?)`)
    .bind(
      crypto.randomUUID(),
      session.sub,
      session.sessionId || null,
      eventType,
      await sourceIpHash(env, request),
      cleanText(request.headers.get("User-Agent") || "", 500),
      new Date().toISOString(),
      JSON.stringify(metadata)
    ).run();
}

export async function getPrincipalPinStatus(env, session) {
  const configured = principalPinSystemConfigured(env);
  if (!session || !env.DB) {
    return {
      required: false,
      pepperConfigured: configured,
      configured: false,
      verified: false,
      setupRequired: false,
      locked: false,
      lockedUntil: null,
      attemptsRemaining: MAX_FAILED_ATTEMPTS
    };
  }
  const row = await env.DB.prepare(`SELECT status,failed_attempts,locked_until,configured_at,last_verified_at
    FROM principal_pin_credentials WHERE portal_user_id=? LIMIT 1`).bind(session.sub).first();
  const lockedUntil = row?.locked_until || null;
  const locked = Boolean(lockedUntil && Date.parse(lockedUntil) > Date.now());
  const credentialConfigured = row?.status === "active";
  return {
    required: true,
    pepperConfigured: configured,
    configured: credentialConfigured,
    verified: Boolean(session.pinVerifiedAt),
    setupRequired: !credentialConfigured,
    locked,
    lockedUntil,
    attemptsRemaining: locked ? 0 : Math.max(0, MAX_FAILED_ATTEMPTS - Number(row?.failed_attempts || 0)),
    configuredAt: row?.configured_at || null,
    lastVerifiedAt: row?.last_verified_at || null
  };
}

export async function configurePrincipalPin(env, request, session, rawPin) {
  if (!principalPinSystemConfigured(env)) {
    throw Object.assign(new Error("Head Office PIN protection is not configured in Cloudflare."), {
      code: "PIN_PEPPER_NOT_CONFIGURED",
      status: 503
    });
  }
  const pin = assertPin(rawPin);
  const existing = await env.DB.prepare("SELECT status FROM principal_pin_credentials WHERE portal_user_id=? LIMIT 1")
    .bind(session.sub).first();
  if (existing?.status === "active") {
    throw Object.assign(new Error("A Head Office PIN is already configured for this principal."), {
      code: "PRINCIPAL_PIN_ALREADY_CONFIGURED",
      status: 409
    });
  }
  const salt = randomSalt();
  const hash = await derivePinHash(pin, salt, pepper(env));
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO principal_pin_credentials
      (portal_user_id,pin_salt,pin_hash,hash_algorithm,hash_iterations,status,failed_attempts,locked_until,
       last_failed_at,last_verified_at,configured_at,configured_session_id,updated_at)
      VALUES (?,?,?,'PBKDF2-SHA-256',?,'active',0,NULL,NULL,?,?,?,?)
      ON CONFLICT(portal_user_id) DO UPDATE SET
        pin_salt=excluded.pin_salt,pin_hash=excluded.pin_hash,hash_algorithm=excluded.hash_algorithm,
        hash_iterations=excluded.hash_iterations,status='active',failed_attempts=0,locked_until=NULL,
        last_failed_at=NULL,last_verified_at=excluded.last_verified_at,configured_at=excluded.configured_at,
        configured_session_id=excluded.configured_session_id,updated_at=excluded.updated_at`)
      .bind(session.sub, salt, hash, PIN_ITERATIONS, now, now, session.sessionId || null, now),
    env.DB.prepare("UPDATE portal_sessions SET pin_verified_at=? WHERE id=? AND portal_user_id=? AND status='active'")
      .bind(now, session.sessionId, session.sub)
  ]);
  await recordPinEvent(env, request, session, "configured", { hashAlgorithm: "PBKDF2-SHA-256", iterations: PIN_ITERATIONS });
  return { configured: true, verified: true, verifiedAt: now };
}

export async function verifyPrincipalPin(env, request, session, rawPin) {
  if (!principalPinSystemConfigured(env)) {
    throw Object.assign(new Error("Head Office PIN protection is not configured in Cloudflare."), {
      code: "PIN_PEPPER_NOT_CONFIGURED",
      status: 503
    });
  }
  const pin = assertPin(rawPin);
  const credential = await env.DB.prepare(`SELECT pin_salt,pin_hash,hash_iterations,status,failed_attempts,locked_until
    FROM principal_pin_credentials WHERE portal_user_id=? LIMIT 1`).bind(session.sub).first();
  if (!credential || credential.status !== "active") {
    throw Object.assign(new Error("Create your personal Head Office PIN before opening the portal."), {
      code: "PRINCIPAL_PIN_SETUP_REQUIRED",
      status: 428
    });
  }
  if (credential.locked_until && Date.parse(credential.locked_until) > Date.now()) {
    throw Object.assign(new Error("Too many incorrect PIN attempts. Try again after the temporary lockout ends."), {
      code: "PRINCIPAL_PIN_LOCKED",
      status: 423,
      details: { lockedUntil: credential.locked_until }
    });
  }

  const candidate = await derivePinHash(pin, credential.pin_salt, pepper(env), Number(credential.hash_iterations));
  if (safeEqual(candidate, credential.pin_hash)) {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`UPDATE principal_pin_credentials SET failed_attempts=0,locked_until=NULL,last_failed_at=NULL,
        last_verified_at=?,updated_at=? WHERE portal_user_id=?`).bind(now, now, session.sub),
      env.DB.prepare("UPDATE portal_sessions SET pin_verified_at=? WHERE id=? AND portal_user_id=? AND status='active'")
        .bind(now, session.sessionId, session.sub)
    ]);
    await recordPinEvent(env, request, session, "verified");
    return { configured: true, verified: true, verifiedAt: now };
  }

  const nextAttempts = Number(credential.failed_attempts || 0) + 1;
  const now = new Date().toISOString();
  if (nextAttempts >= MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCKOUT_MS).toISOString();
    await env.DB.prepare(`UPDATE principal_pin_credentials SET failed_attempts=0,locked_until=?,last_failed_at=?,updated_at=?
      WHERE portal_user_id=?`).bind(lockedUntil, now, now, session.sub).run();
    await recordPinEvent(env, request, session, "locked", { lockedUntil });
    throw Object.assign(new Error("Five incorrect attempts have temporarily locked this PIN for 15 minutes."), {
      code: "PRINCIPAL_PIN_LOCKED",
      status: 423,
      details: { lockedUntil }
    });
  }

  await env.DB.prepare(`UPDATE principal_pin_credentials SET failed_attempts=?,locked_until=NULL,last_failed_at=?,updated_at=?
    WHERE portal_user_id=?`).bind(nextAttempts, now, now, session.sub).run();
  await recordPinEvent(env, request, session, "failed", { attemptsRemaining: MAX_FAILED_ATTEMPTS - nextAttempts });
  throw Object.assign(new Error(`The PIN was incorrect. ${MAX_FAILED_ATTEMPTS - nextAttempts} attempt${MAX_FAILED_ATTEMPTS - nextAttempts === 1 ? "" : "s"} remaining.`), {
    code: "PRINCIPAL_PIN_INCORRECT",
    status: 401,
    details: { attemptsRemaining: MAX_FAILED_ATTEMPTS - nextAttempts }
  });
}
