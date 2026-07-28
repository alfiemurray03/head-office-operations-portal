import { error, json, readJson, requirePlatform } from "../../_shared.js";
import { updatePlatformProfile } from "../../_central-events.js";

function authorised(platform) {
  return platform.scopes.includes("platform:write") || platform.scopes.includes("events:write") || platform.scopes.includes("customers:write");
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth.response;
  if (!authorised(auth.platform)) return error("INSUFFICIENT_PLATFORM_SCOPE","The credential cannot report website health.",403);
  let body;
  try { body = await readJson(context.request, 64_000); }
  catch (cause) { return error(cause.code||"INVALID_REQUEST",cause.message,cause.status||400); }
  try {
    const result = await updatePlatformProfile(context.env,auth.platform,body);
    return json({accepted:true,platform:{code:auth.platform.code,name:auth.platform.name},...result},202);
  } catch (cause) {
    return error(cause.code||"PLATFORM_HEARTBEAT_FAILED",cause.message||"The website heartbeat could not be recorded.",cause.status||500);
  }
};
