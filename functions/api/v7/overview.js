import { json } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { ensureV7Schema } from "../../_v7-schema.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context,"risk:read");
  if (auth.response) return auth.response;
  await ensureV7Schema(context.env);
  const since = new Date(Date.now()-24*60*60_000).toISOString();
  const [events,alerts,critical,incidents,breaches,tasks,complaints,financial,latestAlerts,latestIncidents,latestEvents] = await context.env.DB.batch([
    context.env.DB.prepare("SELECT COUNT(*) count FROM security_events WHERE received_at>=?").bind(since),
    context.env.DB.prepare("SELECT COUNT(*) count FROM security_alerts WHERE status NOT IN ('false_positive','closed')"),
    context.env.DB.prepare("SELECT COUNT(*) count FROM security_alerts WHERE status NOT IN ('false_positive','closed') AND (risk_level='R4' OR severity='SEV-1')"),
    context.env.DB.prepare("SELECT COUNT(*) count FROM security_incidents WHERE status!='closed'"),
    context.env.DB.prepare("SELECT COUNT(*) count FROM security_incidents WHERE data_breach_status IN ('assessment_required','reportable') AND status!='closed'"),
    context.env.DB.prepare("SELECT COUNT(*) count FROM operations_tasks WHERE status NOT IN ('completed','cancelled')"),
    context.env.DB.prepare("SELECT COUNT(*) count FROM cases WHERE case_type='complaint' AND status NOT IN ('closed','cancelled')"),
    context.env.DB.prepare("SELECT COUNT(*) count FROM cases WHERE case_type IN ('refund','payment_dispute') AND status NOT IN ('closed','cancelled')"),
    context.env.DB.prepare(`SELECT a.id,a.alert_reference,a.title,a.category,a.risk_score,a.risk_level,a.enforcement_level,a.severity,a.status,
      a.last_detected_at,c.customer_number,c.display_name customer_name FROM security_alerts a
      LEFT JOIN customers c ON c.id=a.customer_id WHERE a.status NOT IN ('false_positive','closed')
      ORDER BY a.risk_score DESC,a.last_detected_at DESC LIMIT 10`),
    context.env.DB.prepare(`SELECT id,incident_reference,title,category,severity,status,data_breach_status,ico_deadline_at,discovered_at
      FROM security_incidents WHERE status!='closed' ORDER BY CASE severity WHEN 'SEV-1' THEN 1 WHEN 'SEV-2' THEN 2 WHEN 'SEV-3' THEN 3 ELSE 4 END,discovered_at DESC LIMIT 10`),
    context.env.DB.prepare(`SELECT e.event_reference,e.event_type,e.category,e.risk_score,e.risk_level,e.enforcement_level,e.received_at,
      c.customer_number,c.display_name customer_name,p.name platform_name FROM security_events e
      LEFT JOIN customers c ON c.id=e.customer_id LEFT JOIN platforms p ON p.id=e.platform_id
      ORDER BY e.received_at DESC LIMIT 12`)
  ]);
  return json({
    version:"7.0.0",
    metrics:{ events24h:events.results[0].count,openAlerts:alerts.results[0].count,criticalAlerts:critical.results[0].count,
      openIncidents:incidents.results[0].count,breachAssessments:breaches.results[0].count,openTasks:tasks.results[0].count,
      openComplaints:complaints.results[0].count,openFinancialCases:financial.results[0].count },
    alerts:latestAlerts.results,incidents:latestIncidents.results,events:latestEvents.results
  });
};
