import { audit, cleanText, error, json, readJson } from '../../_shared.js';
import { hasPermission, requirePermission } from '../../_operations.js';
import { ensureBranchSettings, ensureSupportCentreSchema } from '../../_support-centre-schema.js';

const BRANCH_SLOTS = [
  {
    key: 'ja_group_services',
    label: 'JA Group Services',
    assistantName: 'JA Group Services Support Assistant',
    launchGateSupported: true,
    matches: value => /ja[ _-]?group[ _-]?services/i.test(value) && !/domain[ _-]?hub/i.test(value),
  },
  {
    key: 'ja_domain_hub',
    label: 'JA Domain Hub',
    assistantName: 'JA Domain Hub Support Assistant',
    launchGateSupported: false,
    matches: value => /ja[ _-]?domain[ _-]?hub|domain[ _-]?hub/i.test(value),
  },
  {
    key: 'planyx',
    label: 'Planyx',
    assistantName: 'Planyx Support Assistant',
    launchGateSupported: false,
    matches: value => /planyx/i.test(value),
  },
  {
    key: 'profile_centre',
    label: 'Profile Centre',
    assistantName: 'Profile Centre Support Assistant',
    launchGateSupported: false,
    matches: value => /profile[ _-]?centre/i.test(value),
  },
];

const CONNECTION_STATUSES = new Set(['connected', 'degraded', 'disconnected', 'never_connected']);
const LAUNCH_GATE_MODES = new Set(['prelaunch', 'maintenance', 'temporarily_unavailable', 'private_preview']);
const POSITIONS = new Set(['bottom-right', 'bottom-left']);
const THEMES = new Set(['auto', 'light', 'dark']);
const MESSAGE_STYLES = new Set(['rounded', 'compact', 'square']);

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

function jsonValue(value) {
  try { return JSON.stringify(value || {}); }
  catch { return '{}'; }
}

function booleanValue(value, fallback = false) {
  return value == null ? fallback : value === true || value === 1 || value === '1' || value === 'true';
}

function boundedNumber(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(numeric)));
}

function colour(value, fallback) {
  const candidate = cleanText(value, 24);
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate.toLowerCase() : fallback;
}

function safeUrl(value, fallback = '') {
  const candidate = cleanText(value, 500);
  if (!candidate) return fallback;
  if (/^(?:https:\/\/|mailto:|tel:|\/)/i.test(candidate)) return candidate;
  return fallback;
}

function slotForPlatform(platform) {
  const descriptor = `${platform?.code || ''} ${platform?.name || ''}`.trim();
  return BRANCH_SLOTS.find(slot => slot.matches(descriptor)) || null;
}

function connectionState(row) {
  if (!row?.last_seen_at) return 'never_connected';
  const age = Date.now() - new Date(row.last_seen_at).getTime();
  if (!Number.isFinite(age) || age < 0) return 'degraded';
  if (age <= 15 * 60 * 1000) return 'connected';
  if (age <= 24 * 60 * 60 * 1000) return 'degraded';
  return 'disconnected';
}

async function ensureControlSchema(env) {
  await ensureSupportCentreSchema(env);
  const statements = [
    `CREATE TABLE IF NOT EXISTS support_branch_connections (
      platform_id TEXT PRIMARY KEY REFERENCES platforms(id) ON DELETE CASCADE,
      connection_status TEXT NOT NULL DEFAULT 'never_connected',
      last_seen_at TEXT,last_config_fetch_at TEXT,last_user_agent TEXT,last_origin TEXT,last_error_code TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS website_control_settings (
      platform_id TEXT PRIMARY KEY REFERENCES platforms(id) ON DELETE CASCADE,
      launch_gate_enabled INTEGER NOT NULL DEFAULT 0,
      launch_gate_mode TEXT NOT NULL DEFAULT 'prelaunch',
      launch_gate_title TEXT,launch_gate_message TEXT,launch_gate_cta_label TEXT,launch_gate_cta_href TEXT,
      launch_gate_background TEXT NOT NULL DEFAULT '#081426',launch_gate_accent TEXT NOT NULL DEFAULT '#2563eb',
      launch_gate_text_colour TEXT NOT NULL DEFAULT '#ffffff',
      launch_gate_show_company_details INTEGER NOT NULL DEFAULT 1,
      launch_gate_allow_search_engines INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
  ];
  for (const statement of statements) await env.DB.prepare(statement).run();
}

async function platformRows(env) {
  const result = await env.DB.prepare('SELECT id,code,name,status FROM platforms ORDER BY name').all();
  return result.results || [];
}

async function ensureWebsiteControl(env, platformId, slot) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO website_control_settings
    (platform_id,launch_gate_enabled,launch_gate_mode,launch_gate_title,launch_gate_message,
     launch_gate_cta_label,launch_gate_cta_href,created_at,updated_at)
    VALUES (?,0,'prelaunch',?,?,'Contact JA Group Services','mailto:contact@jagroupservices.co.uk',?,?)
    ON CONFLICT(platform_id) DO NOTHING`)
    .bind(
      platformId,
      slot.label,
      'This website is not currently open to the public. Please use the published Company contact details if you need assistance.',
      now,
      now,
    ).run();
}

