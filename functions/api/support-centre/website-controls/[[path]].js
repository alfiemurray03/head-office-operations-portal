import { audit, cleanText, error, json, readJson } from '../../../_shared.js';
import { hasPermission, requirePermission } from '../../../_operations.js';
import { ensureBranchSettings, ensureSupportCentreSchema, jsonValue, safeObject } from '../../../_support-centre-schema.js';

const TARGETS = [
  { key: 'ja-group-services', label: 'JA Group Services', pattern: /ja[ _-]?group[ _-]?services/i },
  { key: 'ja-domain-hub', label: 'JA Domain Hub', pattern: /ja[ _-]?domain[ _-]?hub|domain[ _-]?hub/i },
  { key: 'planyx', label: 'Planyx', pattern: /planyx/i },
  { key: 'profile-centre', label: 'Profile Centre', pattern: /profile[ _-]?centre/i },
];

function segments(value) {
  if (Array.isArray(value)) return value.flatMap(item => String(item).split('/')).filter(Boolean);
  return String(value || '').split('/').filter(Boolean);
}

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || JSON.stringify(fallback));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

function boundedNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.round(number))) : fallback;
}

function colour(value, fallback) {
  const cleaned = cleanText(value, 32);
  return /^#[0-9a-f]{6}$/i.test(cleaned) ? cleaned : fallback;
}

