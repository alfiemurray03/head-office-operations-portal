import { audit, cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { hasFreshPrincipalAuthentication } from "../../_principal-identity.js";

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "approvals:write");
  if (auth.response) return auth.response;
  if (!hasFreshPrincipalAuthentication(auth.session)) return error("FRESH_AUTHENTICATION_REQUIRED", "Approve or decline this critical request within 15 minutes of Microsoft authentication.", 401);
  const approval = await context.env.DB.prepare(`SELECT a.*,c.case_reference,c.customer_id FROM approval_requests a LEFT JOIN cases c ON c.id=a.case_id WHERE a.id=?`).bind(context.params.id).first();
  if (!approval) return error("APPROVAL_NOT_FOUND", "The approval request was not found.", 404);
  if (approval.status !== "pending") return error("APPROVAL_ALREADY_DECIDED", "This approval request has already been decided.", 409);
  const roles = auth.authorisation.roles || [];
  const isSystemAdministrator = roles.includes("SYSTEM_ADMINISTRATOR") || auth.authorisation.permissions.includes("*");
  if (approval.required_role_code && !isSystemAdministrator && !roles.includes(String(approval.required_role_code).toUpperCase())) {
    return error("APPROVAL_ROLE_REQUIRED", "This decision requires the specified approval role.", 403);
  }
  if (approval.requested_by === auth.session.sub) {
    return error("SELF_APPROVAL_BLOCKED", "The staff member who requested this approval cannot decide it.", 409);
  }
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const decision = cleanText(body.decision, 20);
  const reason = cleanText(body.reason, 1000);
  if (!["approved", "declined"].includes(decision) || reason.length < 3) return error("INVALID_APPROVAL_DECISION", "Select a decision and record the reason.");
  const now = new Date().toISOString();
  const statements = [context.env.DB.prepare(`UPDATE approval_requests SET status=?,decided_by=?,decided_at=?,decision_reason=? WHERE id=?`)
    .bind(decision, auth.session.sub, now, reason, approval.id)];
  if (approval.case_id) statements.push(context.env.DB.prepare("UPDATE cases SET status=?,updated_at=? WHERE id=?").bind(decision === "approved" ? "investigating" : "awaiting_internal", now, approval.case_id));
  await context.env.DB.batch(statements);
  await audit(context.env, auth.session, `approval.${decision}`, "approval_request", approval.id, {
    label: `Approval request ${decision}`,
    reference: approval.case_reference || approval.id,
    customerId: approval.customer_id,
    caseId: approval.case_id,
    requestId: context.data.requestId,
    before: { status: approval.status },
    after: { status: decision, reason }
  });
  return json({ updated: true, status: decision });
};
