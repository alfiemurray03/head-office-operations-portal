import { cleanText, error, json, requirePlatform } from "../../../_shared.js";
import { centralPaymentError, ensureCentralPaymentsSchema } from "../../../_central-payments.js";

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["payments:status"]);
  if (auth.response) return auth.response;

  try {
    await ensureCentralPaymentsSchema(context.env);
    const url = new URL(context.request.url);
    const reference = cleanText(url.searchParams.get("reference"), 120);
    const orderReference = cleanText(url.searchParams.get("orderReference"), 120);
    const customerNumber = cleanText(url.searchParams.get("customerNumber") || url.searchParams.get("ucn"), 20).replace(/\s/g, "");
    if (!reference && !orderReference && !customerNumber) {
      return error("PAYMENT_REFERENCE_REQUIRED", "Provide a Central Payments reference, order reference or customer UCN.", 400);
    }

    const wildcard = reference || orderReference || customerNumber;
    const [checkout, transactions, subscriptions] = await context.env.DB.batch([
      context.env.DB.prepare(`SELECT id,brand_code,product_code,price_code,customer_number,stripe_checkout_session_id,
        order_reference,service_reference,mode,status,amount_minor,currency,created_at,updated_at,completed_at
        FROM central_payment_checkout_requests
        WHERE platform_id=? AND (id=? OR order_reference=? OR customer_number=?)
        ORDER BY created_at DESC LIMIT 25`).bind(auth.platform.id, reference || wildcard, orderReference || wildcard, customerNumber || wildcard),
      context.env.DB.prepare(`SELECT stripe_object_id,object_type,event_type,brand_code,product_code,price_code,customer_number,
        stripe_payment_intent_id,stripe_subscription_id,stripe_invoice_id,order_reference,service_reference,status,amount_minor,
        currency,occurred_at,updated_at
        FROM central_payment_transactions
        WHERE platform_id=? AND (stripe_object_id=? OR order_reference=? OR customer_number=?)
        ORDER BY occurred_at DESC LIMIT 50`).bind(auth.platform.id, reference || wildcard, orderReference || wildcard, customerNumber || wildcard),
      context.env.DB.prepare(`SELECT stripe_subscription_id,brand_code,product_code,price_code,customer_number,status,quantity,
        current_period_start,current_period_end,cancel_at_period_end,cancelled_at,order_reference,service_reference,created_at,updated_at
        FROM central_payment_subscriptions
        WHERE platform_id=? AND (stripe_subscription_id=? OR order_reference=? OR customer_number=?)
        ORDER BY updated_at DESC LIMIT 25`).bind(auth.platform.id, reference || wildcard, orderReference || wildcard, customerNumber || wildcard),
    ]);

    return json({
      checkoutRequests: checkout.results || [],
      transactions: transactions.results || [],
      subscriptions: subscriptions.results || [],
    });
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments status could not be read.");
  }
};
