import { cleanText, normaliseDate } from './_shared.js';

const SESSION_STATUSES = new Set(['active','revocation_required','revoked','expired','signed_out']);
const TERMINAL_STATUSES = new Set(['revocation_required','revoked','expired','signed_out']);
const SESSION_SCOPES = new Set(['sessions:write','customers:write','events:write','support:write']);

export async function ensureConnectedSessionSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS connected_customer_sessions (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    platform_id TEXT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
    external_session_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revocation_required','revoked','expired','signed_out')),
    device_category TEXT,device_name TEXT,browser_name TEXT,operating_system TEXT,user_agent_summary TEXT,
    country_code TEXT,country_name TEXT,region_name TEXT,city_name TEXT,
    started_at TEXT NOT NULL,last_seen_at TEXT NOT NULL,expires_at TEXT,
    revocation_requested_at TEXT,revoked_at TEXT,signed_out_at TEXT,
    revocation_source TEXT,revocation_actor TEXT,revocation_reason TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(platform_id, external_session_id)
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_connected_sessions_customer_status
    ON connected_customer_sessions(customer_id,status,last_seen_at DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_connected_sessions_platform_status
    ON connected_customer_sessions(platform_id,status,last_seen_at DESC)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_connected_sessions_expiry
    ON connected_customer_sessions(status,expires_at) WHERE expires_at IS NOT NULL`).run();
}

export function platformCanManageSessions(platform) {
  return Array.isArray(platform?.scopes) && platform.scopes.some(scope => SESSION_SCOPES.has(scope));
}

function cleanMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const safe = {};
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 30)) {
    const key = cleanText(rawKey, 80);
    if (!key || /password|secret|token|credential|authorization|cookie|ip_address/i.test(key)) continue;
    if (rawValue === null || ['string','number','boolean'].includes(typeof rawValue)) {
      safe[key] = typeof rawValue === 'string' ? cleanText(rawValue, 300) : rawValue;
    }
  }
  return safe;
}

function validIso(value, fallback = null) {
  return normaliseDate(value) || fallback;
}

export async function findSessionCustomer(env, platform, input = {}) {
  const customerId = cleanText(input.customerId || input.centralCustomerId, 100);
  if (customerId) {
    const customer = await env.DB.prepare('SELECT * FROM customers WHERE id=? LIMIT 1').bind(customerId).first();
    if (customer) return customer;
  }

  const customerNumber = cleanText(input.customerNumber || input.ucn, 40);
  if (customerNumber) {
    const customer = await env.DB.prepare('SELECT * FROM customers WHERE customer_number=? LIMIT 1').bind(customerNumber).first();
    if (customer) return customer;
  }

  const tenantId = cleanText(input.tenantId, 100);
  const objectId = cleanText(input.objectId, 160);
  if (tenantId && objectId) {
    const customer = await env.DB.prepare(`SELECT c.* FROM customer_directory_identities i
      JOIN customers c ON c.id=i.customer_id
      WHERE i.tenant_id=? AND i.object_id=? ORDER BY i.last_synced_at DESC LIMIT 1`)
      .bind(tenantId, objectId).first();
    if (customer) return customer;
  }

  const platformCustomerId = cleanText(input.platformCustomerId || input.platformAccountId, 180);
  if (platformCustomerId && platform?.id) {
    const customer = await env.DB.prepare(`SELECT c.* FROM customer_platform_accounts a
      JOIN customers c ON c.id=a.customer_id
      WHERE a.platform_id=? AND a.external_account_id=? LIMIT 1`)
      .bind(platform.id, platformCustomerId).first();
    if (customer) return customer;
  }

  return null;
}

function normaliseSession(body = {}) {
  const now = new Date().toISOString();
  const externalSessionId = cleanText(body.externalSessionId || body.sessionReference || body.sessionId, 220);
  if (!externalSessionId) throw Object.assign(new Error('A unique external session reference is required.'), { code: 'SESSION_REFERENCE_REQUIRED', status: 400 });
  const requestedStatus = cleanText(body.status, 30).toLowerCase();
  const status = SESSION_STATUSES.has(requestedStatus) ? requestedStatus : 'active';
  return {
    externalSessionId,
    status,
    deviceCategory: cleanText(body.device?.category || body.deviceCategory, 60) || null,
    deviceName: cleanText(body.device?.name || body.deviceName, 120) || null,
    browserName: cleanText(body.device?.browser || body.browserName, 100) || null,
    operatingSystem: cleanText(body.device?.operatingSystem || body.operatingSystem, 100) || null,
    userAgentSummary: cleanText(body.device?.userAgentSummary || body.userAgentSummary, 300) || null,
    countryCode: cleanText(body.location?.countryCode || body.countryCode, 8).toUpperCase() || null,
    countryName: cleanText(body.location?.countryName || body.countryName, 100) || null,
    regionName: cleanText(body.location?.region || body.regionName, 120) || null,
    cityName: cleanText(body.location?.city || body.cityName, 120) || null,
    startedAt: validIso(body.startedAt, now),
    lastSeenAt: validIso(body.lastSeenAt, now),
    expiresAt: validIso(body.expiresAt),
    metadata: cleanMetadata(body.metadata),
    now,
  };
}

export async function registerConnectedSession(env, platform, customer, body) {
  await ensureConnectedSessionSchema(env);
  const session = normaliseSession(body);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO connected_customer_sessions (
    id,customer_id,platform_id,external_session_id,status,device_category,device_name,browser_name,
    operating_system,user_agent_summary,country_code,country_name,region_name,city_name,started_at,
    last_seen_at,expires_at,metadata_json,created_at,updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(platform_id,external_session_id) DO UPDATE SET
    customer_id=excluded.customer_id,
    status=CASE WHEN connected_customer_sessions.status IN ('revocation_required','revoked','expired','signed_out')
      THEN connected_customer_sessions.status ELSE excluded.status END,
    device_category=COALESCE(excluded.device_category,connected_customer_sessions.device_category),
    device_name=COALESCE(excluded.device_name,connected_customer_sessions.device_name),
    browser_name=COALESCE(excluded.browser_name,connected_customer_sessions.browser_name),
    operating_system=COALESCE(excluded.operating_system,connected_customer_sessions.operating_system),
    user_agent_summary=COALESCE(excluded.user_agent_summary,connected_customer_sessions.user_agent_summary),
    country_code=COALESCE(excluded.country_code,connected_customer_sessions.country_code),
    country_name=COALESCE(excluded.country_name,connected_customer_sessions.country_name),
    region_name=COALESCE(excluded.region_name,connected_customer_sessions.region_name),
    city_name=COALESCE(excluded.city_name,connected_customer_sessions.city_name),
    last_seen_at=excluded.last_seen_at,
    expires_at=COALESCE(excluded.expires_at,connected_customer_sessions.expires_at),
    metadata_json=excluded.metadata_json,
    updated_at=excluded.updated_at`)
    .bind(id,customer.id,platform.id,session.externalSessionId,session.status,session.deviceCategory,
      session.deviceName,session.browserName,session.operatingSystem,session.userAgentSummary,
      session.countryCode,session.countryName,session.regionName,session.cityName,session.startedAt,
      session.lastSeenAt,session.expiresAt,JSON.stringify(session.metadata),session.now,session.now).run();
  return getPlatformSession(env, platform.id, session.externalSessionId, true);
}

