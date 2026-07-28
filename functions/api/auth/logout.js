import { getSession, json, audit } from "../../_shared.js";

export const onRequestPost = async ({ request, env }) => {
  const session = await getSession(request, env);
  if (session) await audit(env, session, "auth.logout", "staff_session", session.sub, { label: "Staff sign-out" });
  return json({ ok: true }, 200, { "Set-Cookie": "ho_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
};
