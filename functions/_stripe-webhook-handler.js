import { cleanNullableText, error, hmac, json } from "./_shared.js";
import { findCustomer } from "./_operations.js";
import { ensureV7Schema } from "./_v7-schema.js";
import { ensureV7Enhancements } from "./_v7-enhancements.js";
import { ingestSecurityEvent } from "./_risk-engine.js";
import { processStripeWebhookEvent, resolveStripeConnector, verifyStripeWebhook } from "./_stripe-control.js";

const MAX_BODY_BYTES = 256_000;

function metadataCustomerReference(object) {
  const metadata = object?.metadata || {};
  return cleanNullableText(metadata.ucn || metadata.customer_number || metadata.universal_customer_number || metadata.customerNumber, 100);
}

async function resolveCustomer(env, connector, object, transactionReference) {
  const metadataReference = metadataCustomerReference(object);
  if (metadataReference) return findCustomer(env, metadataReference);
  const provider = `Stripe:${connector.code}`;
  const providerCustomer = typeof object?.customer === "string" ? object.customer : object?.customer?.id;
  if (providerCustomer) {
    const linked = await env.DB.prepare(`SELECT c.* FROM payment_references p
      JOIN customers c ON c.id=p.customer_id WHERE p.provider=? AND p.provider_customer_reference=?
      ORDER BY p.occurred_at DESC LIMIT 1`).bind(provider, providerCustomer).first();
    if (linked) return linked;
  }
  if (transactionReference) {
    const linked = await env.DB.prepare(`SELECT c.* FROM payment_references p
      JOIN customers c ON c.id=p.customer_id WHERE p.provider=? AND p.provider_payment_reference=?
      ORDER BY p.occurred_at DESC LIMIT 1`).bind(provider, transactionReference).first();
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
    "charge.refunded": ["refund.completed", "refund"],
    "charge.dispute.created": ["chargeback.created", "dispute"],
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

async function storePaymentReference(env, connector, mapped, customer) {
  if (!mapped.providerPaymentReference || mapped.amountMinor == null || !mapped.currency) return;
  const status = ({
    "payment.succeeded": "captured",
    "payment.failed": "failed",
    "refund.completed": "refunded",
    "chargeback.created": "disputed"
  })[mapped.eventType];
  if (!status) return;
  const provider = `Stripe:${connector.code}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO payment_references
    (id,customer_id,platform_id,provider,provider_customer_reference,provider_payment_reference,currency,amount_minor,status,occurred_at,created_at)
    VALUES (?,?,NULL,?,?,?,?,?,?,?,?)
    ON CONFLICT(provider,provider_payment_reference) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,payment_references.customer_id),
      provider_customer_reference=COALESCE(excluded.provider_customer_reference,payment_references.provider_customer_reference),
      currency=excluded.currency,amount_minor=excluded.amount_minor,status=excluded.status,occurred_at=excluded.occurred_at`)
    .bind(crypto.randomUUID(), customer?.id || null, provider, mapped.providerCustomerReference,
      mapped.providerPaymentReference, mapped.currency, mapped.amountMinor, status, mapped.occurredAt, now).run();
}

export async function handleStripeWebhook(context, division) {
  let connector;
  try {
    connector = resolveStripeConnector(context.env, division);
  } catch (cause) {
    return error(cause.code || "STRIPE_DIVISION_NOT_FOUND", cause.message, cause.status || 404);
  }

  const contentLength = Number(context.request.headers.get("Content-Length") || 0);
  if (contentLength > MAX_BODY_BYTES) return error("PAYLOAD_TOO_LARGE", "The webhook payload is too large.", 413);
  const rawBody = await context.request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return error("PAYLOAD_TOO_LARGE", "The webhook payload is too large.", 413);

  try {
    await verifyStripeWebhook(rawBody, context.request.headers.get("Stripe-Signature") || "", connector);
  } catch (cause) {
    return error(cause.code || "INVALID_STRIPE_SIGNATURE", cause.message || "The Stripe webhook signature is invalid or stale.", cause.status || 400);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return error("INVALID_STRIPE_PAYLOAD", "The Stripe webhook body is not valid JSON.", 400);
  }
  if (!event?.id || !event?.type || !event?.data?.object?.id) {
    return error("INVALID_STRIPE_EVENT", "A complete Stripe Snapshot event is required. Thin event payloads are not accepted by this endpoint.", 400);
  }

  try {
    await ensureV7Schema(context.env);
    await ensureV7Enhancements(context.env);
    const operations = await processStripeWebhookEvent(context.env, connector, event, rawBody);
    const mapped = mapStripeEvent(event);
    if (!mapped) {
      return json({ received: true, division: connector.slug, eventId: event.id, ignoredByRiskEngine: true, operations });
    }

    const customer = await resolveCustomer(context.env, connector, mapped.object, mapped.transactionReference);
    await storePaymentReference(context.env, connector, mapped, customer);
    const fingerprint = paymentFingerprint(mapped.object);
    const fingerprintHash = fingerprint && context.env.RISK_HASH_SECRET
      ? await hmac(`stripe-payment-method:${connector.code}:${fingerprint}`, context.env.RISK_HASH_SECRET)
      : null;
    const result = await ingestSecurityEvent(context.env, {
      eventType: mapped.eventType,
      category: mapped.category,
      customerId: customer?.id || null,
      externalEventId: `${connector.code}:${mapped.externalEventId}`,
      dedupeKey: `stripe:${connector.code}:${mapped.externalEventId}`,
      occurredAt: mapped.occurredAt,
      amountMinor: mapped.amountMinor,
      currency: mapped.currency,
      paymentFingerprintHash: fingerprintHash,
      attributes: {
        provider: "Stripe",
        stripeDivision: connector.code,
        stripeEventType: event.type,
        providerPaymentReference: mapped.providerPaymentReference,
        transactionReference: mapped.transactionReference,
        providerCustomerReference: mapped.providerCustomerReference,
        providerStatus: mapped.object?.status || null,
        outcomeReason: mapped.object?.last_payment_error?.code || mapped.object?.reason || null
      }
    }, { type: "platform", id: `stripe-${connector.slug}`, name: `Stripe · ${connector.name}` });

    return json({
      received: true,
      division: connector.slug,
      eventId: event.id,
      operations,
      risk: result.event,
      duplicate: result.duplicate
    });
  } catch (cause) {
    console.error(JSON.stringify({
      event: "stripe_webhook_processing_failed",
      stripeDivision: connector.code,
      stripeEventId: event.id,
      stripeEventType: event.type,
      message: cause instanceof Error ? cause.message : "Unknown error"
    }));
    return error(cause.code || "STRIPE_EVENT_PROCESSING_FAILED", cause.message || "The Stripe event could not be processed.", cause.status || 500);
  }
}
