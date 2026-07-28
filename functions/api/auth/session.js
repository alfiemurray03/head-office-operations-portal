import { getSession, json } from "../../_shared.js";

export const onRequestGet = async ({ request, env }) => {
  const configured = Boolean(env.LOCAL_ADMIN_USERNAME && env.LOCAL_ADMIN_PASSWORD && env.SESSION_SECRET && env.DB);
  const session = configured ? await getSession(request, env) : null;
  return json({
    configured,
    authenticated: Boolean(session),
    user: session ? { displayName: session.displayName, roleName: session.roleName } : null
  });
};
