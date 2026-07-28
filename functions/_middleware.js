import { json, securityHeaders } from "./_shared.js";

export const onRequest = async context => {
  const requestId = crypto.randomUUID();
  context.data.requestId = requestId;
  const pathname = new URL(context.request.url).pathname;

  try {
    const response = await context.next();

    // The Microsoft endpoints issue and clear authentication cookies themselves.
    // Returning those responses unchanged avoids header normalisation breaking the
    // OIDC transaction or authenticated staff session.
    if (pathname.startsWith("/api/auth/microsoft/")) return response;

    const setCookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : (response.headers.get("Set-Cookie") ? [response.headers.get("Set-Cookie")] : []);
    const headers = new Headers(response.headers);
    headers.delete("Set-Cookie");
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    headers.set("X-Request-ID", requestId);
    headers.set("Cache-Control", "no-store");

    const secured = new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
    for (const value of setCookies) secured.headers.append("Set-Cookie", value);
    return secured;
  } catch (cause) {
    console.error(JSON.stringify({
      event: "request_failed",
      requestId,
      method: context.request.method,
      path: pathname,
      message: cause instanceof Error ? cause.message : "Unknown error"
    }));
    return json({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId
      }
    }, 500, { "X-Request-ID": requestId });
  }
};
