import { audit, cleanNullableText, cleanText, error, json, normaliseDate, readJson } from "../../_shared.js";
import { findCase, findCustomer, recalculateCustomerSecurity, requirePermission } from "../../_operations.js";

const RISKS = new Set(["low", "moderate", "high", "critical"]);
const VISIBILITIES = new Set(["head_office_only", "branch_instruction", "approved_branch_summary", "system_enforced"]);

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "security:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const customerReference = cleanText(body.customerNumber || body.customerId, 100);
  const caseReference = cleanNullableText(body.caseReference || body.caseId, 100);
  const markerType = cleanText(body.markerType, 80);
  const reason = cleanText(body.reason, 2000);
  const type = await context.env.DB.prepare("SELECT * FROM security_marker_types WHERE code=? AND status='active'").bind(markerType).first();
  if (!type || reason.length < 5) return error("INVALID_SECURITY_MARKER", "Select a valid marker type and enter a clear reason.");
  const customer = await findCustomer(context.env, customerReference);
  if (!customer) return error("CUSTOMER_NOT_FOUND", "The universal customer record was not found.", 404);
  const caseRecord = caseReference ? await findCase(context.env, caseReference) : null;
  if (caseReference && !caseRecord) return error("CASE_NOT_FOUND", "The linked security case was not found.", 404);
  if (Number(type.requires_case) === 1 && !caseRecord) return error("SECURITY_CASE_REQUIRED", "This marker type must be linked to a Head Office case.");
  if (caseRecord?.customer_id && caseRecord.customer_id !== customer.id) return error("CASE_CUSTOMER_MISMATCH", "The selected case belongs to a different customer.");
  const riskLevel = cleanText(body.riskLevel || type.default_risk_level, 20);
  const visibility = cleanText(body.visibility || type.default_visibility, 40);
  if (!RISKS.has(riskLevel) || !VISIBILITIES.has(visibility)) return error("INVALID_SECURITY_MARKER", "The selected risk or visibility value is invalid.");
  const reviewAt = body.reviewAt ? normaliseDate(body.reviewAt) : (type.review_days ? new Date(Date.now() + Number(type.review_days) * 86_400_000).toISOString() : null);
  const expiresAt = body.expiresAt ? normaliseDate(body.expiresAt) : null;
  if ((body.reviewAt && !reviewAt) || (body.expiresAt && !expiresAt)) return error("INVALID_DATE", "Enter a valid review or expiry date.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await context.env.DB.prepare(`INSERT INTO security_markers
    (id,customer_id,case_id,marker_type,risk_level,reason,visibility,status,review_at,expires_at,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,'active',?,?,?,?)`)
    .bind(id, customer.id, caseRecord?.id || null, markerType, riskLevel, reason, visibility, reviewAt, expiresAt, auth.session.sub, now).run();
  await recalculateCustomerSecurity(context.env, customer.id);
  await audit(context.env, auth.session, "security.marker_applied", "security_marker", id, {
    label: "Security marker applied",
    reference: customer.customer_number,
    customerId: customer.id,
    caseId: caseRecord?.id || null,
    requestId: context.data.requestId,
    after: { markerType, riskLevel, visibility, status: "active", reviewAt, expiresAt }
  });
  return json({ id }, 201);
};
