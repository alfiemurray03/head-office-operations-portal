const SETTINGS_LISTENER = '$("#settingsForm").addEventListener("submit", async event => {';

function repairStartupOrder(source) {
  const finalBootCall = /\nboot\(\);\s*$/;
  if (!source.includes(SETTINGS_LISTENER) || !finalBootCall.test(source)) return source;

  return source
    .replace(finalBootCall, "\n")
    .replace(SETTINGS_LISTENER, `boot();\n\n${SETTINGS_LISTENER}`);
}

export const onRequestGet = async ({ request, env }) => {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/app.js";
  assetUrl.search = "";

  const assetResponse = await env.ASSETS.fetch(new Request(assetUrl, request));
  if (!assetResponse.ok) return assetResponse;

  const source = await assetResponse.text();
  const headers = new Headers(assetResponse.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  headers.delete("ETag");
  headers.set("Content-Type", "text/javascript; charset=UTF-8");
  headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  headers.set("Pragma", "no-cache");
  headers.set("Expires", "0");
  headers.set("X-Client-Revision", "microsoft-login-startup-v8");

  return new Response(repairStartupOrder(source), {
    status: 200,
    headers
  });
};
