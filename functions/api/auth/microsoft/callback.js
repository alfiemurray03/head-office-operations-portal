import { completeMicrosoftLogin } from "../../../_microsoft-auth.js";
import { consumeMicrosoftTransaction } from "../../../_microsoft-transaction-store.js";

const HOST_TRANSACTION_COOKIE = "__Host-ho_oidc_tx";
const LEGACY_TRANSACTION_COOKIE = "ho_oidc_tx";
const HOST_SESSION_COOKIE = "__Host-ho_session";
const LEGACY_SESSION_COOKIE = "ho_session";

function cookieParts(request) {
  return (request.headers.get("Cookie") || "")
    .split(";")
    .map(value => value.trim())
    .filter(Boolean);
}

async function requestWithCanonicalTransactionCookie(request, env) {
  const cookies = cookieParts(request);
  const state = new URL(request.url).searchParams.get("state") || "";
  let transactionValue = "";

  // D1 recovery is optional. A database problem must not prevent the normal
  // secure host-only transaction cookie from completing the Microsoft login.
  try {
    transactionValue = await consumeMicrosoftTransaction(env, state);
  } catch (error) {
    console.error(JSON.stringify({
      event: "microsoft_transaction_recovery_unavailable",
      message: error instanceof Error ? error.message : "Unknown transaction-recovery error"
    }));
  }

  if (!transactionValue) {
    const legacyTransaction = cookies.find(value => value.startsWith(`${LEGACY_TRANSACTION_COOKIE}=`));
    const hostTransaction = cookies.find(value => value.startsWith(`${HOST_TRANSACTION_COOKIE}=`));
    transactionValue = legacyTransaction
      ? legacyTransaction.slice(LEGACY_TRANSACTION_COOKIE.length + 1)
      : (hostTransaction ? hostTransaction.slice(HOST_TRANSACTION_COOKIE.length + 1) : "");
  }

  if (!transactionValue) return request;
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

  // Edge has previously returned from Microsoft without exposing the fragment
  // hand-off to the portal boot code. Mirror the signed session into the query
  // string as a one-time transport; boot.js immediately removes it from the URL.
  const location = headers.get("Location");
  if (location) {
    const redirect = new URL(location);
    const fragment = new URLSearchParams(redirect.hash.startsWith("#") ? redirect.hash.slice(1) : redirect.hash);
    const session = fragment.get("auth_session");
    if (session) {
      redirect.searchParams.set("auth_session", session);
      redirect.searchParams.set("auth_result", "success");
      redirect.hash = "#/security-operations";
      headers.set("Location", redirect.toString());
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function authenticationErrorResponse(request, error) {
  const message = error instanceof Error ? error.message : "Microsoft staff sign-in could not be completed.";
  const origin = new URL(request.url).origin;
  const body = `<!doctype html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <title>Microsoft sign-in could not be completed</title>
  <style>
    :root{font-family:Segoe UI,system-ui,sans-serif;color:#fff;background:#08162a}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 70% 20%,#123766,transparent 35%),#08162a}
    main{width:min(620px,100%);padding:34px;border:1px solid #294563;border-radius:18px;background:#0e2038;box-shadow:0 24px 70px rgba(0,0,0,.35)}
    p{color:#c3d0e3;line-height:1.6}strong{display:block;margin-bottom:10px;color:#9fc5ff;text-transform:uppercase;letter-spacing:.08em;font-size:12px}h1{margin:0 0 14px;font-size:30px}a{display:inline-flex;margin-top:12px;padding:11px 16px;border-radius:7px;background:#2563eb;color:#fff;text-decoration:none;font-weight:700}
    code{display:block;margin-top:18px;padding:12px;border-radius:8px;background:#09182b;color:#ffd7d7;white-space:pre-wrap}
  </style>
</head>
<body>
  <main>
    <strong>Head Office Operations &amp; Security Portal</strong>
    <h1>Microsoft sign-in could not be completed</h1>
    <p>The portal has stopped the failed sign-in instead of silently returning you to the login screen.</p>
    <code>${escapeHtml(message)}</code>
    <a href="${escapeHtml(origin)}/">Try Microsoft sign-in again</a>
  </main>
</body>
</html>`;
  return new Response(body, {
    status: 401,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export const onRequestGet = async ({ request, env }) => {
  try {
    const canonicalRequest = await requestWithCanonicalTransactionCookie(request, env);
    return useHostOnlySessionCookie(await completeMicrosoftLogin(canonicalRequest, env));
  } catch (error) {
    console.error(JSON.stringify({
      event: "microsoft_staff_callback_failed",
      message: error instanceof Error ? error.message : "Unknown authentication error"
    }));
    return authenticationErrorResponse(request, error);
  }
};