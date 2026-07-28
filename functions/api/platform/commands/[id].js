import { cleanText, error, json, readJson, requirePlatform } from "../../../_shared.js";
import { ensureCentralPlatformSchema, jsonValue } from "../../../_central-schema.js";

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth.response;
  if (!auth.platform.scopes.includes("security:read") && !auth.platform.scopes.includes("customers:write")) {
    return error("INSUFFICIENT_PLATFORM_SCOPE","The credential cannot acknowledge enforcement commands.",403);
  }
  await ensureCentralPlatformSchema(context.env);
  const command = await context.env.DB.prepare("SELECT * FROM platform_enforcement_commands WHERE id=? AND platform_id=?")
    .bind(context.params.id,auth.platform.id).first();
  if (!command) return error("COMMAND_NOT_FOUND","The enforcement command was not found.",404);
  let body;
  try { body = await readJson(context.request,32_768); }
  catch (cause) { return error(cause.code||"INVALID_REQUEST",cause.message,cause.status||400); }
  const status = body.success === false ? "failed" : "acknowledged";
  const now = new Date().toISOString();
  await context.env.DB.prepare(`UPDATE platform_enforcement_commands SET status=?,acknowledged_at=?,result_json=? WHERE id=?`)
    .bind(status,now,jsonValue({message:cleanText(body.message,1000)||null,details:body.details||{}},{}),command.id).run();
  if (command.command.includes("revoke")) {
    await context.env.DB.prepare(`UPDATE customer_sessions SET status='revoked',revoked_at=COALESCE(revoked_at,?),
      revocation_reason=COALESCE(revocation_reason,?) WHERE customer_id=? AND platform_id=? AND status='revocation_required'`)
      .bind(now,cleanText(body.message,1000)||command.reason,command.customer_id,command.platform_id).run();
  }
  return json({acknowledged:true,status,commandId:command.id});
};
