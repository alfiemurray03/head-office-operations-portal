PRAGMA foreign_keys = ON;

-- Reconcile the Head Office connected-platform register with the current public
-- website structure. Existing IDs/codes are deliberately preserved because
-- credentials, customer links, sessions and audit records can reference them.
-- Sousa Murray Sites is a service area within Sousa Murray Domains, not a
-- separate production website.

UPDATE platforms SET name='JA Group Services Ltd',updated_at=CURRENT_TIMESTAMP
WHERE upper(code)='JA_GROUP_SERVICES';
UPDATE platforms SET name='Sousa Murray Domains',updated_at=CURRENT_TIMESTAMP
WHERE upper(code) IN ('SOUSA_MURRAY_DOMAINS','JA_DOMAIN_HUB','SOUSA_MURRAY_SITES');
UPDATE platforms SET name='Sousa Murray Planeia',updated_at=CURRENT_TIMESTAMP
WHERE upper(code) IN ('SOUSA_MURRAY_PLANEIA','PLANYX');
UPDATE platforms SET name='Sousa Murray Profiles',updated_at=CURRENT_TIMESTAMP
WHERE upper(code) IN ('SOUSA_MURRAY_PROFILES','PROFILE_CENTRE','PROFILE_CENTER','PROFILECENTRE');
UPDATE platforms SET name='Sousa Murray eLearning',updated_at=CURRENT_TIMESTAMP
WHERE upper(code) IN ('SOUSA_MURRAY_ELEARNING','APTENVO','COURSE_SELECT');

INSERT INTO platforms(id,code,name,status,created_at,updated_at)
SELECT 'platform-ja-group-services','JA_GROUP_SERVICES','JA Group Services Ltd','setup',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM platforms WHERE upper(code)='JA_GROUP_SERVICES');

INSERT INTO platforms(id,code,name,status,created_at,updated_at)
SELECT 'platform-sousa-murray-domains','SOUSA_MURRAY_DOMAINS','Sousa Murray Domains','setup',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM platforms WHERE upper(code) IN ('SOUSA_MURRAY_DOMAINS','JA_DOMAIN_HUB','SOUSA_MURRAY_SITES'));

INSERT INTO platforms(id,code,name,status,created_at,updated_at)
SELECT 'platform-sousa-murray-planeia','SOUSA_MURRAY_PLANEIA','Sousa Murray Planeia','setup',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM platforms WHERE upper(code) IN ('SOUSA_MURRAY_PLANEIA','PLANYX'));

INSERT INTO platforms(id,code,name,status,created_at,updated_at)
SELECT 'platform-sousa-murray-profiles','SOUSA_MURRAY_PROFILES','Sousa Murray Profiles','setup',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM platforms WHERE upper(code) IN ('SOUSA_MURRAY_PROFILES','PROFILE_CENTRE','PROFILE_CENTER','PROFILECENTRE'));

INSERT INTO platforms(id,code,name,status,created_at,updated_at)
SELECT 'platform-sousa-murray-elearning','SOUSA_MURRAY_ELEARNING','Sousa Murray eLearning','setup',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM platforms WHERE upper(code) IN ('SOUSA_MURRAY_ELEARNING','APTENVO','COURSE_SELECT'));

UPDATE platform_operational_profiles
SET public_url='https://jagroupservices.co.uk',environment='production',updated_at=CURRENT_TIMESTAMP
WHERE platform_id IN (SELECT id FROM platforms WHERE upper(code)='JA_GROUP_SERVICES');
UPDATE platform_operational_profiles
SET public_url='https://sousamurraydomains.jagroupservices.co.uk',environment='production',updated_at=CURRENT_TIMESTAMP
WHERE platform_id IN (SELECT id FROM platforms WHERE upper(code) IN ('SOUSA_MURRAY_DOMAINS','JA_DOMAIN_HUB','SOUSA_MURRAY_SITES'));
UPDATE platform_operational_profiles
SET public_url='https://sousamurrayplaneia.jagroupservices.co.uk',environment='production',updated_at=CURRENT_TIMESTAMP
WHERE platform_id IN (SELECT id FROM platforms WHERE upper(code) IN ('SOUSA_MURRAY_PLANEIA','PLANYX'));
UPDATE platform_operational_profiles
SET public_url='https://sousamurrayprofiles.jagroupservices.co.uk',environment='production',updated_at=CURRENT_TIMESTAMP
WHERE platform_id IN (SELECT id FROM platforms WHERE upper(code) IN ('SOUSA_MURRAY_PROFILES','PROFILE_CENTRE','PROFILE_CENTER','PROFILECENTRE'));
UPDATE platform_operational_profiles
SET public_url='https://sousamurrayelearning.jagroupservices.co.uk',environment='production',updated_at=CURRENT_TIMESTAMP
WHERE platform_id IN (SELECT id FROM platforms WHERE upper(code) IN ('SOUSA_MURRAY_ELEARNING','APTENVO','COURSE_SELECT'));

INSERT INTO platform_operational_profiles(
  platform_id,public_url,environment,hosting_provider,health_status,health_message,
  capabilities_json,integrations_json,metadata_json,created_at,updated_at
)
SELECT p.id,
  CASE
    WHEN upper(p.code)='JA_GROUP_SERVICES' THEN 'https://jagroupservices.co.uk'
    WHEN upper(p.code) IN ('SOUSA_MURRAY_DOMAINS','JA_DOMAIN_HUB','SOUSA_MURRAY_SITES') THEN 'https://sousamurraydomains.jagroupservices.co.uk'
    WHEN upper(p.code) IN ('SOUSA_MURRAY_PLANEIA','PLANYX') THEN 'https://sousamurrayplaneia.jagroupservices.co.uk'
    WHEN upper(p.code) IN ('SOUSA_MURRAY_PROFILES','PROFILE_CENTRE','PROFILE_CENTER','PROFILECENTRE') THEN 'https://sousamurrayprofiles.jagroupservices.co.uk'
    ELSE 'https://sousamurrayelearning.jagroupservices.co.uk'
  END,
  'production','Cloudflare Pages','awaiting_connection',
  'Current production website registered with JA Group Services Head Office.',
  '["customer_platform","central_payments"]','{}',
  '{"registrationManagedBy":"Head Office","brandRegister":"Sousa Murray"}',
  CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM platforms p
LEFT JOIN platform_operational_profiles o ON o.platform_id=p.id
WHERE o.platform_id IS NULL
  AND upper(p.code) IN (
    'JA_GROUP_SERVICES',
    'SOUSA_MURRAY_DOMAINS','JA_DOMAIN_HUB','SOUSA_MURRAY_SITES',
    'SOUSA_MURRAY_PLANEIA','PLANYX',
    'SOUSA_MURRAY_PROFILES','PROFILE_CENTRE','PROFILE_CENTER','PROFILECENTRE',
    'SOUSA_MURRAY_ELEARNING','APTENVO','COURSE_SELECT'
  );
