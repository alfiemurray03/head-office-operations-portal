import { beginMicrosoftLogin } from "../../../_microsoft-auth.js";

function useHostOnlyTransactionCookie(response) {
  const headers = new Headers(response.headers);
  const setCookie = headers.get("Set-Cookie");
  if (setCookie?.startsWith("ho_oidc_tx=")) {
    headers.set("Set-Cookie", `__Host-ho_oidc_tx=${setCookie.slice("ho_oidc_tx=".length)}`);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export const onRequestGet = async ({ request, env }) => {
  try {
    return useHostOnlyTransactionCookie(await beginMicrosoftLogin(request, env));
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : "Microsoft staff sign-in is unavailable.");
    return Response.redirect(`${new URL(request.url).origin}/?auth_error=${message}`, 302);
  }
};