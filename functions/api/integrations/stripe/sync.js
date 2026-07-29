import { audit, cleanText, error, json, readJson } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { assertSystemServiceEnabled, systemServiceEnabled } from "../../../_runtime-policy.js";
import { syncStripeAccounts } from "../../../_stripe-reconciliation.js";

function divisionSetting(value) {
  const key = cleanText(value, 80).toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
  if (["profile-centre", "profilecentre", "profile-center", "profilecenter"].includes(key)) {
    return { division: "profile-centre", setting: "integrations.stripe_profile_centre_enabled", label: "Profile Centre Stripe" };
  }
  return { division: "planyx", setting: "integrations.stripe_planyx_enabled", label: "Planyx Stripe" };
}

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "configuration:write");
  if (auth.response) return auth.response;
  try {
    const body = await readJson(context.request);
    const requestedDivision = cleanText(body.division, 80) || null;
    const mode = body.mode === "recent" ? "recent" : "full";
    let result;

    if (requestedDivision) {
      const target = divisionSetting(requestedDivision);
      await assertSystemServiceEnabled(context.env, target.setting, target.label);
      result = await syncStripeAccounts(context.env, { division: target.division, mode, reset: Boolean(body.reset) });
    } else {
      const planyxEnabled = await systemServiceEnabled(context.env, "integrations.stripe_planyx_enabled", true);
      const profileEnabled = await systemServiceEnabled(context.env, "integrations.stripe_profile_centre_enabled", true);
      if (!planyxEnabled && !profileEnabled) {
        throw Object.assign(new Error("Both Stripe divisions are disabled in Head Office System Settings."), { code: "SYSTEM_SERVICE_DISABLED", status: 503 });
      }
      if (planyxEnabled && profileEnabled) {
        result = await syncStripeAccounts(context.env, { mode, reset: Boolean(body.reset) });
      } else {
        const division = planyxEnabled ? "planyx" : "profile-centre";
        result = await syncStripeAccounts(context.env, { division, mode, reset: Boolean(body.reset) });
      }
    }

    await audit(context.env, auth.session, "integration.stripe_reconciled", "integration", requestedDivision ? `stripe:${requestedDivision}` : "stripe:enabled", {
      label: requestedDivision ? `${requestedDivision} Stripe data reconciled` : "Enabled Stripe divisions reconciled",
      requestId: context.data.requestId,
      after: { mode, completedAt: result.completedAt, results: result.results.map(item => ({ connector: item.connector.code, partial: item.partial, totals: item.totals })) }
    });
    return json({ ok: true, ...result }, 200, { "Cache-Control": "no-store" });
  } catch (cause) {
    return error(cause.code || "STRIPE_RECONCILIATION_FAILED", cause.message || "Stripe data could not be reconciled.", cause.status || 502, cause.details);
  }
};
