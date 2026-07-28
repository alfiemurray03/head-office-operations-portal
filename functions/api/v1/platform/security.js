import { cleanText, error, json, platformAudit, requirePlatform } from "../../../_shared.js";

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["security:read"]); if (auth.response) return auth.response;
  const customerNumber = cleanText(new URL(context.request.url).searchParams.get("customerNumber") || "", 10);
  if (!/^\d{10}$/.test(customerNumber)) return error("VALID_CUSTOMER_NUMBER_REQUIRED", "A valid ten-digit customerNumber is required.");
  const customer = await context.env.DB.prepare("SELECT id,account_status,security_status FROM customers WHERE customer_number=?").bind(customerNumber).first();
  if (!customer) return error("CUSTOMER_NOT_FOUND", "The universal customer was not found.", 404);
  const result = await context.env.DB.prepare(`SELECT restriction_type,scope,reason,review_at,expires_at
    FROM restrictions WHERE customer_id=? AND status='active'
    AND (scope='company_wide' OR scope=? OR scope=?) ORDER BY applied_at`)
    .bind(customer.id, auth.platform.id, auth.platform.code).all();
  await platformAudit(context.env, auth.platform, "security.controls.read", "customer", customer.id, {
    label: "Platform checked enforceable customer controls", reference: customerNumber,
    customerId: customer.id, requestId: context.data.requestId
  });
  return json({
    customerNumber,
    accountStatus: customer.account_status,
    securityStatus: customer.security_status,
    action: result.results.length || ["restricted", "suspended"].includes(customer.account_status) ? "restrict" : "allow",
    restrictions: result.results
  });
};
