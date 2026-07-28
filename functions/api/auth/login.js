import { createSession, error, json, safeEqual, audit, cleanText } from "../../_shared.js";

export const onRequestPost = async ({ request, env }) => {
  if (!env.LOCAL_ADMIN_USERNAME || !env.LOCAL_ADMIN_PASSWORD || !env.SESSION_SECRET || !env.DB) {
    return error("LOCAL_AUTH_NOT_CONFIGURED", "Local staff sign-in has not been configured.", 503);
  }
  const body = await request.json().catch(() => ({}));
  const username = cleanText(body.username, 100);
  const password = typeof body.password === "string" ? body.password : "";
  if (!safeEqual(username, env.LOCAL_ADMIN_USERNAME) || !safeEqual(password, env.LOCAL_ADMIN_PASSWORD)) {
    return error("INVALID_CREDENTIALS", "The username or password is incorrect.", 401);
  }
  const user = { id: "local-administrator", username, displayName: env.LOCAL_ADMIN_DISPLAY_NAME || "Local Administrator", roleName: "System Administrator" };
  const token = await createSession(user, env);
  await audit(env, user, "auth.login", "staff_session", user.id, { label: "Local staff sign-in" });
  return json({ user: { displayName: user.displayName, roleName: user.roleName } }, 200, {
    "Set-Cookie": `ho_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800`
  });
};