async function expireDueSessions(env, customerId = null) {
  const now = new Date().toISOString();
  const query = customerId
    ? `UPDATE connected_customer_sessions SET status='expired',updated_at=?
       WHERE customer_id=? AND status='active' AND expires_at IS NOT NULL AND expires_at<=?`
    : `UPDATE connected_customer_sessions SET status='expired',updated_at=?
       WHERE status='active' AND expires_at IS NOT NULL AND expires_at<=?`;
  const statement = env.DB.prepare(query);
  if (customerId) await statement.bind(now, customerId, now).run();
  else await statement.bind(now, now).run();
}

export async function getPlatformSession(env, platformId, externalSessionId, touch = false) {
  await ensureConnectedSessionSchema(env);
  await expireDueSessions(env);
  const reference = cleanText(externalSessionId, 220);
  if (!reference) return null;
  if (touch) {
    const now = new Date().toISOString();
    await env.DB.prepare(`UPDATE connected_customer_sessions SET last_seen_at=?,updated_at=?
      WHERE platform_id=? AND external_session_id=? AND status='active'`)
      .bind(now, now, platformId, reference).run();
  }
  return env.DB.prepare(`SELECT s.*,p.code platform_code,p.name platform_name
    FROM connected_customer_sessions s JOIN platforms p ON p.id=s.platform_id
    WHERE s.platform_id=? AND s.external_session_id=? LIMIT 1`)
    .bind(platformId, reference).first();
}

