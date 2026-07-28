import { audit, cleanNullableText, cleanText, error, json, normaliseDate, readJson } from "../_shared.js";
import { canAccessCaseType, findCase, findCustomer, requirePermission } from "../_operations.js";

const STATUSES = new Set(["pending", "authorised", "captured", "failed", "refund_requested", "refunded", "disputed", "cancelled"]);

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const query = cleanText(url.searchParams.get("q") || "", 100);
  const status = cleanText(url.searchParams.get("status") || "", 30);
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const result = await context.env.DB.prepare(`SELECT p.*,u.customer_number,u.display_name customer_name,x.code platform_code,x.name platform_name
    FROM payment_references p LEFT JOIN customers u ON u.id=p.customer_id LEFT JOIN platforms x ON x.id=p.platform_id
    WHERE (?='' OR p.provider_payment_reference LIKE ? ESCAPE '\\' OR COALESCE(p.provider_customer_reference,'') LIKE ? ESCAPE '\\' OR COALESCE(u.customer_number,'') LIKE ? ESCAPE '\\' OR COALESCE(u.display_name,'') LIKE ? ESCAPE '\\')
      AND (?='' OR p.status=?) ORDER BY p.occurred_at DESC LIMIT 200`)
    .bind(query, search, search, search, search, status, status).all();
  return json({ payments: result.results });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "payments:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const customerReference = cleanNullableText(body.customerNumber || body.customerId, 100);
  const caseReference = cleanNullableText(body.caseReference || body.caseId, 100);
  const platformId = cleanNullableText(body.platformId, 100);
  const provider = cleanText(body.provider, 80);
  const providerPaymentReference = cleanText(body.providerPaymentReference, 200);
  const providerCustomerReference = cleanNullableText(body.providerCustomerReference, 200);
  const currency = cleanText(body.currency || "GBP", 3).toUpperCase();
  const amountMinor = Number(body.amountMinor);
  const status = cleanText(body.status || "captured", 30);
  const occurredAt = body.occurredAt ? normaliseDate(body.occurredAt) : new Date().toISOString();
  if (provider.length < 2 || providerPaymentReference.length < 2 || !/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(amountMinor) || amountMinor < 0 || !STATUSES.has(status) || !occurredAt) return error("INVALID_PAYMENT", "Complete the payment or refund reference correctly.");
  const customer = customerReference ? await findCustomer(context.env, customerReference) : null;
  if (customerReference && !customer) return error("CUSTOMER_NOT_FOUND", "The universal customer record was not found.", 404);
  const caseRecord = caseReference ? await findCase(context.env, caseReference) : null;
  if (caseReference && !caseRecord) return error("CASE_NOT_FOUND", "The linked Head Office case was not found.", 404);
  if (caseRecord && !canAccessCaseType(auth.authorisation, caseRecord.case_type, true)) return error("CASE_ACCESS_DENIED", "You are not authorised to use this case.", 403);
  if (platformId && !await context.env.DB.prepare("SELECT id FROM platforms WHERE id=?").bind(platformId).first()) return error("PLATFORM_NOT_FOUND", "The selected division or platform was not found.", 404);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const statements = [context.env.DB.prepare(`INSERT INTO payment_references
    (id,customer_id,platform_id,provider,provider_customer_reference,provider_payment_reference,currency,amount_minor,status,occurred_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id, customer?.id || caseRecord?.customer_id || null, platformId || caseRecord?.platform_id || null, provider, providerCustomerReference, providerPaymentReference, currency, amountMinor, status, occurredAt, now)];
  let approvalId = null;
  if (status === "refund_requested") {
    const setting = await context.env.DB.prepare("SELECT value_json FROM system_settings WHERE setting_key='payments.refund_approval_threshold_minor'").first();
    const threshold = Number(JSON.parse(setting?.value_json || "5000"));
    if (amountMinor >= threshold) {
      if (!caseRecord) return error("APPROVAL_CASE_REQUIRED", "Refunds at or above the approval threshold must be linked to a Head Office case.");
      approvalId = crypto.randomUUID();
      statements.push(context.env.DB.prepare(`INSERT INTO approval_requests
        (id,case_id,approval_type,requested_by,requested_at,required_role_code,amount_minor,currency,status)
        VALUES (?,?,'refund',?,?,'HEAD_OFFICE_OPERATIONS',?,?,'pending')`)
        .bind(approvalId, caseRecord.id, auth.session.sub, now, amountMinor, currency));
      statements.push(context.env.DB.prepare("UPDATE cases SET status='approval_required',updated_at=? WHERE id=?").bind(now, caseRecord.id));
    }
  }
  try { await context.env.DB.batch(statements); }
  catch (cause) {
    if (String(cause).includes("provider_payment_reference")) return error("DUPLICATE_PAYMENT_REFERENCE", "That provider payment reference has already been recorded.", 409);
    throw cause;
  }
  await audit(context.env, auth.session, "payment.recorded", "payment_reference", id, {
    label: status === "refund_requested" ? "Refund request recorded" : "Payment reference recorded",
    reference: providerPaymentReference,
    customerId: customer?.id || caseRecord?.customer_id || null,
    caseId: caseRecord?.id || null,
    requestId: context.data.requestId,
    after: { provider, providerPaymentReference, currency, amountMinor, status, approvalId }
  });
  return json({ id, approvalId }, 201);
};
