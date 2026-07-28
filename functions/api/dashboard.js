import { json } from "../_shared.js";
import { caseAccessFlags, requirePermission } from "../_operations.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "dashboard:read");
  if (auth.response) return auth.response;
  const flags = caseAccessFlags(auth.authorisation);
  const now = new Date().toISOString();
  const [customers, cases, overdue, restrictions, criticalMarkers, platforms, approvals, attention, platformRows, activity] = await context.env.DB.batch([
    context.env.DB.prepare("SELECT COUNT(*) count FROM customers WHERE account_status!='archived'"),
    context.env.DB.prepare(`SELECT COUNT(*) count FROM cases WHERE status NOT IN ('closed','cancelled')
      AND (?=1 OR case_type!='data_protection') AND (?=1 OR case_type!='safeguarding')`).bind(flags.dataProtection ? 1 : 0, flags.safeguarding ? 1 : 0),
    context.env.DB.prepare(`SELECT COUNT(*) count FROM cases WHERE due_at<? AND status NOT IN ('resolved','closed','cancelled')
      AND (?=1 OR case_type!='data_protection') AND (?=1 OR case_type!='safeguarding')`).bind(now, flags.dataProtection ? 1 : 0, flags.safeguarding ? 1 : 0),
    context.env.DB.prepare("SELECT COUNT(*) count FROM restrictions WHERE status='active'"),
    context.env.DB.prepare("SELECT COUNT(*) count FROM security_markers WHERE status IN ('active','under_review') AND risk_level='critical'"),
    context.env.DB.prepare("SELECT COUNT(*) count FROM platforms WHERE status='active'"),
    context.env.DB.prepare("SELECT COUNT(*) count FROM approval_requests WHERE status='pending'"),
    context.env.DB.prepare(`SELECT c.id,c.case_reference,c.title,c.case_type,c.priority,c.status,c.due_at,u.customer_number,u.display_name customer_name
      FROM cases c LEFT JOIN customers u ON u.id=c.customer_id
      WHERE c.status NOT IN ('resolved','closed','cancelled') AND (c.priority IN ('high','critical') OR c.due_at<?)
      AND (?=1 OR c.case_type!='data_protection') AND (?=1 OR c.case_type!='safeguarding')
      ORDER BY CASE c.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,c.due_at LIMIT 10`)
      .bind(now, flags.dataProtection ? 1 : 0, flags.safeguarding ? 1 : 0),
    context.env.DB.prepare(`SELECT p.id,p.code,p.name,p.status,p.last_health_check_at,
      (SELECT COUNT(*) FROM platform_api_credentials k WHERE k.platform_id=p.id AND k.status='active') active_credential_count
      FROM platforms p ORDER BY p.name`),
    context.env.DB.prepare("SELECT occurred_at,actor_name,action_label,entity_type,entity_id,entity_reference FROM audit_events ORDER BY occurred_at DESC LIMIT 12")
  ]);
  return json({
    environment: context.env.APP_ENV || "Production",
    user: { permissions: auth.authorisation.permissions, roles: auth.authorisation.roles },
    metrics: {
      customers: Number(customers.results[0]?.count || 0),
      openCases: Number(cases.results[0]?.count || 0),
      overdueCases: Number(overdue.results[0]?.count || 0),
      activeRestrictions: Number(restrictions.results[0]?.count || 0),
      criticalMarkers: Number(criticalMarkers.results[0]?.count || 0),
      activePlatforms: Number(platforms.results[0]?.count || 0),
      pendingApprovals: Number(approvals.results[0]?.count || 0)
    },
    attention: attention.results,
    platforms: platformRows.results,
    activity: activity.results
  });
};
