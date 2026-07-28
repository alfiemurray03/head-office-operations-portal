import { securityHeaders, json } from "./_shared.js";

const SETTINGS_LISTENER = '$("#settingsForm").addEventListener("submit", async event => {';

function repairPortalClientStartup(source) {
  // The settings form is rendered by boot(). The source previously attempted
  // to attach its listener before boot(), throwing on a null element and
  // preventing the Microsoft session fragment from ever being consumed.
  const finalBootCall = /\nboot\(\);\s*$/;
  if (!source.includes(SETTINGS_LISTENER) || !finalBootCall.test(source)) return source;
  return source
    .replace(finalBootCall, "\n")
    .replace(SETTINGS_LISTENER, `boot();\n\n${SETTINGS_LISTENER}`);
}

export const onRequest = async context => {
  const requestId = crypto.randomUUID();
  context.data.requestId = requestId;
  try {
    let response = await context.next();
    const pathname = new URL(context.request.url).pathname;

    // Authentication endpoints manage security and Set-Cookie headers
    // themselves. Return them unchanged so the Pages middleware cannot rebuild
    // or normalise away an OIDC transaction/session cookie.
    if (pathname.startsWith("/api/auth/microsoft/")) return response;

    // Repair the known client startup ordering fault at the delivery boundary.
    // This also guarantees that the session token is removed from the address
    // bar before the first authenticated API request is made.
    if (pathname === "/app.js" && response.ok) {
      const source = await response.text();
      const headers = new Headers(response.headers);
      headers.delete("Content-Encoding");
      headers.delete("Content-Length");
      headers.delete("ETag");
      headers.set("Content-Type", "text/javascript; charset=UTF-8");
      headers.set("Cache-Control", "no-store, max-age=0");
      headers.set("X-Client-Revision", "microsoft-login-startup-v7");
      response = new Response(repairPortalClientStartup(source), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    // Preserve every Set-Cookie value explicitly. Cloudflare's response
    // normalisation can otherwise collapse cookies while cloning a Pages
    // Function response, which breaks the Microsoft callback hand-off.
    const setCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : (response.headers.get("Set-Cookie") ? [response.headers.get("Set-Cookie")] : []);
    const headers = new Headers(response.headers);
    headers.delete("Set-Cookie");
    const secured = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
    for (const value of setCookies) secured.headers.append("Set-Cookie", value);
    for (const [name, value] of Object.entries(securityHeaders)) secured.headers.set(name, value);
    secured.headers.set("X-Request-ID", requestId);
    if (pathname.startsWith("/api/") || pathname === "/app.js") secured.headers.set("Cache-Control", "no-store, max-age=0");
    return secured;
  } catch (cause) {
    console.error(JSON.stringify({ event: "request_failed", requestId, path: new URL(context.request.url).pathname, message: cause instanceof Error ? cause.message : "Unknown error" }));
    return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", requestId } }, 500);
  }
};