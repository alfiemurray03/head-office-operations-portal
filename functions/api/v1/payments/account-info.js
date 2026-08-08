import { json, requirePlatform } from "../../../_shared.js";
import {
  centralPaymentError,
  centralPaymentsConfiguration,
  verifyCentralStripeAccount,
} from "../../../_central-payments.js";

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["payments:checkout"]);
  if (auth.response) return auth.response;

  try {
    const account = await verifyCentralStripeAccount(context.env);
    const configuration = centralPaymentsConfiguration(context.env);
    return json({
      stripeAccountId: account.id,
      liveMode: configuration.mode === "live",
      mode: configuration.mode,
      displayName: account.settings?.dashboard?.display_name || account.business_profile?.name || null,
      country: account.country || null,
      defaultCurrency: String(account.default_currency || "").toUpperCase() || null,
    });
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments could not verify the configured Stripe account.");
  }
};
