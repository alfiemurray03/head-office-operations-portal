import { ensureCentralStripeAccountBinding } from "../../../_central-payment-account-binding.js";
import { centralPaymentError } from "../../../_central-payments.js";

export const onRequest = async context => {
  let binding;
  try {
    binding = await ensureCentralStripeAccountBinding(context.env);
    if (!binding.configured) {
      throw Object.assign(new Error("The approved Head Office Central Payments Stripe account is not fully configured."), {
        code: "CENTRAL_STRIPE_BINDING_NOT_CONFIGURED",
        status: 503,
      });
    }
  } catch (cause) {
    // Connected websites must never continue into a payment route when the
    // configured Stripe key/account/mode cannot be verified by Head Office.
    return centralPaymentError(cause, "Central Payments could not verify its approved Stripe account.");
  }

  const response = await context.next();
  if (!binding.rebound) return response;

  const headers = new Headers(response.headers);
  headers.set("X-Central-Payments-Account-Rebound", "true");
  headers.set("Cache-Control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
