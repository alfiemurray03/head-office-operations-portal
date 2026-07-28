import { audit, hmac, safeEqual } from "./_shared.js";

const TENANT_ID = "53477196-db21-46d2-8123-00be3d6882da";
const CLIENT_ID = "4f5c0708-f580-4514-b710-3cb780939348";
const AUTHORITY = `https://login.microsoftonline.com/${TENANT_ID}`;
const AUTHORISE_ENDPOINT = `${AUTHORITY}/oauth2/v2.0/authorize`;
const TOKEN_ENDPOINT = `${AUTHORITY}/oauth2/v2.0/token`;
const JWKS_ENDPOINT = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;
const LOGOUT_ENDPOINT = `${AUTHORITY}/oauth2/v2.0/logout`;
const ISSUER = `https://login.microsoftonline.com/${TENANT_ID}/v2.0`;
const CALLBACK_PATH = "/api/auth/microsoft/callback";
const TRANSACTION_COOKIE = "ho_oidc_tx";
const SESSION_COOKIE = "ho_session";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
let jwksCache;

function clientSecret(env) {
  return String(env.ADMIN_OIDC_CLIENT_SECRET || env.AZURE_AD_CLIENT_SECRET || "").trim();
}

function sessionSecret(env) {
  return String(env.SESSION_SECRET || clientSecret(env)).trim();
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value) {
  const normalised = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalised.padEnd(normalised.length + ((4 - normalised.length % 4) % 4), "="));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function randomValue(length = 32) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function sha256Base64Url(value) {
  return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function readCookie(request, name) {
  const prefix = `${name}=`;
  const part = (request.headers.get("Cookie") || "").split(";").map(item => item.trim()).find(item => item.startsWith(prefix));
  return part ? decodeURIComponent(part.slice(prefix.length)) : "";
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function signedPayload(value, secret) {
  const encoded = base64Url(encoder.encode(JSON.stringify(value)));
  return `${encoded}.${await hmac(encoded, secret)}`;
}

async function readSignedPayload(raw, secret) {
  const [encoded, signature] = String(raw || "").split(".");
  if (!encoded || !signature || !safeEqual(await hmac(encoded, secret), signature)) return null;
  try {
    return JSON.parse(decoder.decode(decodeBase64Url(encoded)));
  } catch {
    return null;
  }
}

function safeReturnPath(value) {
  const raw = String(value || "/");
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  try {
    const url = new URL(raw, "https://portal.local");
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}

async function getSigningKeys() {
  if (jwksCache?.expiresAt > Date.now()) return jwksCache.keys;
  const response = await fetch(JWKS_ENDPOINT, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("Microsoft signing keys could not be loaded.");
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error("Microsoft signing keys are invalid.");
  jwksCache = { keys: body.keys, expiresAt: Date.now() + 3_600_000 };
  return body.keys;
}

async function verifyIdToken(token, expectedNonce) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw new Error("Microsoft returned an invalid identity token.");
  const header = JSON.parse(decoder.decode(decodeBase64Url(parts[0])));
  const claims = JSON.parse(decoder.decode(decodeBase64Url(parts[1])));
  if (header.alg !== "RS256" || !header.kid) throw new Error("Microsoft used an unsupported signing method.");
  const jwk = (await getSigningKeys()).find(key => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) throw new Error("Microsoft's signing key was not recognised.");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(parts[2]),
    encoder.encode(`${parts[0]}.${parts[1]}`)
  );
  if (!verified) throw new Error("Microsoft identity-token signature validation failed.");
  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER || claims.tid !== TENANT_ID) throw new Error("This Microsoft account does not belong to the JA Group Services tenant.");
  if (claims.aud !== CLIENT_ID) throw new Error("Microsoft identity-token audience validation failed.");
  if (!claims.sub || claims.nonce !== expectedNonce) throw new Error("Microsoft identity-token transaction validation failed.");
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now - 60) throw new Error("The Microsoft identity token has expired.");
  if (claims.nbf && Number(claims.nbf) > now + 60) throw new Error("The Microsoft identity token is not active.");
  return claims;
}

