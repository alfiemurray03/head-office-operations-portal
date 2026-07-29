import { cleanNullableText, error, hmac, json, safeEqual } from "../../_shared.js";
import { findCustomer } from "../../_operations.js";
import { ensureV7Schema } from "../../_v7-schema.js";
import { ensureV7Enhancements } from "../../_v7-enhancements.js";
import { ingestSecurityEvent } from "../../_risk-engine.js";
import { processStripeWebhookEvent } from "../../_stripe-control.js";

const MAX_BODY_BYTES = 256_000;
const SIGNATURE_TOLERANCE_SECONDS = 300;

function parseStripeSignature(header = "") {
  const values = {};
  for (const part of header.split(",")) {
    const [key, value] = part.trim().split("=", 2);
    if (!key || !value) continue;
    (values[key] ||= []).push(value);
  }
  return { timestamp: Number(values.t?.[0]), signatures: values.v1 || [] };
}

async function verifyStripeSignature(rawBody, header, secret) {
  const parsed = parseStripeSignature(header);
  if (!Number.isFinite(parsed.timestamp) || parsed.signatures.length === 0) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = await hmac(`${parsed.timestamp}.${rawBody}`, secret);
  return parsed.signatures.some(signature => safeEqual(expected, signature));
}

function metadataCustomerReference(object) {
  const metadata = object?.metadata || {};
  return cleanNullableText(metadata.ucn || metadata.customer_number || metadata.universal_customer_number || metadata.customerNumber, 100);
}

async function resolveCustomer(env, object, transactionReference) {
  const metadataReference = metadataCustomerReference(object);
  if (metadataReference) return findCustomer(env, metadataReference);
  const providerCustomer = typeof object?.customer === "string" ? object.customer : object?.customer?.id;
  if (providerCustomer) {
    const linked = await env.DB.prepare(`SELECT c.* FROM payment_references p
      JOIN customers c ON c.id=p.customer_id WHERE p.provider='Stripe' AND p.provider_customer_reference=?
      ORDER BY p.occurred_at DESC LIMIT 1`).bind(providerCustomer).first();
    if (linked) return linked;
  }
  if (transactionReference) {
    const linked = await env.DB.prepare(`SELECT c.* FROM payment_references p
      JOIN customers c ON c.id=p.customer_id WHERE p.provider='Stripe' AND p.provider_payment_reference=?
      ORDER BY p.occurred_at DESC LIMIT 1`).bind(transactionReference).first();
    if (linked) return linked;
  }
  return null;
}

function paymentFingerprint(object) {
  return object?.payment_method_details?.card?.fingerprint
    || object?.charges?.data?.[0]?.payment_method_details?.card?.fingerprint
    || null;
}

function mapStripeEvent(event) {
  const object = event?.data?.object || {};
  const mappings = {
    "payment_intent.succeeded": ["payment.succeeded", "payment"],
    "payment_intent.payment_failed": ["payment.failed", "payment"],
    "refund.created": ["refund.requested", "refund"],
    "refund.failed": ["refund.failed", "refund"],
    "refund.updated": [object.status === "succeeded" ? "refund.completed" : "refund.updated", "refund"],
    "charge.refunded": ["refund.completed", "refund"],
    "charge.dispute.created": ["chargeback.created", "dispute"],
    "charge.dispute.updated": ["chargeback.updated", "dispute"],
    "charge.dispute.closed": ["chargeback.closed", "dispute"],
    "review.opened": ["payment.review_opened", "payment"],
    "review.closed": ["payment.review_closed", "payment"],
    "invoice.payment_failed": ["payment.failed", "payment"],
    "invoice.paid": ["payment.succeeded", "payment"]
  };
  const mapped = mappings[event?.type];
  if (!mapped) return null;
  const amountMinor = object.amount ?? object.amount_received ?? object.amount_refunded ?? object.amount_paid ?? object.total ?? null;
  const currency = typeof object.currency === "string" ? object.currency.toUpperCase() : null;
  const providerCustomerReference = typeof object.customer === "string" ? object.customer : object.customer?.id || null;
  const providerPaymentReference = object.id || event.id;
  const transactionReference = typeof object.payment_intent === "string" ? object.payment_intent
    : typeof object.charge === "string" ? object.charge
    : object.payment_intent?.id || object.charge?.id || null;
  return {
    eventType: mapped[0],
    category: mapped[1],
    object,
    amountMinor: Number.isFinite(Number(amountMinor)) ? Math.max(0, Math.round(Number(amountMinor))) : null,
    currency,
    providerCustomerReference,
    providerPaymentReference,
    transactionReference,
    externalEventId: event.id,
    occurredAt: Number.isFinite(Number(event.created)) ? new Date(Number(event.created) * 1000).toISOString() : new Date().toISOString()
  };
}

