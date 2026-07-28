import { json } from "../_shared.js";
import { requirePermission } from "../_operations.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "dashboard:read");
  if (auth.response) return auth.response;
  const [platforms, staff, units, roles, markerTypes, restrictionTypes, settings] = await context.env.DB.batch([
    context.env.DB.prepare("SELECT id,code,name,status,last_health_check_at FROM platforms ORDER BY name"),
    context.env.DB.prepare("SELECT id,display_name,email,status,authentication_source FROM staff_members WHERE status IN ('active','invited') ORDER BY display_name"),
    context.env.DB.prepare("SELECT id,code,name,unit_type,status,parent_unit_id FROM organisation_units ORDER BY unit_type,name"),
    context.env.DB.prepare("SELECT code,name,description,permissions_json,status FROM role_definitions WHERE status='active' ORDER BY name"),
    context.env.DB.prepare("SELECT * FROM security_marker_types WHERE status='active' ORDER BY label"),
    context.env.DB.prepare("SELECT * FROM restriction_types WHERE status='active' ORDER BY label"),
    context.env.DB.prepare("SELECT setting_key,value_json FROM system_settings")
  ]);
  return json({
    permissions: auth.authorisation.permissions,
    roles: auth.authorisation.roles,
    platforms: platforms.results,
    staff: staff.results,
    units: units.results,
    roleDefinitions: roles.results,
    markerTypes: markerTypes.results,
    restrictionTypes: restrictionTypes.results,
    settings: Object.fromEntries(settings.results.map(row => {
      try { return [row.setting_key, JSON.parse(row.value_json)]; }
      catch { return [row.setting_key, row.value_json]; }
    }))
  });
};
