import { audit, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { validateProfile } from "../../_principal-identity.js";

async function loadProfile(env, userId) {
  const row = await env.DB.prepare(`SELECT u.id,u.full_name,u.preferred_name,u.email,u.contact_details_json,u.job_titles_json,
    u.profile_image_reference,u.status,u.role_code,u.created_at,u.last_successful_sign_in_at,u.last_failed_sign_in_at,u.last_activity_at,
    r.name role_name,r.security_level,r.access_level,r.authority_label
    FROM portal_users u JOIN portal_roles r ON r.code=u.role_code WHERE u.id=? LIMIT 1`).bind(userId).first();
  if (!row) return null;
  return { id: row.id, fullName: row.full_name, displayName: row.full_name, preferredName: row.preferred_name, email: row.email,
    contactDetails: JSON.parse(row.contact_details_json || "{}"), jobTitles: JSON.parse(row.job_titles_json || "[]"),
    profileImage: row.profile_image_reference, status: row.status, roleCode: row.role_code, roleName: row.role_name,
    securityLevel: row.security_level, accessLevel: row.access_level, authority: row.authority_label,
    createdAt: row.created_at, lastSuccessfulSignInAt: row.last_successful_sign_in_at,
    lastFailedSignInAt: row.last_failed_sign_in_at, lastActivityAt: row.last_activity_at };
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "dashboard:read");
  if (auth.response) return auth.response;
  return json({ profile: await loadProfile(context.env, auth.session.sub) });
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "dashboard:read");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 32_768); } catch (cause) { return error(cause.code, cause.message, cause.status); }
  const profile = validateProfile(body);
  if (!profile.preferredName || !profile.displayName) return error("PROFILE_NAME_REQUIRED", "Display name and preferred name are required.");
  const before = await loadProfile(context.env, auth.session.sub);
  await context.env.DB.prepare(`UPDATE portal_users SET full_name=?,preferred_name=?,profile_image_reference=?,contact_details_json=?,job_titles_json=?,updated_at=? WHERE id=?`)
    .bind(profile.displayName, profile.preferredName, profile.profileImage, JSON.stringify(profile.contactDetails), JSON.stringify(profile.jobTitles), new Date().toISOString(), auth.session.sub).run();
  const after = await loadProfile(context.env, auth.session.sub);
  await audit(context.env, auth.session, "principal.profile_updated", "portal_user", auth.session.sub, { label: "Principal updated own profile", before, after });
  return json({ profile: after });
};
