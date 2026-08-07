import { error, json } from "../../_shared.js";
import {
  CENTRAL_STRIPE_REQUIRED_EVENTS,
  centralPaymentError,
  ensureCentralPaymentsSchema,
  processCentralStripeEvent,
  verifyCentralStripeWebhook,
} from "../../_central-payments.js";

export const onRequestPost = async context => {
  try {
    await ensureCentralPaymentsSchema(context.env);
    const signature = context.request.headers.get("Stripe-Signature") || "";
    const rawBody = await context.request.text();
    await verifyCentralStripeWebhook(rawBody, signature, context.env);

    let event;
    try { event = JSON.parse(rawBody); }
    catch { return error("INVALID_STRIPE_EVENT", "The Stripe webhook body is not valid JSON.", 400); }

    if (!CENTRAL_STRIPE_REQUIRED_EVENTS.includes(event?.type)) {
      return json({ received: true, ignored: true, eventType: event?.type || null });
    }

    const result = await processCentralStripeEvent(context.env, event, rawBody);
    return json({ received: true, ...result });
  } catch (cause) {
    console.error(JSON.stringify({
      event: "central_stripe_webhook_failed",
      code: cause?.code || "CENTRAL_STRIPE_WEBHOOK_FAILED",
      message: cause instanceof Error ? cause.message : "Unknown Central Payments webhook failure",
    }));
    return centralPaymentError(cause, "Central Payments could not process the Stripe webhook event.");
  }
};