export async function listCustomerSessions(env, customerId) {
  await ensureConnectedSessionSchema(env);
  await expireDueSessions(env, customerId);
  const result = await env.DB.prepare(`SELECT s.*,p.code platform_code,p.name platform_name
    FROM connected_customer_sessions s JOIN platforms p ON p.id=s.platform_id
    WHERE s.customer_id=? ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'revocation_required' THEN 1 ELSE 2 END,
      s.last_seen_at DESC LIMIT 250`).bind(customerId).all();
  return result.results || [];
}

export function customerSessionView(row) {
  return {
    id: row.id,
    platformCode: row.platform_code,
    platformName: row.platform_name,
    status: row.status,
    device: {
      category: row.device_category,
      name: row.device_name,
      browser: row.browser_name,
      operatingSystem: row.operating_system,
    },
    location: {
      countryCode: row.country_code,
      countryName: row.country_name,
      region: row.region_name,
      city: row.city_name,
    },
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    revocationRequestedAt: row.revocation_requested_at,
    revokedAt: row.revoked_at,
    signedOutAt: row.signed_out_at,
  };
}

export function platformSessionDecision(row) {
  if (!row) return { found: false, status: 'unknown', active: false, revoke: true };
  const active = row.status === 'active';
  return {
    found: true,
    status: row.status,
    active,
    revoke: !active,
    sessionId: row.id,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
  };
}

export async function requestSessionRevocation(env, sessionId, actor = {}) {
  await ensureConnectedSessionSchema(env);
  const now = new Date().toISOString();
  const session = await env.DB.prepare('SELECT * FROM connected_customer_sessions WHERE id=? LIMIT 1').bind(sessionId).first();
  if (!session) return null;
  if (session.status === 'active') {
    await env.DB.prepare(`UPDATE connected_customer_sessions SET status='revocation_required',
      revocation_requested_at=?,revocation_source=?,revocation_actor=?,revocation_reason=?,updated_at=? WHERE id=?`)
      .bind(now,cleanText(actor.source,60)||'head_office',cleanText(actor.actor,160)||null,
        cleanText(actor.reason,500)||'Session revoked for account security.',now,session.id).run();
  }
  return env.DB.prepare(`SELECT s.*,p.code platform_code,p.name platform_name FROM connected_customer_sessions s
    JOIN platforms p ON p.id=s.platform_id WHERE s.id=? LIMIT 1`).bind(session.id).first();
}

export async function requestAllSessionRevocations(env, customerId, actor = {}, excludeExternalSessionId = null) {
  await ensureConnectedSessionSchema(env);
  const now = new Date().toISOString();
  const excluded = cleanText(excludeExternalSessionId,220) || null;
  const result = await env.DB.prepare(`UPDATE connected_customer_sessions SET status='revocation_required',
    revocation_requested_at=?,revocation_source=?,revocation_actor=?,revocation_reason=?,updated_at=?
    WHERE customer_id=? AND status='active' AND (? IS NULL OR external_session_id<>?)`)
    .bind(now,cleanText(actor.source,60)||'head_office',cleanText(actor.actor,160)||null,
      cleanText(actor.reason,500)||'All connected sessions were revoked for account security.',now,
      customerId,excluded,excluded).run();
  return Number(result.meta?.changes || 0);
}

export async function closePlatformSession(env, platformId, externalSessionId, reason = '') {
  await ensureConnectedSessionSchema(env);
  const now = new Date().toISOString();
  const existing = await getPlatformSession(env, platformId, externalSessionId, false);
  if (!existing) return null;
  const status = existing.status === 'revocation_required' ? 'revoked' :
    (existing.status === 'revoked' ? 'revoked' : 'signed_out');
  await env.DB.prepare(`UPDATE connected_customer_sessions SET status=?,
    revoked_at=CASE WHEN ?='revoked' THEN COALESCE(revoked_at,?) ELSE revoked_at END,
    signed_out_at=CASE WHEN ?='signed_out' THEN COALESCE(signed_out_at,?) ELSE signed_out_at END,
    revocation_reason=COALESCE(revocation_reason,?),updated_at=? WHERE id=?`)
    .bind(status,status,now,status,now,cleanText(reason,500)||null,now,existing.id).run();
  return getPlatformSession(env, platformId, externalSessionId, false);
}
