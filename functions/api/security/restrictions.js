import { audit, cleanNullableText, cleanText, error, json, normaliseDate, readJson } from "../../_shared.js";
import { findCase, findCustomer, recalculateCustomerSecurity, requirePermission } from "../../_operations.js";

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "security:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const customerReference = cleanText(body.customerNumber || body.customerId, 100);
  const caseReference = cleanNullableText(body.caseReference || body.caseId, 100);
  const markerId = cleanNullableText(body.markerId, 100);
  const restrictionType = cleanText(body.restrictionType, 80);
  const scope = cleanText(body.scope || "company_wide", 100);
  const reason = cleanText(body.reason, 2000);
  const type = await context.env.DB.prepare("SELECT * FROM restriction_types WHERE code=? AND status='active'").bind(restrictionType).first();
  if (!type || reason.length < 5) return error("INVALID_RESTRICTION", "Select a valid restriction and enter a clear reason.");
  const customer = await findCustomer(context.env, customerReference);
  if (!customer) return error("CUSTOMER_NOT_FOUND", "The universal customer record was not found.", 404);
  const caseRecord = caseReference ? await findCase(context.env, caseReference) : null;
  if (caseReference && !caseRecord) return error("CASE_NOT_FOUND", "The linked security case was not found.", 404);
  if (caseRecord?.customer_id && caseRecord.customer_id !== customer.id) return error("CASE_CUSTOMER_MISMATCH", "The selected case belongs to a different customer.");
  if (markerId) {
    const marker = await context.env.DB.prepare("SELECT id FROM security_markers WHERE id=? AND customer_id=?").bind(markerId, customer.id).first();
    if (!marker) return error("MARKER_NOT_FOUND", "The selected marker does not belong to this customer.", 404);
  }
  if (scope !== "company_wide" && !await context.env.DB.prepare("SELECT id FROM platforms WHERE id=? OR code=?").bind(scope, scope).first()) return error("INVALID_SCOPE", "The selected restriction scope is not a registered division.");
  const reviewAt = body.reviewAt ? normaliseDate(body.reviewAt) : new Date(Date.now() + 14 * 86_400_000).toISOString();
  const expiresAt = body.expiresAt ? normaliseDate(body.expiresAt) : null;
  if (!reviewAt || (body.expiresAt && !expiresAt)) return error("INVALID_DATE", "Enter a valid review or expiry date.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await context.env.DB.prepare(`INSERT INTO restrictions
    (id,customer_id,case_id,marker_id,restriction_type,scope,reason,status,applied_by,applied_at,review_at,expires_at)
    VALUES (?,?,?,?,?,?,?,'active',?,?,?,?)`)
    .bind(id, customer.id, caseRecord?.id || null, markerId, restrictionType, scope, reason, auth.session.sub, now, reviewAt, expiresAt).run();
  await recalculateCustomerSecurity(context.env, customer.id);
  await audit(context.env, auth.session, "security.restriction_applied", "restriction", id, {
    label: "Customer restriction applied",
    reference: customer.customer_number,
    customerId: customer.id,
    caseId: caseRecord?.id || null,
    requestId: context.data.requestId,
    after: { restrictionType, scope, enforcementAction: type.enforcement_action, status: "active", reviewAt, expiresAt }
  });
  return json({ id, enforcementAction: type.enforcement_action }, 201);
};
