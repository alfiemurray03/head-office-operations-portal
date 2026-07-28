import { finaliseMicrosoftLogin } from "../../../_microsoft-auth.js";

export const onRequestPost = async ({ request, env }) => {
  try {
    return await finaliseMicrosoftLogin(request, env);
  } catch (error) {
    console.error(JSON.stringify({
      event: "microsoft_staff_session_handoff_failed",
      message: error instanceof Error ? error.message : "Unknown authentication error"
    }));
    return new Response(JSON.stringify({
      error: {
        code: "AUTH_HANDOFF_FAILED",
        message: error instanceof Error ? error.message : "Microsoft staff sign-in could not be completed."
      }
    }), {
      status: 401,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
  }
};
