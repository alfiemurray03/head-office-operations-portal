PRAGMA foreign_keys = ON;

-- Retire the obsolete assumed record only when it has never received a
-- credential or customer link and a real Profile Centre setup record exists.
DELETE FROM platform_operational_profiles
WHERE platform_id = 'platform-profile-centre'
  AND EXISTS (SELECT 1 FROM platforms WHERE code = 'PROFILECENTRE')
  AND NOT EXISTS (
    SELECT 1 FROM platform_api_credentials WHERE platform_id = 'platform-profile-centre'
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_platform_accounts WHERE platform_id = 'platform-profile-centre'
  );

DELETE FROM platforms
WHERE id = 'platform-profile-centre'
  AND code = 'PROFILE_CENTRE'
  AND EXISTS (SELECT 1 FROM platforms WHERE code = 'PROFILECENTRE')
  AND NOT EXISTS (
    SELECT 1 FROM platform_api_credentials WHERE platform_id = 'platform-profile-centre'
  )
  AND NOT EXISTS (
    SELECT 1 FROM customer_platform_accounts WHERE platform_id = 'platform-profile-centre'
  );

UPDATE platforms
SET code = 'PROFILE_CENTRE',
    name = 'Profile Centre',
    status = CASE WHEN status = 'disabled' THEN 'setup' ELSE status END,
    updated_at = CURRENT_TIMESTAMP
WHERE code = 'PROFILECENTRE';

INSERT INTO platform_operational_profiles (
  platform_id, public_url, environment, hosting_provider, health_status,
  capabilities_json, integrations_json, metadata_json, created_at, updated_at
)
SELECT
  id,
  'https://profilecentre.jagroupservices.co.uk/',
  'production',
  'Cloudflare Pages',
  'awaiting_connection',
  '["customer_identity_sync","central_access_decisions","security_state","operational_events","age_assurance"]',
  '{"customerIdentity":"JA Group Services ID","securityAuthority":"JA Group Services Head Office","ageAssuranceContract":"ja-head-office-age-assurance-v1"}',
  '{"divisionCode":"DIV-020","customerPopulation":"customers_only","staffAccountsExcluded":true,"minimumAge":18,"ageEnforcementEnabled":false}',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM platforms
WHERE code = 'PROFILE_CENTRE'
ON CONFLICT(platform_id) DO UPDATE SET
  public_url = excluded.public_url,
  environment = excluded.environment,
  hosting_provider = excluded.hosting_provider,
  capabilities_json = excluded.capabilities_json,
  integrations_json = excluded.integrations_json,
  metadata_json = excluded.metadata_json,
  updated_at = CURRENT_TIMESTAMP;
