import { error, json, readJson, requirePlatform } from "../../_shared.js";
import { ingestPlatformEvent } from "../../_central-events.js";

function authorised(platform) {
  return platform.scopes.includes("events:write") || platform.scopes.includes("customers:write");
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, []);
  if (auth.response) return auth.response;
  if (!authorised(auth.platform)) return error("INSUFFICIENT_PLATFORM_SCOPE","The credential cannot submit customer events.",403);
  let body;
  try { body = await readJson(context.request, 256_000); }
  catch (cause) { return error(cause.code||"INVALID_REQUEST",cause.message,cause.status||400); }
  const events = Array.isArray(body.events) ? body.events.slice(0,100) : [body];
  const results = [];
  for (const event of events) {
    try { results.push({ok:true,...await ingestPlatformEvent(context.env,auth.platform,event)}); }
    catch (cause) {
      results.push({ok:false,externalEventId:event?.externalEventId||event?.id||null,
        error:{code:cause.code||"PLATFORM_EVENT_FAILED",message:cause.message||"The event could not be processed."}});
    }
  }
  const failed = results.filter(item=>!item.ok).length;
  return json({accepted:results.length-failed,failed,results},failed?207:202);
};
