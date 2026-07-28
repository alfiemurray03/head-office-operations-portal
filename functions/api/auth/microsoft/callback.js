import { completeMicrosoftLogin } from "../../../_microsoft-auth.js";

const HOST_TRANSACTION_COOKIE = "__Host-ho_oidc_tx";
const LEGACY_TRANSACTION_COOKIE = "ho_oidc_tx";
const HOST_SESSION_COOKIE = "__Host-ho_session";
const LEGACY_SESSION_COOKIE = "ho_session";

function requestWithCanonicalTransactionCookie(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = cookieHeader.split(";").map(value => value.trim()).filter(Boolean);
  const hostTransaction = cookies.find(value => value.startsWith(`${HOST_TRANSACTION_COOKIE}=`));
  if (!hostTransaction) return request;

  const transactionValue = hostTransaction.slice(HOST_TRANSACTION_COOKIE.length + 1);
  const headers = new Headers(request.headers);
  headers.set("Cookie", [
    `${LEGACY_TRANSACTION_COOKIE}=${transactionValue}`,
    ...cookies.filter(value => !value.startsWith(`${LEGACY_TRANSACTION_COOKIE}=`))
  ].join("; "));
  return new Request(request, { headers });
}

function useHostOnlySessionCookie(response) {
  const originalHeaders = response.headers;
  const setCookies = typeof originalHeaders.getSetCookie === "function"
    ? originalHeaders.getSetCookie()
    : (originalHeaders.get("Set-Cookie") ? [originalHeaders.get("Set-Cookie")] : []);
  const headers = new Headers(originalHeaders);
  headers.delete("Set-Cookie");

  for (const value of setCookies) {
    const rewritten = value.startsWith(`${LEGACY_SESSION_COOKIE}=`)
      ? `${HOST_SESSION_COOKIE}=${value.slice(LEGACY_SESSION_COOKIE.length + 1)}`
      : value;
    headers.append("Set-Cookie", rewritten);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export const onRequestGet = async ({ request, env }) => {
  try {
    const canonicalRequest = requestWithCanonicalTransactionCookie(request);
    return useHostOnlySessionCookie(await completeMicrosoftLogin(canonicalRequest, env));
  } catch (error) {
    console.error(JSON.stringify({
      event: "microsoft_staff_callback_failed",
      message: error instanceof Error ? error.message : "Unknown authentication error"
    }));
    const message = encodeURIComponent(error instanceof Error ? error.message : "Microsoft staff sign-in could not be completed.");
    return Response.redirect(`${new URL(request.url).origin}/?auth_error=${message}`, 302);
  }
};