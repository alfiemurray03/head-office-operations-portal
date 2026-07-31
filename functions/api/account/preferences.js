import { audit, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { validatePreferences } from "../../_principal-identity.js";

function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function map(row) { return { theme: row.theme, tableDensity: row.table_density, timeZone: row.time_zone,
  dateTimeFormat: row.date_time_format, defaultLandingPage: row.default_landing_page,
  sensitiveValuesMasked: Boolean(row.sensitive_values_masked), accessibility: parse(row.accessibility_json, {}),
  notifications: parse(row.notifications_json, {}), dashboard: parse(row.dashboard_json, {}), savedFilters: parse(row.saved_filters_json, {}) }; }
async function load(env, id) { const row = await env.DB.prepare("SELECT * FROM portal_user_preferences WHERE portal_user_id=?").bind(id).first(); return row ? map(row) : null; }

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "dashboard:read"); if (auth.response) return auth.response;
  return json({ preferences: await load(context.env, auth.session.sub) });
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "dashboard:read"); if (auth.response) return auth.response;
  let body; try { body = await readJson(context.request, 65_536); } catch (cause) { return error(cause.code, cause.message, cause.status); }
  const before = await load(context.env, auth.session.sub) || {};
  const value = validatePreferences(body, before);
  await context.env.DB.prepare(`INSERT INTO portal_user_preferences
    (portal_user_id,theme,table_density,time_zone,date_time_format,default_landing_page,sensitive_values_masked,accessibility_json,notifications_json,dashboard_json,saved_filters_json,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(portal_user_id) DO UPDATE SET theme=excluded.theme,table_density=excluded.table_density,
    time_zone=excluded.time_zone,date_time_format=excluded.date_time_format,default_landing_page=excluded.default_landing_page,
    sensitive_values_masked=excluded.sensitive_values_masked,accessibility_json=excluded.accessibility_json,notifications_json=excluded.notifications_json,
    dashboard_json=excluded.dashboard_json,saved_filters_json=excluded.saved_filters_json,updated_at=excluded.updated_at`)
    .bind(auth.session.sub,value.theme,value.tableDensity,value.timeZone,value.dateTimeFormat,value.defaultLandingPage,value.sensitiveValuesMasked?1:0,
      JSON.stringify(value.accessibility),JSON.stringify(value.notifications),JSON.stringify(value.dashboard),JSON.stringify(value.savedFilters),new Date().toISOString()).run();
  await audit(context.env, auth.session, "principal.preferences_updated", "portal_user_preferences", auth.session.sub, { label: "Principal updated own preferences", before, after: value });
  return json({ preferences: value });
};