function cleanAppearance(input = {}) {
  return {
    accentColour: colour(input.accentColour, '#2563eb'),
    launcherColour: colour(input.launcherColour, colour(input.accentColour, '#2563eb')),
    launcherTextColour: colour(input.launcherTextColour, '#ffffff'),
    headerBackground: colour(input.headerBackground, '#0f172a'),
    headerTextColour: colour(input.headerTextColour, '#ffffff'),
    panelBackground: colour(input.panelBackground, '#ffffff'),
    panelTextColour: colour(input.panelTextColour, '#0f172a'),
    position: POSITIONS.has(input.position) ? input.position : 'bottom-right',
    theme: THEMES.has(input.theme) ? input.theme : 'auto',
    messageStyle: MESSAGE_STYLES.has(input.messageStyle) ? input.messageStyle : 'rounded',
    panelWidth: boundedNumber(input.panelWidth, 340, 720, 430),
    panelHeight: boundedNumber(input.panelHeight, 480, 900, 680),
    borderRadius: boundedNumber(input.borderRadius, 0, 32, 18),
    launcherSize: boundedNumber(input.launcherSize, 44, 80, 56),
    launcherLabel: cleanText(input.launcherLabel, 80) || 'Help',
    headerSubtitle: cleanText(input.headerSubtitle, 160) || 'Connected to JA Group Services Head Office',
    inputPlaceholder: cleanText(input.inputPlaceholder, 160) || 'Type your enquiry…',
    showLauncherLabel: input.showLauncherLabel !== false,
    showPoweredBy: input.showPoweredBy !== false,
    showKnowledgeSuggestions: input.showKnowledgeSuggestions !== false,
    knowledgeLimit: boundedNumber(input.knowledgeLimit, 0, 10, 3),
  };
}

function cleanOperatingHours(input = {}) {
  const day = value => cleanText(value, 80);
  return {
    timezone: cleanText(input.timezone, 80) || 'Europe/London',
    monday: day(input.monday),
    tuesday: day(input.tuesday),
    wednesday: day(input.wednesday),
    thursday: day(input.thursday),
    friday: day(input.friday),
    saturday: day(input.saturday),
    sunday: day(input.sunday),
    closedMessage: cleanText(input.closedMessage, 500),
    displayHoursToCustomer: input.displayHoursToCustomer !== false,
  };
}

function cleanEscalationRules(input = {}) {
  return {
    complaints: input.complaints !== false,
    dataProtection: input.dataProtection !== false,
    safeguarding: input.safeguarding !== false,
    security: input.security !== false,
    accountRecovery: input.accountRecovery !== false,
    providerEscalation: input.providerEscalation === true,
    unresolvedAfterMessages: boundedNumber(input.unresolvedAfterMessages, 1, 20, 5),
    humanRequestPriority: ['low', 'normal', 'high', 'critical'].includes(input.humanRequestPriority)
      ? input.humanRequestPriority
      : 'normal',
    requireConsentForSensitiveData: input.requireConsentForSensitiveData !== false,
  };
}

