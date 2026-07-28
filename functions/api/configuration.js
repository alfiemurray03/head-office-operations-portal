import { audit, cleanText, error, json, requireSession } from "../_shared.js";

export const onRequestGet = async context => {
  const auth = await requireSession(context);
  if (auth.response) return auth.response;
  const [settings, markerTypes, restrictionTypes] = await context.env.DB.batch([
    context.env.DB.prepare("SELECT setting_key,setting_group,value_json,description,updated_at FROM system_settings ORDER BY setting_group,setting_key"),
    context.env.DB.prepare("SELECT * FROM security_marker_types ORDER BY label"),
    context.env.DB.prepare("SELECT * FROM restriction_types ORDER BY label")
  ]);
  return json({ settings: settings.results, markerTypes: markerTypes.results, restrictionTypes: restrictionTypes.results });
};

export const onRequestPut = async context => {
  const auth = await requireSession(context);
  if (auth.response) return auth.response;
  const body = await context.request.json().catch(() => ({}));
  const key = cleanText(body.key, 120);
  const allowed = new Set([
    "security.session_hours",
    "security.failed_login_threshold",
    "security.default_marker_review_days",
    "operations.case_reference_prefix",
    "notifications.critical_case_alerts"
  ]);
  if (!allowed.has(key)) return error("INVALID_SETTING", "That setting cannot be changed here.");
  const current = await context.env.DB.prepare("SELECT value_json FROM system_settings WHERE setting_key=?").bind(key).first();
  if (!current) return error("SETTING_NOT_FOUND", "The setting does not exist.", 404);
  const valueJson = JSON.stringify(body.value);
  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare("UPDATE system_settings SET value_json=?,updated_by=?,updated_at=? WHERE setting_key=?")
      .bind(valueJson, auth.session.sub, now, key),
    context.env.DB.prepare(`INSERT INTO configuration_changes
      (id,setting_key,before_json,after_json,changed_by,changed_at) VALUES (?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), key, current.value_json, valueJson, auth.session.sub, now)
  ]);
  await audit(context.env, auth.session, "configuration.updated", "system_setting", key, {
    label: "System configuration updated",
    metadata: { key }
  });
  return json({ updated: true, key, value: body.value });
};
