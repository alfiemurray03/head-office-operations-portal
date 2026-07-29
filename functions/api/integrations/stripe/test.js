import { audit, error, json, readJson } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { testStripeApiConnection } from "../../../_stripe-control.js";

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "configuration:write");
  if (auth.response) return auth.response;
  try {
    const body = await readJson(context.request);
    const result = await testStripeApiConnection(context.env, body.division);
    await audit(context.env, auth.session, "integration.stripe_tested", "integration", `stripe:${result.connector.code}`, {
      label: `${result.connector.name} Stripe API connection tested`,
      reference: result.accountId,
      requestId: context.data.requestId,
      after: {
        connected: true,
        connector: result.connector.code,
        accountId: result.accountId,
        country: result.country,
        chargesEnabled: result.chargesEnabled,
        payoutsEnabled: result.payoutsEnabled
      }
    });
    return json(result, 200, { "Cache-Control": "no-store" });
  } catch (cause) {
    return error(cause.code || "STRIPE_API_TEST_FAILED", cause.message || "The Stripe API connection could not be tested.", cause.status || 502);
  }
};
