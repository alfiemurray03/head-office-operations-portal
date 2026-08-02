import { assertSameOrigin, error, getSession, json, readJson } from "../../_shared.js";
import {
  configurePrincipalPin,
  getPrincipalPinStatus,
  verifyPrincipalPin
} from "../../_principal-pin.js";

async function authenticatedSession(request, env) {
  const session = await getSession(request, env);
  if (!session) {
    throw Object.assign(new Error("Your Microsoft-authenticated Head Office session is not valid."), {
      code: "AUTHENTICATION_REQUIRED",
      status: 401
    });
  }
  return session;
}

export const onRequestGet = async ({ request, env }) => {
  try {
    const session = await authenticatedSession(request, env);
    return json({ pin: await getPrincipalPinStatus(env, session) });
  } catch (cause) {
    return error(cause.code || "PIN_STATUS_FAILED", cause.message || "The PIN status could not be checked.", cause.status || 500, cause.details);
  }
};

export const onRequestPost = async ({ request, env }) => {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;
  try {
    const session = await authenticatedSession(request, env);
    const body = await readJson(request, 4_096);
    const action = String(body.action || "").trim().toLowerCase();
    let result;
    if (action === "setup") result = await configurePrincipalPin(env, request, session, body.pin);
    else if (action === "verify") result = await verifyPrincipalPin(env, request, session, body.pin);
    else return error("INVALID_PIN_ACTION", "Choose either setup or verify.", 400);
    return json({ ok: true, pin: { ...await getPrincipalPinStatus(env, { ...session, pinVerifiedAt: result.verifiedAt }), ...result } });
  } catch (cause) {
    return error(cause.code || "PIN_ACTION_FAILED", cause.message || "The PIN action could not be completed.", cause.status || 500, cause.details);
  }
};
