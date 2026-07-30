INSERT INTO system_settings(setting_key,setting_group,value_json,description,updated_by,updated_at)
VALUES
  ('age_assurance.planyx_workflow_id','age_assurance','""','Didit workflow validated specifically for the Planyx 16+ threshold.','system',CURRENT_TIMESTAMP),
  ('age_assurance.profile_centre_workflow_id','age_assurance','""','Didit workflow validated specifically for the Profile Centre 18+ threshold.','system',CURRENT_TIMESTAMP)
ON CONFLICT(setting_key) DO NOTHING;
