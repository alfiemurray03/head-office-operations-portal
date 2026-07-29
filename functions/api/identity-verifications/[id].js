import { cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import {
  cancelIdentityVerification,
  refreshIdentityVerification,
  resumeIdentityVerification
} from "../../_didit-operations.js";

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "security:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 32_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const action = cleanText(body.action, 40).toLowerCase();
  try {
    if (action === "refresh") return json(await refreshIdentityVerification(context.env, auth.session, context.params.id));
    if (action === "resume") return json(await resumeIdentityVerification(context.env, auth.session, context.params.id));
    if (action === "cancel") return json(await cancelIdentityVerification(context.env, auth.session, context.params.id, body.reason));
    return error("INVALID_VERIFICATION_ACTION", "Select refresh, resume or cancel.");
  } catch (cause) {
    return error(cause.code || "IDENTITY_VERIFICATION_ACTION_FAILED", cause.message || "The identity-verification action could not be completed.", cause.status || 500);
  }
};
