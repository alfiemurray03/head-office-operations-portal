import { cleanText, json } from "../_shared.js";
import { requirePermission } from "../_operations.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "audit:read");
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const query = cleanText(url.searchParams.get("q") || "", 100);
  const entityType = cleanText(url.searchParams.get("entityType") || "", 50);
  const actorType = cleanText(url.searchParams.get("actorType") || "", 30);
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const result = await context.env.DB.prepare(`SELECT id,occurred_at,actor_type,actor_id,actor_name,action,action_label,entity_type,entity_id,entity_reference,request_id,metadata_json
    FROM audit_events WHERE (?='' OR COALESCE(actor_name,'') LIKE ? ESCAPE '\\' OR action_label LIKE ? ESCAPE '\\' OR COALESCE(entity_reference,'') LIKE ? ESCAPE '\\')
      AND (?='' OR entity_type=?) AND (?='' OR actor_type=?) ORDER BY occurred_at DESC LIMIT 300`)
    .bind(query, search, search, search, entityType, entityType, actorType, actorType).all();
  return json({ events: result.results });
};
