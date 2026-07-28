import { audit, cleanText, error, json, normaliseDate, readJson } from "../../../_shared.js";
import { recalculateCustomerSecurity, requirePermission } from "../../../_operations.js";
import { applyRestrictionEnforcement, liftRestrictionEnforcement } from "../../../_central-access.js";

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "security:write");
  if (auth.response) return auth.response;
  const restriction = await context.env.DB.prepare(`SELECT r.*,c.customer_number,t.enforcement_action
    FROM restrictions r JOIN customers c ON c.id=r.customer_id
    LEFT JOIN restriction_types t ON t.code=r.restriction_type WHERE r.id=?`).bind(context.params.id).first();
  if (!restriction) return error("RESTRICTION_NOT_FOUND", "The customer restriction was not found.", 404);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const action = cleanText(body.action, 30);
  const now = new Date().toISOString();
  let status = restriction.status;
  let reviewAt = restriction.review_at;
  let liftedBy = restriction.lifted_by;
  let liftedAt = restriction.lifted_at;
  if (action === "review") {
    reviewAt = body.reviewAt ? normaliseDate(body.reviewAt) : now;
    if (!reviewAt) return error("INVALID_DATE", "Enter a valid review date.");
  } else if (["lift", "cancel"].includes(action)) {
    status = action === "lift" ? "lifted" : "cancelled";
    liftedBy = auth.session.sub;
    liftedAt = now;
  } else if (action === "activate") {
    status = "active";
    reviewAt = body.reviewAt ? normaliseDate(body.reviewAt) : restriction.review_at;
  } else {
    return error("INVALID_RESTRICTION_ACTION", "Select a valid restriction action.");
  }
  await context.env.DB.prepare(`UPDATE restrictions SET status=?,review_at=?,lifted_by=?,lifted_at=? WHERE id=?`)
    .bind(status, reviewAt, liftedBy, liftedAt, restriction.id).run();
  await recalculateCustomerSecurity(context.env, restriction.customer_id);
  let enforcement = null;
  if (["lift","cancel"].includes(action)) enforcement = await liftRestrictionEnforcement(context.env, restriction);
  if (action === "activate") enforcement = await applyRestrictionEnforcement(context.env, restriction, restriction);
  await audit(context.env, auth.session, `security.restriction_${action}`, "restriction", restriction.id, {
    label: `Customer restriction ${action === "lift" ? "lifted" : action === "cancel" ? "cancelled" : action === "activate" ? "reactivated" : "reviewed"}`,
    reference: restriction.customer_number,
    customerId: restriction.customer_id,
    caseId: restriction.case_id,
    requestId: context.data.requestId,
    before: { status: restriction.status, reviewAt: restriction.review_at },
    after: { status, reviewAt, enforcement }
  });
  return json({ updated: true, status, reviewAt, enforcement });
};
