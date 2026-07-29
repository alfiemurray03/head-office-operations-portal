import { audit, cleanText, error, json, readJson } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import { ensureSystemSettingsReady, normaliseSystemSetting, parseSettingValue } from "../_system-settings.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "configuration:read");
  if (auth.response) return auth.response;
  await ensureSystemSettingsReady(context.env);
  const [settings, markerTypes, restrictionTypes, changes] = await context.env.DB.batch([
    context.env.DB.prepare("SELECT setting_key,setting_group,value_json,description,updated_by,updated_at FROM system_settings ORDER BY setting_group,setting_key"),
    context.env.DB.prepare("SELECT * FROM security_marker_types ORDER BY label"),
    context.env.DB.prepare("SELECT * FROM restriction_types ORDER BY label"),
    context.env.DB.prepare("SELECT * FROM configuration_changes ORDER BY changed_at DESC LIMIT 100")
  ]);
  return json({ settings: settings.results, markerTypes: markerTypes.results, restrictionTypes: restrictionTypes.results, changes: changes.results }, 200, { "Cache-Control": "no-store" });
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "configuration:write");
  if (auth.response) return auth.response;
  await ensureSystemSettingsReady(context.env);
  let body;
  try { body = await readJson(context.request, 128_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  const supplied = body.settings && typeof body.settings === "object" && !Array.isArray(body.settings)
    ? Object.entries(body.settings)
    : [[cleanText(body.key, 120), body.value]];
  if (!supplied.length || supplied.length > 50) return error("INVALID_SETTINGS_BATCH", "Submit between one and fifty governed settings.");

  const updates = [];
  try {
    for (const [rawKey, rawValue] of supplied) {
      const key = cleanText(rawKey, 120);
      updates.push([key, normaliseSystemSetting(key, rawValue)]);
    }
  } catch (cause) {
    return error(cause.code || "INVALID_SETTING", cause.message || "That setting or value cannot be changed here.", cause.status || 400);
  }

  const before = {};
  for (const [key] of updates) {
    const current = await context.env.DB.prepare("SELECT value_json FROM system_settings WHERE setting_key=?").bind(key).first();
    if (!current) return error("SETTING_NOT_FOUND", `The setting ${key} does not exist.`, 404);
    before[key] = parseSettingValue(current.value_json, current.value_json);
  }

  const now = new Date().toISOString();
  const statements = [];
  const after = {};
  for (const [key, value] of updates) {
    const valueJson = JSON.stringify(value);
    after[key] = value;
    statements.push(
      context.env.DB.prepare("UPDATE system_settings SET value_json=?,updated_by=?,updated_at=? WHERE setting_key=?")
        .bind(valueJson, auth.session.sub, now, key),
      context.env.DB.prepare(`INSERT INTO configuration_changes(id,setting_key,before_json,after_json,changed_by,changed_at)
        VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), key, JSON.stringify(before[key]), valueJson, auth.session.sub, now)
    );
  }
  await context.env.DB.batch(statements);
  await audit(context.env, auth.session, "configuration.updated", "system_setting", updates.length === 1 ? updates[0][0] : "system-settings", {
    label: updates.length === 1 ? "System configuration updated" : "System configuration batch updated",
    reference: updates.length === 1 ? updates[0][0] : `${updates.length} settings`,
    requestId: context.data.requestId,
    before,
    after
  });
  return json({ updated: true, count: updates.length, settings: after });
};
