PRAGMA foreign_keys = ON;

ALTER TABLE identity_verification_sessions ADD COLUMN verification_purpose TEXT;
ALTER TABLE identity_verification_sessions ADD COLUMN required_age INTEGER;

CREATE INDEX IF NOT EXISTS idx_identity_verification_age_assurance
  ON identity_verification_sessions(customer_id, verification_purpose, status, required_age, completed_at DESC);

INSERT INTO system_settings(setting_key,setting_group,value_json,description,updated_by,updated_at)
VALUES
  ('age_assurance.enforcement_master_enabled','age_assurance','false','Master switch for customer-only age-assurance enforcement across connected services.','system',CURRENT_TIMESTAMP),
  ('age_assurance.planyx_status','age_assurance','"disabled"','Planyx customer age-assurance deployment state: disabled, paused or enabled.','system',CURRENT_TIMESTAMP),
  ('age_assurance.planyx_minimum_age','age_assurance','16','Minimum customer age for Planyx.','system',CURRENT_TIMESTAMP),
  ('age_assurance.planyx_threshold_validated','age_assurance','false','Confirms the configured Didit workflow has been tested for the Planyx 16+ threshold.','system',CURRENT_TIMESTAMP),
  ('age_assurance.profile_centre_status','age_assurance','"disabled"','Profile Centre customer age-assurance deployment state: disabled, paused or enabled.','system',CURRENT_TIMESTAMP),
  ('age_assurance.profile_centre_minimum_age','age_assurance','18','Minimum customer age for Profile Centre.','system',CURRENT_TIMESTAMP),
  ('age_assurance.profile_centre_threshold_validated','age_assurance','false','Confirms the configured Didit workflow has been tested for the Profile Centre 18+ threshold.','system',CURRENT_TIMESTAMP),
  ('age_assurance.result_validity_days','age_assurance','365','Default validity period for approved customer age-assurance evidence.','system',CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO NOTHING;
