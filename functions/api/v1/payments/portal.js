import { error, json, platformAudit, readJson, requirePlatform } from "../../../_shared.js";
import {
  centralPaymentError,
  centralStripePost,
  ensureCentralPaymentsSchema,
  findCentralCustomer,
  requirePlatformBrand,
  validatePlatformReturnUrl,
  verifyCentralStripeAccount,
} from "../../../_central-payments.js";

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["payments:portal"]);
  if (auth.response) return auth.response;

  let body;
  try { body = await readJson(context.request, 16_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    await ensureCentralPaymentsSchema(context.env);
    await verifyCentralStripeAccount(context.env);
    const brand = requirePlatformBrand(auth.platform, body.brand);
    const customer = await findCentralCustomer(context.env, body.customerNumber || body.ucn);
    const link = await context.env.DB.prepare(`SELECT stripe_customer_id FROM central_payment_customer_links WHERE customer_id=? LIMIT 1`)
      .bind(customer.id).first();
    if (!link?.stripe_customer_id) return error("STRIPE_CUSTOMER_NOT_FOUND", "This customer does not yet have a Central Payments billing profile.", 404);
    const returnUrl = await validatePlatformReturnUrl(context.env, auth.platform, body.returnUrl);
    const session = await centralStripePost(context.env, "/billing_portal/sessions", {
      customer: link.stripe_customer_id,
      return_url: returnUrl,
    }, `central-portal-${auth.platform.id}-${customer.id}-${crypto.randomUUID()}`);

    await platformAudit(context.env, auth.platform, "central_payment.portal.create", "customer", customer.id, {
      label: "Connected platform opened Central Payments billing portal",
      reference: customer.customer_number,
      customerId: customer.id,
      requestId: context.data.requestId,
      metadata: { brandCode: brand.code, stripeCustomerId: link.stripe_customer_id },
    });

    return json({ portal: { url: session.url, customerNumber: customer.customer_number, brandCode: brand.code } }, 201);
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments could not open the billing portal.");
  }
};
