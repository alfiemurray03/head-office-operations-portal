import { audit, error, json, readJson } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { testStripeApiConnection } from "../../../_stripe-control.js";

async function recordAudit(context, auth, result) {
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
}

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "configuration:write");
  if (auth.response) return auth.response;
  try {
    const body = await readJson(context.request);
    if (body.division) {
      const result = await testStripeApiConnection(context.env, body.division);
      await recordAudit(context, auth, result);
      return json(result, 200, { "Cache-Control": "no-store" });
    }

    const results = [];
    const failures = [];
    for (const division of ["planyx", "profile-centre"]) {
      try {
        const result = await testStripeApiConnection(context.env, division);
        await recordAudit(context, auth, result);
        results.push(result);
      } catch (cause) {
        failures.push({ division, code: cause.code || "STRIPE_API_TEST_FAILED", message: cause.message || "Connection failed." });
      }
    }
    if (failures.length) {
      return error("STRIPE_DIVISION_CONNECTION_FAILED", "One or more Stripe division API connections failed.", 502, { results, failures });
    }
    return json({
      connected: true,
      businessName: "Planyx and Profile Centre",
      accountId: results.map(result => result.accountId).join(" · "),
      chargesEnabled: results.every(result => result.chargesEnabled),
      payoutsEnabled: results.every(result => result.payoutsEnabled),
      results
    }, 200, { "Cache-Control": "no-store" });
  } catch (cause) {
    return error(cause.code || "STRIPE_API_TEST_FAILED", cause.message || "The Stripe API connection could not be tested.", cause.status || 502);
  }
};
