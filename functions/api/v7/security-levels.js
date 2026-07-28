import { json } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { ensureV7Schema } from "../../_v7-schema.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context,"risk:read");
  if (auth.response) return auth.response;
  await ensureV7Schema(context.env);
  const [levels,rules] = await context.env.DB.batch([
    context.env.DB.prepare("SELECT dimension,code,rank,label,description,default_action,colour_token FROM security_level_definitions WHERE status='active' ORDER BY dimension,rank"),
    context.env.DB.prepare("SELECT code,category,name,description,event_type,base_score,threshold_count,threshold_window_minutes,risk_floor,recommended_enforcement,alert_severity,data_classification,confidentiality_level,enabled,version FROM detection_rules ORDER BY category,name")
  ]);
  return json({ levels:levels.results,rules:rules.results });
};
