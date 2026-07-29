import { audit, cleanText, error, json, readJson } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { syncStripeAccounts } from "../../../_stripe-reconciliation.js";

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "configuration:write");
  if (auth.response) return auth.response;
  try {
    const body = await readJson(context.request);
    const division = cleanText(body.division, 80) || null;
    const mode = body.mode === "recent" ? "recent" : "full";
    const result = await syncStripeAccounts(context.env, { division, mode, reset: Boolean(body.reset) });
    await audit(context.env, auth.session, "integration.stripe_reconciled", "integration", division ? `stripe:${division}` : "stripe:all", {
      label: division ? `${division} Stripe data reconciled` : "All Stripe divisions reconciled",
      requestId: context.data.requestId,
      after: { mode, completedAt: result.completedAt, results: result.results.map(item => ({ connector: item.connector.code, partial: item.partial, totals: item.totals })) }
    });
    return json({ ok: true, ...result }, 200, { "Cache-Control": "no-store" });
  } catch (cause) {
    return error(cause.code || "STRIPE_RECONCILIATION_FAILED", cause.message || "Stripe data could not be reconciled.", cause.status || 502, cause.details);
  }
};
