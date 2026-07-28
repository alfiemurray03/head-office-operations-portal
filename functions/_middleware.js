import { securityHeaders, json } from "./_shared.js";

export const onRequest = async context => {
  const requestId = crypto.randomUUID();
  context.data.requestId = requestId;
  try {
    const response = await context.next();
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
    if (new URL(context.request.url).pathname.startsWith("/api/")) secured.headers.set("Cache-Control", "no-store");
    return secured;
  } catch (cause) {
    console.error(JSON.stringify({ event: "request_failed", requestId, path: new URL(context.request.url).pathname, message: cause instanceof Error ? cause.message : "Unknown error" }));
    return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", requestId } }, 500);
  }
};
