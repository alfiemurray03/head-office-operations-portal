import { cleanText, error, json, platformAudit, readJson, requirePlatform } from "../../../_shared.js";
import { centralPaymentError, ensureCentralPaymentsSchema } from "../../../_central-payments.js";

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["payments:status"]);
  if (auth.response) return auth.response;
  try {
    await ensureCentralPaymentsSchema(context.env);
    const url = new URL(context.request.url);
    const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 50, 100));
    const result = await context.env.DB.prepare(`SELECT id,event_type,central_reference,payload_json,created_at
      FROM central_payment_event_outbox
      WHERE platform_id=? AND status='pending'
      ORDER BY created_at ASC LIMIT ?`).bind(auth.platform.id, limit).all();
    return json({
      events: (result.results || []).map(row => ({
        id: row.id,
        eventType: row.event_type,
        reference: row.central_reference,
        createdAt: row.created_at,
        payload: (() => { try { return JSON.parse(row.payload_json || "{}"); } catch { return {}; } })(),
      })),
    });
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments events could not be read.");
  }
};

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["payments:status"]);
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 16_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    await ensureCentralPaymentsSchema(context.env);
    const eventIds = Array.isArray(body.eventIds)
      ? [...new Set(body.eventIds.map(value => cleanText(value, 80)).filter(Boolean))].slice(0, 100)
      : [];
    if (!eventIds.length) return error("EVENT_IDS_REQUIRED", "Provide one or more Central Payments event IDs to acknowledge.", 400);
    const now = new Date().toISOString();
    let acknowledged = 0;
    for (const eventId of eventIds) {
      const result = await context.env.DB.prepare(`UPDATE central_payment_event_outbox
        SET status='acknowledged',acknowledged_at=?
        WHERE id=? AND platform_id=? AND status='pending'`).bind(now, eventId, auth.platform.id).run();
      acknowledged += Number(result.meta?.changes || 0);
    }
    await platformAudit(context.env, auth.platform, "central_payment.events.acknowledge", "central_payment_event_outbox", auth.platform.id, {
      label: "Connected platform acknowledged Central Payments events",
      reference: auth.platform.code,
      requestId: context.data.requestId,
      metadata: { requested: eventIds.length, acknowledged },
    });
    return json({ acknowledged });
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments events could not be acknowledged.");
  }
};
