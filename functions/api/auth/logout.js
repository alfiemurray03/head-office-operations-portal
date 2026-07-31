import { getSession, json, audit } from "../../_shared.js";
import { clearPrincipalSessionCookie, revokeSession } from "../../_principal-identity.js";

export const onRequestPost = async ({ request, env }) => {
  const session = await getSession(request, env);
  if (session) {
    if (session.sessionId) await revokeSession(env, request, session, session.sessionId, "Signed out from current device");
    await audit(env, session, "auth.logout", "portal_session", session.sessionId || session.sub, { label: "Principal sign-out" });
  }
  if (session?.authSource === "microsoft_entra") {
    return json({ ok: true, redirect: "/api/auth/microsoft/logout" }, 200, { "Set-Cookie": clearPrincipalSessionCookie() });
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearPrincipalSessionCookie() });
};
