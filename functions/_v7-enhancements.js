export async function ensureV7Enhancements(env) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO detection_rules
    (code,category,name,description,event_type,base_score,threshold_count,threshold_window_minutes,
     risk_floor,recommended_enforcement,alert_severity,data_classification,confidentiality_level,
     enabled,version,created_at,updated_at)
    VALUES ('PAYMENT_DISPUTE_OPENED','dispute','Payment dispute opened',
      'A customer, provider or staff member opens a formal payment dispute.','payment.dispute_opened',
      35,1,0,'R2','A3','SEV-3','D3','K1',1,1,?,?)
    ON CONFLICT(code) DO UPDATE SET name=excluded.name,description=excluded.description,
      event_type=excluded.event_type,base_score=excluded.base_score,risk_floor=excluded.risk_floor,
      recommended_enforcement=excluded.recommended_enforcement,alert_severity=excluded.alert_severity,
      data_classification=excluded.data_classification,confidentiality_level=excluded.confidentiality_level,
      enabled=1,updated_at=excluded.updated_at`).bind(now,now).run();

  const settings = [
    ["risk.alert_score_threshold","risk","30","Minimum score for a Head Office risk alert."],
    ["risk.incident_score_threshold","risk","85","Minimum score for automatic incident creation."],
    ["complaints.acknowledgement_hours","complaints","48","Internal target for acknowledging a central complaint."],
    ["complaints.final_response_days","complaints","20","Internal target for a complaint final response unless another rule applies."],
    ["incidents.breach_assessment_hours","incidents","72","Decision-support clock for personal-data breach assessment and notification."],
    ["system.product_version","system","\"7.0.0\"","Current Head Office Operations Centre product version."]
  ];
  for (const setting of settings) {
    await env.DB.prepare(`INSERT INTO system_settings
      (setting_key,setting_group,value_json,description,updated_by,updated_at)
      VALUES (?,?,?,?, 'system', ?) ON CONFLICT(setting_key) DO NOTHING`)
      .bind(...setting,now).run();
  }
}
