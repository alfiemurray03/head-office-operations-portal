import { finaliseMicrosoftLogin } from "../../../_microsoft-auth.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    return await finaliseMicrosoftLogin(request, env);
  } catch (error) {
    console.error(JSON.stringify({
      event: "microsoft_staff_session_handoff_failed",
      message: error instanceof Error ? error.message : "Unknown authentication error"
    }));
    const message = encodeURIComponent(error instanceof Error ? error.message : "Microsoft staff sign-in could not be completed.");
    return new Response(null, {
      status: 303,
      headers: {
        Location: `${new URL(request.url).origin}/?auth_error=${message}`,
        "Cache-Control": "no-store"
      }
    });
  }
};
