import { json } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { stripeOperationalStatus } from "../../../_stripe-control.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  const origin = new URL(context.request.url).origin;
  return json(await stripeOperationalStatus(context.env, origin), 200, { "Cache-Control": "no-store" });
};
