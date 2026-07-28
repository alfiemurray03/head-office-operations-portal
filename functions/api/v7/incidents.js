import { audit, cleanNullableText, cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { ensureV7Schema } from "../../_v7-schema.js";

const STATUSES = new Set(["new","triage","contained","investigating","remediating","recovering","monitoring","closed"]);
const BREACH = new Set(["not_assessed","not_a_breach","assessment_required","not_reportable","reportable","reported"]);
const SEVERITIES = new Set(["SEV-1","SEV-2","SEV-3","SEV-4"]);

function incidentReference() {
  const values = new Uint32Array(2); crypto.getRandomValues(values);
  return `INC-${new Date().getUTCFullYear()}-${String((values[0]^values[1])%1000000).padStart(6,"0")}`;
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context,"incidents:read");
  if (auth.response) return auth.response;
  await ensureV7Schema(context.env);
  const url = new URL(context.request.url);
  const status = cleanText(url.searchParams.get("status") || "",40);
  const result = await context.env.DB.prepare(`SELECT i.*,c.customer_number,c.display_name customer_name,s.display_name owner_name,
      b.risk_to_rights,b.high_risk_to_rights,b.report_to_ico,b.notify_individuals,b.rationale breach_rationale
    FROM security_incidents i LEFT JOIN customers c ON c.id=i.customer_id LEFT JOIN staff_members s ON s.id=i.owner_staff_id
    LEFT JOIN data_breach_assessments b ON b.incident_id=i.id WHERE (?='' OR i.status=?)
    ORDER BY CASE i.severity WHEN 'SEV-1' THEN 1 WHEN 'SEV-2' THEN 2 WHEN 'SEV-3' THEN 3 ELSE 4 END,i.discovered_at DESC LIMIT 200`)
    .bind(status,status).all();
  return json({ incidents:result.results });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context,"incidents:write");
  if (auth.response) return auth.response;
  await ensureV7Schema(context.env);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST",cause.message,cause.status || 400); }
  const title = cleanText(body.title,180),description = cleanText(body.description,5000),category = cleanText(body.category || "general",60),severity = cleanText(body.severity || "SEV-3",10);
  if (title.length<3 || description.length<5 || !SEVERITIES.has(severity)) return error("INVALID_INCIDENT","Complete the incident title, description and severity.");
  const id=crypto.randomUUID(),reference=incidentReference(),now=new Date().toISOString();
  const dataBreachStatus = body.possibleDataBreach ? "assessment_required" : "not_assessed";
  const deadline = body.possibleDataBreach ? new Date(Date.now()+72*60*60_000).toISOString() : null;
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO security_incidents
      (id,incident_reference,category,title,description,severity,status,confidentiality_level,data_classification,customer_id,case_id,discovered_at,occurred_at,data_breach_status,ico_deadline_at,owner_staff_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'new',?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id,reference,category,title,description,severity,cleanText(body.confidentialityLevel || "K2",10),cleanText(body.dataClassification || "D3",10),cleanNullableText(body.customerId,100),cleanNullableText(body.caseId,100),now,body.occurredAt ? new Date(body.occurredAt).toISOString() : null,dataBreachStatus,deadline,auth.session.sub,now,now),
    context.env.DB.prepare(`INSERT INTO incident_timeline (id,incident_id,entry_type,summary,details_json,recorded_by,occurred_at,created_at)
      VALUES (?,?,'creation',?,'{}',?,?,?)`).bind(crypto.randomUUID(),id,"Incident opened manually.",auth.session.sub,now,now)
  ]);
  if (body.possibleDataBreach) await context.env.DB.prepare(`INSERT INTO data_breach_assessments
    (id,incident_id,awareness_at,risk_to_rights,ico_deadline_at,created_at,updated_at) VALUES (?,? ,?,'not_assessed',?,?,?)`)
    .bind(crypto.randomUUID(),id,now,deadline,now,now).run();
  await audit(context.env,auth.session,"incident.created","security_incident",id,{label:"Security incident opened",reference,requestId:context.data.requestId,after:{category,severity,dataBreachStatus}});
  return json({id,reference},201);
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context,"incidents:write");
  if (auth.response) return auth.response;
  await ensureV7Schema(context.env);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST",cause.message,cause.status || 400); }
  const id=cleanText(body.id,100),status=cleanText(body.status,40),breachStatus=cleanText(body.dataBreachStatus || "",40);
  if (!id || !STATUSES.has(status) || (breachStatus && !BREACH.has(breachStatus))) return error("INVALID_INCIDENT_UPDATE","Select valid incident values.");
  const existing=await context.env.DB.prepare("SELECT * FROM security_incidents WHERE id=?").bind(id).first();
  if(!existing) return error("INCIDENT_NOT_FOUND","The incident was not found.",404);
  const now=new Date().toISOString(),summary=cleanText(body.timelineSummary || `Incident status changed to ${status}.`,1000);
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE security_incidents SET status=?,severity=?,data_breach_status=?,owner_staff_id=?,
      contained_at=CASE WHEN ?='contained' AND contained_at IS NULL THEN ? ELSE contained_at END,
      resolved_at=CASE WHEN ?='closed' THEN ? ELSE resolved_at END,updated_at=? WHERE id=?`)
      .bind(status,SEVERITIES.has(body.severity) ? body.severity : existing.severity,breachStatus || existing.data_breach_status,cleanNullableText(body.ownerStaffId,100),status,now,status,now,now,id),
    context.env.DB.prepare(`INSERT INTO incident_timeline (id,incident_id,entry_type,summary,details_json,recorded_by,occurred_at,created_at)
      VALUES (?,?,'status',?,'{}',?,?,?)`).bind(crypto.randomUUID(),id,summary,auth.session.sub,now,now)
  ]);
  if (existing.data_breach_status!==breachStatus && breachStatus) {
    await context.env.DB.prepare(`UPDATE data_breach_assessments SET risk_to_rights=?,high_risk_to_rights=?,report_to_ico=?,notify_individuals=?,rationale=?,decision_by=?,decision_at=?,updated_at=? WHERE incident_id=?`)
      .bind(cleanText(body.riskToRights || "not_assessed",40),body.highRiskToRights?1:0,body.reportToIco===undefined?null:(body.reportToIco?1:0),body.notifyIndividuals===undefined?null:(body.notifyIndividuals?1:0),cleanNullableText(body.breachRationale,4000),auth.session.sub,now,now,id).run();
  }
  await audit(context.env,auth.session,"incident.updated","security_incident",id,{label:"Incident status updated",reference:existing.incident_reference,before:{status:existing.status,dataBreachStatus:existing.data_breach_status},after:{status,dataBreachStatus:breachStatus||existing.data_breach_status},requestId:context.data.requestId});
  return json({ok:true});
};
