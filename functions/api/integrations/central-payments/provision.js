import { audit, json } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import {
  centralPaymentError,
  verifyCentralStripeAccount,
} from "../../../_central-payments.js";
import { CENTRAL_PAYMENT_STANDARD_CATALOGUE } from "../../../_central-payment-catalogue-manifest.js";
import {
  provisionStandardCatalogue,
  standardCatalogueState,
} from "../../../_central-payment-standard-catalogue.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  try {
    const items = await standardCatalogueState(context.env);
    return json({
      items,
      ready: items.every(item => item.productReady && item.priceReady),
      total: CENTRAL_PAYMENT_STANDARD_CATALOGUE.length,
      provisioned: items.filter(item => item.productReady && item.priceReady).length,
    });
  } catch (cause) {
    return centralPaymentError(cause, "The standard Central Payments catalogue could not be inspected.");
  }
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "payments:write");
  if (auth.response) return auth.response;
  try {
    await verifyCentralStripeAccount(context.env);
    const state = await provisionStandardCatalogue(context.env);
    await audit(context.env, auth.session, "central_payments.catalogue.provision", "central_payment_catalogue", "standard", {
      label: "Standard Central Payments catalogue provisioned",
      reference: "standard",
      requestId: context.data.requestId,
      metadata: {
        createdProducts: state.createdProducts,
        createdPrices: state.createdPrices,
        total: CENTRAL_PAYMENT_STANDARD_CATALOGUE.length,
        stripeAccountId: String(context.env.CENTRAL_STRIPE_ACCOUNT_ID || ""),
      },
    });
    return json(state);
  } catch (cause) {
    return centralPaymentError(cause, "The standard Central Payments catalogue could not be provisioned.");
  }
};
