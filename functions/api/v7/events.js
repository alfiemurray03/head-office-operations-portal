import { cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { ensureV7Schema } from "../../_v7-schema.js";
import { ensureV7Enhancements } from "../../_v7-enhancements.js";
import { ingestSecurityEvent } from "../../_risk-engine.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context,"risk:read");
  if (auth.response) return auth.response;
  await ensureV7Schema(context.env);
  await ensureV7Enhancements(context.env);
  const url = new URL(context.request.url);
  const q = cleanText(url.searchParams.get("q") || "",100);
  const category = cleanText(url.searchParams.get("category") || "",60);
  const risk = cleanText(url.searchParams.get("risk") || "",10);
  const search = `%${q.replaceAll("%","\\%").replaceAll("_","\\_")}%`;
  const result = await context.env.DB.prepare(`SELECT e.*,c.customer_number,c.display_name customer_name,p.name platform_name
    FROM security_events e LEFT JOIN customers c ON c.id=e.customer_id LEFT JOIN platforms p ON p.id=e.platform_id
    WHERE (?='' OR e.event_reference LIKE ? ESCAPE '\\' OR e.event_type LIKE ? ESCAPE '\\' OR COALESCE(c.customer_number,'') LIKE ? ESCAPE '\\' OR COALESCE(c.display_name,'') LIKE ? ESCAPE '\\')
      AND (?='' OR e.category=?) AND (?='' OR e.risk_level=?)
    ORDER BY e.received_at DESC LIMIT 250`).bind(q,search,search,search,search,category,category,risk,risk).all();
  return json({ events:result.results });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context,"risk:write");
  if (auth.response) return auth.response;
  await ensureV7Schema(context.env);
  await ensureV7Enhancements(context.env);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST",cause.message,cause.status || 400); }
  try {
    const result = await ingestSecurityEvent(context.env,body,{ type:"staff",id:auth.session.sub,name:auth.session.displayName });
    return json(result,result.duplicate ? 200 : 201);
  } catch (cause) {
    return error(cause.code || "EVENT_PROCESSING_FAILED",cause.message || "The security event could not be processed.",cause.status || 400);
  }
};
