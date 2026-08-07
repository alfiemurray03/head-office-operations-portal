PRAGMA foreign_keys = ON;

-- Board-approved Central Payments cutover: existing production website credentials
-- are already trusted Head Office server-to-server connections. Extend only the
-- governed customer-facing platforms with the payment scopes they now require.
UPDATE platform_api_credentials
SET scopes_json = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(CASE WHEN json_valid(platform_api_credentials.scopes_json) THEN platform_api_credentials.scopes_json ELSE '[]' END)
    UNION SELECT 'payments:checkout'
    UNION SELECT 'payments:status'
    UNION SELECT 'payments:portal'
  )
)
WHERE status = 'active'
  AND platform_id IN (
    SELECT id FROM platforms
    WHERE upper(code) IN (
      'JA_GROUP_SERVICES',
      'JA_DOMAIN_HUB',
      'SOUSA_MURRAY_DOMAINS',
      'SOUSA_MURRAY_SITES',
      'PLANYX',
      'SOUSA_MURRAY_PLANEIA',
      'PROFILE_CENTRE',
      'PROFILE_CENTER',
      'SOUSA_MURRAY_PROFILES',
      'APTENVO',
      'COURSE_SELECT',
      'SOUSA_MURRAY_ELEARNING'
    )
  );

-- Authorise the canonical production origins. These are return targets only;
-- the platform credential is still required to create a Checkout or Portal session.
INSERT OR IGNORE INTO central_payment_platform_origins
  (id, platform_id, origin, status, created_at, updated_at)
SELECT lower(hex(randomblob(16))), id,
  CASE upper(code)
    WHEN 'JA_GROUP_SERVICES' THEN 'https://jagroupservices.co.uk'
    WHEN 'JA_DOMAIN_HUB' THEN 'https://sousamurraydomains.jagroupservices.co.uk'
    WHEN 'SOUSA_MURRAY_DOMAINS' THEN 'https://sousamurraydomains.jagroupservices.co.uk'
    WHEN 'SOUSA_MURRAY_SITES' THEN 'https://sousamurraydomains.jagroupservices.co.uk'
    WHEN 'PLANYX' THEN 'https://sousamurrayplaneia.jagroupservices.co.uk'
    WHEN 'SOUSA_MURRAY_PLANEIA' THEN 'https://sousamurrayplaneia.jagroupservices.co.uk'
    WHEN 'PROFILE_CENTRE' THEN 'https://sousamurrayprofiles.jagroupservices.co.uk'
    WHEN 'PROFILE_CENTER' THEN 'https://sousamurrayprofiles.jagroupservices.co.uk'
    WHEN 'SOUSA_MURRAY_PROFILES' THEN 'https://sousamurrayprofiles.jagroupservices.co.uk'
    WHEN 'APTENVO' THEN 'https://sousamurrayelearning.jagroupservices.co.uk'
    WHEN 'COURSE_SELECT' THEN 'https://sousamurrayelearning.jagroupservices.co.uk'
    WHEN 'SOUSA_MURRAY_ELEARNING' THEN 'https://sousamurrayelearning.jagroupservices.co.uk'
  END,
  'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM platforms
WHERE upper(code) IN (
  'JA_GROUP_SERVICES',
  'JA_DOMAIN_HUB',
  'SOUSA_MURRAY_DOMAINS',
  'SOUSA_MURRAY_SITES',
  'PLANYX',
  'SOUSA_MURRAY_PLANEIA',
  'PROFILE_CENTRE',
  'PROFILE_CENTER',
  'SOUSA_MURRAY_PROFILES',
  'APTENVO',
  'COURSE_SELECT',
  'SOUSA_MURRAY_ELEARNING'
);

-- Temporary legacy Domain Hub origin remains authorised during DNS cutover only.
INSERT OR IGNORE INTO central_payment_platform_origins
  (id, platform_id, origin, status, created_at, updated_at)
SELECT lower(hex(randomblob(16))), id, 'https://jadomainhub.jagroupservices.co.uk',
  'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM platforms
WHERE upper(code) = 'JA_DOMAIN_HUB';