function identityFromClaims(claims) {
  return {
    objectId: String(claims.oid || claims.sub),
    email: String(claims.preferred_username || claims.email || claims.upn || "").trim().toLowerCase(),
    displayName: String(claims.name || claims.preferred_username || "JA Group Services staff member").trim()
  };
}

async function resolveStaff(env, identity) {
  if (!env.DB) throw new Error("The Head Office database is not connected.");
  let staff = await env.DB.prepare(`
    SELECT s.id,s.display_name,s.email,s.status,
      COALESCE((SELECT group_concat(role_code, ', ') FROM staff_role_assignments WHERE staff_id=s.id), 'Authorised Staff') role_name
    FROM staff_members s
    WHERE s.external_identity_id=? OR lower(s.email)=lower(?)
    LIMIT 1
  `).bind(identity.objectId, identity.email).first();

  if (!staff) {
    const count = await env.DB.prepare("SELECT COUNT(*) total FROM staff_members").first();
    if (Number(count?.total || 0) !== 0) throw new Error("Your Microsoft account has not been granted access to this portal.");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO staff_members
        (id,external_identity_id,authentication_source,display_name,email,status,created_at,updated_at)
        VALUES (?,?,'microsoft_entra',?,?,'active',?,?)`)
        .bind(id, identity.objectId, identity.displayName, identity.email, now, now),
      env.DB.prepare(`INSERT INTO staff_role_assignments
        (id,staff_id,role_code,assigned_by,assigned_at) VALUES (?,?,'system_administrator','system.bootstrap',?)`)
        .bind(crypto.randomUUID(), id, now)
    ]);
    staff = { id, display_name: identity.displayName, email: identity.email, status: "active", role_name: "System Administrator" };
  } else {
    if (staff.status !== "active") throw new Error("Your Head Office staff access is not active.");
    await env.DB.prepare(`UPDATE staff_members SET external_identity_id=?,authentication_source='microsoft_entra',
      display_name=?,email=?,updated_at=? WHERE id=?`)
      .bind(identity.objectId, identity.displayName, identity.email, new Date().toISOString(), staff.id).run();
  }
  return staff;
}

export function microsoftConfiguration(env) {
  return {
    configured: Boolean(clientSecret(env)),
    tenantId: TENANT_ID,
    clientId: CLIENT_ID,
    authority: AUTHORITY,
    callbackPath: CALLBACK_PATH
  };
}

export async function beginMicrosoftLogin(request, env) {
  const secret = clientSecret(env);
  if (!secret) throw new Error("Microsoft staff sign-in has not been configured.");
  const url = new URL(request.url);
  const verifier = randomValue(48);
  const state = randomValue();
  const nonce = randomValue();
  const transaction = await signedPayload({
    state, nonce, verifier,
    returnTo: safeReturnPath(url.searchParams.get("return_to")),
    expiresAt: Date.now() + 10 * 60 * 1000
  }, secret);
  const authorise = new URL(AUTHORISE_ENDPOINT);
  authorise.searchParams.set("client_id", CLIENT_ID);
  authorise.searchParams.set("response_type", "code");
  authorise.searchParams.set("redirect_uri", `${url.origin}${CALLBACK_PATH}`);
  authorise.searchParams.set("response_mode", "query");
  authorise.searchParams.set("scope", "openid profile email");
  authorise.searchParams.set("state", state);
  authorise.searchParams.set("nonce", nonce);
  authorise.searchParams.set("code_challenge", await sha256Base64Url(verifier));
  authorise.searchParams.set("code_challenge_method", "S256");
  authorise.searchParams.set("prompt", "select_account");
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorise.toString(),
      "Set-Cookie": cookie(TRANSACTION_COOKIE, transaction, 600),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}

export async function completeMicrosoftLogin(request, env) {
  const secret = clientSecret(env);
  if (!secret) throw new Error("Microsoft staff sign-in has not been configured.");
  const url = new URL(request.url);
  if (url.searchParams.get("error")) throw new Error(url.searchParams.get("error_description") || "Microsoft sign-in was cancelled.");
  const transaction = await readSignedPayload(readCookie(request, TRANSACTION_COOKIE), secret);
  if (!transaction || transaction.expiresAt < Date.now() || !safeEqual(transaction.state, url.searchParams.get("state") || "")) {
    throw new Error("The Microsoft sign-in transaction has expired or is invalid.");
  }
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Microsoft did not return an authorisation code.");
  const tokenResponse = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: secret,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${url.origin}${CALLBACK_PATH}`,
      code_verifier: transaction.verifier,
      scope: "openid profile email"
    })
  });
  const tokenBody = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenBody.id_token) throw new Error(tokenBody.error_description || "Microsoft could not complete staff sign-in.");
  const claims = await verifyIdToken(tokenBody.id_token, transaction.nonce);
  const identity = identityFromClaims(claims);
  if (!identity.email) throw new Error("Microsoft did not provide a staff email address.");
  const staff = await resolveStaff(env, identity);
  const session = await signedPayload({
    sub: staff.id,
    objectId: identity.objectId,
    username: staff.email,
    displayName: staff.display_name,
    roleName: staff.role_name || "Authorised Staff",
    tenantId: TENANT_ID,
    authSource: "microsoft_entra",
    exp: Date.now() + 8 * 60 * 60 * 1000,
    version: 2
  }, sessionSecret(env));
  // Authentication must not be discarded because a secondary audit write fails.
  // The callback has already validated Microsoft and resolved the authorised
  // staff member at this point, so issue the session and report audit failures
  // separately for operational follow-up.
  try {
    await audit(env, {
      sub: staff.id,
      displayName: staff.display_name
    }, "auth.microsoft_login", "staff_session", staff.id, { label: "Microsoft staff sign-in" });
  } catch (error) {
    console.error(JSON.stringify({
      event: "microsoft_staff_login_audit_failed",
      staffId: staff.id,
      message: error instanceof Error ? error.message : "Unknown audit error"
    }));
  }
  const returnUrl = new URL(safeReturnPath(transaction.returnTo), url.origin);
  returnUrl.searchParams.set("auth_result", "success");
  const headers = new Headers({
    Location: returnUrl.toString(),
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer"
  });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, session, 28_800));
  headers.append("Set-Cookie", cookie(TRANSACTION_COOKIE, "", 0));
  return new Response(null, { status: 303, headers });
}

