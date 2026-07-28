import { securityHeaders, json } from "./_shared.js";

export const onRequest = async context => {
  const requestId = crypto.randomUUID();
  context.data.requestId = requestId;
  try {
    const response = await context.next();
    const secured = new Response(response.body, response);
    for (const [name, value] of Object.entries(securityHeaders)) secured.headers.set(name, value);
    secured.headers.set("X-Request-ID", requestId);
    if (new URL(context.request.url).pathname.startsWith("/api/")) secured.headers.set("Cache-Control", "no-store");
    return secured;
  } catch (cause) {
    console.error(JSON.stringify({ event: "request_failed", requestId, path: new URL(context.request.url).pathname, message: cause instanceof Error ? cause.message : "Unknown error" }));
    return json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed.", requestId } }, 500);
  }
};