async function ensureControlTables(env) {
  await ensureSupportCentreSchema(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS support_branch_connections (
    platform_id TEXT PRIMARY KEY REFERENCES platforms(id) ON DELETE CASCADE,
    connection_status TEXT NOT NULL DEFAULT 'never_connected',
    last_seen_at TEXT,last_config_fetch_at TEXT,last_user_agent TEXT,last_origin TEXT,last_error_code TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS website_control_settings (
    platform_id TEXT PRIMARY KEY REFERENCES platforms(id) ON DELETE CASCADE,
    launch_gate_enabled INTEGER NOT NULL DEFAULT 0,
    launch_gate_mode TEXT NOT NULL DEFAULT 'prelaunch',
    launch_gate_title TEXT,launch_gate_message TEXT,launch_gate_cta_label TEXT,launch_gate_cta_href TEXT,
    launch_gate_background TEXT NOT NULL DEFAULT '#081426',launch_gate_accent TEXT NOT NULL DEFAULT '#2563eb',
    launch_gate_text_colour TEXT NOT NULL DEFAULT '#ffffff',
    launch_gate_show_company_details INTEGER NOT NULL DEFAULT 1,
    launch_gate_allow_search_engines INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
}

function targetFor(platform) {
  const descriptor = `${platform.code || ''} ${platform.name || ''}`;
  return TARGETS.find(target => target.pattern.test(descriptor));
}

async function authorised(context) {
  const auth = await requirePermission(context, 'configuration:read');
  if (auth.response) return auth;
  if (!hasPermission(auth.authorisation, 'configuration:write') && context.request.method !== 'GET') {
    return { response: error('SUPPORT_CONTROL_WRITE_DENIED', 'You are not authorised to change website customer-service controls.', 403) };
  }
  await ensureControlTables(context.env);
  return auth;
}

async function rowsForTargets(env) {
  const rows = await env.DB.prepare(`SELECT p.id,p.code,p.name,p.status,
      b.assistant_name,b.assistant_enabled,b.ai_enabled,b.human_takeover_enabled,b.anonymous_enabled,
      b.maintenance_enabled,b.maintenance_message,b.emergency_notice,b.greeting,b.away_message,
      b.operating_hours_json,b.appearance_json,b.escalation_rules_json,b.contact_options_json,b.retention_days,
      c.connection_status,c.last_seen_at,c.last_config_fetch_at,c.last_error_code,
      w.launch_gate_enabled,w.launch_gate_mode,w.launch_gate_title,w.launch_gate_message,
      w.launch_gate_cta_label,w.launch_gate_cta_href,w.launch_gate_background,w.launch_gate_accent,
      w.launch_gate_text_colour,w.launch_gate_show_company_details,w.launch_gate_allow_search_engines
    FROM platforms p
    LEFT JOIN support_branch_settings b ON b.platform_id=p.id
    LEFT JOIN support_branch_connections c ON c.platform_id=p.id
    LEFT JOIN website_control_settings w ON w.platform_id=p.id
    ORDER BY p.name`).all();
  return rows.results || [];
}

async function ensureTargetRows(env) {
  const rows = await rowsForTargets(env);
  for (const row of rows) {
    if (!targetFor(row)) continue;
    await ensureBranchSettings(env, row);
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO website_control_settings
      (platform_id,launch_gate_enabled,launch_gate_mode,launch_gate_title,launch_gate_message,
       launch_gate_cta_label,launch_gate_cta_href,created_at,updated_at)
      VALUES (?,0,'prelaunch',?,?,'Contact JA Group Services','mailto:contact@jagroupservices.co.uk',?,?)
      ON CONFLICT(platform_id) DO NOTHING`)
      .bind(row.id, row.name, 'This website is not currently open to the public. Please use the published Company contact details if you need assistance.', now, now).run();
  }
  return rowsForTargets(env);
}

function profile(row) {
  const target = targetFor(row);
  const appearance = parseJson(row.appearance_json);
  const escalationRules = parseJson(row.escalation_rules_json);
  const contactOptions = parseJson(row.contact_options_json);
  const operatingHours = parseJson(row.operating_hours_json);
  return {
    key: target?.key || row.code,
    expectedName: target?.label || row.name,
    platformId: row.id,
    platformCode: row.code,
    platformName: row.name,
    platformStatus: row.status,
    connected: row.connection_status === 'connected',
    connectionStatus: row.connection_status || 'never_connected',
    lastSeenAt: row.last_seen_at || null,
    lastConfigFetchAt: row.last_config_fetch_at || null,
    lastErrorCode: row.last_error_code || null,
    assistantName: row.assistant_name || `${row.name} Support Assistant`,
    assistantEnabled: Boolean(row.assistant_enabled),
    aiEnabled: Boolean(row.ai_enabled),
    humanTakeoverEnabled: row.human_takeover_enabled == null ? true : Boolean(row.human_takeover_enabled),
    anonymousEnabled: row.anonymous_enabled == null ? true : Boolean(row.anonymous_enabled),
    maintenanceEnabled: Boolean(row.maintenance_enabled),
    maintenanceMessage: row.maintenance_message || '',
    emergencyNotice: row.emergency_notice || '',
    greeting: row.greeting || '',
    awayMessage: row.away_message || '',
    retentionDays: Number(row.retention_days || 180),
    operatingHours,
    appearance,
    escalationRules,
    contactOptions,
    launchGate: {
      enabled: Boolean(row.launch_gate_enabled),
      mode: row.launch_gate_mode || 'prelaunch',
      title: row.launch_gate_title || row.name,
      message: row.launch_gate_message || '',
      ctaLabel: row.launch_gate_cta_label || 'Contact JA Group Services',
      ctaHref: row.launch_gate_cta_href || 'mailto:contact@jagroupservices.co.uk',
      background: row.launch_gate_background || '#081426',
      accent: row.launch_gate_accent || '#2563eb',
      textColour: row.launch_gate_text_colour || '#ffffff',
      showCompanyDetails: row.launch_gate_show_company_details == null ? true : Boolean(row.launch_gate_show_company_details),
      allowSearchEngines: Boolean(row.launch_gate_allow_search_engines),
    },
  };
}

async function listProfiles(context) {
  const rows = await ensureTargetRows(context.env);
  const profiles = [];
  const found = new Set();
  for (const target of TARGETS) {
    const row = rows.find(item => targetFor(item)?.key === target.key);
    if (row) {
      profiles.push(profile(row));
      found.add(target.key);
    } else {
      profiles.push({
        key: target.key,
        expectedName: target.label,
        registered: false,
        connected: false,
        connectionStatus: 'platform_not_registered',
      });
    }
  }
  return json({ profiles, count: profiles.length });
}

async function getProfile(context, platformId) {
  const rows = await ensureTargetRows(context.env);
  const row = rows.find(item => item.id === platformId && targetFor(item));
  if (!row) return error('SUPPORT_WEBSITE_PROFILE_NOT_FOUND', 'The selected website control profile was not found.', 404);
  return json({ profile: profile(row) });
}

async function updateProfile(context, auth, platformId) {
  const rows = await ensureTargetRows(context.env);
  const row = rows.find(item => item.id === platformId && targetFor(item));
  if (!row) return error('SUPPORT_WEBSITE_PROFILE_NOT_FOUND', 'The selected website control profile was not found.', 404);

  let body;
  try { body = await readJson(context.request, 96_000); }
  catch (cause) { return error(cause.code || 'INVALID_REQUEST', cause.message, cause.status || 400); }

  const now = new Date().toISOString();
  const appearance = safeObject(body.appearance, 80);
  const escalationRules = safeObject(body.escalationRules, 100);
  const operatingHours = safeObject(body.operatingHours, 50);
  const contactOptions = safeObject(body.contactOptions, 50);
  const gate = body.launchGate && typeof body.launchGate === 'object' ? body.launchGate : {};
  const retentionDays = boundedNumber(body.retentionDays, Number(row.retention_days || 180), 30, 2555);
  const gateModes = new Set(['prelaunch', 'maintenance', 'temporarily_unavailable', 'private_preview']);
  const gateMode = gateModes.has(cleanText(gate.mode, 40)) ? cleanText(gate.mode, 40) : 'prelaunch';

  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO support_branch_settings
      (platform_id,assistant_name,assistant_enabled,ai_enabled,human_takeover_enabled,anonymous_enabled,
       maintenance_enabled,maintenance_message,emergency_notice,greeting,away_message,operating_hours_json,
       appearance_json,escalation_rules_json,contact_options_json,retention_days,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(platform_id) DO UPDATE SET
        assistant_name=excluded.assistant_name,assistant_enabled=excluded.assistant_enabled,
        ai_enabled=excluded.ai_enabled,human_takeover_enabled=excluded.human_takeover_enabled,
        anonymous_enabled=excluded.anonymous_enabled,maintenance_enabled=excluded.maintenance_enabled,
        maintenance_message=excluded.maintenance_message,emergency_notice=excluded.emergency_notice,
        greeting=excluded.greeting,away_message=excluded.away_message,
        operating_hours_json=excluded.operating_hours_json,appearance_json=excluded.appearance_json,
        escalation_rules_json=excluded.escalation_rules_json,contact_options_json=excluded.contact_options_json,
        retention_days=excluded.retention_days,updated_at=excluded.updated_at`)
      .bind(
        platformId,
        cleanText(body.assistantName, 120) || `${row.name} Support Assistant`,
        asBoolean(body.assistantEnabled) ? 1 : 0,
        asBoolean(body.aiEnabled) ? 1 : 0,
        asBoolean(body.humanTakeoverEnabled, true) ? 1 : 0,
        asBoolean(body.anonymousEnabled, true) ? 1 : 0,
        asBoolean(body.maintenanceEnabled) ? 1 : 0,
        cleanText(body.maintenanceMessage, 1000) || null,
        cleanText(body.emergencyNotice, 1000) || null,
        cleanText(body.greeting, 1000) || null,
        cleanText(body.awayMessage, 1000) || null,
        jsonValue(operatingHours),
        jsonValue(appearance),
        jsonValue(escalationRules),
        jsonValue(contactOptions),
        retentionDays,
        now,
        now,
      ),
    context.env.DB.prepare(`INSERT INTO website_control_settings
      (platform_id,launch_gate_enabled,launch_gate_mode,launch_gate_title,launch_gate_message,
       launch_gate_cta_label,launch_gate_cta_href,launch_gate_background,launch_gate_accent,
       launch_gate_text_colour,launch_gate_show_company_details,launch_gate_allow_search_engines,
       created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(platform_id) DO UPDATE SET
        launch_gate_enabled=excluded.launch_gate_enabled,launch_gate_mode=excluded.launch_gate_mode,
        launch_gate_title=excluded.launch_gate_title,launch_gate_message=excluded.launch_gate_message,
        launch_gate_cta_label=excluded.launch_gate_cta_label,launch_gate_cta_href=excluded.launch_gate_cta_href,
        launch_gate_background=excluded.launch_gate_background,launch_gate_accent=excluded.launch_gate_accent,
        launch_gate_text_colour=excluded.launch_gate_text_colour,
        launch_gate_show_company_details=excluded.launch_gate_show_company_details,
        launch_gate_allow_search_engines=excluded.launch_gate_allow_search_engines,
        updated_at=excluded.updated_at`)
      .bind(
        platformId,
        asBoolean(gate.enabled) ? 1 : 0,
        gateMode,
        cleanText(gate.title, 180) || row.name,
        cleanText(gate.message, 1600) || null,
        cleanText(gate.ctaLabel, 120) || null,
        cleanText(gate.ctaHref, 500) || null,
        colour(gate.background, '#081426'),
        colour(gate.accent, '#2563eb'),
        colour(gate.textColour, '#ffffff'),
        asBoolean(gate.showCompanyDetails, true) ? 1 : 0,
        asBoolean(gate.allowSearchEngines) ? 1 : 0,
        now,
        now,
      ),
  ]);

  await audit(context.env, auth.session, 'support.website_profile.configure', 'platform', platformId, {
    label: 'Website AI Customer Service and launch-gate controls changed',
    reference: row.name,
    requestId: context.data?.requestId,
    after: {
      assistantEnabled: asBoolean(body.assistantEnabled),
      aiEnabled: asBoolean(body.aiEnabled),
      humanTakeoverEnabled: asBoolean(body.humanTakeoverEnabled, true),
      maintenanceEnabled: asBoolean(body.maintenanceEnabled),
      launchGateEnabled: asBoolean(gate.enabled),
      launchGateMode: gateMode,
      retentionDays,
    },
  });

  return getProfile(context, platformId);
}

export const onRequestGet = async context => {
  const auth = await authorised(context);
  if (auth.response) return auth.response;
  const route = segments(context.params.path);
  if (route.length === 0) return listProfiles(context);
  if (route.length === 1) return getProfile(context, route[0]);
  return error('SUPPORT_WEBSITE_CONTROL_ROUTE_NOT_FOUND', 'The website control route was not found.', 404);
};

export const onRequestPut = async context => {
  const auth = await authorised(context);
  if (auth.response) return auth.response;
  const route = segments(context.params.path);
  if (route.length === 1) return updateProfile(context, auth, route[0]);
  return error('SUPPORT_WEBSITE_CONTROL_ROUTE_NOT_FOUND', 'The website control route was not found.', 404);
};
