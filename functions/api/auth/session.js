import { getSession, json } from "../../_shared.js";
import { inspectMicrosoftSession, microsoftConfiguration } from "../../_microsoft-auth.js";

export const onRequestGet = async ({ request, env }) => {
  const microsoft = microsoftConfiguration(env);
  const localConfigured = Boolean(env.LOCAL_ADMIN_USERNAME && env.LOCAL_ADMIN_PASSWORD && env.SESSION_SECRET && env.DB);
  const configured = Boolean(env.DB && (microsoft.configured || localConfigured));
  const microsoftInspection = microsoft.configured
    ? await inspectMicrosoftSession(requestWithPreferredHostCookies(request), env)
    : { session: null, status: "microsoft_not_configured" };
  const session = microsoftInspection.session || (configured ? await getSession(request, env) : null);
  return json({
    authRevision: "host-only-cookie-v6",
    configured,
    authentication: microsoft.configured ? "microsoft_entra" : (localConfigured ? "local" : "unconfigured"),
    microsoft: {
      configured: microsoft.configured,
      tenantId: microsoft.tenantId,
      clientId: microsoft.clientId,
      callbackUrl: `${new URL(request.url).origin}${microsoft.callbackPath}`
    },
    authenticated: Boolean(session),
    sessionStatus: session ? "authenticated" : microsoftInspection.status,
    user: session ? { displayName: session.displayName, roleName: session.roleName, email: session.username, authenticationSource: session.authSource || "local" } : null
  });
};

function requestWithPreferredHostCookies(request) {
  const rawCookieHeader = request.headers.get("Cookie") || "";
  const parts = rawCookieHeader.split(";").map(value => value.trim()).filter(Boolean);
  const hostSession = parts.find(value => value.startsWith("__Host-ho_session="));
  const hostTransaction = parts.find(value => value.startsWith("__Host-ho_oidc_tx="));
  if (!hostSession && !hostTransaction) return request;

  const preferred = [];
  if (hostSession) preferred.push(`ho_session=${hostSession.slice("__Host-ho_session=".length)}`);
  if (hostTransaction) preferred.push(`ho_oidc_tx=${hostTransaction.slice("__Host-ho_oidc_tx=".length)}`);
  const remaining = parts.filter(value => !value.startsWith("ho_session=") && !value.startsWith("ho_oidc_tx="));
  const headers = new Headers(request.headers);
  headers.set("Cookie", [...preferred, ...remaining].join("; "));
  return new Request(request, { headers });
}