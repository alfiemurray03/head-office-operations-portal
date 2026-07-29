import { json } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { stripeOperationalStatus } from "../../../_stripe-control.js";
import { STRIPE_RECONCILIATION_EVENTS, stripeReconciliationStatus } from "../../../_stripe-reconciliation.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  const origin = new URL(context.request.url).origin;
  const [status, reconciliation] = await Promise.all([
    stripeOperationalStatus(context.env, origin),
    stripeReconciliationStatus(context.env)
  ]);
  const requiredEvents = [...new Set([...(status.requiredEvents || []), ...STRIPE_RECONCILIATION_EVENTS])].sort();
  return json({ ...status, requiredEvents, reconciliation }, 200, { "Cache-Control": "no-store" });
};
