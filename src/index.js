const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin"
};

function json(data, status = 200) {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const requestId = crypto.randomUUID();

    try {
      if (url.pathname === "/api/health" && request.method === "GET") {
        return json({
          ok: true,
          service: "JA Group Services Head Office Operations Portal",
          environment: env.APP_ENV,
          version: "0.1.0",
          requestId
        });
      }

      if (url.pathname.startsWith("/api/")) {
        return json({
          error: {
            code: "API_NOT_AVAILABLE",
            message: "This endpoint is not available in the Version 1 preview.",
            requestId
          }
        }, 404);
      }

      const response = await env.ASSETS.fetch(request);
      const secured = new Response(response.body, response);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        secured.headers.set(name, value);
      }
      if (response.headers.get("Content-Type")?.includes("text/html")) {
        secured.headers.set("Cache-Control", "no-store");
      }
      return secured;
    } catch (error) {
      console.error(JSON.stringify({
        level: "error",
        event: "request_failed",
        requestId,
        path: url.pathname,
        message: error instanceof Error ? error.message : "Unknown error"
      }));
      return json({
        error: {
          code: "INTERNAL_ERROR",
          message: "The request could not be completed.",
          requestId
        }
      }, 500);
    }
  }
};
