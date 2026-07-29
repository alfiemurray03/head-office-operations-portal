import { error, json, safeEqual } from "../../../_shared.js";
import { processDueAutomationSchedules } from "../../../_automation-scheduler.js";

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() : "";
}

export const onRequestPost = async context => {
  const expected = String(context.env.AUTOMATION_SECRET || "").trim();
  const supplied = bearerToken(context.request);
  if (!expected || !supplied || !safeEqual(expected, supplied)) {
    return error("AUTOMATION_AUTHENTICATION_REQUIRED", "The automation credential is missing or invalid.", 401);
  }
  try {
    const result = await processDueAutomationSchedules(context.env, context.data.requestId);
    return json({ ok: true, ...result });
  } catch (cause) {
    return error(cause.code || "AUTOMATION_SCHEDULER_FAILED", cause.message || "The automation scheduler cycle failed.", cause.status || 502, cause.details);
  }
};
