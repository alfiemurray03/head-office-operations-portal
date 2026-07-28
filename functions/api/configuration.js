import { audit, cleanText, error, json, readJson } from "../_shared.js";
import { requirePermission } from "../_operations.js";

const ALLOWED = new Map([
  ["security.session_hours", value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 24],
  ["security.failed_login_threshold", value => Number.isInteger(Number(value)) && Number(value) >= 3 && Number(value) <= 20],
  ["security.default_marker_review_days", value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 365],
  ["operations.case_reference_prefix", value => /^[A-Z0-9]{2,8}$/.test(String(value || "").toUpperCase())],
  ["operations.default_case_due_hours", value => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 720],
  ["payments.refund_approval_threshold_minor", value => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 10_000_000],
  ["notifications.critical_case_alerts", value => typeof value === "boolean"]
]);

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "configuration:read");
  if (auth.response) return auth.response;
  const [settings, markerTypes, restrictionTypes, changes] = await context.env.DB.batch([
    context.env.DB.prepare("SELECT setting_key,setting_group,value_json,description,updated_by,updated_at FROM system_settings ORDER BY setting_group,setting_key"),
    context.env.DB.prepare("SELECT * FROM security_marker_types ORDER BY label"),
    context.env.DB.prepare("SELECT * FROM restriction_types ORDER BY label"),
    context.env.DB.prepare("SELECT * FROM configuration_changes ORDER BY changed_at DESC LIMIT 50")
  ]);
  return json({ settings: settings.results, markerTypes: markerTypes.results, restrictionTypes: restrictionTypes.results, changes: changes.results });
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "configuration:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const key = cleanText(body.key, 120);
  const validator = ALLOWED.get(key);
  if (!validator || !validator(body.value)) return error("INVALID_SETTING", "That setting or value cannot be changed here.");
  const current = await context.env.DB.prepare("SELECT value_json FROM system_settings WHERE setting_key=?").bind(key).first();
  if (!current) return error("SETTING_NOT_FOUND", "The setting does not exist.", 404);
  const value = key === "operations.case_reference_prefix" ? String(body.value).toUpperCase() : body.value;
  const valueJson = JSON.stringify(value);
  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare("UPDATE system_settings SET value_json=?,updated_by=?,updated_at=? WHERE setting_key=?").bind(valueJson, auth.session.sub, now, key),
    context.env.DB.prepare(`INSERT INTO configuration_changes(id,setting_key,before_json,after_json,changed_by,changed_at)
      VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), key, current.value_json, valueJson, auth.session.sub, now)
  ]);
  await audit(context.env, auth.session, "configuration.updated", "system_setting", key, {
    label: "System configuration updated",
    reference: key,
    requestId: context.data.requestId,
    before: JSON.parse(current.value_json),
    after: value
  });
  return json({ updated: true, key, value });
};
