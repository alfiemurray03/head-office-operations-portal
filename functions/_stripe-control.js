import { cleanText, validEmail } from "./_shared.js";

const textEncoder = new TextEncoder();

const CONNECTOR_BLUEPRINTS = Object.freeze([
  Object.freeze({
    slug: "planyx",
    code: "PLANYX",
    name: "Planyx",
    secretKeyBinding: "STRIPE_PLANYX_SECRET_KEY",
    webhookSecretBinding: "STRIPE_PLANYX_WEBHOOK_SECRET",
    publishableKeyBinding: "STRIPE_PLANYX_PUBLISHABLE_KEY"
  }),
  Object.freeze({
    slug: "profile-centre",
    code: "PROFILE_CENTRE",
    name: "Profile Centre",
    secretKeyBinding: "STRIPE_PROFILE_CENTRE_SECRET_KEY",
    webhookSecretBinding: "STRIPE_PROFILE_CENTRE_WEBHOOK_SECRET",
    publishableKeyBinding: "STRIPE_PROFILE_CENTRE_PUBLISHABLE_KEY"
  })
]);

export const STRIPE_REQUIRED_EVENTS = Object.freeze([
  "customer.created",
  "customer.updated",
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
  "charge.dispute.created",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed"
]);

const STRIPE_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS stripe_webhook_events (
    event_key TEXT PRIMARY KEY,connector_code TEXT NOT NULL,event_id TEXT NOT NULL,event_type TEXT NOT NULL,
    livemode INTEGER NOT NULL DEFAULT 0,api_version TEXT,object_id TEXT,customer_reference TEXT,
    processing_status TEXT NOT NULL DEFAULT 'received',payload_hash TEXT NOT NULL,received_at TEXT NOT NULL,
    processed_at TEXT,error_message TEXT,UNIQUE(connector_code,event_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_customer_links (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,stripe_customer_id TEXT NOT NULL,customer_id TEXT,
    customer_number TEXT,email TEXT,name TEXT,livemode INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,UNIQUE(connector_code,stripe_customer_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_payment_records (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,stripe_object_id TEXT NOT NULL,object_type TEXT NOT NULL,
    event_type TEXT NOT NULL,customer_id TEXT,customer_number TEXT,stripe_customer_id TEXT,platform_code TEXT,
    status TEXT,amount_minor INTEGER,currency TEXT,description TEXT,receipt_email TEXT,occurred_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',UNIQUE(connector_code,stripe_object_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_order_records (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,stripe_object_id TEXT NOT NULL,customer_id TEXT,
    customer_number TEXT,stripe_customer_id TEXT,platform_code TEXT,status TEXT,payment_status TEXT,
    amount_total_minor INTEGER,currency TEXT,customer_email TEXT,occurred_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',UNIQUE(connector_code,stripe_object_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_subscription_records (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,stripe_subscription_id TEXT NOT NULL,customer_id TEXT,
    customer_number TEXT,stripe_customer_id TEXT,platform_code TEXT,status TEXT NOT NULL,price_id TEXT,product_id TEXT,
    quantity INTEGER,current_period_start TEXT,current_period_end TEXT,cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    cancelled_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(connector_code,stripe_subscription_id)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_stripe_events_connector ON stripe_webhook_events(connector_code,received_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_stripe_links_connector ON stripe_customer_links(connector_code,stripe_customer_id)",
  "CREATE INDEX IF NOT EXISTS idx_stripe_payments_connector ON stripe_payment_records(connector_code,occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_stripe_orders_connector ON stripe_order_records(connector_code,occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_stripe_subscriptions_connector ON stripe_subscription_records(connector_code,updated_at DESC)"
];

export async function ensureStripeControlSchema(env) {
  for (const statement of STRIPE_SCHEMA) await env.DB.prepare(statement).run();
}

function connectorKey(value) {
  return cleanText(value, 80).toLowerCase().replaceAll("_", "-").replaceAll(" ", "-");
}

export function resolveStripeConnector(env, value) {
  const key = connectorKey(value);
  const blueprint = CONNECTOR_BLUEPRINTS.find(item => item.slug === key || connectorKey(item.code) === key);
  if (!blueprint) {
    throw Object.assign(new Error("Select either the Planyx or Profile Centre Stripe connection."), {
      code: "STRIPE_DIVISION_NOT_FOUND",
      status: 404
    });
  }
  return {
    ...blueprint,
    secretKey: String(env[blueprint.secretKeyBinding] || ""),
    webhookSecret: String(env[blueprint.webhookSecretBinding] || ""),
    publishableKey: String(env[blueprint.publishableKeyBinding] || "")
  };
}

function connectorMode(secretKey) {
  if (String(secretKey).startsWith("sk_live_")) return "live";
  if (String(secretKey).startsWith("sk_test_")) return "test";
  return "unknown";
}

function connectorSummary(env, blueprint, origin) {
  const connector = resolveStripeConnector(env, blueprint.slug);
  return {
    slug: connector.slug,
    code: connector.code,
    name: connector.name,
    webhookEndpoint: `${String(origin).replace(/\/$/, "")}/api/webhooks/stripe/${connector.slug}`,
    configuration: {
      apiKeyConfigured: Boolean(cleanText(connector.secretKey, 500)),
      webhookSecretConfigured: Boolean(cleanText(connector.webhookSecret, 500)),
      publishableKeyConfigured: Boolean(cleanText(connector.publishableKey, 500)),
      mode: connectorMode(connector.secretKey),
      secretKeyBinding: connector.secretKeyBinding,
      webhookSecretBinding: connector.webhookSecretBinding,
      publishableKeyBinding: connector.publishableKeyBinding
    }
  };
}

export function stripeConnectorCatalog(env, origin = "") {
  return CONNECTOR_BLUEPRINTS.map(item => connectorSummary(env, item, origin));
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

export async function verifyStripeWebhook(rawBody, signatureHeader, connector, toleranceSeconds = 300) {
  const webhookSecret = String(connector?.webhookSecret || "");
  if (!webhookSecret) {
    throw Object.assign(new Error(`${connector?.webhookSecretBinding || "The division webhook secret"} is not configured.`), {
      code: "STRIPE_WEBHOOK_NOT_CONFIGURED",
      status: 503
    });
  }
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed.timestamp || !parsed.signatures.length) {
    throw Object.assign(new Error("The Stripe-Signature header is missing or invalid."), { code: "STRIPE_SIGNATURE_MISSING", status: 400 });
  }
  const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
  if (age > toleranceSeconds) {
    throw Object.assign(new Error("The Stripe webhook timestamp is outside the permitted replay window."), { code: "STRIPE_SIGNATURE_EXPIRED", status: 400 });
  }
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(webhookSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = toHex(await crypto.subtle.sign("HMAC", key, textEncoder.encode(`${parsed.timestamp}.${rawBody}`)));
  if (!parsed.signatures.some(signature => constantTimeEqual(signature, expected))) {
    throw Object.assign(new Error(`Stripe signature verification failed for ${connector.name}.`), { code: "STRIPE_SIGNATURE_INVALID", status: 400 });
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

function isoFromUnix(value, fallback = new Date().toISOString()) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : fallback;
}

export async function resolveStripeCustomer(env, connector, object) {
  const ucn = ucnFromObject(object);
  if (ucn) {
    const customer = await env.DB.prepare("SELECT id,customer_number,verified_email,display_name FROM customers WHERE customer_number=?").bind(ucn).first();
    if (customer) return customer;
  }
  const customerId = stripeCustomerId(object);
  if (customerId) {
    const linked = await env.DB.prepare(`SELECT c.id,c.customer_number,c.verified_email,c.display_name
      FROM stripe_customer_links l JOIN customers c ON c.id=l.customer_id
      WHERE l.connector_code=? AND l.stripe_customer_id=?`).bind(connector.code, customerId).first();
    if (linked) return linked;
  }
  const email = emailFromObject(object);
  if (email) return env.DB.prepare("SELECT id,customer_number,verified_email,display_name FROM customers WHERE lower(verified_email)=?").bind(email).first();
  return null;
}

async function upsertStripeCustomer(env, connector, object, customer, livemode) {
  const stripeId = stripeCustomerId(object);
  if (!stripeId) return;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO stripe_customer_links
    (id,connector_code,stripe_customer_id,customer_id,customer_number,email,name,livemode,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_customer_id) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,stripe_customer_links.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_customer_links.customer_number),
      email=COALESCE(excluded.email,stripe_customer_links.email),name=COALESCE(excluded.name,stripe_customer_links.name),
      livemode=excluded.livemode,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), connector.code, stripeId, customer?.id || null, customer?.customer_number || ucnFromObject(object),
      emailFromObject(object), cleanText(object?.name || object?.customer_details?.name, 160) || null, livemode ? 1 : 0, now, now).run();
}

async function storePayment(env, connector, event, object, customer) {
  const amount = object.amount_received ?? object.amount_captured ?? object.amount ?? object.amount_refunded ?? object.amount_paid ?? object.total;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO stripe_payment_records
    (id,connector_code,stripe_object_id,object_type,event_type,customer_id,customer_number,stripe_customer_id,platform_code,status,
     amount_minor,currency,description,receipt_email,occurred_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_object_id) DO UPDATE SET event_type=excluded.event_type,
      customer_id=COALESCE(excluded.customer_id,stripe_payment_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_payment_records.customer_number),status=excluded.status,
      amount_minor=COALESCE(excluded.amount_minor,stripe_payment_records.amount_minor),currency=COALESCE(excluded.currency,stripe_payment_records.currency),
      description=COALESCE(excluded.description,stripe_payment_records.description),receipt_email=COALESCE(excluded.receipt_email,stripe_payment_records.receipt_email),
      updated_at=excluded.updated_at,metadata_json=excluded.metadata_json`)
    .bind(crypto.randomUUID(), connector.code, object.id, object.object || "stripe_object", event.type, customer?.id || null,
      customer?.customer_number || ucnFromObject(object), stripeCustomerId(object), connector.code,
      cleanText(object.status || event.type.split(".").at(-1), 80), Number.isFinite(Number(amount)) ? Number(amount) : null,
      cleanText(object.currency, 3).toUpperCase() || null, cleanText(object.description, 500) || null, emailFromObject(object),
      isoFromUnix(object.created, event.created ? isoFromUnix(event.created) : now), now,
      JSON.stringify({ ...metadataOf(object), headOfficeStripeConnector: connector.code })).run();
}

async function storeOrder(env, connector, object, customer) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO stripe_order_records
    (id,connector_code,stripe_object_id,customer_id,customer_number,stripe_customer_id,platform_code,status,payment_status,
     amount_total_minor,currency,customer_email,occurred_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_object_id) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,stripe_order_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_order_records.customer_number),status=excluded.status,
      payment_status=excluded.payment_status,amount_total_minor=excluded.amount_total_minor,currency=excluded.currency,
      customer_email=COALESCE(excluded.customer_email,stripe_order_records.customer_email),updated_at=excluded.updated_at,
      metadata_json=excluded.metadata_json`)
    .bind(crypto.randomUUID(), connector.code, object.id, customer?.id || null, customer?.customer_number || ucnFromObject(object),
      stripeCustomerId(object), connector.code, cleanText(object.status, 80) || null, cleanText(object.payment_status, 80) || null,
      Number.isFinite(Number(object.amount_total)) ? Number(object.amount_total) : null, cleanText(object.currency, 3).toUpperCase() || null,
      emailFromObject(object), isoFromUnix(object.created), now,
      JSON.stringify({ ...metadataOf(object), headOfficeStripeConnector: connector.code })).run();
}

async function storeSubscription(env, connector, object, customer) {
  const item = object.items?.data?.[0];
  const price = item?.price;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO stripe_subscription_records
    (id,connector_code,stripe_subscription_id,customer_id,customer_number,stripe_customer_id,platform_code,status,price_id,product_id,
     quantity,current_period_start,current_period_end,cancel_at_period_end,cancelled_at,created_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_subscription_id) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,stripe_subscription_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_subscription_records.customer_number),status=excluded.status,
      price_id=COALESCE(excluded.price_id,stripe_subscription_records.price_id),product_id=COALESCE(excluded.product_id,stripe_subscription_records.product_id),
      quantity=COALESCE(excluded.quantity,stripe_subscription_records.quantity),current_period_start=excluded.current_period_start,
      current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,cancelled_at=excluded.cancelled_at,
      updated_at=excluded.updated_at,metadata_json=excluded.metadata_json`)
    .bind(crypto.randomUUID(), connector.code, object.id, customer?.id || null, customer?.customer_number || ucnFromObject(object),
      stripeCustomerId(object), connector.code, cleanText(object.status, 80) || "unknown", cleanText(price?.id, 120) || null,
      typeof price?.product === "string" ? price.product : cleanText(price?.product?.id, 120) || null,
      Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : null,
      isoFromUnix(object.current_period_start, null), isoFromUnix(object.current_period_end, null), object.cancel_at_period_end ? 1 : 0,
      object.canceled_at ? isoFromUnix(object.canceled_at, null) : null, isoFromUnix(object.created), now,
      JSON.stringify({ ...metadataOf(object), headOfficeStripeConnector: connector.code })).run();
}

export async function processStripeWebhookEvent(env, connector, event, rawBody) {
  await ensureStripeControlSchema(env);
  const object = event?.data?.object;
  if (!event?.id || !event?.type || !object?.id) {
    throw Object.assign(new Error("Stripe sent an incomplete event payload."), { code: "STRIPE_EVENT_INVALID", status: 400 });
  }
  const eventKey = `${connector.code}:${event.id}`;
  const receivedAt = new Date().toISOString();
  const payloadHash = await sha256(rawBody);
  const existing = await env.DB.prepare("SELECT processing_status FROM stripe_webhook_events WHERE event_key=?").bind(eventKey).first();
  if (existing) return { duplicate: true, status: existing.processing_status, connectorCode: connector.code };
  await env.DB.prepare(`INSERT INTO stripe_webhook_events
    (event_key,connector_code,event_id,event_type,livemode,api_version,object_id,customer_reference,processing_status,payload_hash,received_at)
    VALUES (?,?,?,?,?,?,?,?, 'received',?,?)`)
    .bind(eventKey, connector.code, event.id, event.type, event.livemode ? 1 : 0, cleanText(event.api_version, 40) || null,
      object.id, stripeCustomerId(object), payloadHash, receivedAt).run();

  try {
    const customer = await resolveStripeCustomer(env, connector, object);
    await upsertStripeCustomer(env, connector, object, customer, Boolean(event.livemode));
    let handled = false;
    if (object.object === "customer") handled = true;
    if (["payment_intent", "charge", "invoice"].includes(object.object)) {
      await storePayment(env, connector, event, object, customer);
      handled = true;
    }
    if (object.object === "checkout.session") {
      await storeOrder(env, connector, object, customer);
      handled = true;
    }
    if (object.object === "subscription") {
      await storeSubscription(env, connector, object, customer);
      handled = true;
    }
    const status = handled ? "processed" : "ignored";
    await env.DB.prepare("UPDATE stripe_webhook_events SET processing_status=?,processed_at=? WHERE event_key=?")
      .bind(status, new Date().toISOString(), eventKey).run();
    return {
      duplicate: false,
      status,
      connectorCode: connector.code,
      connectorName: connector.name,
      linkedCustomerNumber: customer?.customer_number || null,
      objectType: object.object
    };
  } catch (cause) {
    await env.DB.prepare("UPDATE stripe_webhook_events SET processing_status='failed',processed_at=?,error_message=? WHERE event_key=?")
      .bind(new Date().toISOString(), cleanText(cause?.message || String(cause), 1000), eventKey).run();
    throw cause;
  }
}

export async function testStripeApiConnection(env, division) {
  const connector = resolveStripeConnector(env, division);
  if (!connector.secretKey) {
    throw Object.assign(new Error(`${connector.secretKeyBinding} is not configured.`), { code: "STRIPE_API_NOT_CONFIGURED", status: 503 });
  }
  const response = await fetch("https://api.stripe.com/v1/account", { headers: { Authorization: `Bearer ${connector.secretKey}` } });
  const account = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(cleanText(account?.error?.message, 500) || `Stripe rejected the ${connector.name} API key.`), {
      code: "STRIPE_API_TEST_FAILED",
      status: response.status || 502
    });
  }
  return {
    connected: true,
    connector: { slug: connector.slug, code: connector.code, name: connector.name },
    accountId: account.id,
    businessName: account.business_profile?.name || account.settings?.dashboard?.display_name || null,
    country: account.country,
    defaultCurrency: account.default_currency,
    chargesEnabled: Boolean(account.charges_enabled),
    payoutsEnabled: Boolean(account.payouts_enabled),
    mode: connectorMode(connector.secretKey)
  };
}

export async function stripeOperationalStatus(env, origin) {
  await ensureStripeControlSchema(env);
  const connectors = [];
  for (const summary of stripeConnectorCatalog(env, origin)) {
    const [events, records] = await env.DB.batch([
      env.DB.prepare(`SELECT connector_code,event_id,event_type,livemode,object_id,processing_status,received_at,processed_at,error_message
        FROM stripe_webhook_events WHERE connector_code=? ORDER BY received_at DESC LIMIT 20`).bind(summary.code),
      env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM stripe_payment_records WHERE connector_code=?) payments,
        (SELECT COUNT(*) FROM stripe_order_records WHERE connector_code=?) orders,
        (SELECT COUNT(*) FROM stripe_subscription_records WHERE connector_code=?) subscriptions,
        (SELECT COUNT(*) FROM stripe_webhook_events WHERE connector_code=? AND processing_status='failed') failed_events`)
        .bind(summary.code, summary.code, summary.code, summary.code)
    ]);
    connectors.push({
      ...summary,
      counts: records.results?.[0] || { payments: 0, orders: 0, subscriptions: 0, failed_events: 0 },
      recentEvents: events.results || []
    });
  }
  const totals = connectors.reduce((result, connector) => {
    for (const key of ["payments", "orders", "subscriptions", "failed_events"]) result[key] += Number(connector.counts?.[key] || 0);
    return result;
  }, { payments: 0, orders: 0, subscriptions: 0, failed_events: 0 });
  const modes = [...new Set(connectors.map(item => item.configuration.mode).filter(mode => mode !== "unknown"))];
  return {
    connectors,
    configuration: {
      apiKeyConfigured: connectors.every(item => item.configuration.apiKeyConfigured),
      webhookSecretConfigured: connectors.every(item => item.configuration.webhookSecretConfigured),
      publishableKeyConfigured: connectors.every(item => item.configuration.publishableKeyConfigured),
      mode: modes.length === 1 ? modes[0] : modes.length > 1 ? "mixed" : "unknown",
      connectorCount: connectors.length
    },
    webhookEndpoint: `${String(origin).replace(/\/$/, "")}/api/webhooks/stripe/{planyx|profile-centre}`,
    requiredEvents: STRIPE_REQUIRED_EVENTS,
    counts: totals,
    recentEvents: connectors.flatMap(item => item.recentEvents.map(event => ({ ...event, connector_name: item.name })))
      .sort((left, right) => String(right.received_at).localeCompare(String(left.received_at))).slice(0, 30)
  };
}