function cleanContactOptions(input = {}) {
  return {
    email: cleanText(input.email, 254) || 'contact@jagroupservices.co.uk',
    phone: cleanText(input.phone, 40) || '020 3834 2790',
    complaintsEmail: cleanText(input.complaintsEmail, 254) || 'complaints@jagroupservices.co.uk',
    dataProtectionEmail: cleanText(input.dataProtectionEmail, 254) || 'dataprotection@jagroupservices.co.uk',
    showEmail: input.showEmail !== false,
    showPhone: input.showPhone !== false,
  };
}

function branchPayload(slot, platform, settings, site, connection, permissions = {}) {
  if (!platform) {
    return {
      slotKey: slot.key,
      slotLabel: slot.label,
      registered: false,
      launchGateSupported: slot.launchGateSupported,
      connection: { status: 'not_registered', lastSeenAt: null },
      permissions,
    };
  }
  const appearance = cleanAppearance(parseJson(settings?.appearance_json));
  const operatingHours = cleanOperatingHours(parseJson(settings?.operating_hours_json));
  const escalationRules = cleanEscalationRules(parseJson(settings?.escalation_rules_json));
  const contactOptions = cleanContactOptions(parseJson(settings?.contact_options_json));
  const calculatedConnection = connectionState(connection);
  return {
    slotKey: slot.key,
    slotLabel: slot.label,
    registered: true,
    launchGateSupported: slot.launchGateSupported,
    platformId: platform.id,
    platformCode: platform.code,
    platformName: platform.name,
    platformStatus: platform.status,
    assistantName: settings?.assistant_name || slot.assistantName,
    assistantEnabled: Boolean(settings?.assistant_enabled),
    aiEnabled: Boolean(settings?.ai_enabled),
    humanTakeoverEnabled: settings?.human_takeover_enabled == null ? true : Boolean(settings.human_takeover_enabled),
    anonymousEnabled: settings?.anonymous_enabled == null ? true : Boolean(settings.anonymous_enabled),
    maintenanceEnabled: Boolean(settings?.maintenance_enabled),
    maintenanceMessage: settings?.maintenance_message || '',
    emergencyNotice: settings?.emergency_notice || '',
    greeting: settings?.greeting || '',
    awayMessage: settings?.away_message || '',
    retentionDays: Number(settings?.retention_days || 180),
    appearance,
    operatingHours,
    escalationRules,
    contactOptions,
    launchGate: {
      enabled: slot.launchGateSupported && Boolean(site?.launch_gate_enabled),
      mode: LAUNCH_GATE_MODES.has(site?.launch_gate_mode) ? site.launch_gate_mode : 'prelaunch',
      title: site?.launch_gate_title || slot.label,
      message: site?.launch_gate_message || '',
      ctaLabel: site?.launch_gate_cta_label || 'Contact JA Group Services',
      ctaHref: site?.launch_gate_cta_href || 'mailto:contact@jagroupservices.co.uk',
      background: colour(site?.launch_gate_background, '#081426'),
      accent: colour(site?.launch_gate_accent, '#2563eb'),
      textColour: colour(site?.launch_gate_text_colour, '#ffffff'),
      showCompanyDetails: site?.launch_gate_show_company_details == null ? true : Boolean(site.launch_gate_show_company_details),
      allowSearchEngines: Boolean(site?.launch_gate_allow_search_engines),
    },
    connection: {
      status: CONNECTION_STATUSES.has(calculatedConnection) ? calculatedConnection : 'never_connected',
      lastSeenAt: connection?.last_seen_at || null,
      lastConfigFetchAt: connection?.last_config_fetch_at || null,
      lastOrigin: connection?.last_origin || null,
      lastErrorCode: connection?.last_error_code || null,
    },
    permissions,
  };
}

async function loadBranches(context, auth) {
  const platforms = await platformRows(context.env);
  const output = [];
  for (const slot of BRANCH_SLOTS) {
    const platform = platforms.find(item => slotForPlatform(item)?.key === slot.key) || null;
    if (!platform) {
      output.push(branchPayload(slot, null, null, null, null, { canConfigure: false }));
      continue;
    }
    const settings = await ensureBranchSettings(context.env, platform);
    await ensureWebsiteControl(context.env, platform.id, slot);
    const [site, connection] = await Promise.all([
      context.env.DB.prepare('SELECT * FROM website_control_settings WHERE platform_id=?').bind(platform.id).first(),
      context.env.DB.prepare('SELECT * FROM support_branch_connections WHERE platform_id=?').bind(platform.id).first(),
    ]);
    output.push(branchPayload(slot, platform, settings, site, connection, {
      canConfigure: hasPermission(auth.authorisation, 'configuration:write'),
    }));
  }
  return output;
}

