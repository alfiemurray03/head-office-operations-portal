import { audit, cleanNullableText, cleanText, error, json, normaliseDate, readJson } from "../../_shared.js";
import { canAccessCaseType, CASE_PRIORITIES, CASE_STATUSES, findCase, hasPermission, requirePermission } from "../../_operations.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "cases:read");
  if (auth.response) return auth.response;
  const record = await findCase(context.env, context.params.id);
  if (!record) return error("CASE_NOT_FOUND", "The Head Office case was not found.", 404);
  if (!canAccessCaseType(auth.authorisation, record.case_type)) return error("CASE_ACCESS_DENIED", "You are not authorised to open this restricted case.", 403);
  const canDpo = hasPermission(auth.authorisation, "data_protection:*");
  const canSafeguarding = hasPermission(auth.authorisation, "safeguarding:*");
  const [notes, communications, approvals, history] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT n.id,n.note_type,n.body,n.visibility,n.created_by,n.created_at,s.display_name created_by_name
      FROM case_notes n LEFT JOIN staff_members s ON s.id=n.created_by WHERE n.case_id=?
      AND (n.visibility IN ('case_team','head_office') OR (?=1 AND n.visibility='restricted_dpo') OR (?=1 AND n.visibility='restricted_safeguarding'))
      ORDER BY n.created_at`).bind(record.id, canDpo ? 1 : 0, canSafeguarding ? 1 : 0),
    context.env.DB.prepare("SELECT * FROM communications WHERE case_id=? ORDER BY occurred_at DESC LIMIT 100").bind(record.id),
    context.env.DB.prepare(`SELECT a.*,s.display_name decided_by_name FROM approval_requests a
      LEFT JOIN staff_members s ON s.id=a.decided_by WHERE a.case_id=? ORDER BY a.requested_at DESC`).bind(record.id),
    context.env.DB.prepare(`SELECT occurred_at,actor_name,action_label,before_json,after_json,metadata_json
      FROM audit_events WHERE entity_type='case' AND entity_id=? ORDER BY occurred_at DESC LIMIT 100`).bind(record.id)
  ]);
  return json({ case: record, notes: notes.results, communications: communications.results, approvals: approvals.results, history: history.results });
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "cases:read");
  if (auth.response) return auth.response;
  const record = await findCase(context.env, context.params.id);
  if (!record) return error("CASE_NOT_FOUND", "The Head Office case was not found.", 404);
  if (!canAccessCaseType(auth.authorisation, record.case_type, true)) return error("CASE_ACCESS_DENIED", "You are not authorised to update this restricted case.", 403);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  const status = cleanText(body.status ?? record.status, 40);
  const priority = cleanText(body.priority ?? record.priority, 20);
  const assignedStaffId = cleanNullableText(body.assignedStaffId ?? record.assigned_staff_id, 100);
  const dueAt = body.dueAt === null ? null : (body.dueAt ? normaliseDate(body.dueAt) : record.due_at);
  if (!CASE_STATUSES.has(status) || !CASE_PRIORITIES.has(priority) || (body.dueAt && !dueAt)) return error("INVALID_CASE_UPDATE", "One or more case fields are invalid.");
  if (assignedStaffId && !await context.env.DB.prepare("SELECT id FROM staff_members WHERE id=? AND status='active'").bind(assignedStaffId).first()) return error("STAFF_NOT_FOUND", "The selected staff member is not active.", 404);
  const now = new Date().toISOString();
  const closedAt = ["closed", "cancelled"].includes(status) ? (record.closed_at || now) : null;
  await context.env.DB.prepare(`UPDATE cases SET status=?,priority=?,assigned_staff_id=?,due_at=?,closed_at=?,updated_at=? WHERE id=?`)
    .bind(status, priority, assignedStaffId, dueAt, closedAt, now, record.id).run();
  const updated = await findCase(context.env, record.id);
  await audit(context.env, auth.session, "case.update", "case", record.id, {
    label: "Head Office case updated",
    reference: record.case_reference,
    customerId: record.customer_id,
    caseId: record.id,
    requestId: context.data.requestId,
    before: { status: record.status, priority: record.priority, assignedStaffId: record.assigned_staff_id, dueAt: record.due_at },
    after: { status, priority, assignedStaffId, dueAt }
  });
  return json({ updated: true, case: updated });
};
