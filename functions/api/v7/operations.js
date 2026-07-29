import { audit, cleanNullableText, cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { ensureV7Schema } from "../../_v7-schema.js";

function taskReference(){const x=new Uint32Array(2);crypto.getRandomValues(x);return `HOO-${new Date().getUTCFullYear()}-${String((x[0]^x[1])%1000000).padStart(6,"0")}`;}

export const onRequestGet=async context=>{
  const auth=await requirePermission(context,"operations:read");if(auth.response)return auth.response;
  await ensureV7Schema(context.env);
  const [tasks,complaints,financial,cases]=await context.env.DB.batch([
    context.env.DB.prepare(`SELECT t.*,c.customer_number,c.display_name customer_name,x.case_reference,i.incident_reference,s.display_name assigned_staff_name
      FROM operations_tasks t LEFT JOIN customers c ON c.id=t.customer_id LEFT JOIN cases x ON x.id=t.case_id
      LEFT JOIN security_incidents i ON i.id=t.incident_id LEFT JOIN staff_members s ON s.id=t.assigned_staff_id
      WHERE t.status NOT IN ('completed','cancelled') ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,t.due_at LIMIT 200`),
    context.env.DB.prepare(`SELECT x.id,x.case_reference,x.title,x.priority,x.status,x.due_at,c.customer_number,c.display_name customer_name,
      d.complaint_stage,d.acknowledgement_due_at,d.final_response_due_at,d.outcome,d.remedy
      FROM cases x LEFT JOIN customers c ON c.id=x.customer_id LEFT JOIN complaint_records d ON d.case_id=x.id
      WHERE x.case_type='complaint' AND x.status NOT IN ('closed','cancelled') ORDER BY x.due_at LIMIT 150`),
    context.env.DB.prepare(`SELECT x.id,x.case_reference,x.case_type,x.title,x.priority,x.status,x.due_at,c.customer_number,c.display_name customer_name,
      f.operation_type,f.provider,f.transaction_reference,f.amount_minor,f.currency,f.fraud_suspected,f.dispute_stage,f.evidence_status,f.approval_status,f.outcome
      FROM cases x LEFT JOIN customers c ON c.id=x.customer_id LEFT JOIN financial_operations f ON f.case_id=x.id
      WHERE x.case_type IN ('refund','payment_dispute') AND x.status NOT IN ('closed','cancelled') ORDER BY x.due_at LIMIT 150`),
    context.env.DB.prepare(`SELECT case_type,status,COUNT(*) count FROM cases WHERE status NOT IN ('closed','cancelled') GROUP BY case_type,status`)
  ]);
  return json({tasks:tasks.results,complaints:complaints.results,financial:financial.results,caseSummary:cases.results});
};

export const onRequestPost=async context=>{
  const auth=await requirePermission(context,"operations:write");if(auth.response)return auth.response;
  await ensureV7Schema(context.env);let body;try{body=await readJson(context.request);}catch(cause){return error(cause.code||"INVALID_REQUEST",cause.message,cause.status||400);}
  const title=cleanText(body.title,180),description=cleanText(body.description,3000),serviceArea=cleanText(body.serviceArea||"general",60),taskType=cleanText(body.taskType||"head_office_action",80);
  if(title.length<3||description.length<5)return error("INVALID_TASK","Complete the task title and description.");
  const suppliedCustomer=cleanNullableText(body.customerId,100);
  let customerId=null;
  if(suppliedCustomer){
    const customer=await context.env.DB.prepare("SELECT id FROM customers WHERE id=? OR customer_number=? LIMIT 1").bind(suppliedCustomer,suppliedCustomer).first();
    if(!customer)return error("CUSTOMER_NOT_FOUND","Search for and select a valid customer from the Universal Customer Register.",404);
    customerId=customer.id;
  }
  const id=crypto.randomUUID(),reference=taskReference(),now=new Date().toISOString();
  const dueAt=body.dueAt&&!Number.isNaN(Date.parse(body.dueAt))?new Date(body.dueAt).toISOString():new Date(Date.now()+72*60*60_000).toISOString();
  await context.env.DB.prepare(`INSERT INTO operations_tasks
    (id,task_reference,service_area,task_type,customer_id,case_id,incident_id,title,description,priority,status,due_at,assigned_staff_id,checklist_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?,?, ?,?)`)
    .bind(id,reference,serviceArea,taskType,customerId,cleanNullableText(body.caseId,100),cleanNullableText(body.incidentId,100),title,description,cleanText(body.priority||"normal",20),dueAt,cleanNullableText(body.assignedStaffId,100),JSON.stringify(Array.isArray(body.checklist)?body.checklist.slice(0,30):[]),now,now).run();
  await audit(context.env,auth.session,"operations.task.created","operations_task",id,{label:"Head Office task created",reference,customerId,requestId:context.data.requestId});
  return json({id,reference},201);
};

export const onRequestPut=async context=>{
  const auth=await requirePermission(context,"operations:write");if(auth.response)return auth.response;
  await ensureV7Schema(context.env);let body;try{body=await readJson(context.request);}catch(cause){return error(cause.code||"INVALID_REQUEST",cause.message,cause.status||400);}
  const id=cleanText(body.id,100),status=cleanText(body.status,40);if(!id||!["open","in_progress","awaiting_customer","awaiting_internal","approval_required","completed","cancelled"].includes(status))return error("INVALID_TASK_UPDATE","Select a valid task and status.");
  const existing=await context.env.DB.prepare("SELECT * FROM operations_tasks WHERE id=?").bind(id).first();if(!existing)return error("TASK_NOT_FOUND","The Head Office task was not found.",404);
  const now=new Date().toISOString();await context.env.DB.prepare("UPDATE operations_tasks SET status=?,assigned_staff_id=?,updated_at=? WHERE id=?").bind(status,cleanNullableText(body.assignedStaffId,100),now,id).run();
  await audit(context.env,auth.session,"operations.task.updated","operations_task",id,{label:"Head Office task updated",reference:existing.task_reference,before:{status:existing.status},after:{status},requestId:context.data.requestId});return json({ok:true});
};
