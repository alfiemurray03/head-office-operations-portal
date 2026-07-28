import { json, requireSession } from "../_shared.js";

export const onRequestGet = async context => {
  const auth = await requireSession(context);
  if (auth.response) return auth.response;
  const [staff, roles, units, audit] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT s.id,s.display_name,s.email,s.authentication_source,s.status,s.created_at,
      COALESCE(group_concat(r.role_code), '') role_codes
      FROM staff_members s LEFT JOIN staff_role_assignments r ON r.staff_id=s.id
      GROUP BY s.id ORDER BY s.display_name`),
    context.env.DB.prepare("SELECT code,name,description,permissions_json,status FROM role_definitions ORDER BY name"),
    context.env.DB.prepare("SELECT id,code,name,unit_type,status,parent_unit_id FROM organisation_units ORDER BY unit_type,name"),
    context.env.DB.prepare(`SELECT occurred_at,actor_name,action_label,entity_type,entity_reference
      FROM audit_events ORDER BY occurred_at DESC LIMIT 100`)
  ]);
  return json({ staff: staff.results, roles: roles.results, units: units.results, audit: audit.results });
};
