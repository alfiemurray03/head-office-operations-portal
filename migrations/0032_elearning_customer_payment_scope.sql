PRAGMA foreign_keys = ON;

-- Sousa Murray eLearning must reconcile the signed-in Microsoft Entra identity
-- with the authoritative Head Office Universal Customer Register before asking
-- Central Payments to charge the customer. Extend the existing eLearning
-- platform credential in place; no new key is created or distributed.
UPDATE platform_api_credentials
SET scopes_json = (
  SELECT json_group_array(value)
  FROM (
    SELECT value
    FROM json_each(CASE WHEN json_valid(platform_api_credentials.scopes_json) THEN platform_api_credentials.scopes_json ELSE '[]' END)
    UNION SELECT 'customers:write'
    UNION SELECT 'payments:checkout'
    UNION SELECT 'payments:status'
    UNION SELECT 'payments:portal'
  )
)
WHERE status='active'
  AND platform_id IN (
    SELECT id FROM platforms
    WHERE upper(code) IN ('APTENVO','COURSE_SELECT','SOUSA_MURRAY_ELEARNING')
  );
