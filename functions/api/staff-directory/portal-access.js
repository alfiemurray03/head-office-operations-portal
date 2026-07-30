import { audit, cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { ensureStaffDirectoryReady, staffDirectoryAuditReference } from "../../_staff-directory.js";
import { ensureStaffTenantDirectorySchema } from "../../_staff-entra-sync.js";

function normaliseRole(value) {
  return cleanText(value, 100).replaceAll("-", "_").replaceAll(" ", "_").toUpperCase();
}

async function staffAuthorityRecord(env, profileId) {
  return env.DB.prepare(`SELECT p.*,s.id portal_staff_id,s.status portal_status,s.external_identity_id,
      d.object_id entra_object_id,d.tenant_id,d.account_enabled,d.directory_status,d.user_principal_name,d.mail directory_mail,
      COALESCE((SELECT group_concat(role_code, ',') FROM staff_role_assignments WHERE staff_id=s.id),'') role_codes
    FROM staff_directory_profiles p
    LEFT JOIN staff_members s ON s.id=p.linked_staff_member_id
    LEFT JOIN staff_directory_identities d ON d.staff_profile_id=p.id
    WHERE p.id=? LIMIT 1`).bind(profileId).first();
}

async function activeRoles(env, requested) {
  const wanted = [...new Set((Array.isArray(requested) ? requested : []).map(normaliseRole).filter(Boolean))];
  if (!wanted.length) throw Object.assign(new Error("Select at least one Head Office portal role."), { code: "PORTAL_ROLE_REQUIRED", status: 400 });
  const placeholders = wanted.map(() => "?").join(",");
  const rows = await env.DB.prepare(`SELECT code,name,description,permissions_json FROM role_definitions
    WHERE upper(code) IN (${placeholders}) AND status='active'`).bind(...wanted).all();
  const available = new Map((rows.results || []).map(row => [normaliseRole(row.code), row]));
  const invalid = wanted.filter(code => !available.has(code));
  if (invalid.length) throw Object.assign(new Error(`One or more portal roles are not active: ${invalid.join(", ")}.`), { code: "INVALID_PORTAL_ROLE", status: 400 });
  return wanted.map(code => available.get(code));
}

async function protectAdministratorContinuity(env, auth, targetStaffId, roleCodes) {
  const removingSystemAdministrator = targetStaffId && !roleCodes.includes("SYSTEM_ADMINISTRATOR")
    && Boolean(await env.DB.prepare(`SELECT 1 present FROM staff_role_assignments
      WHERE staff_id=? AND upper(role_code)='SYSTEM_ADMINISTRATOR' LIMIT 1`).bind(targetStaffId).first());
  if (!removingSystemAdministrator) return;
  if (targetStaffId === auth.session.sub) {
    throw Object.assign(new Error("You cannot remove your own System Administrator authority."), { code: "SELF_ADMIN_ROLE_REMOVAL_BLOCKED", status: 409 });
  }
  const remaining = await env.DB.prepare(`SELECT COUNT(DISTINCT staff_id) total FROM staff_role_assignments
    WHERE upper(role_code)='SYSTEM_ADMINISTRATOR' AND staff_id<>?`).bind(targetStaffId).first();
  if (Number(remaining?.total || 0) < 1) {
    throw Object.assign(new Error("At least one other active System Administrator must remain."), { code: "LAST_SYSTEM_ADMINISTRATOR_PROTECTED", status: 409 });
  }
}

async function grantOrUpdate(context, auth, profile, roles) {
  if (profile.status !== "active") throw Object.assign(new Error("Only an active Staff Directory profile can receive portal access."), { code: "STAFF_PROFILE_NOT_ACTIVE", status: 409 });
  if (!profile.entra_object_id) throw Object.assign(new Error("Synchronise and link this staff profile to a Microsoft tenant identity before granting portal access."), { code: "MICROSOFT_STAFF_IDENTITY_REQUIRED", status: 409 });
  if (Number(profile.account_enabled || 0) !== 1 || ["disabled", "deleted"].includes(String(profile.directory_status || "").toLowerCase())) {
    throw Object.assign(new Error("The Microsoft staff identity is disabled or deleted and cannot receive portal access."), { code: "MICROSOFT_STAFF_IDENTITY_INACTIVE", status: 409 });
  }

  const roleCodes = roles.map(role => normaliseRole(role.code));
  await protectAdministratorContinuity(context.env, auth, profile.portal_staff_id, roleCodes);
  const now = new Date().toISOString();
  let portalStaffId = profile.portal_staff_id;
  if (!portalStaffId) {
    const conflict = await context.env.DB.prepare(`SELECT id,external_identity_id,email FROM staff_members
      WHERE external_identity_id=? OR lower(email)=lower(?) LIMIT 2`).bind(profile.entra_object_id, profile.email).all();
    if ((conflict.results || []).length > 1) {
      throw Object.assign(new Error("More than one staff access identity matched this record. Head Office review is required."), { code: "STAFF_ACCESS_IDENTITY_CONFLICT", status: 409 });
    }
    portalStaffId = conflict.results?.[0]?.id || crypto.randomUUID();
    if (conflict.results?.[0]) {
      await context.env.DB.prepare(`UPDATE staff_members SET external_identity_id=?,authentication_source='microsoft_entra',
        display_name=?,email=?,status='active',updated_at=? WHERE id=?`)
        .bind(profile.entra_object_id, profile.display_name, profile.email, now, portalStaffId).run();
    } else {
      await context.env.DB.prepare(`INSERT INTO staff_members
        (id,external_identity_id,authentication_source,display_name,email,status,created_at,updated_at)
        VALUES (?,?,'microsoft_entra',?,?,'active',?,?)`)
        .bind(portalStaffId, profile.entra_object_id, profile.display_name, profile.email, now, now).run();
    }
    await context.env.DB.prepare("UPDATE staff_directory_profiles SET linked_staff_member_id=?,updated_at=? WHERE id=?")
      .bind(portalStaffId, now, profile.id).run();
  } else {
    await context.env.DB.prepare(`UPDATE staff_members SET external_identity_id=?,authentication_source='microsoft_entra',
      display_name=?,email=?,status='active',updated_at=? WHERE id=?`)
      .bind(profile.entra_object_id, profile.display_name, profile.email, now, portalStaffId).run();
  }

  await context.env.DB.prepare("DELETE FROM staff_role_assignments WHERE staff_id=?").bind(portalStaffId).run();
  for (const roleCode of roleCodes) {
    await context.env.DB.prepare(`INSERT INTO staff_role_assignments
      (id,staff_id,role_code,assigned_by,assigned_at) VALUES (?,?,?,?,?)`)
      .bind(crypto.randomUUID(), portalStaffId, roleCode, auth.session.sub, now).run();
  }

  await audit(context.env, auth.session, profile.portal_staff_id ? "staff.portal_roles_updated" : "staff.portal_access_granted", "staff_directory_profile", profile.id, {
    label: profile.portal_staff_id ? "Staff portal roles updated" : "Staff portal access granted",
    reference: staffDirectoryAuditReference(profile),
    requestId: context.data.requestId,
    before: { portalStaffId: profile.portal_staff_id || null, roleCodes: String(profile.role_codes || "").split(",").filter(Boolean) },
    after: { portalStaffId, roleCodes, microsoftObjectId: profile.entra_object_id, customerRecordIndependent: true }
  });
  return { portalStaffId, roleCodes };
}

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;
  try {
    await ensureStaffDirectoryReady(context.env);
    await ensureStaffTenantDirectorySchema(context.env);
    const body = await readJson(context.request);
    const profileId = cleanText(body.profileId, 100);
    const action = cleanText(body.action || "grant", 40).toLowerCase();
    const profile = profileId ? await staffAuthorityRecord(context.env, profileId) : null;
    if (!profile) return error("STAFF_PROFILE_NOT_FOUND", "The Staff Directory profile was not found.", 404);

    if (action === "grant" || action === "update_roles" || action === "restore") {
      const roles = await activeRoles(context.env, body.roleCodes);
      const result = await grantOrUpdate(context, auth, profile, roles);
      return json({ success: true, action, ...result, staff: await staffAuthorityRecord(context.env, profile.id) });
    }

    if (action === "suspend") {
      if (!profile.portal_staff_id) return error("PORTAL_ACCESS_NOT_LINKED", "This staff profile has no portal access identity.", 409);
      if (profile.portal_staff_id === auth.session.sub) return error("SELF_PORTAL_SUSPENSION_BLOCKED", "You cannot suspend your own portal access.", 409);
      await protectAdministratorContinuity(context.env, auth, profile.portal_staff_id, []);
      const now = new Date().toISOString();
      await context.env.DB.prepare("UPDATE staff_members SET status='suspended',updated_at=? WHERE id=?").bind(now, profile.portal_staff_id).run();
      await context.env.DB.prepare("DELETE FROM microsoft_staff_sessions WHERE staff_id=?").bind(profile.portal_staff_id).run().catch(() => null);
      await audit(context.env, auth.session, "staff.portal_access_suspended", "staff_directory_profile", profile.id, {
        label: "Staff portal access suspended", reference: staffDirectoryAuditReference(profile), requestId: context.data.requestId,
        before: { status: profile.portal_status }, after: { status: "suspended", sessionsRevoked: true }
      });
      return json({ success: true, action, staff: await staffAuthorityRecord(context.env, profile.id) });
    }

    return error("INVALID_PORTAL_ACCESS_ACTION", "The requested portal-access action is not supported.", 400);
  } catch (cause) {
    return error(cause.code || "STAFF_PORTAL_ACCESS_FAILED", cause instanceof Error ? cause.message : "The staff portal-access change failed.", Number(cause.status) || 500);
  }
};
