import { audit, cleanText, error, json, normaliseDate, readJson } from "../../../_shared.js";
import { recalculateCustomerSecurity, requirePermission } from "../../../_operations.js";
import { applyRestrictionEnforcement, calculateAccessDecision, liftRestrictionEnforcement } from "../../../_central-access.js";

async function accessPosition(env, restriction) {
  const now = new Date().toISOString();
  const customer = await env.DB.prepare("SELECT * FROM customers WHERE id=? LIMIT 1").bind(restriction.customer_id).first();
  const platformResult = restriction.scope === "company_wide"
    ? await env.DB.prepare("SELECT * FROM platforms WHERE status!='disabled' ORDER BY name").all()
    : await env.DB.prepare("SELECT * FROM platforms WHERE status!='disabled' AND (id=? OR upper(code)=upper(?)) ORDER BY name")
      .bind(restriction.scope, restriction.scope).all();
  const decisions = [];
  for (const platform of platformResult.results || []) {
    const access = await calculateAccessDecision(env, customer, platform, false);
    decisions.push({
      platformId: platform.id,
      platformCode: platform.code,
      platformName: platform.name,
      decision: access.decision,
      revokeSessions: access.revokeSessions,
      reason: access.reason,
      restrictionIds: (access.restrictions || []).map(item => item.id)
    });
  }
  const remaining = await env.DB.prepare(`SELECT r.id,r.restriction_type,r.scope,r.reason,r.applied_at,r.review_at,r.expires_at,
      t.label,t.enforcement_action
    FROM restrictions r LEFT JOIN restriction_types t ON t.code=r.restriction_type
    WHERE r.customer_id=? AND r.status='active' AND (r.expires_at IS NULL OR r.expires_at>?)
    ORDER BY r.applied_at DESC`).bind(restriction.customer_id, now).all();
  const affectedDecisions = decisions.length ? decisions : [{
    platformId: null,
    platformCode: null,
    platformName: "No active connected service",
    decision: ["closed", "archived", "suspended"].includes(customer?.account_status) ? "deny" : customer?.security_status === "critical" ? "review" : "allow",
    revokeSessions: false,
    reason: "No active connected platform matched the restriction scope.",
    restrictionIds: []
  }];
  return {
    customer: {
      accountStatus: customer?.account_status || null,
      securityStatus: customer?.security_status || null
    },
    accessRestored: affectedDecisions.every(item => item.decision === "allow"),
    decisions: affectedDecisions,
    remainingRestrictions: remaining.results || []
  };
}

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
    const existing = await context.env.DB.prepare(`SELECT id FROM restrictions
      WHERE customer_id=? AND restriction_type=? AND scope=? AND status='active' AND id<>?
        AND (expires_at IS NULL OR expires_at>?) LIMIT 1`)
      .bind(restriction.customer_id, restriction.restriction_type, restriction.scope, restriction.id, now).first();
    if (existing) return error("DUPLICATE_ACTIVE_RESTRICTION", "Another active restriction of this type already applies to the same customer and service.", 409, { existingRestrictionId: existing.id });
    status = "active";
    reviewAt = body.reviewAt ? normaliseDate(body.reviewAt) : restriction.review_at;
    liftedBy = null;
    liftedAt = null;
  } else {
    return error("INVALID_RESTRICTION_ACTION", "Select a valid restriction action.");
  }
  await context.env.DB.prepare(`UPDATE restrictions SET status=?,review_at=?,lifted_by=?,lifted_at=? WHERE id=?`)
    .bind(status, reviewAt, liftedBy, liftedAt, restriction.id).run();
  await recalculateCustomerSecurity(context.env, restriction.customer_id);
  let enforcement = null;
  if (["lift","cancel"].includes(action)) enforcement = await liftRestrictionEnforcement(context.env, restriction);
  if (action === "activate") enforcement = await applyRestrictionEnforcement(context.env, { ...restriction, status }, restriction);
  const access = ["lift", "cancel", "activate"].includes(action)
    ? await accessPosition(context.env, restriction)
    : null;
  await audit(context.env, auth.session, `security.restriction_${action}`, "restriction", restriction.id, {
    label: `Customer restriction ${action === "lift" ? "lifted" : action === "cancel" ? "cancelled" : action === "activate" ? "reactivated" : "reviewed"}`,
    reference: restriction.customer_number,
    customerId: restriction.customer_id,
    caseId: restriction.case_id,
    requestId: context.data.requestId,
    before: { status: restriction.status, reviewAt: restriction.review_at },
    after: { status, reviewAt, enforcement, access }
  });
  return json({ updated: true, status, reviewAt, enforcement, access });
};