async function findBranch(context, auth, platformId) {
  const platform = await context.env.DB.prepare('SELECT id,code,name,status FROM platforms WHERE id=? LIMIT 1')
    .bind(platformId).first();
  if (!platform) return null;
  const slot = slotForPlatform(platform);
  if (!slot) return null;
  const settings = await ensureBranchSettings(context.env, platform);
  await ensureWebsiteControl(context.env, platform.id, slot);
  const [site, connection] = await Promise.all([
    context.env.DB.prepare('SELECT * FROM website_control_settings WHERE platform_id=?').bind(platform.id).first(),
    context.env.DB.prepare('SELECT * FROM support_branch_connections WHERE platform_id=?').bind(platform.id).first(),
  ]);
  return branchPayload(slot, platform, settings, site, connection, {
    canConfigure: hasPermission(auth.authorisation, 'configuration:write'),
  });
}

async function listBranchControls(context, auth) {
  return json({ branches: await loadBranches(context, auth), controlledBranchCount: BRANCH_SLOTS.length });
}

async function getBranchControl(context, auth, platformId) {
  const branch = await findBranch(context, auth, platformId);
  if (!branch) return error('SUPPORT_CONTROL_BRANCH_NOT_FOUND', 'The selected approved website branch was not found.', 404);
  return json({ branch });
}

