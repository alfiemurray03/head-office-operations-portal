import { cleanText, validEmail } from "./_shared.js";

const textEncoder = new TextEncoder();

const STRIPE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,livemode INTEGER NOT NULL DEFAULT 0,api_version TEXT,
    object_id TEXT,customer_reference TEXT,processing_status TEXT NOT NULL DEFAULT 'received',payload_hash TEXT NOT NULL,
    received_at TEXT NOT NULL,processed_at TEXT,error_message TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_customer_links (
    stripe_customer_id TEXT PRIMARY KEY,customer_id TEXT,customer_number TEXT,email TEXT,name TEXT,
    livemode INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_payment_records (
    stripe_object_id TEXT PRIMARY KEY,object_type TEXT NOT NULL,event_type TEXT NOT NULL,customer_id TEXT,customer_number TEXT,
    stripe_customer_id TEXT,platform_code TEXT,status TEXT,amount_minor INTEGER,currency TEXT,description TEXT,receipt_email TEXT,
    occurred_at TEXT NOT NULL,updated_at TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_order_records (
    stripe_object_id TEXT PRIMARY KEY,customer_id TEXT,customer_number TEXT,stripe_customer_id TEXT,platform_code TEXT,status TEXT,
    payment_status TEXT,amount_total_minor INTEGER,currency TEXT,customer_email TEXT,occurred_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_subscription_records (
    stripe_subscription_id TEXT PRIMARY KEY,customer_id TEXT,customer_number TEXT,stripe_customer_id TEXT,platform_code TEXT,
    status TEXT NOT NULL,price_id TEXT,product_id TEXT,quantity INTEGER,current_period_start TEXT,current_period_end TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,cancelled_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  )`
];

export async function ensureStripeControlSchema(env) {
  for (const statement of STRIPE_SCHEMA) await env.DB.prepare(statement).run();
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value) {
  return toHex(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
}

function constantTimeEqual(left, right) {
  const a = String(left || "").toLowerCase();
  const b = String(right || "").toLowerCase();
  if (a.length !== b.length) return false;
  let result = 0;
  for (let index = 0; index < a.length; index += 1) result |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return result === 0;
}

function parseStripeSignature(value) {
  const result = { timestamp: null, signatures: [] };
  for (const item of String(value || "").split(",")) {
    const [key, token] = item.split("=", 2);
    if (key === "t" && /^\d+$/.test(token || "")) result.timestamp = Number(token);
    if (key === "v1" && /^[a-f0-9]{64}$/i.test(token || "")) result.signatures.push(token.toLowerCase());
  }
  return result;
}

export async function verifyStripeWebhook(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  const webhookSecret = String(secret || "");
  if (!webhookSecret) throw Object.assign(new Error("STRIPE_WEBHOOK_SECRET is not configured."), { code: "STRIPE_WEBHOOK_NOT_CONFIGURED", status: 503 });
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed.timestamp || !parsed.signatures.length) throw Object.assign(new Error("The Stripe-Signature header is missing or invalid."), { code: "STRIPE_SIGNATURE_MISSING", status: 400 });
  const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
  if (age > toleranceSeconds) throw Object.assign(new Error("The Stripe webhook timestamp is outside the permitted replay window."), { code: "STRIPE_SIGNATURE_EXPIRED", status: 400 });
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, textEncoder.encode(`${parsed.timestamp}.${rawBody}`)));
  if (!parsed.signatures.some(signature => constantTimeEqual(signature, expected))) {
    throw Object.assign(new Error("Stripe webhook signature verification failed."), { code: "STRIPE_SIGNATURE_INVALID", status: 400 });
  }
  return { signatureVersion: "v1", timestamp: parsed.timestamp, ageSeconds: age };
}

function metadataOf(object) {
  return object?.metadata && typeof object.metadata === "object" ? object.metadata : {};
}

function stripeCustomerId(object) {
  return typeof object?.customer === "string" ? object.customer : object?.customer?.id || (object?.object === "customer" ? object.id : null);
}

function ucnFromObject(object) {
  const metadata = metadataOf(object);
  const candidates = [metadata.ucn, metadata.customerNumber, metadata.customer_number, object?.client_reference_id];
  return candidates.map(value => cleanText(value, 30)).find(value => /^\d{10}$/.test(value)) || null;
}

function emailFromObject(object) {
  const candidates = [object?.customer_details?.email, object?.customer_email, object?.receipt_email, object?.email, metadataOf(object).email];
  return candidates.map(value => cleanText(value, 254).toLowerCase()).find(validEmail) || null;
}

function platformCodeFromObject(object) {
  const metadata = metadataOf(object);
  return cleanText(metadata.platformCode || metadata.platform_code || metadata.service || metadata.product, 80).toUpperCase() || null;
}

function isoFromUnix(value, fallback = new Date().toISOString()) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : fallback;
}

async function resolveCustomer(env, object) {
  const ucn = ucnFromObject(object);
  if (ucn) {
    const customer = await env.DB.prepare("SELECT id,customer_number,verified_email,display_name FROM customers WHERE customer_number=?").bind(ucn).first();
    if (customer) return customer;
  }
  const customerId = stripeCustomerId(object);
  if (customerId) {
    const linked = await env.DB.prepare(`SELECT c.id,c.customer_number,c.verified_email,c.display_name
      FROM stripe_customer_links l JOIN customers c ON c.id=l.customer_id WHERE l.stripe_customer_id=?`).bind(customerId).first();
    if (linked) return linked;
  }
  const email = emailFromObject(object);
  if (email) return env.DB.prepare("SELECT id,customer_number,verified_email,display_name FROM customers WHERE lower(verified_email)=?").bind(email).first();
  return null;
}

async function upsertStripeCustomer(env, object, customer, livemode) {
  const stripeId = stripeCustomerId(object);
  if (!stripeId) return;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO stripe_customer_links
    (stripe_customer_id,customer_id,customer_number,email,name,livemode,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(stripe_customer_id) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,stripe_customer_links.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_customer_links.customer_number),
      email=COALESCE(excluded.email,stripe_customer_links.email),name=COALESCE(excluded.name,stripe_customer_links.name),
      livemode=excluded.livemode,updated_at=excluded.updated_at`)
    .bind(stripeId, customer?.id || null, customer?.customer_number || ucnFromObject(object), emailFromObject(object),
      cleanText(object?.name || object?.customer_details?.name, 160) || null, livemode ? 1 : 0, now, now).run();
}

async function storePayment(env, event, object, customer) {
  const amount = object.amount_received ?? object.amount_captured ?? object.amount ?? object.amount_refunded ?? object.amount_paid ?? object.total;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO stripe_payment_records
    (stripe_object_id,object_type,event_type,customer_id,customer_number,stripe_customer_id,platform_code,status,amount_minor,currency,
     description,receipt_email,occurred_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(stripe_object_id) DO UPDATE SET event_type=excluded.event_type,customer_id=COALESCE(excluded.customer_id,stripe_payment_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_payment_records.customer_number),status=excluded.status,
      amount_minor=COALESCE(excluded.amount_minor,stripe_payment_records.amount_minor),currency=COALESCE(excluded.currency,stripe_payment_records.currency),
      description=COALESCE(excluded.description,stripe_payment_records.description),receipt_email=COALESCE(excluded.receipt_email,stripe_payment_records.receipt_email),
      updated_at=excluded.updated_at,metadata_json=excluded.metadata_json`)
    .bind(object.id, object.object || "stripe_object", event.type, customer?.id || null, customer?.customer_number || ucnFromObject(object),
      stripeCustomerId(object), platformCodeFromObject(object), cleanText(object.status || event.type.split(".").at(-1), 80),
      Number.isFinite(Number(amount)) ? Number(amount) : null, cleanText(object.currency, 3).toUpperCase() || null,
      cleanText(object.description, 500) || null, emailFromObject(object), isoFromUnix(object.created, event.created ? isoFromUnix(event.created) : now),
      now, JSON.stringify(metadataOf(object))).run();
}

async function storeOrder(env, object, customer) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO stripe_order_records
    (stripe_object_id,customer_id,customer_number,stripe_customer_id,platform_code,status,payment_status,amount_total_minor,currency,
     customer_email,occurred_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(stripe_object_id) DO UPDATE SET customer_id=COALESCE(excluded.customer_id,stripe_order_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_order_records.customer_number),status=excluded.status,
      payment_status=excluded.payment_status,amount_total_minor=excluded.amount_total_minor,currency=excluded.currency,
      customer_email=COALESCE(excluded.customer_email,stripe_order_records.customer_email),updated_at=excluded.updated_at,metadata_json=excluded.metadata_json`)
    .bind(object.id, customer?.id || null, customer?.customer_number || ucnFromObject(object), stripeCustomerId(object), platformCodeFromObject(object),
      cleanText(object.status, 80) || null, cleanText(object.payment_status, 80) || null,
      Number.isFinite(Number(object.amount_total)) ? Number(object.amount_total) : null, cleanText(object.currency, 3).toUpperCase() || null,
      emailFromObject(object), isoFromUnix(object.created), now, JSON.stringify(metadataOf(object))).run();
}

async function storeSubscription(env, object, customer) {
  const item = object.items?.data?.[0];
  const price = item?.price;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO stripe_subscription_records
    (stripe_subscription_id,customer_id,customer_number,stripe_customer_id,platform_code,status,price_id,product_id,quantity,
     current_period_start,current_period_end,cancel_at_period_end,cancelled_at,created_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(stripe_subscription_id) DO UPDATE SET customer_id=COALESCE(excluded.customer_id,stripe_subscription_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_subscription_records.customer_number),status=excluded.status,
      price_id=COALESCE(excluded.price_id,stripe_subscription_records.price_id),product_id=COALESCE(excluded.product_id,stripe_subscription_records.product_id),
      quantity=COALESCE(excluded.quantity,stripe_subscription_records.quantity),current_period_start=excluded.current_period_start,
      current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,cancelled_at=excluded.cancelled_at,
      updated_at=excluded.updated_at,metadata_json=excluded.metadata_json`)
    .bind(object.id, customer?.id || null, customer?.customer_number || ucnFromObject(object), stripeCustomerId(object), platformCodeFromObject(object),
      cleanText(object.status, 80) || "unknown", cleanText(price?.id, 120) || null,
      typeof price?.product === "string" ? price.product : cleanText(price?.product?.id, 120) || null,
      Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : null,
      isoFromUnix(object.current_period_start, null), isoFromUnix(object.current_period_end, null), object.cancel_at_period_end ? 1 : 0,
      object.canceled_at ? isoFromUnix(object.canceled_at, null) : null, isoFromUnix(object.created), now, JSON.stringify(metadataOf(object))).run();
}

export async function processStripeWebhookEvent(env, event, rawBody) {
  await ensureStripeControlSchema(env);
  const object = event?.data?.object;
  if (!event?.id || !event?.type || !object?.id) throw Object.assign(new Error("Stripe sent an incomplete event payload."), { code: "STRIPE_EVENT_INVALID", status: 400 });
  const receivedAt = new Date().toISOString();
  const payloadHash = await sha256(rawBody);
  const existing = await env.DB.prepare("SELECT processing_status FROM stripe_webhook_events WHERE event_id=?").bind(event.id).first();
  if (existing) return { duplicate: true, status: existing.processing_status };
  await env.DB.prepare(`INSERT INTO stripe_webhook_events
    (event_id,event_type,livemode,api_version,object_id,customer_reference,processing_status,payload_hash,received_at)
    VALUES (?,?,?,?,?,?, 'received',?,?)`)
    .bind(event.id, event.type, event.livemode ? 1 : 0, cleanText(event.api_version, 40) || null, object.id,
      stripeCustomerId(object), payloadHash, receivedAt).run();

  try {
    const customer = await resolveCustomer(env, object);
    await upsertStripeCustomer(env, object, customer, Boolean(event.livemode));
    let handled = false;
    if (object.object === "customer") { handled = true; }
    if (["payment_intent", "charge", "invoice"].includes(object.object)) { await storePayment(env, event, object, customer); handled = true; }
    if (object.object === "checkout.session") { await storeOrder(env, object, customer); handled = true; }
    if (object.object === "subscription") { await storeSubscription(env, object, customer); handled = true; }
    const status = handled ? "processed" : "ignored";
    await env.DB.prepare("UPDATE stripe_webhook_events SET processing_status=?,processed_at=? WHERE event_id=?")
      .bind(status, new Date().toISOString(), event.id).run();
    return { duplicate: false, status, linkedCustomerNumber: customer?.customer_number || null, objectType: object.object };
  } catch (cause) {
    await env.DB.prepare("UPDATE stripe_webhook_events SET processing_status='failed',processed_at=?,error_message=? WHERE event_id=?")
      .bind(new Date().toISOString(), cleanText(cause?.message || String(cause), 1000), event.id).run();
    throw cause;
  }
}

export function stripeConfiguration(env) {
  return {
    apiKeyConfigured: Boolean(cleanText(env.STRIPE_SECRET_KEY, 500)),
    webhookSecretConfigured: Boolean(cleanText(env.STRIPE_WEBHOOK_SECRET, 500)),
    publishableKeyConfigured: Boolean(cleanText(env.STRIPE_PUBLISHABLE_KEY, 500)),
    mode: String(env.STRIPE_SECRET_KEY || "").startsWith("sk_live_") ? "live" : String(env.STRIPE_SECRET_KEY || "").startsWith("sk_test_") ? "test" : "unknown"
  };
}

export async function testStripeApiConnection(env) {
  const key = String(env.STRIPE_SECRET_KEY || "");
  if (!key) throw Object.assign(new Error("STRIPE_SECRET_KEY is not configured."), { code: "STRIPE_API_NOT_CONFIGURED", status: 503 });
  const response = await fetch("https://api.stripe.com/v1/account", { headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2025-12-15.clover" } });
  const account = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(cleanText(account?.error?.message, 500) || "Stripe rejected the API key."), { code: "STRIPE_API_TEST_FAILED", status: response.status || 502 });
  return { connected: true, accountId: account.id, businessName: account.business_profile?.name || account.settings?.dashboard?.display_name || null, country: account.country, defaultCurrency: account.default_currency, chargesEnabled: Boolean(account.charges_enabled), payoutsEnabled: Boolean(account.payouts_enabled) };
}

export async function stripeOperationalStatus(env, origin) {
  await ensureStripeControlSchema(env);
  const [events, records] = await env.DB.batch([
    env.DB.prepare(`SELECT event_id,event_type,livemode,object_id,processing_status,received_at,processed_at,error_message
      FROM stripe_webhook_events ORDER BY received_at DESC LIMIT 20`),
    env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM stripe_payment_records) payments,
      (SELECT COUNT(*) FROM stripe_order_records) orders,
      (SELECT COUNT(*) FROM stripe_subscription_records) subscriptions,
      (SELECT COUNT(*) FROM stripe_webhook_events WHERE processing_status='failed') failed_events`)
  ]);
  return {
    configuration: stripeConfiguration(env),
    webhookEndpoint: `${String(origin).replace(/\/$/, "")}/api/webhooks/stripe`,
    requiredEvents: [
      "customer.created", "customer.updated", "checkout.session.completed", "checkout.session.async_payment_succeeded",
      "payment_intent.succeeded", "payment_intent.payment_failed", "charge.refunded", "charge.dispute.created",
      "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
      "invoice.paid", "invoice.payment_failed"
    ],
    counts: records.results?.[0] || { payments: 0, orders: 0, subscriptions: 0, failed_events: 0 },
    recentEvents: events.results || []
  };
}
