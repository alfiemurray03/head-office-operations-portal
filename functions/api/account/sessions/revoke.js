import { audit, error, json, readJson } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import { clearPrincipalSessionCookie, revokeSession } from "../../../_principal-identity.js";

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "dashboard:read"); if (auth.response) return auth.response;
  let body; try { body = await readJson(context.request, 4096); } catch (cause) { return error(cause.code, cause.message, cause.status); }
  const target = body.all ? null : String(body.sessionId || auth.session.sessionId);
  if (body.report && target) {
    const owned = await context.env.DB.prepare("SELECT id FROM portal_sessions WHERE id=? AND portal_user_id=?").bind(target, auth.session.sub).first();
    if (!owned) return error("SESSION_NOT_FOUND", "That session does not belong to the signed-in principal.", 404);
    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare("UPDATE portal_sessions SET status='reported',revoked_at=?,revocation_reason='Reported as unrecognised by principal' WHERE id=?").bind(now, target),
      context.env.DB.prepare(`INSERT INTO portal_security_alerts(id,portal_user_id,alert_type,severity,title,description,status,created_at)
        VALUES (?,?, 'unrecognised_session','high','Unrecognised session reported','The principal reported a session they did not recognise.','open',?)`).bind(crypto.randomUUID(), auth.session.sub, now)
    ]);
  } else if (body.all) {
    await context.env.DB.prepare("UPDATE portal_sessions SET status='revoked',revoked_at=?,revocation_reason='User revoked all own sessions' WHERE portal_user_id=? AND status='active'")
      .bind(new Date().toISOString(), auth.session.sub).run();
  } else if (!await revokeSession(context.env, context.request, auth.session, target)) {
    return error("SESSION_NOT_FOUND", "That session does not belong to the signed-in principal.", 404);
  }
  await audit(context.env, auth.session, body.report ? "principal.session_reported" : body.all ? "principal.sessions_revoked_all" : "principal.session_revoked", "portal_session", target || auth.session.sub, { label: body.report ? "Principal reported unrecognised session" : body.all ? "Principal revoked all own sessions" : "Principal revoked own session" });
  const currentRevoked = body.all || target === auth.session.sessionId;
  return json({ revoked: true, currentSessionRevoked: currentRevoked }, 200, currentRevoked ? { "Set-Cookie": clearPrincipalSessionCookie() } : {});
};
