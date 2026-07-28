import { completeMicrosoftLogin } from "../../../_microsoft-auth.js";

export const onRequestGet = async ({ request, env }) => {
  try {
    return await completeMicrosoftLogin(request, env);
  } catch (error) {
    console.error(JSON.stringify({
      event: "microsoft_staff_callback_failed",
      message: error instanceof Error ? error.message : "Unknown authentication error"
    }));
    const message = encodeURIComponent(error instanceof Error ? error.message : "Microsoft staff sign-in could not be completed.");
    return Response.redirect(`${new URL(request.url).origin}/?auth_error=${message}`, 302);
  }
};
