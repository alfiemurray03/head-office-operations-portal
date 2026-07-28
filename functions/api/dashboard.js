import { json, requireSession } from "../_shared.js";

export const onRequestGet = async context => {
  const auth = await requireSession(context); if (auth.response) return auth.response;
  const { env } = context;
  const [customers, cases, overdue, restrictions, platforms, attention, platformRows, activity] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) count FROM customers WHERE account_status != 'archived'"),
    env.DB.prepare("SELECT COUNT(*) count FROM cases WHERE status NOT IN ('closed','cancelled')"),
    env.DB.prepare("SELECT COUNT(*) count FROM cases WHERE due_at < ? AND status NOT IN ('resolved','closed','cancelled')").bind(new Date().toISOString()),
    env.DB.prepare("SELECT COUNT(*) count FROM restrictions WHERE status = 'active'"),
    env.DB.prepare("SELECT COUNT(*) count FROM platforms WHERE status = 'active'"),
    env.DB.prepare(`SELECT c.case_reference,c.title,c.priority,c.due_at,u.customer_number FROM cases c LEFT JOIN customers u ON u.id=c.customer_id WHERE c.status NOT IN ('resolved','closed','cancelled') AND (c.priority IN ('high','critical') OR c.due_at < ?) ORDER BY CASE c.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,c.due_at LIMIT 8`).bind(new Date().toISOString()),
    env.DB.prepare("SELECT id,code,name,status,last_health_check_at FROM platforms ORDER BY name"),
    env.DB.prepare("SELECT occurred_at,actor_name,action_label,entity_type,entity_id,entity_reference FROM audit_events ORDER BY occurred_at DESC LIMIT 8")
  ]);
  return json({
    environment: env.APP_ENV || "Preview",
    metrics: { customers: customers.results[0].count, openCases: cases.results[0].count, overdueCases: overdue.results[0].count, activeRestrictions: restrictions.results[0].count, activePlatforms: platforms.results[0].count },
    attention: attention.results, platforms: platformRows.results, activity: activity.results
  });
};
