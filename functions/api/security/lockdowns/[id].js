import { audit, error, json, readJson } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { ensureSecurityControlPlane, liftManualPlatformLockdown } from "../../../_security-control-plane.js";

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "security:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  await ensureSecurityControlPlane(context.env);
  const lockdown = await context.env.DB.prepare(`SELECT l.*,p.code platform_code,p.name platform_name
    FROM platform_lockdowns l JOIN platforms p ON p.id=l.platform_id WHERE l.id=?`).bind(context.params.id).first();
  if (!lockdown) return error("LOCKDOWN_NOT_FOUND", "The security lockdown record was not found.", 404);
  try {
    const result = await liftManualPlatformLockdown(context.env, lockdown, body, auth.session.sub);
    await audit(context.env, auth.session, "security.platform_lockdown_lifted", "platform_lockdown", lockdown.id, {
      label: "Website security lockdown lifted manually by Head Office",
      reference: lockdown.incident_reference,
      requestId: context.data.requestId,
      before: { status: lockdown.status, platformCode: lockdown.platform_code },
      after: { status: result.status, commandId: result.commandId }
    });
    return json(result);
  } catch (cause) {
    return error(cause.code || "LOCKDOWN_LIFT_FAILED", cause.message || "The Head Office security lockdown could not be lifted.", cause.status || 400);
  }
};
