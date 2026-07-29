import { audit, cleanText, error, json, readJson } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import {
  STAFF_REVIEW_STATUSES,
  STAFF_REVIEW_TYPES,
  allocateStaffNumber,
  ensureStaffDirectoryProfiles,
  normaliseStaffDirectoryInput,
  staffDirectoryAuditReference
} from "../_staff-directory.js";

async function staffProfile(env, id) {
  return env.DB.prepare(`SELECT p.*,u.code organisation_unit_code,u.name organisation_unit_name,
    s.id portal_staff_id,s.external_identity_id,s.authentication_source,s.status portal_identity_status,
    COALESCE((SELECT group_concat(role_code, ',') FROM staff_role_assignments WHERE staff_id=s.id),'') role_codes,
    CASE WHEN s.id IS NOT NULL AND s.status='active' AND EXISTS
      (SELECT 1 FROM staff_role_assignments ra WHERE ra.staff_id=s.id) THEN 1 ELSE 0 END portal_access_available
    FROM staff_directory_profiles p
    LEFT JOIN staff_members s ON s.id=p.linked_staff_member_id
    LEFT JOIN organisation_units u ON u.id=p.organisation_unit_id
    WHERE p.id=?`).bind(id).first();
}

async function validUnit(env, id) {
  if (!id) return true;
  return Boolean(await env.DB.prepare("SELECT id FROM organisation_units WHERE id=? AND status='active'").bind(id).first());
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "administration:read");
  if (auth.response) return auth.response;
  await ensureStaffDirectoryProfiles(context.env);
  const url = new URL(context.request.url);
  const q = cleanText(url.searchParams.get("q"), 160);
  const status = cleanText(url.searchParams.get("status"), 40).toLowerCase();
  const division = cleanText(url.searchParams.get("division"), 80).toUpperCase();
  const conditions = [];
  const values = [];
  if (q) {
    conditions.push(`(lower(p.display_name) LIKE lower(?) OR lower(p.email) LIKE lower(?) OR lower(p.staff_number) LIKE lower(?)
      OR lower(COALESCE(p.job_title,'')) LIKE lower(?) OR lower(COALESCE(p.department,'')) LIKE lower(?))`);
    const like = `%${q}%`;
    values.push(like, like, like, like, like);
  }
  if (status) { conditions.push("p.status=?"); values.push(status); }
  if (division) { conditions.push("p.division_code=?"); values.push(division); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [staff, metrics, reviews, roles, units, unlinkedPortalIdentities] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT p.id,p.staff_number,p.linked_staff_member_id,p.display_name,p.email,p.job_title,p.employment_type,
      p.organisation_unit_id,p.division_code,p.department,p.telephone,p.internal_extension,p.start_date,p.end_date,
      p.directory_notes,p.status,p.created_at,p.updated_at,u.code organisation_unit_code,u.name organisation_unit_name,
      s.id portal_staff_id,s.authentication_source,s.status portal_identity_status,
      COALESCE((SELECT group_concat(role_code, ',') FROM staff_role_assignments WHERE staff_id=s.id),'') role_codes,
      CASE WHEN s.id IS NOT NULL AND s.status='active' AND EXISTS
        (SELECT 1 FROM staff_role_assignments ra WHERE ra.staff_id=s.id) THEN 1 ELSE 0 END portal_access_available,
      (SELECT COUNT(*) FROM staff_manual_reviews mr WHERE mr.staff_profile_id=p.id AND mr.status IN ('open','in_review')) open_review_count
      FROM staff_directory_profiles p
      LEFT JOIN staff_members s ON s.id=p.linked_staff_member_id
      LEFT JOIN organisation_units u ON u.id=p.organisation_unit_id
      ${where}
      ORDER BY CASE p.status WHEN 'active' THEN 1 WHEN 'suspended' THEN 2 WHEN 'left' THEN 3 ELSE 4 END,p.display_name LIMIT 500`).bind(...values),
    context.env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN linked_staff_member_id IS NOT NULL THEN 1 ELSE 0 END) portal_linked,
      SUM(CASE WHEN employment_type='director' AND status='active' THEN 1 ELSE 0 END) directors,
      SUM(CASE WHEN status IN ('left','archived') THEN 1 ELSE 0 END) former
      FROM staff_directory_profiles`),
    context.env.DB.prepare(`SELECT r.*,p.staff_number,p.display_name,p.email
      FROM staff_manual_reviews r JOIN staff_directory_profiles p ON p.id=r.staff_profile_id
      ORDER BY CASE r.status WHEN 'open' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END,r.opened_at DESC LIMIT 100`),
    context.env.DB.prepare("SELECT code,name,description,permissions_json,status FROM role_definitions ORDER BY name"),
    context.env.DB.prepare("SELECT id,code,name,unit_type,status,parent_unit_id FROM organisation_units WHERE status='active' ORDER BY unit_type,name"),
    context.env.DB.prepare(`SELECT s.id,s.display_name,s.email,s.authentication_source,s.status,
      COALESCE((SELECT group_concat(role_code, ',') FROM staff_role_assignments WHERE staff_id=s.id),'') role_codes
      FROM staff_members s LEFT JOIN staff_directory_profiles p ON p.linked_staff_member_id=s.id
      WHERE p.id IS NULL ORDER BY s.display_name`)
  ]);
  return json({
    staff: staff.results,
    metrics: metrics.results[0] || {},
    reviews: reviews.results,
    roles: roles.results,
    units: units.results,
    unlinkedPortalIdentities: unlinkedPortalIdentities.results,
    separationPolicy: {
      customerRecordIndependent: true,
      matchingCustomerEmailAllowed: true,
      automaticCustomerLinking: false,
      automaticChecks: false,
      staffNumberSeparateFromUcn: true
    }
  });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  let input;
  try { input = normaliseStaffDirectoryInput(body); }
  catch (cause) { return error(cause.code || "INVALID_STAFF_RECORD", cause.message, cause.status || 400); }
  if (!await validUnit(context.env, input.organisationUnitId)) return error("INVALID_ORGANISATION_UNIT", "Select an active organisation unit.", 400);
  const duplicate = await context.env.DB.prepare("SELECT id,staff_number FROM staff_directory_profiles WHERE lower(email)=lower(?)").bind(input.email).first();
  if (duplicate) return error("STAFF_DIRECTORY_EMAIL_EXISTS", "That email already belongs to a Staff Directory profile.", 409, { profileId: duplicate.id, staffNumber: duplicate.staff_number });

  const id = crypto.randomUUID();
  const staffNumber = await allocateStaffNumber(context.env);
  const now = new Date().toISOString();
  await context.env.DB.prepare(`INSERT INTO staff_directory_profiles
    (id,staff_number,linked_staff_member_id,display_name,email,job_title,employment_type,organisation_unit_id,division_code,
     department,telephone,internal_extension,start_date,end_date,directory_notes,status,created_at,updated_at)
    VALUES (?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, staffNumber, input.displayName, input.email, input.jobTitle, input.employmentType, input.organisationUnitId,
      input.divisionCode, input.department, input.telephone, input.internalExtension, input.startDate, input.endDate,
      input.notes, input.status, now, now).run();
  await audit(context.env, auth.session, "staff.directory_profile_created", "staff_directory_profile", id, {
    label: "Staff Directory profile created", reference: staffNumber, requestId: context.data.requestId,
    after: { ...input, staffNumber, portalIdentityLinked: false, customerRecordIndependent: true }
  });
  return json({ created: true, staff: await staffProfile(context.env, id) }, 201);
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const action = cleanText(body.action, 50).toLowerCase();
  const profileId = cleanText(body.profileId || body.staffId, 100);
  const staff = profileId ? await staffProfile(context.env, profileId) : null;
  if (!staff) return error("STAFF_PROFILE_NOT_FOUND", "The Staff Directory profile was not found.", 404);
  const now = new Date().toISOString();

  if (action === "update") {
    let input;
    try { input = normaliseStaffDirectoryInput(body); }
    catch (cause) { return error(cause.code || "INVALID_STAFF_RECORD", cause.message, cause.status || 400); }
    if (!await validUnit(context.env, input.organisationUnitId)) return error("INVALID_ORGANISATION_UNIT", "Select an active organisation unit.", 400);
    const duplicate = await context.env.DB.prepare("SELECT id FROM staff_directory_profiles WHERE lower(email)=lower(?) AND id<>?").bind(input.email, staff.id).first();
    if (duplicate) return error("STAFF_DIRECTORY_EMAIL_EXISTS", "That email already belongs to another Staff Directory profile.", 409);
    await context.env.DB.prepare(`UPDATE staff_directory_profiles SET display_name=?,email=?,job_title=?,employment_type=?,organisation_unit_id=?,division_code=?,
      department=?,telephone=?,internal_extension=?,start_date=?,end_date=?,directory_notes=?,status=?,updated_at=? WHERE id=?`)
      .bind(input.displayName, input.email, input.jobTitle, input.employmentType, input.organisationUnitId, input.divisionCode,
        input.department, input.telephone, input.internalExtension, input.startDate, input.endDate, input.notes, input.status, now, staff.id).run();
    await audit(context.env, auth.session, "staff.directory_profile_updated", "staff_directory_profile", staff.id, {
      label: "Staff Directory profile updated", reference: staffDirectoryAuditReference(staff), requestId: context.data.requestId,
      before: staff, after: { ...input, customerRecordIndependent: true }
    });
    return json({ updated: true, staff: await staffProfile(context.env, staff.id) });
  }

  if (action === "link_portal_identity") {
    const portalStaffId = cleanText(body.portalStaffId, 100);
    if (!portalStaffId) return error("PORTAL_STAFF_ID_REQUIRED", "Select a Microsoft staff access identity.", 400);
    const portalIdentity = await context.env.DB.prepare("SELECT id,display_name,email,status FROM staff_members WHERE id=?").bind(portalStaffId).first();
    if (!portalIdentity) return error("PORTAL_STAFF_IDENTITY_NOT_FOUND", "The Microsoft staff access identity was not found.", 404);
    const existingLink = await context.env.DB.prepare("SELECT id,staff_number FROM staff_directory_profiles WHERE linked_staff_member_id=? AND id<>?")
      .bind(portalIdentity.id, staff.id).first();
    if (existingLink) return error("PORTAL_STAFF_IDENTITY_ALREADY_LINKED", "That portal identity is already linked to another Staff Directory profile.", 409, { profileId: existingLink.id, staffNumber: existingLink.staff_number });
    await context.env.DB.prepare("UPDATE staff_directory_profiles SET linked_staff_member_id=?,updated_at=? WHERE id=?")
      .bind(portalIdentity.id, now, staff.id).run();
    await audit(context.env, auth.session, "staff.portal_identity_linked", "staff_directory_profile", staff.id, {
      label: "Microsoft staff access identity linked", reference: staffDirectoryAuditReference(staff), requestId: context.data.requestId,
      before: { linkedStaffMemberId: staff.linked_staff_member_id },
      after: { linkedStaffMemberId: portalIdentity.id, portalEmail: portalIdentity.email, customerRecordIndependent: true }
    });
    return json({ updated: true, staff: await staffProfile(context.env, staff.id) });
  }

  if (action === "unlink_portal_identity") {
    if (!staff.linked_staff_member_id) return json({ updated: false, staff });
    if (staff.linked_staff_member_id === auth.session.sub) return error("SELF_PORTAL_IDENTITY_UNLINK_BLOCKED", "You cannot unlink your own portal identity from the Staff Directory.", 409);
    await context.env.DB.prepare("UPDATE staff_directory_profiles SET linked_staff_member_id=NULL,updated_at=? WHERE id=?").bind(now, staff.id).run();
    await audit(context.env, auth.session, "staff.portal_identity_unlinked", "staff_directory_profile", staff.id, {
      label: "Microsoft staff access identity unlinked", reference: staffDirectoryAuditReference(staff), requestId: context.data.requestId,
      before: { linkedStaffMemberId: staff.linked_staff_member_id }, after: { linkedStaffMemberId: null }
    });
    return json({ updated: true });
  }

  if (action === "open_review") {
    const reviewType = cleanText(body.reviewType, 40).toLowerCase();
    const reason = cleanText(body.reason, 2000);
    if (!STAFF_REVIEW_TYPES.has(reviewType)) return error("INVALID_STAFF_REVIEW_TYPE", "Select a valid manual staff review type.", 400);
    if (!reason) return error("STAFF_REVIEW_REASON_REQUIRED", "Record the reason for opening the manual staff review.", 400);
    const id = crypto.randomUUID();
    await context.env.DB.prepare(`INSERT INTO staff_manual_reviews
      (id,staff_profile_id,review_type,status,reason,opened_by,opened_at,created_at,updated_at)
      VALUES (?,?,?,'open',?,?,?,?,?)`)
      .bind(id, staff.id, reviewType, reason, auth.session.sub, now, now, now).run();
    await audit(context.env, auth.session, "staff.manual_review_opened", "staff_manual_review", id, {
      label: "Manual staff review opened", reference: staffDirectoryAuditReference(staff), requestId: context.data.requestId,
      after: { staffProfileId: staff.id, reviewType, reason, automatic: false }
    });
    return json({ created: true, reviewId: id });
  }

  if (action === "close_review") {
    const reviewId = cleanText(body.reviewId, 100);
    const status = cleanText(body.status, 30).toLowerCase();
    const outcome = cleanText(body.outcome, 2000);
    if (!["completed", "cancelled"].includes(status) || !STAFF_REVIEW_STATUSES.has(status)) return error("INVALID_REVIEW_STATUS", "Select completed or cancelled.", 400);
    if (!outcome) return error("STAFF_REVIEW_OUTCOME_REQUIRED", "Record the outcome before closing the review.", 400);
    const review = await context.env.DB.prepare("SELECT * FROM staff_manual_reviews WHERE id=? AND staff_profile_id=? AND status IN ('open','in_review')")
      .bind(reviewId, staff.id).first();
    if (!review) return error("STAFF_REVIEW_NOT_FOUND", "The open manual staff review was not found.", 404);
    await context.env.DB.prepare(`UPDATE staff_manual_reviews SET status=?,outcome=?,closed_by=?,closed_at=?,updated_at=? WHERE id=?`)
      .bind(status, outcome, auth.session.sub, now, now, review.id).run();
    await audit(context.env, auth.session, "staff.manual_review_closed", "staff_manual_review", review.id, {
      label: "Manual staff review closed", reference: staffDirectoryAuditReference(staff), requestId: context.data.requestId,
      before: review, after: { status, outcome }
    });
    return json({ updated: true, status });
  }

  return error("INVALID_STAFF_DIRECTORY_ACTION", "The requested Staff Directory action is not supported.", 400);
};
