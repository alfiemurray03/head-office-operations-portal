import { audit, cleanText, error, json, readJson } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import {
  STAFF_REVIEW_STATUSES,
  STAFF_REVIEW_TYPES,
  allocateStaffNumber,
  normaliseStaffDirectoryInput,
  normaliseStaffEmail,
  staffDirectoryAuditReference
} from "../_staff-directory.js";

async function staffRecord(env, id) {
  return env.DB.prepare(`SELECT s.*,u.code organisation_unit_code,u.name organisation_unit_name,
    COALESCE((SELECT group_concat(role_code, ',') FROM staff_role_assignments WHERE staff_id=s.id),'') role_codes
    FROM staff_members s
    LEFT JOIN organisation_units u ON u.id=s.organisation_unit_id
    WHERE s.id=?`).bind(id).first();
}

async function validUnit(env, id) {
  if (!id) return true;
  return Boolean(await env.DB.prepare("SELECT id FROM organisation_units WHERE id=? AND status='active'").bind(id).first());
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "administration:read");
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const q = cleanText(url.searchParams.get("q"), 160);
  const status = cleanText(url.searchParams.get("status"), 40).toLowerCase();
  const division = cleanText(url.searchParams.get("division"), 80).toUpperCase();
  const conditions = [];
  const values = [];
  if (q) {
    conditions.push(`(lower(s.display_name) LIKE lower(?) OR lower(s.email) LIKE lower(?) OR lower(COALESCE(s.staff_number,'')) LIKE lower(?)
      OR lower(COALESCE(s.job_title,'')) LIKE lower(?) OR lower(COALESCE(s.department,'')) LIKE lower(?))`);
    const like = `%${q}%`;
    values.push(like, like, like, like, like);
  }
  if (status) { conditions.push("s.status=?"); values.push(status); }
  if (division) { conditions.push("s.division_code=?"); values.push(division); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const [staff, metrics, reviews, roles, units] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT s.id,s.staff_number,s.display_name,s.email,s.authentication_source,s.external_identity_id,
      s.job_title,s.employment_type,s.organisation_unit_id,s.division_code,s.department,s.telephone,s.internal_extension,
      s.start_date,s.end_date,s.directory_notes,s.portal_access_enabled,s.status,s.created_at,s.updated_at,
      u.code organisation_unit_code,u.name organisation_unit_name,
      COALESCE((SELECT group_concat(role_code, ',') FROM staff_role_assignments WHERE staff_id=s.id),'') role_codes,
      (SELECT COUNT(*) FROM staff_manual_reviews mr WHERE mr.staff_id=s.id AND mr.status IN ('open','in_review')) open_review_count
      FROM staff_members s LEFT JOIN organisation_units u ON u.id=s.organisation_unit_id
      ${where} ORDER BY CASE s.status WHEN 'active' THEN 1 WHEN 'suspended' THEN 2 WHEN 'left' THEN 3 ELSE 4 END,s.display_name LIMIT 500`).bind(...values),
    context.env.DB.prepare(`SELECT COUNT(*) total,
      SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN portal_access_enabled=1 THEN 1 ELSE 0 END) portal_enabled,
      SUM(CASE WHEN employment_type='director' AND status='active' THEN 1 ELSE 0 END) directors,
      SUM(CASE WHEN status IN ('left','archived') THEN 1 ELSE 0 END) former
      FROM staff_members`),
    context.env.DB.prepare(`SELECT r.*,s.staff_number,s.display_name,s.email
      FROM staff_manual_reviews r JOIN staff_members s ON s.id=r.staff_id
      ORDER BY CASE r.status WHEN 'open' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END,r.opened_at DESC LIMIT 100`),
    context.env.DB.prepare("SELECT code,name,description,permissions_json,status FROM role_definitions ORDER BY name"),
    context.env.DB.prepare("SELECT id,code,name,unit_type,status,parent_unit_id FROM organisation_units WHERE status='active' ORDER BY unit_type,name")
  ]);
  return json({
    staff: staff.results,
    metrics: metrics.results[0] || {},
    reviews: reviews.results,
    roles: roles.results,
    units: units.results,
    separationPolicy: {
      customerRecordIndependent: true,
      matchingEmailAllowed: true,
      automaticCustomerLinking: false,
      automaticChecks: false
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
  const duplicate = await context.env.DB.prepare("SELECT id,staff_number FROM staff_members WHERE lower(email)=lower(?)").bind(input.email).first();
  if (duplicate) return error("STAFF_EMAIL_EXISTS", "That email already belongs to a Staff Directory record.", 409, { staffId: duplicate.id, staffNumber: duplicate.staff_number });

  const id = crypto.randomUUID();
  const staffNumber = await allocateStaffNumber(context.env);
  const now = new Date().toISOString();
  await context.env.DB.prepare(`INSERT INTO staff_members
    (id,external_identity_id,authentication_source,display_name,email,status,created_at,updated_at,staff_number,job_title,
     employment_type,organisation_unit_id,division_code,department,telephone,internal_extension,start_date,end_date,directory_notes,portal_access_enabled)
    VALUES (?,NULL,'manual',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`)
    .bind(id, input.displayName, input.email, input.status, now, now, staffNumber, input.jobTitle, input.employmentType,
      input.organisationUnitId, input.divisionCode, input.department, input.telephone, input.internalExtension,
      input.startDate, input.endDate, input.notes).run();
  await audit(context.env, auth.session, "staff.directory_record_created", "staff_member", id, {
    label: "Staff Directory record created",
    reference: staffNumber,
    requestId: context.data.requestId,
    after: { ...input, staffNumber, portalAccessEnabled: false, customerRecordIndependent: true }
  });
  return json({ created: true, staff: await staffRecord(context.env, id) }, 201);
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const action = cleanText(body.action, 50).toLowerCase();
  const staffId = cleanText(body.staffId, 100);
  const staff = staffId ? await staffRecord(context.env, staffId) : null;
  if (!staff) return error("STAFF_NOT_FOUND", "The staff member was not found.", 404);
  const now = new Date().toISOString();

  if (action === "update") {
    let input;
    try { input = normaliseStaffDirectoryInput(body); }
    catch (cause) { return error(cause.code || "INVALID_STAFF_RECORD", cause.message, cause.status || 400); }
    if (!await validUnit(context.env, input.organisationUnitId)) return error("INVALID_ORGANISATION_UNIT", "Select an active organisation unit.", 400);
    const duplicate = await context.env.DB.prepare("SELECT id FROM staff_members WHERE lower(email)=lower(?) AND id<>?").bind(input.email, staff.id).first();
    if (duplicate) return error("STAFF_EMAIL_EXISTS", "That email already belongs to another Staff Directory record.", 409);
    await context.env.DB.prepare(`UPDATE staff_members SET display_name=?,email=?,job_title=?,employment_type=?,organisation_unit_id=?,division_code=?,
      department=?,telephone=?,internal_extension=?,start_date=?,end_date=?,directory_notes=?,status=?,updated_at=? WHERE id=?`)
      .bind(input.displayName, input.email, input.jobTitle, input.employmentType, input.organisationUnitId, input.divisionCode,
        input.department, input.telephone, input.internalExtension, input.startDate, input.endDate, input.notes, input.status, now, staff.id).run();
    await audit(context.env, auth.session, "staff.directory_record_updated", "staff_member", staff.id, {
      label: "Staff Directory record updated", reference: staffDirectoryAuditReference(staff), requestId: context.data.requestId,
      before: staff, after: { ...input, customerRecordIndependent: true }
    });
    return json({ updated: true, staff: await staffRecord(context.env, staff.id) });
  }

  if (action === "set_portal_access") {
    const enabled = Boolean(body.enabled);
    if (!enabled && staff.id === auth.session.sub) return error("SELF_ACCESS_DISABLE_BLOCKED", "You cannot disable your own portal access.", 409);
    if (enabled) {
      const role = await context.env.DB.prepare("SELECT 1 present FROM staff_role_assignments WHERE staff_id=? LIMIT 1").bind(staff.id).first();
      if (!role) return error("STAFF_ROLE_REQUIRED", "Assign at least one role before enabling portal access.", 409);
    } else {
      const isAdmin = String(staff.role_codes || "").toUpperCase().split(",").map(value => value.trim()).includes("SYSTEM_ADMINISTRATOR");
      if (isAdmin) {
        const others = await context.env.DB.prepare(`SELECT COUNT(DISTINCT s.id) count FROM staff_members s
          JOIN staff_role_assignments r ON r.staff_id=s.id
          WHERE upper(r.role_code)='SYSTEM_ADMINISTRATOR' AND s.status='active' AND s.portal_access_enabled=1 AND s.id<>?`).bind(staff.id).first();
        if (Number(others?.count || 0) === 0) return error("LAST_ADMINISTRATOR", "The final active System Administrator cannot have portal access disabled.", 409);
      }
    }
    await context.env.DB.prepare("UPDATE staff_members SET portal_access_enabled=?,updated_at=? WHERE id=?").bind(enabled ? 1 : 0, now, staff.id).run();
    await audit(context.env, auth.session, enabled ? "staff.portal_access_enabled" : "staff.portal_access_disabled", "staff_member", staff.id, {
      label: enabled ? "Staff portal access enabled" : "Staff portal access disabled", reference: staffDirectoryAuditReference(staff),
      requestId: context.data.requestId, before: { enabled: Boolean(staff.portal_access_enabled) }, after: { enabled }
    });
    return json({ updated: true, portalAccessEnabled: enabled });
  }

  if (action === "open_review") {
    const reviewType = cleanText(body.reviewType, 40).toLowerCase();
    const reason = cleanText(body.reason, 2000);
    if (!STAFF_REVIEW_TYPES.has(reviewType)) return error("INVALID_STAFF_REVIEW_TYPE", "Select a valid manual staff review type.", 400);
    if (!reason) return error("STAFF_REVIEW_REASON_REQUIRED", "Record the reason for opening the manual staff review.", 400);
    const id = crypto.randomUUID();
    await context.env.DB.prepare(`INSERT INTO staff_manual_reviews
      (id,staff_id,review_type,status,reason,opened_by,opened_at,created_at,updated_at)
      VALUES (?,? ,?,'open',?,?,?,?,?)`)
      .bind(id, staff.id, reviewType, reason, auth.session.sub, now, now, now).run();
    await audit(context.env, auth.session, "staff.manual_review_opened", "staff_manual_review", id, {
      label: "Manual staff review opened", reference: staffDirectoryAuditReference(staff), requestId: context.data.requestId,
      after: { staffId: staff.id, reviewType, reason, automatic: false }
    });
    return json({ created: true, reviewId: id });
  }

  if (action === "close_review") {
    const reviewId = cleanText(body.reviewId, 100);
    const status = cleanText(body.status, 30).toLowerCase();
    const outcome = cleanText(body.outcome, 2000);
    if (!["completed", "cancelled"].includes(status) || !STAFF_REVIEW_STATUSES.has(status)) return error("INVALID_REVIEW_STATUS", "Select completed or cancelled.", 400);
    if (!outcome) return error("STAFF_REVIEW_OUTCOME_REQUIRED", "Record the outcome before closing the review.", 400);
    const review = await context.env.DB.prepare("SELECT * FROM staff_manual_reviews WHERE id=? AND staff_id=? AND status IN ('open','in_review')")
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
