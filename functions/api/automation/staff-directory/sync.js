import { error, json, safeEqual } from "../../../_shared.js";
import { assertSystemServiceEnabled } from "../../../_runtime-policy.js";
import { STAFF_DIRECTORY_CONNECTOR_ID, syncStaffTenantDirectory } from "../../../_staff-entra-sync.js";

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

async function systemAudit(env, result, requestId) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO audit_events
    (id,occurred_at,actor_type,actor_id,actor_name,action,action_label,entity_type,entity_id,entity_reference,request_id,after_json,metadata_json)
    VALUES (?,?,'system','staff-directory-automation','Staff Directory automation','staff.directory_automatic_sync',
      'Automatic Microsoft staff tenant reconciliation','staff_directory_connector',?,?,?,?,?)`)
    .bind(crypto.randomUUID(), now, STAFF_DIRECTORY_CONNECTOR_ID, "JA Group Services Microsoft tenant", requestId || null,
      JSON.stringify({
        mode: result.mode,
        partial: Boolean(result.partial),
        continuationPending: Boolean(result.continuationPending),
        stats: result.stats,
        totals: result.totals,
        portalAccessGranted: false,
        customerRecordsAffected: false
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
    await assertSystemServiceEnabled(context.env, "automation.staff_directory_enabled", "Automatic staff tenant reconciliation");
    await assertSystemServiceEnabled(context.env, "integrations.staff_directory_enabled", "Staff tenant directory synchronisation");
    const result = await syncStaffTenantDirectory(context.env, "delta", "system:staff-directory-automation");
    await systemAudit(context.env, result, context.data.requestId);
    return json({ ok: true, completedAt: new Date().toISOString(), ...result });
  } catch (cause) {
    return error(cause.code || "AUTOMATIC_STAFF_DIRECTORY_SYNC_FAILED", cause.message || "Automatic staff tenant reconciliation failed.", cause.status || 502, cause.details);
  }
};
