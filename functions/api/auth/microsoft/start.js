import { beginMicrosoftLogin } from "../../../_microsoft-auth.js";
import { storeMicrosoftTransaction } from "../../../_microsoft-transaction-store.js";

function transactionTokenFromResponse(response) {
  const value = response.headers.get("Set-Cookie") || "";
  const match = value.match(/(?:^|;\s*)ho_oidc_tx=([^;]+)/);
  if (!match) return "";
  try { return decodeURIComponent(match[1]); }
  catch { return match[1]; }
}

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
    const response = await beginMicrosoftLogin(request, env);
    const location = response.headers.get("Location");
    const state = location ? new URL(location).searchParams.get("state") : "";
    const transactionToken = transactionTokenFromResponse(response);

    // The secure browser cookie is sufficient to start sign-in. D1 persistence
    // is extra resilience only and must never prevent the Microsoft redirect.
    try {
      await storeMicrosoftTransaction(env, state, transactionToken);
    } catch (error) {
      console.error(JSON.stringify({
        event: "microsoft_transaction_store_unavailable",
        message: error instanceof Error ? error.message : "Unknown transaction-store error"
      }));
    }

    return useHostOnlyTransactionCookie(response);
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : "Microsoft staff sign-in is unavailable.");
    return Response.redirect(`${new URL(request.url).origin}/?auth_error=${message}`, 302);
  }
};