import { cleanText, error, json, requirePlatform } from "../../../_shared.js";
import { centralPaymentError, ensureCentralPaymentsSchema } from "../../../_central-payments.js";

async function ensureCheckoutItemsSchema(env) {
  await ensureCentralPaymentsSchema(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS central_payment_checkout_items (
    id TEXT PRIMARY KEY,
    checkout_request_id TEXT NOT NULL,
    line_position INTEGER NOT NULL,
    item_code TEXT NOT NULL,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_net_minor INTEGER NOT NULL,
    unit_tax_minor INTEGER NOT NULL,
    unit_gross_minor INTEGER NOT NULL,
    line_net_minor INTEGER NOT NULL,
    line_tax_minor INTEGER NOT NULL,
    line_gross_minor INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'GBP',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE(checkout_request_id,line_position),
    FOREIGN KEY (checkout_request_id) REFERENCES central_payment_checkout_requests(id) ON DELETE CASCADE
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_central_checkout_items_request
    ON central_payment_checkout_items(checkout_request_id,line_position)`).run();
}

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["payments:status"]);
  if (auth.response) return auth.response;

  try {
    await ensureCheckoutItemsSchema(context.env);
    const url = new URL(context.request.url);
    const reference = cleanText(url.searchParams.get("reference"), 120);
    const orderReference = cleanText(url.searchParams.get("orderReference"), 120);
    const customerNumber = cleanText(url.searchParams.get("customerNumber") || url.searchParams.get("ucn"), 20).replace(/\s/g, "");
    if (!reference && !orderReference && !customerNumber) {
      return error("PAYMENT_REFERENCE_REQUIRED", "Provide a Central Payments reference, order reference or customer UCN.", 400);
    }

    const wildcard = reference || orderReference || customerNumber;
    const [checkout, checkoutItems, transactions, subscriptions] = await context.env.DB.batch([
      context.env.DB.prepare(`SELECT id,brand_code,product_code,price_code,customer_number,stripe_customer_id,stripe_checkout_session_id,
        order_reference,service_reference,mode,status,amount_minor,currency,created_at,updated_at,completed_at
        FROM central_payment_checkout_requests
        WHERE platform_id=? AND (id=? OR order_reference=? OR customer_number=?)
        ORDER BY created_at DESC LIMIT 25`).bind(auth.platform.id, reference || wildcard, orderReference || wildcard, customerNumber || wildcard),
      context.env.DB.prepare(`SELECT i.id,i.checkout_request_id,i.line_position,i.item_code,i.item_name,i.quantity,
        i.unit_net_minor,i.unit_tax_minor,i.unit_gross_minor,i.line_net_minor,i.line_tax_minor,i.line_gross_minor,
        i.currency,i.metadata_json,i.created_at
        FROM central_payment_checkout_items i
        INNER JOIN central_payment_checkout_requests r ON r.id=i.checkout_request_id
        WHERE r.platform_id=? AND (r.id=? OR r.order_reference=? OR r.customer_number=?)
        ORDER BY r.created_at DESC,i.line_position ASC LIMIT 250`).bind(auth.platform.id, reference || wildcard, orderReference || wildcard, customerNumber || wildcard),
      context.env.DB.prepare(`SELECT stripe_object_id,object_type,event_type,brand_code,product_code,price_code,customer_number,
        stripe_customer_id,stripe_payment_intent_id,stripe_subscription_id,stripe_invoice_id,order_reference,service_reference,status,amount_minor,
        currency,occurred_at,updated_at
        FROM central_payment_transactions
        WHERE platform_id=? AND (stripe_object_id=? OR order_reference=? OR customer_number=?)
        ORDER BY occurred_at DESC LIMIT 50`).bind(auth.platform.id, reference || wildcard, orderReference || wildcard, customerNumber || wildcard),
      context.env.DB.prepare(`SELECT stripe_subscription_id,brand_code,product_code,price_code,customer_number,stripe_customer_id,status,quantity,
        current_period_start,current_period_end,cancel_at_period_end,cancelled_at,order_reference,service_reference,created_at,updated_at
        FROM central_payment_subscriptions
        WHERE platform_id=? AND (stripe_subscription_id=? OR order_reference=? OR customer_number=?)
        ORDER BY updated_at DESC LIMIT 25`).bind(auth.platform.id, reference || wildcard, orderReference || wildcard, customerNumber || wildcard),
    ]);

    return json({
      checkoutRequests: checkout.results || [],
      checkoutItems: checkoutItems.results || [],
      transactions: transactions.results || [],
      subscriptions: subscriptions.results || [],
    });
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments status could not be read.");
  }
};