import { json } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "dashboard:read"); if (auth.response) return auth.response;
  const [sessions, events, alerts] = await context.env.DB.batch([
    context.env.DB.prepare(`SELECT id,status,authentication_method,authentication_strength,created_at,last_seen_at,expires_at,revoked_at,
      device_label,user_agent,last_mfa_at FROM portal_sessions WHERE portal_user_id=? ORDER BY created_at DESC LIMIT 50`).bind(auth.session.sub),
    context.env.DB.prepare(`SELECT id,event_type,reason_code,authentication_method,authentication_strength,session_id,occurred_at
      FROM portal_authentication_events WHERE portal_user_id=? ORDER BY occurred_at DESC LIMIT 50`).bind(auth.session.sub),
    context.env.DB.prepare(`SELECT id,alert_type,severity,title,description,status,created_at,resolved_at
      FROM portal_security_alerts WHERE portal_user_id=? ORDER BY created_at DESC LIMIT 50`).bind(auth.session.sub)
  ]);
  return json({ currentSessionId: auth.session.sessionId, sessions: sessions.results, authenticationEvents: events.results, alerts: alerts.results });
};
