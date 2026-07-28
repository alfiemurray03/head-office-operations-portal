import { audit, cleanText, error, json, normaliseDate, readJson } from "../../../_shared.js";
import { recalculateCustomerSecurity, requirePermission } from "../../../_operations.js";

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "security:write");
  if (auth.response) return auth.response;
  const marker = await context.env.DB.prepare(`SELECT m.*,c.customer_number FROM security_markers m JOIN customers c ON c.id=m.customer_id WHERE m.id=?`).bind(context.params.id).first();
  if (!marker) return error("MARKER_NOT_FOUND", "The security marker was not found.", 404);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const action = cleanText(body.action, 30);
  const now = new Date().toISOString();
  let status = marker.status;
  let reviewAt = marker.review_at;
  let clearedBy = marker.cleared_by;
  let clearedAt = marker.cleared_at;
  if (action === "review") {
    status = "under_review";
    reviewAt = body.reviewAt ? normaliseDate(body.reviewAt) : now;
    if (!reviewAt) return error("INVALID_DATE", "Enter a valid review date.");
  } else if (action === "activate") {
    status = "active";
    reviewAt = body.reviewAt ? normaliseDate(body.reviewAt) : marker.review_at;
  } else if (["clear", "cancel"].includes(action)) {
    status = action === "clear" ? "cleared" : "cancelled";
    clearedBy = auth.session.sub;
    clearedAt = now;
  } else {
    return error("INVALID_MARKER_ACTION", "Select a valid marker action.");
  }
  await context.env.DB.prepare(`UPDATE security_markers SET status=?,review_at=?,cleared_by=?,cleared_at=? WHERE id=?`)
    .bind(status, reviewAt, clearedBy, clearedAt, marker.id).run();
  await recalculateCustomerSecurity(context.env, marker.customer_id);
  await audit(context.env, auth.session, `security.marker_${action}`, "security_marker", marker.id, {
    label: `Security marker ${action === "clear" ? "cleared" : action === "cancel" ? "cancelled" : "reviewed"}`,
    reference: marker.customer_number,
    customerId: marker.customer_id,
    caseId: marker.case_id,
    requestId: context.data.requestId,
    before: { status: marker.status, reviewAt: marker.review_at },
    after: { status, reviewAt }
  });
  return json({ updated: true, status, reviewAt });
};
