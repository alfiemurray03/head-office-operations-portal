import { error, json } from "../../_shared.js";
import {
  acceptDiditWebhook,
  ensureDiditWebhookSchema,
  markDiditWebhookFailed,
  processDiditWebhook,
  verifyDiditWebhookRequest
} from "../../_didit-webhook.js";

function methodNotAllowed() {
  return error("METHOD_NOT_ALLOWED", "Only GET, HEAD and POST are supported.", 405);
}

export const onRequestGet = async context => {
  try {
    await ensureDiditWebhookSchema(context.env);
    return json({
      service: "didit_identity_verification_webhook",
      status: "ready",
      webhookVersion: "v3",
      subscribedEvent: "status.updated"
    }, 200, { Allow: "GET, HEAD, POST" });
  } catch {
    return error("DIDIT_WEBHOOK_UNAVAILABLE", "The identity-verification webhook endpoint is unavailable.", 503);
  }
};

export const onRequestHead = async context => {
  const response = await onRequestGet(context);
  return new Response(null, { status: response.status, headers: response.headers });
};

export const onRequestPost = async context => {
  let verified;
  try {
    verified = await verifyDiditWebhookRequest(context.request, context.env);
  } catch (cause) {
    return error(cause.code || "DIDIT_WEBHOOK_REJECTED", cause.message || "The Didit webhook could not be verified.", cause.status || 401);
  }

  let accepted;
  try {
    accepted = await acceptDiditWebhook(context.env, verified);
  } catch (cause) {
    return error("DIDIT_WEBHOOK_STORAGE_FAILED", "The verified Didit event could not be recorded safely.", 503, {
      retryable: true,
      message: cause instanceof Error ? cause.message : "Database write failed."
    });
  }

  if (!accepted.accepted) {
    return json({ received: true, duplicate: true, eventId: accepted.eventId }, 200);
  }

  const work = processDiditWebhook(context.env, verified).catch(async cause => {
    await markDiditWebhookFailed(context.env, accepted.eventId, cause);
    console.error(JSON.stringify({
      event: "didit_webhook_processing_failed",
      eventId: accepted.eventId,
      sessionId: verified.sessionId,
      message: cause instanceof Error ? cause.message : "Unknown Didit processing error"
    }));
  });

  if (typeof context.waitUntil === "function") context.waitUntil(work);
  else await work;

  return json({ received: true, accepted: true, eventId: accepted.eventId }, 202);
};

export const onRequest = async context => {
  if (context.request.method === "GET") return onRequestGet(context);
  if (context.request.method === "HEAD") return onRequestHead(context);
  if (context.request.method === "POST") return onRequestPost(context);
  return methodNotAllowed();
};
