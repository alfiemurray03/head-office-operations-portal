import { cleanText, error, json, readJson } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import {
  createIdentityVerification,
  diditConfiguration,
  listIdentityVerifications,
  randomVerificationCandidates
} from "../_didit-operations.js";

function listValue(value, maximum = 25) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => cleanText(String(item || ""), 120)).filter(Boolean))].slice(0, maximum);
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "security:read");
  if (auth.response) return auth.response;
  try {
    const url = new URL(context.request.url);
    if (url.searchParams.get("mode") === "random_candidates") {
      const candidates = await randomVerificationCandidates(context.env, Number(url.searchParams.get("count") || 5));
      return json({ candidates, configuration: diditConfiguration(context.env) });
    }
    const result = await listIdentityVerifications(context.env, {
      q: url.searchParams.get("q") || "",
      status: url.searchParams.get("status") || "",
      purpose: url.searchParams.get("purpose") || "",
      customerId: url.searchParams.get("customerId") || url.searchParams.get("customerNumber") || ""
    });
    return json(result);
  } catch (cause) {
    return error(cause.code || "IDENTITY_VERIFICATION_LIST_FAILED", cause.message || "Identity-verification records could not be loaded.", cause.status || 500);
  }
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "security:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 128_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  const action = cleanText(body.action || "start", 40).toLowerCase();
  try {
    if (action === "random_preview") {
      const candidates = await randomVerificationCandidates(context.env, Number(body.count || 5));
      return json({ candidates, configuration: diditConfiguration(context.env) });
    }

    if (action === "random_commit") {
      const customerIds = listValue(body.customerIds, 25);
      if (!customerIds.length) return error("RANDOM_SELECTION_EMPTY", "Select at least one customer before starting random verification requests.");
      if (cleanText(body.confirmation, 80) !== "START RANDOM CHECKS") {
        return error("RANDOM_SELECTION_CONFIRMATION_REQUIRED", "Enter START RANDOM CHECKS to confirm the selected identity-verification requests.");
      }
      const results = [];
      const failures = [];
      for (const customerId of customerIds) {
        try {
          const result = await createIdentityVerification(context.env, auth.session, {
            customerId,
            purpose: "random_selection",
            accessMode: cleanText(body.accessMode || "request_only", 40),
            scope: cleanText(body.scope || "company_wide", 120),
            reason: cleanText(body.reason || "Selected through the controlled random customer identity-confirmation programme.", 2000),
            source: "random_selection",
            sendNotificationEmails: Boolean(body.sendNotificationEmails)
          });
          results.push(result);
        } catch (cause) {
          failures.push({ customerId, code: cause.code || "VERIFICATION_START_FAILED", message: cause.message || "The request could not be started." });
        }
      }
      return json({ started: results.length, failed: failures.length, results, failures }, failures.length && !results.length ? 400 : 201);
    }

    if (action !== "start") return error("INVALID_VERIFICATION_ACTION", "Select a valid identity-verification action.");
    const result = await createIdentityVerification(context.env, auth.session, {
      customerId: body.customerId,
      customerNumber: body.customerNumber,
      purpose: body.purpose,
      accessMode: body.accessMode,
      scope: body.scope || body.platformId,
      reason: body.reason,
      source: cleanText(body.source || "manual", 60),
      sendNotificationEmails: Boolean(body.sendNotificationEmails)
    });
    return json(result, 201);
  } catch (cause) {
    return error(cause.code || "IDENTITY_VERIFICATION_START_FAILED", cause.message || "The identity-verification request could not be started.", cause.status || 500);
  }
};
