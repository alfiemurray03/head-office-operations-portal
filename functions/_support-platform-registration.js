import { ensureCentralPlatformSchema } from './_central-schema.js';

const APPROVED_SUPPORT_PLATFORMS = [
  {
    id: 'platform-ja-group-services',
    code: 'JA_GROUP_SERVICES',
    name: 'JA Group Services',
    publicUrl: 'https://jagroupservices.co.uk/',
    capabilities: ['customer_service', 'website_controls', 'launch_gate'],
    integrations: {
      customerService: 'JA Group Services Head Office',
      launchGate: 'head_office_controlled',
    },
    matches: value => /ja[ _-]?group[ _-]?services/i.test(value) && !/domain[ _-]?hub/i.test(value),
  },
  {
    id: 'platform-ja-domain-hub',
    code: 'JA_DOMAIN_HUB',
    name: 'JA Domain Hub',
    publicUrl: 'https://jadomainhub.co.uk/',
    capabilities: ['customer_service', 'domain_support', 'provider_escalation'],
    integrations: {
      customerService: 'JA Group Services Head Office',
      underlyingProvider: 'authorised_domain_service_provider',
    },
    matches: value => /ja[ _-]?domain[ _-]?hub|domain[ _-]?hub/i.test(value),
  },
  {
    id: 'platform-planyx',
    code: 'PLANYX',
    name: 'Planyx',
    publicUrl: 'https://planyx.jagroupservices.co.uk/',
    capabilities: ['customer_service', 'customer_identity', 'ai_support'],
    integrations: { customerService: 'JA Group Services Head Office' },
    matches: value => /planyx/i.test(value),
  },
  {
    id: 'platform-profile-centre',
    code: 'PROFILE_CENTRE',
    name: 'Profile Centre',
    publicUrl: 'https://profilecentre.jagroupservices.co.uk/',
    capabilities: ['customer_service', 'customer_identity', 'profile_management'],
    integrations: { customerService: 'JA Group Services Head Office' },
    matches: value => /profile[ _-]?centre/i.test(value),
  },
];

function descriptor(platform) {
  return `${platform?.code || ''} ${platform?.name || ''}`.trim();
}

async function currentPlatforms(env) {
  const result = await env.DB.prepare('SELECT id,code,name,status FROM platforms ORDER BY name').all();
  return result.results || [];
}

async function createMissingPlatform(env, definition, now) {
  await env.DB.prepare(`INSERT INTO platforms (id,code,name,status,created_at,updated_at)
    VALUES (?,?,?,'setup',?,?)
    ON CONFLICT(code) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at`)
    .bind(definition.id, definition.code, definition.name, now, now).run();

  return env.DB.prepare('SELECT id,code,name,status FROM platforms WHERE code=? LIMIT 1')
    .bind(definition.code).first();
}

async function ensureOperationalProfile(env, platform, definition, now) {
  await env.DB.prepare(`INSERT INTO platform_operational_profiles
    (platform_id,public_url,environment,hosting_provider,health_status,health_message,
     capabilities_json,integrations_json,metadata_json,created_at,updated_at)
    VALUES (?,?,'production','Cloudflare Pages','awaiting_connection',?,?,?,?,?,?)
    ON CONFLICT(platform_id) DO NOTHING`)
    .bind(
      platform.id,
      definition.publicUrl,
      'Customer Service platform registered; awaiting its first authenticated configuration check.',
      JSON.stringify(definition.capabilities),
      JSON.stringify(definition.integrations),
      JSON.stringify({ customerServiceControlProfile: definition.code, registrationManagedBy: 'Head Office' }),
      now,
      now,
    ).run();
}

export async function ensureApprovedSupportPlatforms(env) {
  await ensureCentralPlatformSchema(env);
  const now = new Date().toISOString();
  const platforms = await currentPlatforms(env);
  const ensured = [];

  for (const definition of APPROVED_SUPPORT_PLATFORMS) {
    let platform = platforms.find(item => definition.matches(descriptor(item))) || null;
    if (!platform) {
      platform = await createMissingPlatform(env, definition, now);
      if (platform) platforms.push(platform);
    }
    if (!platform) continue;
    await ensureOperationalProfile(env, platform, definition, now);
    ensured.push(platform);
  }

  return ensured;
}
