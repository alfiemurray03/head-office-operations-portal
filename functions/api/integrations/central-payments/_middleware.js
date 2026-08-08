import { ensureCentralStripeAccountBinding } from "../../../_central-payment-account-binding.js";

export const onRequest = async context => {
  let binding = null;
  try {
    binding = await ensureCentralStripeAccountBinding(context.env);
  } catch (cause) {
    // Keep diagnostics available even when the Stripe configuration itself is
    // wrong; the underlying endpoint will return its normal actionable error.
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
