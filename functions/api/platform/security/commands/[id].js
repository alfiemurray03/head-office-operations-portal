import { cleanText, error, json, readJson, requirePlatform } from "../../../../_shared.js";
import { ensureSecurityControlPlane } from "../../../../_security-control-plane.js";

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["security:read"]);
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  await ensureSecurityControlPlane(context.env);
  const command = await context.env.DB.prepare(`SELECT * FROM platform_security_commands WHERE id=? AND platform_id=?`)
    .bind(context.params.id, auth.platform.id).first();
  if (!command) return error("SECURITY_COMMAND_NOT_FOUND", "The security command was not found for this connected system.", 404);
  const status = body.status === "failed" ? "failed" : "acknowledged";
  const now = new Date().toISOString();
  await context.env.DB.prepare(`UPDATE platform_security_commands SET status=?,acknowledged_at=?,result_json=? WHERE id=?`)
    .bind(status, now, JSON.stringify({ message: cleanText(body.message, 1000) || null, state: body.state || null }), command.id).run();
  return json({ acknowledged: status === "acknowledged", status, commandId: command.id, acknowledgedAt: now });
};
