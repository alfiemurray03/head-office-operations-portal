import { audit, cleanNullableText, cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { ensureV7Schema } from "../../_v7-schema.js";

const STATUSES = new Set(["new","triage","investigating","actioned","false_positive","closed"]);

export const onRequestGet = async context => {
  const auth = await requirePermission(context,"risk:read");
  if (auth.response) return auth.response;
  await ensureV7Schema(context.env);
  const url = new URL(context.request.url);
  const status = cleanText(url.searchParams.get("status") || "",40);
  const risk = cleanText(url.searchParams.get("risk") || "",10);
  const result = await context.env.DB.prepare(`SELECT a.*,c.customer_number,c.display_name customer_name,p.name platform_name,
      i.incident_reference,s.display_name assigned_staff_name FROM security_alerts a
    LEFT JOIN customers c ON c.id=a.customer_id LEFT JOIN platforms p ON p.id=a.platform_id
    LEFT JOIN security_incidents i ON i.id=a.incident_id LEFT JOIN staff_members s ON s.id=a.assigned_staff_id
    WHERE (?='' OR a.status=?) AND (?='' OR a.risk_level=?)
    ORDER BY CASE a.risk_level WHEN 'R4' THEN 1 WHEN 'R3' THEN 2 WHEN 'R2' THEN 3 WHEN 'R1' THEN 4 ELSE 5 END,a.last_detected_at DESC LIMIT 250`)
    .bind(status,status,risk,risk).all();
  return json({ alerts:result.results });
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context,"risk:write");
  if (auth.response) return auth.response;
  await ensureV7Schema(context.env);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST",cause.message,cause.status || 400); }
  const id = cleanText(body.id,100),status = cleanText(body.status,40);
  if (!id || !STATUSES.has(status)) return error("INVALID_ALERT_UPDATE","Select a valid alert and status.");
  const existing = await context.env.DB.prepare("SELECT * FROM security_alerts WHERE id=?").bind(id).first();
  if (!existing) return error("ALERT_NOT_FOUND","The security alert was not found.",404);
  const assigned = cleanNullableText(body.assignedStaffId,100);
  if (assigned && !await context.env.DB.prepare("SELECT id FROM staff_members WHERE id=? AND status='active'").bind(assigned).first()) return error("INVALID_ASSIGNEE","The selected staff member is not active.");
  const now = new Date().toISOString();
  await context.env.DB.prepare(`UPDATE security_alerts SET status=?,assigned_staff_id=?,decision=?,decision_reason=?,updated_at=? WHERE id=?`)
    .bind(status,assigned,cleanNullableText(body.decision,100),cleanNullableText(body.reason,2000),now,id).run();
  await audit(context.env,auth.session,"risk.alert.updated","security_alert",id,{ label:"Security alert decision recorded",reference:existing.alert_reference,before:{status:existing.status},after:{status,assignedStaffId:assigned},requestId:context.data.requestId });
  return json({ ok:true });
};