export async function getMicrosoftSession(request, env) {
  return (await inspectMicrosoftSession(request, env)).session;
}

export async function inspectMicrosoftSession(request, env) {
  const secret = sessionSecret(env);
  if (!secret) return { session: null, status: "signing_secret_missing" };
  const raw = readCookie(request, SESSION_COOKIE) || readCookie(request, "__Host-ho_session");
  if (!raw) return { session: null, status: "session_cookie_missing" };
  const session = await readSignedPayload(raw, secret);
  if (!session) return { session: null, status: "session_cookie_invalid" };
  if (session.version !== 2) return { session: null, status: "session_version_invalid" };
  if (session.exp < Date.now()) return { session: null, status: "session_expired" };
  if (session.tenantId !== TENANT_ID) return { session: null, status: "session_tenant_invalid" };
  return { session, status: "authenticated" };
}

export function microsoftLogout(request) {
  const url = new URL(request.url);
  const destination = new URL(LOGOUT_ENDPOINT);
  destination.searchParams.set("post_logout_redirect_uri", `${url.origin}/`);
  const headers = new Headers({
    Location: destination.toString(),
    "Cache-Control": "no-store"
  });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
  headers.append("Set-Cookie", cookie("__Host-ho_session", "", 0));
  return new Response(null, {
    status: 302,
    headers
  });
}
