import { getSession, json } from "../../_shared.js";
import { microsoftConfiguration } from "../../_microsoft-auth.js";

export const onRequestGet = async ({ request, env }) => {
  const microsoft = microsoftConfiguration(env);
  const localConfigured = Boolean(env.LOCAL_ADMIN_USERNAME && env.LOCAL_ADMIN_PASSWORD && env.SESSION_SECRET && env.DB);
  const configured = Boolean(env.DB && (microsoft.configured || localConfigured));
  const session = configured ? await getSession(request, env) : null;
  return json({
    configured,
    authentication: microsoft.configured ? "microsoft_entra" : (localConfigured ? "local" : "unconfigured"),
    microsoft: {
      configured: microsoft.configured,
      tenantId: microsoft.tenantId,
      clientId: microsoft.clientId,
      callbackUrl: `${new URL(request.url).origin}${microsoft.callbackPath}`
    },
    authenticated: Boolean(session),
    user: session ? { displayName: session.displayName, roleName: session.roleName, email: session.username, authenticationSource: session.authSource || "local" } : null
  });
};
