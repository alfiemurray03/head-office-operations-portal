import { cleanText, error, json, platformAudit, readJson, requirePlatform } from "../../../_shared.js";
import {
  centralPaymentError,
  centralStripePost,
  ensureCentralPaymentsSchema,
  findCentralCustomer,
} from "../../../_central-payments.js";

const ACTIONS = new Set(["cancel_at_period_end", "resume"]);

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["payments:portal"]);
  if (auth.response) return auth.response;

  let body;
  try { body = await readJson(context.request, 16_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    await ensureCentralPaymentsSchema(context.env);
    const action = cleanText(body.action || "cancel_at_period_end", 40).toLowerCase();
    if (!ACTIONS.has(action)) return error("INVALID_SUBSCRIPTION_ACTION", "Choose a permitted Central Payments subscription action.", 400);
    const customer = await findCentralCustomer(context.env, body.customerNumber || body.ucn);
    const requestedSubscriptionId = cleanText(body.subscriptionId, 120);
    const subscription = await context.env.DB.prepare(`SELECT * FROM central_payment_subscriptions
      WHERE platform_id=? AND customer_id=?
        AND (?='' OR stripe_subscription_id=?)
      ORDER BY updated_at DESC LIMIT 1`)
      .bind(auth.platform.id, customer.id, requestedSubscriptionId, requestedSubscriptionId).first();
    if (!subscription?.stripe_subscription_id) {
      return error("CENTRAL_SUBSCRIPTION_NOT_FOUND", "No Central Payments subscription was found for this customer and website.", 404);
    }

    const cancelAtPeriodEnd = action === "cancel_at_period_end";
    const result = await centralStripePost(
      context.env,
      `/subscriptions/${encodeURIComponent(subscription.stripe_subscription_id)}`,
      { cancel_at_period_end: cancelAtPeriodEnd ? "true" : "false" },
      `central-subscription-${action}-${subscription.stripe_subscription_id}`,
    );

    const now = new Date().toISOString();
    await context.env.DB.prepare(`UPDATE central_payment_subscriptions
      SET status=?,cancel_at_period_end=?,cancelled_at=?,updated_at=?
      WHERE stripe_subscription_id=?`)
      .bind(
        cleanText(result.status, 80) || subscription.status,
        result.cancel_at_period_end ? 1 : 0,
        result.canceled_at ? new Date(Number(result.canceled_at) * 1000).toISOString() : subscription.cancelled_at,
        now,
        subscription.stripe_subscription_id,
      ).run();

    await platformAudit(context.env, auth.platform, `central_payment.subscription.${action}`, "central_payment_subscription", subscription.stripe_subscription_id, {
      label: cancelAtPeriodEnd ? "Connected platform scheduled Central Payments subscription cancellation" : "Connected platform resumed Central Payments subscription",
      reference: subscription.stripe_subscription_id,
      customerId: customer.id,
      requestId: context.data.requestId,
      metadata: { customerNumber: customer.customer_number, cancelAtPeriodEnd: Boolean(result.cancel_at_period_end) },
    });

    return json({
      subscription: {
        id: subscription.stripe_subscription_id,
        status: result.status || subscription.status,
        cancelAtPeriodEnd: Boolean(result.cancel_at_period_end),
        currentPeriodEnd: result.current_period_end ? new Date(Number(result.current_period_end) * 1000).toISOString() : subscription.current_period_end,
      },
    });
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments could not update the subscription.");
  }
};
