import { error, json, safeEqual } from "../../../_shared.js";
import { assertSystemServiceEnabled } from "../../../_runtime-policy.js";
import { CUSTOMER_DIRECTORY_CONNECTOR_ID } from "../../../_customer-entra.js";
import { syncCustomerDirectory } from "../../../_customer-entra-sync.js";

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function systemAudit(env, result, requestId) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO audit_events
    (id,occurred_at,actor_type,actor_id,actor_name,action,action_label,entity_type,entity_id,entity_reference,request_id,after_json,metadata_json)
    VALUES (?,?,'system','customer-directory-automation','Customer directory automation','customer_directory.automatic_sync',
      'Automatic Microsoft customer reconciliation','customer_directory_connector',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), now, CUSTOMER_DIRECTORY_CONNECTOR_ID, "JA Group Services ID", requestId || null,
      JSON.stringify({
        mode: result.mode,
        partial: Boolean(result.partial),
        continuationPending: Boolean(result.continuationPending),
        stats: result.stats,
        totals: result.totals
      }),
      JSON.stringify({ runId: result.runId })).run();
}

export const onRequestPost = async context => {
  const expected = String(context.env.AUTOMATION_SECRET || "").trim();
  const supplied = bearerToken(context.request);
  if (!expected || !supplied || !safeEqual(expected, supplied)) {
    return error("AUTOMATION_AUTHENTICATION_REQUIRED", "The automation credential is missing or invalid.", 401);
  }

  try {
    await assertSystemServiceEnabled(context.env, "automation.customer_directory_enabled", "Automatic JA Group Services ID reconciliation");
    await assertSystemServiceEnabled(context.env, "integrations.customer_directory_enabled", "JA Group Services ID synchronisation");
    // Continue any stored initial/full cursor first. Once complete, use the saved Microsoft delta link.
    const result = await syncCustomerDirectory(context.env, "delta", "system:customer-directory-automation");
    await systemAudit(context.env, result, context.data.requestId);
    return json({ ok: true, completedAt: new Date().toISOString(), ...result });
  } catch (cause) {
    return error(cause.code || "AUTOMATIC_DIRECTORY_SYNC_FAILED", cause.message || "Automatic customer reconciliation failed.", cause.status || 502, cause.details);
  }
};
