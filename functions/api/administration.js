import { json } from "../_shared.js";
import { requirePermission } from "../_operations.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "administration:read");
  if (auth.response) return auth.response;
  const [staff, roles, units] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT s.id,s.display_name,s.email,s.authentication_source,s.status,s.created_at,
      COALESCE(group_concat(r.role_code), '') role_codes
      FROM staff_members s LEFT JOIN staff_role_assignments r ON r.staff_id=s.id
      GROUP BY s.id ORDER BY s.display_name`),
    context.env.DB.prepare("SELECT code,name,description,permissions_json,status FROM role_definitions ORDER BY name"),
    context.env.DB.prepare("SELECT id,code,name,unit_type,status,parent_unit_id FROM organisation_units ORDER BY unit_type,name")
  ]);
  return json({ staff: staff.results, roles: roles.results, units: units.results, permissions: auth.authorisation.permissions });
};
