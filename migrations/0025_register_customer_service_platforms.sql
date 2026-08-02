PRAGMA foreign_keys = ON;

-- Register the two public websites that were missing from the central platform
-- register. Existing records are preserved and are never marked connected by
-- this migration: a genuine secure configuration check is still required.
INSERT INTO platforms (id,code,name,status,created_at,updated_at)
VALUES ('platform-ja-group-services','JA_GROUP_SERVICES','JA Group Services','setup',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(code) DO UPDATE SET
  name=excluded.name,
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO platforms (id,code,name,status,created_at,updated_at)
VALUES ('platform-ja-domain-hub','JA_DOMAIN_HUB','JA Domain Hub','setup',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT(code) DO UPDATE SET
  name=excluded.name,
  updated_at=CURRENT_TIMESTAMP;

INSERT INTO platform_operational_profiles (
  platform_id,public_url,environment,hosting_provider,health_status,health_message,
  capabilities_json,integrations_json,metadata_json,created_at,updated_at
)
SELECT
  id,
  'https://jagroupservices.co.uk/',
  'production',
  'Cloudflare Pages',
  'awaiting_connection',
  'Customer Service platform registered; awaiting its first authenticated configuration check.',
  '["customer_service","website_controls","launch_gate"]',
  '{"customerService":"JA Group Services Head Office","launchGate":"head_office_controlled"}',
  '{"customerServiceControlProfile":"JA_GROUP_SERVICES","registrationManagedBy":"Head Office"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM platforms
WHERE code='JA_GROUP_SERVICES'
ON CONFLICT(platform_id) DO NOTHING;

INSERT INTO platform_operational_profiles (
  platform_id,public_url,environment,hosting_provider,health_status,health_message,
  capabilities_json,integrations_json,metadata_json,created_at,updated_at
)
SELECT
  id,
  'https://jadomainhub.co.uk/',
  'production',
  'Cloudflare Pages',
  'awaiting_connection',
  'Customer Service platform registered; awaiting its first authenticated configuration check.',
  '["customer_service","domain_support","provider_escalation"]',
  '{"customerService":"JA Group Services Head Office","underlyingProvider":"authorised_domain_service_provider"}',
  '{"customerServiceControlProfile":"JA_DOMAIN_HUB","registrationManagedBy":"Head Office"}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM platforms
WHERE code='JA_DOMAIN_HUB'
ON CONFLICT(platform_id) DO NOTHING;
