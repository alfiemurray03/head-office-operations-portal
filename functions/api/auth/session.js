import { json } from "../../_shared.js";
import { inspectMicrosoftSession, microsoftConfiguration } from "../../_microsoft-auth.js";

export const onRequestGet = async ({ request, env }) => {
  const microsoft = microsoftConfiguration(env);
  const configured = Boolean(env.DB && microsoft.configured);
  const microsoftInspection = microsoft.configured
    ? await inspectMicrosoftSession(requestWithPreferredHostCookies(request), env)
    : { session: null, status: "microsoft_not_configured" };
  const session = microsoftInspection.session;
  return json({
    authRevision: "host-only-cookie-v6",
    configured,
    authentication: microsoft.configured ? "microsoft_entra" : "unconfigured",
    microsoft: {
      configured: microsoft.configured,
      tenantId: microsoft.tenantId,
      clientId: microsoft.clientId,
      callbackUrl: `${new URL(request.url).origin}${microsoft.callbackPath}`
    },
    authenticated: Boolean(session),
    sessionStatus: session ? "authenticated" : microsoftInspection.status,
    user: session ? {
      id: session.sub, displayName: session.displayName, fullName: session.fullName, preferredName: session.preferredName,
      roleName: session.roleName, roleCode: session.roleCode, email: session.username, jobTitles: session.jobTitles,
      profileImage: session.profileImage, securityLevel: session.securityLevel, accessLevel: session.accessLevel,
      authority: session.authority, sessionId: session.sessionId, sessionCreatedAt: session.createdAt,
      authenticationStrength: session.authenticationStrength, authenticationSource: session.authSource
    } : null
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
