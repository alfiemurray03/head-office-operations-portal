import { json } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import { ensureProductionSchema } from "../_schema-bootstrap.js";
import { ensureProductionCatalogues } from "../_catalogue-bootstrap.js";
import { ensureV7Schema } from "../_v7-schema.js";
import { ensureV7Enhancements } from "../_v7-enhancements.js";
import { ensureCentralPlatformSchema } from "../_central-schema.js";

const REQUIRED_REFERENCE_TABLES = [
  "platforms",
  "platform_operational_profiles",
  "staff_members",
  "staff_role_assignments",
  "organisation_units",
  "role_definitions",
  "security_marker_types",
  "restriction_types",
  "system_settings"
];

let referenceSchemaPromise = null;

async function referenceSchemaExists(env) {
  if (!env.DB) throw new Error("The Head Office database is not connected.");
  const names = REQUIRED_REFERENCE_TABLES.map(name => `'${name}'`).join(",");
  const row = await env.DB.prepare(`SELECT COUNT(*) AS table_count
    FROM sqlite_master WHERE type='table' AND name IN (${names})`).first();
  return Number(row?.table_count || 0) === REQUIRED_REFERENCE_TABLES.length;
}

async function ensureReferenceSchema(env) {
  if (referenceSchemaPromise) return referenceSchemaPromise;
  referenceSchemaPromise = (async () => {
    // Production already has these tables. A single catalogue check avoids running
    // hundreds of CREATE/ALTER/INSERT statements during every staff login.
    if (await referenceSchemaExists(env)) return;
    await ensureProductionSchema(env);
    await ensureProductionCatalogues(env);
    await ensureV7Schema(env);
    await ensureV7Enhancements(env);
    await ensureCentralPlatformSchema(env);
  })().catch(error => {
    referenceSchemaPromise = null;
    throw error;
  });
  return referenceSchemaPromise;
}

export const onRequestGet = async context => {
  await ensureReferenceSchema(context.env);
  const auth = await requirePermission(context, "dashboard:read");
  if (auth.response) return auth.response;
  const [platforms, staff, units, roles, markerTypes, restrictionTypes, settings] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT p.id,p.code,p.name,p.status,p.last_health_check_at,
      o.health_status,o.public_url,o.hosting_provider,o.last_heartbeat_at,o.release_version,o.release_commit
      FROM platforms p LEFT JOIN platform_operational_profiles o ON o.platform_id=p.id
      WHERE p.status!='disabled' ORDER BY p.name`),
    context.env.DB.prepare("SELECT id,display_name,email,status,authentication_source FROM staff_members WHERE status IN ('active','invited') ORDER BY display_name"),
    context.env.DB.prepare("SELECT id,code,name,unit_type,status,parent_unit_id FROM organisation_units ORDER BY unit_type,name"),
    context.env.DB.prepare("SELECT code,name,description,permissions_json,status FROM role_definitions WHERE status='active' ORDER BY name"),
    context.env.DB.prepare("SELECT * FROM security_marker_types WHERE status='active' ORDER BY label"),
    context.env.DB.prepare("SELECT * FROM restriction_types WHERE status='active' ORDER BY label"),
    context.env.DB.prepare("SELECT setting_key,value_json FROM system_settings")
  ]);
  return json({
    systemVersion: "8.0.1-startup",
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
