import { ensureCentralStripeAccountBinding } from "../../../_central-payment-account-binding.js";
import { requireSession } from "../../../_shared.js";

export const onRequest = async context => {
  // Automatic rebinding changes account-scoped D1 references, so even the
  // diagnostic path must not allow an anonymous request to trigger it.
  const auth = await requireSession(context);
  if (auth.response) return auth.response;

  let binding = null;
  try {
    binding = await ensureCentralStripeAccountBinding(context.env);
  } catch (cause) {
    // Keep authenticated diagnostics available even when the Stripe
    // configuration itself is wrong; the route returns the actionable detail.
    console.warn("Central Payments Stripe account binding check failed", cause);
  }

  const response = await context.next();
  if (!binding?.rebound) return response;

  const headers = new Headers(response.headers);
  headers.set("X-Central-Payments-Account-Rebound", "true");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
