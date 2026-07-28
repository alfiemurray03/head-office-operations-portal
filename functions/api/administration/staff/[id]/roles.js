import { audit, cleanText, error, json, readJson } from "../../../../_shared.js";
import { requirePermission } from "../../../../_operations.js";

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;
  const staff = await context.env.DB.prepare("SELECT id,display_name,email,status FROM staff_members WHERE id=?").bind(context.params.id).first();
  if (!staff) return error("STAFF_NOT_FOUND", "The staff member was not found.", 404);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const roles = [...new Set((Array.isArray(body.roles) ? body.roles : []).map(value => cleanText(value, 80).toUpperCase()).filter(Boolean))];
  if (!roles.length) return error("ROLE_REQUIRED", "Assign at least one active role.");
  const placeholders = roles.map(() => "?").join(",");
  const valid = await context.env.DB.prepare(`SELECT code FROM role_definitions WHERE status='active' AND code IN (${placeholders})`).bind(...roles).all();
  if (valid.results.length !== roles.length) return error("INVALID_ROLE", "One or more selected roles are not active.");
  const current = await context.env.DB.prepare("SELECT role_code FROM staff_role_assignments WHERE staff_id=?").bind(staff.id).all();
  if (current.results.some(row => String(row.role_code).toUpperCase() === "SYSTEM_ADMINISTRATOR") && !roles.includes("SYSTEM_ADMINISTRATOR")) {
    const others = await context.env.DB.prepare(`SELECT COUNT(*) count FROM staff_role_assignments r JOIN staff_members s ON s.id=r.staff_id
      WHERE upper(r.role_code)='SYSTEM_ADMINISTRATOR' AND s.status='active' AND r.staff_id!=?`).bind(staff.id).first();
    if (Number(others?.count || 0) === 0) return error("LAST_ADMINISTRATOR", "The final active System Administrator role cannot be removed.", 409);
  }
  const now = new Date().toISOString();
  const statements = [context.env.DB.prepare("DELETE FROM staff_role_assignments WHERE staff_id=?").bind(staff.id)];
  for (const role of roles) {
    statements.push(context.env.DB.prepare(`INSERT INTO staff_role_assignments(id,staff_id,role_code,assigned_by,assigned_at)
      VALUES (?,?,?,?,?)`).bind(crypto.randomUUID(), staff.id, role, auth.session.sub, now));
  }
  await context.env.DB.batch(statements);
  await audit(context.env, auth.session, "staff.roles_updated", "staff_member", staff.id, {
    label: "Staff roles updated",
    reference: staff.email,
    requestId: context.data.requestId,
    before: { roles: current.results.map(row => row.role_code) },
    after: { roles }
  });
  return json({ updated: true, roles });
};
