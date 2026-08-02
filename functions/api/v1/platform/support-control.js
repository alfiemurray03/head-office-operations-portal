import { cleanText, error, json, requirePlatform } from '../../../_shared.js';
import {
  ensureBranchSettings,
  ensureSupportCentreSchema,
  ensureSupportCredentialScopes,
  isLiveSupportPlatform,
} from '../../../_support-centre-schema.js';

function parseJson(value, fallback = {}) {
  try {
    const parsed = JSON.parse(value || JSON.stringify(fallback));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function hasScope(platform, required) {
  const scopes = platform?.scopes || [];
  return scopes.includes('support:*') || scopes.includes(required);
}

async function ensureControlSchema(env) {
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

async function authenticate(context) {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth;
  await ensureControlSchema(context.env);
  const granted = await ensureSupportCredentialScopes(context.env, auth.platform);
  auth.platform.scopes = [...new Set([...(auth.platform.scopes || []), ...granted])];
  if (!isLiveSupportPlatform(auth.platform) || !hasScope(auth.platform, 'support:read')) {
    return { response: error('SUPPORT_CONTROL_ACCESS_DENIED', 'This platform is not authorised for central customer-service controls.', 403) };
  }
  return auth;
}

function publicConfig(settings, site) {
  const assistantEnabled = Boolean(settings.assistant_enabled);
  return {
    platformId: settings.platform_id,
    assistantEnabled,
    enabled: assistantEnabled,
    aiEnabled: Boolean(settings.ai_enabled),
    humanTakeoverEnabled: Boolean(settings.human_takeover_enabled),
    anonymousEnabled: Boolean(settings.anonymous_enabled),
    maintenanceEnabled: Boolean(settings.maintenance_enabled),
    maintenanceMessage: settings.maintenance_message || '',
    emergencyNotice: settings.emergency_notice || '',
    assistantName: settings.assistant_name || 'Support Assistant',
    greeting: settings.greeting || '',
    awayMessage: settings.away_message || '',
    operatingHours: parseJson(settings.operating_hours_json),
    appearance: parseJson(settings.appearance_json),
    escalationRules: parseJson(settings.escalation_rules_json),
    contactOptions: parseJson(settings.contact_options_json),
    retentionDays: Number(settings.retention_days || 180),
    siteControls: {
      launchGate: {
        enabled: Boolean(site?.launch_gate_enabled),
        mode: site?.launch_gate_mode || 'prelaunch',
        title: site?.launch_gate_title || '',
        message: site?.launch_gate_message || '',
        ctaLabel: site?.launch_gate_cta_label || '',
        ctaHref: site?.launch_gate_cta_href || '',
        background: site?.launch_gate_background || '#081426',
        accent: site?.launch_gate_accent || '#2563eb',
        textColour: site?.launch_gate_text_colour || '#ffffff',
        showCompanyDetails: site?.launch_gate_show_company_details == null ? true : Boolean(site.launch_gate_show_company_details),
        allowSearchEngines: Boolean(site?.launch_gate_allow_search_engines),
      },
    },
  };
}

export const onRequestGet = async context => {
  const auth = await authenticate(context);
  if (auth.response) return auth.response;

  const settings = await ensureBranchSettings(context.env, auth.platform);
  const now = new Date().toISOString();
  const origin = cleanText(context.request.headers.get('Origin') || '', 300);
  const userAgent = cleanText(context.request.headers.get('User-Agent') || '', 300);

  if (String(settings.contact_options_json || '').includes('hello@jagroupservices.co.uk')) {
    settings.contact_options_json = String(settings.contact_options_json)
      .replaceAll('hello@jagroupservices.co.uk', 'contact@jagroupservices.co.uk');
    await context.env.DB.prepare('UPDATE support_branch_settings SET contact_options_json=?,updated_at=? WHERE platform_id=?')
      .bind(settings.contact_options_json, now, auth.platform.id).run();
  }

  await context.env.DB.prepare(`INSERT INTO support_branch_connections
    (platform_id,connection_status,last_seen_at,last_config_fetch_at,last_user_agent,last_origin,last_error_code,created_at,updated_at)
    VALUES (?,'connected',?,?,?,?,NULL,?,?)
    ON CONFLICT(platform_id) DO UPDATE SET
      connection_status='connected',last_seen_at=excluded.last_seen_at,
      last_config_fetch_at=excluded.last_config_fetch_at,last_user_agent=excluded.last_user_agent,
      last_origin=excluded.last_origin,last_error_code=NULL,updated_at=excluded.updated_at`)
    .bind(auth.platform.id, now, now, userAgent || null, origin || null, now, now).run();

  await context.env.DB.prepare(`INSERT INTO website_control_settings
    (platform_id,launch_gate_enabled,launch_gate_mode,launch_gate_title,launch_gate_message,
     launch_gate_cta_label,launch_gate_cta_href,created_at,updated_at)
    VALUES (?,0,'prelaunch',?,?,'Contact JA Group Services','mailto:contact@jagroupservices.co.uk',?,?)
    ON CONFLICT(platform_id) DO NOTHING`)
    .bind(
      auth.platform.id,
      auth.platform.name,
      'This website is not currently open to the public. Please use the published Company contact details if you need assistance.',
      now,
      now,
    ).run();

  const site = await context.env.DB.prepare('SELECT * FROM website_control_settings WHERE platform_id=?')
    .bind(auth.platform.id).first();
  const config = publicConfig(settings, site);
  return json({
    success: true,
    connected: true,
    centralEnabled: true,
    platform: { id: auth.platform.id, code: auth.platform.code, name: auth.platform.name },
    config,
    branch: config,
    connection: { status: 'connected', lastSeenAt: now },
  });
};
