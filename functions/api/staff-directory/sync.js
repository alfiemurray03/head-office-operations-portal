import { audit, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { STAFF_DIRECTORY_CONNECTOR_ID, syncStaffTenantDirectory } from "../../_staff-entra-sync.js";

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "administration:write");
  if (auth.response) return auth.response;

  let body = {};
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  const mode = body.mode === "full" ? "full" : "delta";
  try {
    const result = await syncStaffTenantDirectory(context.env, mode, auth.session.sub);
    await audit(context.env, auth.session, "staff.directory_tenant_sync", "staff_directory_connector", STAFF_DIRECTORY_CONNECTOR_ID, {
      label: result.partial ? "Microsoft staff tenant sync batch completed" : "Microsoft staff tenant sync completed",
      reference: "JA Group Services Microsoft tenant",
      requestId: context.data.requestId,
      after: {
        mode: result.mode,
        partial: result.partial,
        stats: result.stats,
        totals: result.totals,
        portalAccessGranted: false,
        customerRecordsAffected: false
      },
      metadata: { runId: result.runId }
    });
    return json({ ok: true, completedAt: new Date().toISOString(), ...result });
  } catch (cause) {
    return error(cause.code || "STAFF_DIRECTORY_SYNC_FAILED", cause.message || "The Microsoft staff tenant could not be synchronised.", cause.status || 502, cause.details);
  }
};