async function storePaymentReference(env, mapped, customer) {
  if (!mapped.providerPaymentReference || mapped.amountMinor == null || !mapped.currency) return;
  const status = ({
    "payment.succeeded": "captured",
    "payment.failed": "failed",
    "refund.requested": "refund_requested",
    "refund.completed": "refunded",
    "refund.failed": "failed",
    "chargeback.created": "disputed",
    "chargeback.updated": "disputed",
    "chargeback.closed": "disputed"
  })[mapped.eventType];
  if (!status) return;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO payment_references
    (id,customer_id,platform_id,provider,provider_customer_reference,provider_payment_reference,currency,amount_minor,status,occurred_at,created_at)
    VALUES (?,?,NULL,'Stripe',?,?,?,?,?,?,?)
    ON CONFLICT(provider,provider_payment_reference) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,payment_references.customer_id),
      provider_customer_reference=COALESCE(excluded.provider_customer_reference,payment_references.provider_customer_reference),
      currency=excluded.currency,amount_minor=excluded.amount_minor,status=excluded.status,occurred_at=excluded.occurred_at`)
    .bind(crypto.randomUUID(), customer?.id || null, mapped.providerCustomerReference, mapped.providerPaymentReference,
      mapped.currency, mapped.amountMinor, status, mapped.occurredAt, now).run();
}

export const onRequestPost = async context => {
  if (!context.env.STRIPE_WEBHOOK_SECRET) return error("STRIPE_WEBHOOK_NOT_CONFIGURED", "The Stripe webhook secret is not configured.", 503);
  const contentLength = Number(context.request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) return error("PAYLOAD_TOO_LARGE", "The webhook payload is too large.", 413);
  const rawBody = await context.request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return error("PAYLOAD_TOO_LARGE", "The webhook payload is too large.", 413);
  const signature = context.request.headers.get("Stripe-Signature") || "";
  if (!await verifyStripeSignature(rawBody, signature, context.env.STRIPE_WEBHOOK_SECRET)) {
    return error("INVALID_STRIPE_SIGNATURE", "The Stripe webhook signature is invalid or stale.", 400);
  }
  let event;
  try { event = JSON.parse(rawBody); }
  catch { return error("INVALID_STRIPE_PAYLOAD", "The Stripe webhook body is not valid JSON.", 400); }
  if (!event?.id || !event?.type || !event?.data?.object?.id) return error("INVALID_STRIPE_EVENT", "The Stripe event is incomplete.", 400);

  try {
    await ensureV7Schema(context.env);
    await ensureV7Enhancements(context.env);
    const operations = await processStripeWebhookEvent(context.env, event, rawBody);
    const mapped = mapStripeEvent(event);
    if (!mapped) return json({ received: true, eventId: event.id, ignoredByRiskEngine: true, operations });

    const customer = await resolveCustomer(context.env, mapped.object, mapped.transactionReference);
    await storePaymentReference(context.env, mapped, customer);
    const fingerprint = paymentFingerprint(mapped.object);
    const fingerprintHash = fingerprint && context.env.RISK_HASH_SECRET
      ? await hmac(`stripe-payment-method:${fingerprint}`, context.env.RISK_HASH_SECRET)
      : null;
    const result = await ingestSecurityEvent(context.env, {
      eventType: mapped.eventType,
      category: mapped.category,
      customerId: customer?.id || null,
      externalEventId: mapped.externalEventId,
      dedupeKey: `stripe:${mapped.externalEventId}`,
      occurredAt: mapped.occurredAt,
      amountMinor: mapped.amountMinor,
      currency: mapped.currency,
      paymentFingerprintHash: fingerprintHash,
      attributes: {
        provider: "Stripe",
        stripeEventType: event.type,
        providerPaymentReference: mapped.providerPaymentReference,
        transactionReference: mapped.transactionReference,
        providerCustomerReference: mapped.providerCustomerReference,
        providerStatus: mapped.object?.status || null,
        outcomeReason: mapped.object?.last_payment_error?.code || mapped.object?.reason || null
      }
    }, { type: "platform", id: "stripe", name: "Stripe" });
    return json({ received: true, eventId: event.id, operations, risk: result.event, duplicate: result.duplicate });
  } catch (cause) {
    console.error(JSON.stringify({ event: "stripe_webhook_processing_failed", stripeEventId: event.id, stripeEventType: event.type, message: cause instanceof Error ? cause.message : "Unknown error" }));
    return error(cause.code || "STRIPE_EVENT_PROCESSING_FAILED", cause.message || "The Stripe event could not be processed.", cause.status || 500);
  }
};
