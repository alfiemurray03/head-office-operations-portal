import { assertSameOrigin, audit, cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { resolveCustomerDirectoryReview } from "../../_customer-entra.js";

export const onRequestPut = async context => {
  const originError = assertSameOrigin(context.request);
  if (originError) return originError;
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  const reviewId = cleanText(body.reviewId, 100);
  const decision = cleanText(body.decision, 40);
  let customerId = cleanText(body.customerId, 100) || null;
  const reason = cleanText(body.reason, 1000);
  if (!reviewId || !["link_existing", "create_new", "dismiss"].includes(decision)) {
    return error("INVALID_DIRECTORY_REVIEW", "Select a valid review item and decision.");
  }
  if (reason.length < 5) return error("REVIEW_REASON_REQUIRED", "Record why this identity-linking decision is appropriate.");

  if (decision === "link_existing" && customerId) {
    const customer = await context.env.DB.prepare("SELECT id FROM customers WHERE id=? OR customer_number=?").bind(customerId, customerId).first();
    if (!customer) return error("CUSTOMER_NOT_FOUND", "The universal customer number could not be found.", 404);
    customerId = customer.id;
  }

  try {
    const result = await resolveCustomerDirectoryReview(context.env, reviewId, decision, customerId, auth.session.sub, reason);
    await audit(context.env, auth.session, "customer_directory.review_decided", "customer_directory_review", reviewId, {
      label: "Microsoft customer identity review decided",
      reference: reviewId,
      customerId: result.customerId,
      requestId: context.data.requestId,
      after: { decision, status: result.status, customerId: result.customerId },
      metadata: { reason }
    });
    return json(result);
  } catch (cause) {
    return error(cause.code || "CUSTOMER_DIRECTORY_REVIEW_FAILED", cause.message || "The directory review decision could not be saved.", cause.status || 500, cause.details);
  }
};
