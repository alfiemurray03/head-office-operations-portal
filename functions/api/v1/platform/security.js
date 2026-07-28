import { cleanText, error, json, platformAudit, requirePlatform } from "../../../_shared.js";

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["security:read"]);
  if (auth.response) return auth.response;
  const customerNumber = cleanText(new URL(context.request.url).searchParams.get("customerNumber") || "", 10);
  if (!/^\d{10}$/.test(customerNumber)) return error("VALID_CUSTOMER_NUMBER_REQUIRED", "A valid ten-digit customerNumber is required.");
  const customer = await context.env.DB.prepare("SELECT id,account_status,security_status FROM customers WHERE customer_number=?").bind(customerNumber).first();
  if (!customer) return error("CUSTOMER_NOT_FOUND", "The universal customer was not found.", 404);
  const result = await context.env.DB.prepare(`SELECT r.restriction_type,r.scope,r.review_at,r.expires_at,t.enforcement_action
    FROM restrictions r LEFT JOIN restriction_types t ON t.code=r.restriction_type
    WHERE r.customer_id=? AND r.status='active' AND (r.expires_at IS NULL OR r.expires_at>?)
      AND (r.scope='company_wide' OR r.scope=? OR r.scope=?) ORDER BY r.applied_at`)
    .bind(customer.id, new Date().toISOString(), auth.platform.id, auth.platform.code).all();
  await platformAudit(context.env, auth.platform, "security.controls.read", "customer", customer.id, {
    label: "Platform checked enforceable customer controls",
    reference: customerNumber,
    customerId: customer.id,
    requestId: context.data.requestId
  });
  return json({
    customerNumber,
    accountStatus: customer.account_status,
    securityStatus: customer.security_status,
    action: result.results.length || ["restricted", "suspended"].includes(customer.account_status) ? "restrict" : "allow",
    controls: result.results.map(row => ({
      code: row.restriction_type,
      scope: row.scope,
      enforcementAction: row.enforcement_action,
      reviewAt: row.review_at,
      expiresAt: row.expires_at
    }))
  });
};
