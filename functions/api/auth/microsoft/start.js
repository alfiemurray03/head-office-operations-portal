import { beginMicrosoftLogin } from "../../../_microsoft-auth.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    return await beginMicrosoftLogin(request, env);
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : "Microsoft staff sign-in is unavailable.");
    return Response.redirect(`${new URL(request.url).origin}/?auth_error=${message}`, 302);
  }
};
