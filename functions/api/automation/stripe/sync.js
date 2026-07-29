import { error, json, safeEqual } from "../../../_shared.js";
import { syncStripeAccounts } from "../../../_stripe-reconciliation.js";

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function systemAudit(env, result, requestId) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO audit_events
    (id,occurred_at,actor_type,actor_id,actor_name,action,action_label,entity_type,entity_id,entity_reference,request_id,after_json,metadata_json)
    VALUES (?,?,'system','stripe-reconciliation-automation','Stripe reconciliation automation','integration.stripe_automatic_reconciliation',
      'Automatic Stripe account reconciliation','integration','stripe:all','Planyx and Profile Centre',?,?,?)`)
    .bind(crypto.randomUUID(), now, requestId || null,
      JSON.stringify({ mode: result.mode, completedAt: result.completedAt, results: result.results.map(item => ({ connector: item.connector.code, partial: item.partial, totals: item.totals })) }),
      JSON.stringify({ source: "hourly-automation" })).run();
}

export const onRequestPost = async context => {
  const expected = String(context.env.AUTOMATION_SECRET || "").trim();
  const supplied = bearerToken(context.request);
  if (!expected || !supplied || !safeEqual(expected, supplied)) {
    return error("AUTOMATION_AUTHENTICATION_REQUIRED", "The automation credential is missing or invalid.", 401);
  }
  try {
    // Full mode resumes saved historical cursors until each resource is complete.
    // Once a resource is complete, the same mode refreshes its newest records.
    const result = await syncStripeAccounts(context.env, { mode: "full" });
    await systemAudit(context.env, result, context.data.requestId);
    return json({ ok: true, ...result });
  } catch (cause) {
    return error(cause.code || "AUTOMATIC_STRIPE_RECONCILIATION_FAILED", cause.message || "Automatic Stripe reconciliation failed.", cause.status || 502, cause.details);
  }
};
