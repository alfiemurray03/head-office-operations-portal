import { json } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { centralPaymentError, centralPaymentsConfiguration, ensureCentralPaymentsSchema } from "../../../_central-payments.js";

function liveConfiguration(env, origin) {
  const configuration = centralPaymentsConfiguration(env, origin);
  configuration.enabled = String(env.CENTRAL_PAYMENTS_ENABLED || "").trim().toLowerCase() !== "false";
  return configuration;
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  try {
    await ensureCentralPaymentsSchema(context.env);
    const origin = new URL(context.request.url).origin;
    const [counts, recentCheckout, recentTransactions, recentSubscriptions, eventStatus] = await context.env.DB.batch([
      context.env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM central_payment_customer_links) linked_customers,
        (SELECT COUNT(*) FROM central_payment_catalogue_products WHERE status='active') active_products,
        (SELECT COUNT(*) FROM central_payment_catalogue_prices WHERE status='active') active_prices,
        (SELECT COUNT(*) FROM central_payment_checkout_requests WHERE status='created') open_checkouts,
        (SELECT COUNT(*) FROM central_payment_subscriptions WHERE status IN ('active','trialing','past_due')) active_subscriptions,
        (SELECT COUNT(*) FROM central_payment_event_outbox WHERE status='pending') pending_platform_events`),
      context.env.DB.prepare(`SELECT id,platform_id,brand_code,product_code,price_code,customer_number,order_reference,service_reference,
        mode,status,amount_minor,currency,created_at,completed_at FROM central_payment_checkout_requests ORDER BY created_at DESC LIMIT 25`),
      context.env.DB.prepare(`SELECT stripe_object_id,object_type,event_type,brand_code,product_code,price_code,customer_number,
        order_reference,service_reference,status,amount_minor,currency,occurred_at FROM central_payment_transactions ORDER BY occurred_at DESC LIMIT 25`),
      context.env.DB.prepare(`SELECT stripe_subscription_id,brand_code,product_code,price_code,customer_number,status,quantity,
        current_period_start,current_period_end,cancel_at_period_end,order_reference,service_reference,updated_at
        FROM central_payment_subscriptions ORDER BY updated_at DESC LIMIT 25`),
      context.env.DB.prepare(`SELECT processing_status,COUNT(*) count FROM central_payment_webhook_events GROUP BY processing_status`),
    ]);
    return json({
      configuration: liveConfiguration(context.env, origin),
      metrics: counts.results?.[0] || {},
      webhookStatus: Object.fromEntries((eventStatus.results || []).map(row => [row.processing_status, Number(row.count || 0)])),
      recentCheckoutRequests: recentCheckout.results || [],
      recentTransactions: recentTransactions.results || [],
      recentSubscriptions: recentSubscriptions.results || [],
    });
  } catch (cause) {
    return centralPaymentError(cause, "The Central Payments overview could not be read.");
  }
};