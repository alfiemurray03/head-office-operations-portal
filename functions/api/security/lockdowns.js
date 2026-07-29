import { audit, cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { findPlatform } from "../../_central-schema.js";
import { initiateManualPlatformLockdown, listPlatformLockdowns } from "../../_security-control-plane.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "security:read");
  if (auth.response) return auth.response;
  return json({
    lockdowns: await listPlatformLockdowns(context.env),
    policy: {
      automatedLockdownEnabled: false,
      initiationAuthority: "JA Group Services Ltd Head Office",
      requiredSeverity: "critical",
      localMaintenanceAndLaunchGatesRemainControlledByEachSite: true
    }
  }, 200, { "Cache-Control": "no-store" });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "security:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const platform = await findPlatform(context.env, cleanText(body.platformId || body.platformCode, 100));
  if (!platform || platform.status === "disabled") return error("PLATFORM_NOT_FOUND", "Select an active connected website or service.", 404);
  try {
    const result = await initiateManualPlatformLockdown(context.env, platform, body, auth.session.sub);
    await audit(context.env, auth.session, "security.platform_lockdown_initiated", "platform_lockdown", result.id, {
      label: "Critical website security lockdown initiated manually by Head Office",
      reference: body.incidentReference,
      requestId: context.data.requestId,
      after: { platformId: platform.id, platformCode: platform.code, status: result.status, commandId: result.commandId, automated: false }
    });
    return json(result, 201);
  } catch (cause) {
    return error(cause.code || "LOCKDOWN_FAILED", cause.message || "The Head Office security lockdown could not be initiated.", cause.status || 400, cause.details);
  }
};