async function updateBranchControl(context, auth, platformId) {
  if (!hasPermission(auth.authorisation, 'configuration:write')) {
    return error('SUPPORT_CONTROL_DENIED', 'You are not authorised to change website customer-service controls.', 403);
  }
  const platform = await context.env.DB.prepare('SELECT id,code,name,status FROM platforms WHERE id=? LIMIT 1')
    .bind(platformId).first();
  const slot = platform && slotForPlatform(platform);
  if (!platform || !slot) return error('SUPPORT_CONTROL_BRANCH_NOT_FOUND', 'The selected approved website branch was not found.', 404);

  let body;
  try { body = await readJson(context.request, 80_000); }
  catch (cause) { return error(cause.code || 'INVALID_REQUEST', cause.message, cause.status || 400); }

  const previous = await findBranch(context, auth, platformId);
  const appearance = cleanAppearance(body.appearance || {});
  const operatingHours = cleanOperatingHours(body.operatingHours || {});
  const escalationRules = cleanEscalationRules(body.escalationRules || {});
  const contactOptions = cleanContactOptions(body.contactOptions || {});
  const retentionDays = boundedNumber(body.retentionDays, 30, 2555, 180);
  const now = new Date().toISOString();

  await context.env.DB.prepare(`INSERT INTO support_branch_settings
    (platform_id,assistant_name,assistant_enabled,ai_enabled,human_takeover_enabled,anonymous_enabled,
     maintenance_enabled,maintenance_message,emergency_notice,greeting,away_message,
     operating_hours_json,appearance_json,escalation_rules_json,contact_options_json,
     retention_days,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(platform_id) DO UPDATE SET
      assistant_name=excluded.assistant_name,
      assistant_enabled=excluded.assistant_enabled,
      ai_enabled=excluded.ai_enabled,
      human_takeover_enabled=excluded.human_takeover_enabled,
      anonymous_enabled=excluded.anonymous_enabled,
      maintenance_enabled=excluded.maintenance_enabled,
      maintenance_message=excluded.maintenance_message,
      emergency_notice=excluded.emergency_notice,
      greeting=excluded.greeting,
      away_message=excluded.away_message,
      operating_hours_json=excluded.operating_hours_json,
      appearance_json=excluded.appearance_json,
      escalation_rules_json=excluded.escalation_rules_json,
      contact_options_json=excluded.contact_options_json,
      retention_days=excluded.retention_days,
      updated_at=excluded.updated_at`)
    .bind(
      platformId,
      cleanText(body.assistantName, 120) || slot.assistantName,
      booleanValue(body.assistantEnabled) ? 1 : 0,
      booleanValue(body.aiEnabled) ? 1 : 0,
      body.humanTakeoverEnabled === false ? 0 : 1,
      body.anonymousEnabled === false ? 0 : 1,
      booleanValue(body.maintenanceEnabled) ? 1 : 0,
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
    ).run();

  const gate = body.launchGate || {};
  if (booleanValue(gate.enabled) && !slot.launchGateSupported) {
    return error('LAUNCH_GATE_NOT_SUPPORTED', 'The Launch Gate is currently authorised only for the JA Group Services website.', 409);
  }
  const gateMode = LAUNCH_GATE_MODES.has(gate.mode) ? gate.mode : 'prelaunch';
  await context.env.DB.prepare(`INSERT INTO website_control_settings
    (platform_id,launch_gate_enabled,launch_gate_mode,launch_gate_title,launch_gate_message,
     launch_gate_cta_label,launch_gate_cta_href,launch_gate_background,launch_gate_accent,
     launch_gate_text_colour,launch_gate_show_company_details,launch_gate_allow_search_engines,
     created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(platform_id) DO UPDATE SET
      launch_gate_enabled=excluded.launch_gate_enabled,
      launch_gate_mode=excluded.launch_gate_mode,
      launch_gate_title=excluded.launch_gate_title,
      launch_gate_message=excluded.launch_gate_message,
      launch_gate_cta_label=excluded.launch_gate_cta_label,
      launch_gate_cta_href=excluded.launch_gate_cta_href,
      launch_gate_background=excluded.launch_gate_background,
      launch_gate_accent=excluded.launch_gate_accent,
      launch_gate_text_colour=excluded.launch_gate_text_colour,
      launch_gate_show_company_details=excluded.launch_gate_show_company_details,
      launch_gate_allow_search_engines=excluded.launch_gate_allow_search_engines,
      updated_at=excluded.updated_at`)
    .bind(
      platformId,
      slot.launchGateSupported && booleanValue(gate.enabled) ? 1 : 0,
      gateMode,
      cleanText(gate.title, 160) || slot.label,
      cleanText(gate.message, 1500) || 'This website is not currently open to the public. Please use the published Company contact details if you need assistance.',
      cleanText(gate.ctaLabel, 100) || 'Contact JA Group Services',
      safeUrl(gate.ctaHref, 'mailto:contact@jagroupservices.co.uk'),
      colour(gate.background, '#081426'),
      colour(gate.accent, '#2563eb'),
      colour(gate.textColour, '#ffffff'),
      gate.showCompanyDetails === false ? 0 : 1,
      booleanValue(gate.allowSearchEngines) ? 1 : 0,
      now,
      now,
    ).run();

  const updated = await findBranch(context, auth, platformId);
  await audit(context.env, auth.session, 'support.branch.full_control', 'platform', platformId, {
    label: `${slot.label} customer-service controls changed`,
    reference: platform.name,
    requestId: context.data?.requestId,
    before: previous,
    after: updated,
    metadata: {
      branch: slot.key,
      launchGateSupported: slot.launchGateSupported,
      launchGateEnabled: Boolean(updated?.launchGate?.enabled),
    },
  });
  return json({ updated: true, branch: updated, updatedAt: now });
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, 'communications:read');
  if (auth.response) return auth.response;
  await ensureControlSchema(context.env);
  const route = segments(context.params.path);
  if (route.length === 1 && route[0] === 'branches') return listBranchControls(context, auth);
  if (route.length === 2 && route[0] === 'branches') return getBranchControl(context, auth, route[1]);
  return error('SUPPORT_CONTROL_ROUTE_NOT_FOUND', 'The customer-service control route was not found.', 404);
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context, 'configuration:write');
  if (auth.response) return auth.response;
  await ensureControlSchema(context.env);
  const route = segments(context.params.path);
  if (route.length === 2 && route[0] === 'branches') return updateBranchControl(context, auth, route[1]);
  return error('SUPPORT_CONTROL_ROUTE_NOT_FOUND', 'The customer-service control route was not found.', 404);
};
