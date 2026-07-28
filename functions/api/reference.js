import { json } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import { ensureProductionSchema } from "../_schema-bootstrap.js";
import { ensureProductionCatalogues } from "../_catalogue-bootstrap.js";
import { ensureV7Schema } from "../_v7-schema.js";
import { ensureV7Enhancements } from "../_v7-enhancements.js";
import { ensureCentralPlatformSchema } from "../_central-schema.js";

export const onRequestGet = async context => {
  await ensureProductionSchema(context.env);
  await ensureProductionCatalogues(context.env);
  await ensureV7Schema(context.env);
  await ensureV7Enhancements(context.env);
  await ensureCentralPlatformSchema(context.env);
  const auth = await requirePermission(context, "dashboard:read");
  if (auth.response) return auth.response;
  const [platforms, staff, units, roles, markerTypes, restrictionTypes, settings] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT p.id,p.code,p.name,p.status,p.last_health_check_at,
      o.health_status,o.public_url,o.hosting_provider,o.last_heartbeat_at,o.release_version,o.release_commit
      FROM platforms p LEFT JOIN platform_operational_profiles o ON o.platform_id=p.id ORDER BY p.name`),
    context.env.DB.prepare("SELECT id,display_name,email,status,authentication_source FROM staff_members WHERE status IN ('active','invited') ORDER BY display_name"),
    context.env.DB.prepare("SELECT id,code,name,unit_type,status,parent_unit_id FROM organisation_units ORDER BY unit_type,name"),
    context.env.DB.prepare("SELECT code,name,description,permissions_json,status FROM role_definitions WHERE status='active' ORDER BY name"),
    context.env.DB.prepare("SELECT * FROM security_marker_types WHERE status='active' ORDER BY label"),
    context.env.DB.prepare("SELECT * FROM restriction_types WHERE status='active' ORDER BY label"),
    context.env.DB.prepare("SELECT setting_key,value_json FROM system_settings")
  ]);
  return json({
    systemVersion: "8.0.0-central",
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
