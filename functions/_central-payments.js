import { cleanText, error, hmac, safeEqual, sha256, validEmail } from "./_shared.js";

export const CENTRAL_PAYMENT_BRANDS = Object.freeze([
  Object.freeze({ code: "JA_GROUP_SERVICES", name: "JA Group Services Ltd" }),
  Object.freeze({ code: "SOUSA_MURRAY_DOMAINS", name: "Sousa Murray Domains" }),
  Object.freeze({ code: "SOUSA_MURRAY_SITES", name: "Sousa Murray Sites" }),
  Object.freeze({ code: "SOUSA_MURRAY_PLANEIA", name: "Sousa Murray Planeia" }),
  Object.freeze({ code: "SOUSA_MURRAY_PROFILES", name: "Sousa Murray Profiles" }),
  Object.freeze({ code: "SOUSA_MURRAY_ELEARNING", name: "Sousa Murray eLearning" }),
]);

export const CENTRAL_STRIPE_REQUIRED_EVENTS = Object.freeze([
  "customer.created",
  "customer.updated",
  "checkout.session.completed",
  "checkout.session.expired",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "payment_intent.succeeded",
  "payment_intent.payment_failed",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS central_payment_schema_state (
    schema_key TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS central_payment_catalogue_products (
    id TEXT PRIMARY KEY,
    brand_code TEXT NOT NULL,
    product_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    service_type TEXT NOT NULL DEFAULT 'service',
    stripe_product_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS central_payment_catalogue_prices (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    price_code TEXT NOT NULL UNIQUE,
    stripe_price_id TEXT NOT NULL UNIQUE,
    amount_minor INTEGER,
    currency TEXT NOT NULL DEFAULT 'GBP',
    billing_type TEXT NOT NULL DEFAULT 'one_time',
    recurring_interval TEXT,
    recurring_interval_count INTEGER,
    tax_behavior TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (product_id) REFERENCES central_payment_catalogue_products(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS central_payment_customer_links (
    customer_id TEXT PRIMARY KEY,
    customer_number TEXT NOT NULL UNIQUE,
    stripe_customer_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS central_payment_platform_origins (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL,
    origin TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(platform_id,origin),
    FOREIGN KEY (platform_id) REFERENCES platforms(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS central_payment_checkout_requests (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL,
    brand_code TEXT NOT NULL,
    product_code TEXT NOT NULL,
    price_code TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    customer_number TEXT NOT NULL,
    stripe_customer_id TEXT NOT NULL,
    stripe_checkout_session_id TEXT UNIQUE,
    order_reference TEXT,
    service_reference TEXT,
    success_url TEXT NOT NULL,
    cancel_url TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'created',
    amount_minor INTEGER,
    currency TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (platform_id) REFERENCES platforms(id),
    FOREIGN KEY (customer_id) REFERENCES customers(id)
  )`,
  `CREATE TABLE IF NOT EXISTS central_payment_transactions (
    id TEXT PRIMARY KEY,
    stripe_object_id TEXT NOT NULL UNIQUE,
    object_type TEXT NOT NULL,
    event_type TEXT NOT NULL,
    platform_id TEXT,
    brand_code TEXT,
    product_code TEXT,
    price_code TEXT,
    customer_id TEXT,
    customer_number TEXT,
    stripe_customer_id TEXT,
    stripe_payment_intent_id TEXT,
    stripe_subscription_id TEXT,
    stripe_invoice_id TEXT,
    order_reference TEXT,
    service_reference TEXT,
    status TEXT,
    amount_minor INTEGER,
    currency TEXT,
    occurred_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS central_payment_subscriptions (
    id TEXT PRIMARY KEY,
    stripe_subscription_id TEXT NOT NULL UNIQUE,
    platform_id TEXT,
    brand_code TEXT,
    product_code TEXT,
    price_code TEXT,
    customer_id TEXT,
    customer_number TEXT,
    stripe_customer_id TEXT,
    status TEXT NOT NULL,
    quantity INTEGER,
    current_period_start TEXT,
    current_period_end TEXT,
    cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
    cancelled_at TEXT,
    order_reference TEXT,
    service_reference TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE TABLE IF NOT EXISTS central_payment_webhook_events (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    livemode INTEGER NOT NULL DEFAULT 0,
    api_version TEXT,
    object_id TEXT,
    payload_hash TEXT NOT NULL,
    processing_status TEXT NOT NULL DEFAULT 'received',
    received_at TEXT NOT NULL,
    processed_at TEXT,
    error_message TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS central_payment_event_outbox (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    central_reference TEXT,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    acknowledged_at TEXT,
    UNIQUE(platform_id,event_type,central_reference)
  )`,
  "CREATE INDEX IF NOT EXISTS idx_central_prices_product ON central_payment_catalogue_prices(product_id,status)",
  "CREATE INDEX IF NOT EXISTS idx_central_checkout_customer ON central_payment_checkout_requests(customer_number,created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_central_checkout_platform ON central_payment_checkout_requests(platform_id,created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_central_tx_customer ON central_payment_transactions(customer_number,occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_central_tx_brand ON central_payment_transactions(brand_code,occurred_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_central_sub_customer ON central_payment_subscriptions(customer_number,updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_central_outbox_platform ON central_payment_event_outbox(platform_id,status,created_at)",
];

export async function ensureCentralPaymentsSchema(env) {
  if (!env.DB) throw Object.assign(new Error("The Head Office DB binding is not configured."), { code: "DATABASE_NOT_BOUND", status: 503 });
  for (const statement of SCHEMA) await env.DB.prepare(statement).run();
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO central_payment_schema_state(schema_key,version,applied_at)
    VALUES ('central_payments',1,?)
    ON CONFLICT(schema_key) DO UPDATE SET version=excluded.version,applied_at=excluded.applied_at`).bind(now).run();
}

export function centralPaymentsConfiguration(env, origin = "") {
  const secret = String(env.CENTRAL_STRIPE_SECRET_KEY || "");
  const mode = secret.startsWith("sk_live_") || secret.startsWith("rk_live_") ? "live"
    : secret.startsWith("sk_test_") || secret.startsWith("rk_test_") ? "test" : "unknown";
  return {
    enabled: String(env.CENTRAL_PAYMENTS_ENABLED || "").toLowerCase() === "true",
    stripeKeyConfigured: Boolean(secret),
    stripeWebhookConfigured: Boolean(String(env.CENTRAL_STRIPE_WEBHOOK_SECRET || "")),
    expectedStripeAccountIdConfigured: Boolean(String(env.CENTRAL_STRIPE_ACCOUNT_ID || "")),
    mode,
    webhookEndpoint: origin ? `${String(origin).replace(/\/$/, "")}/api/webhooks/stripe` : "/api/webhooks/stripe",
  };
}

function stripeForm(values) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values || {})) {
    if (value === undefined || value === null || value === "") continue;
    form.set(key, String(value));
  }
  return form;
}

async function stripeFetch(env, method, path, values = null, idempotencyKey = "") {
  const secret = String(env.CENTRAL_STRIPE_SECRET_KEY || "");
  if (!secret) throw Object.assign(new Error("CENTRAL_STRIPE_SECRET_KEY is not configured in Head Office."), { code: "CENTRAL_STRIPE_NOT_CONFIGURED", status: 503 });
  const headers = { Authorization: `Bearer ${secret}` };
  const options = { method, headers };
  if (method !== "GET") {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    options.body = stripeForm(values);
  }
  const response = await fetch(`https://api.stripe.com/v1${path}`, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const stripeError = payload?.error || {};
    throw Object.assign(new Error(stripeError.message || `Stripe request failed (${response.status}).`), {
      code: stripeError.code || "STRIPE_REQUEST_FAILED",
      status: response.status >= 500 ? 502 : response.status,
      stripeStatus: response.status,
      stripeParam: stripeError.param || null,
      stripeType: stripeError.type || null,
    });
  }
  return payload;
}

export const centralStripeGet = (env, path) => stripeFetch(env, "GET", path);
export const centralStripePost = (env, path, values, idempotencyKey = "") => stripeFetch(env, "POST", path, values, idempotencyKey);

export async function verifyCentralStripeAccount(env) {
  const expected = cleanText(env.CENTRAL_STRIPE_ACCOUNT_ID, 80);
  if (!expected) throw Object.assign(new Error("CENTRAL_STRIPE_ACCOUNT_ID is not configured."), { code: "CENTRAL_STRIPE_ACCOUNT_NOT_CONFIGURED", status: 503 });
  const account = await centralStripeGet(env, "/account");
  if (account.id !== expected) {
    throw Object.assign(new Error("The configured Stripe secret does not belong to the approved JA Group Services Central Payments account."), {
      code: "WRONG_CENTRAL_STRIPE_ACCOUNT",
      status: 503,
      actualAccountId: account.id,
      expectedAccountId: expected,
    });
  }
  return account;
}

function normaliseBrand(value) {
  const code = cleanText(value, 80).toUpperCase().replaceAll("-", "_").replaceAll(" ", "_");
  const aliases = {
    PLANYX: "SOUSA_MURRAY_PLANEIA",
    PROFILE_CENTRE: "SOUSA_MURRAY_PROFILES",
    PROFILE_CENTER: "SOUSA_MURRAY_PROFILES",
    JA_DOMAIN_HUB: "SOUSA_MURRAY_DOMAINS",
    APTENVO: "SOUSA_MURRAY_ELEARNING",
    COURSE_SELECT: "SOUSA_MURRAY_ELEARNING",
  };
  return aliases[code] || code;
}

export function brandDefinition(value) {
  const code = normaliseBrand(value);
  return CENTRAL_PAYMENT_BRANDS.find(item => item.code === code) || null;
}

function governedBrandsForPlatform(platform) {
  const code = cleanText(platform?.code, 80).toUpperCase();
  if (code === "JA_GROUP_SERVICES") return new Set(CENTRAL_PAYMENT_BRANDS.map(item => item.code));
  if (["PLANYX", "SOUSA_MURRAY_PLANEIA"].includes(code)) return new Set(["SOUSA_MURRAY_PLANEIA"]);
  if (["PROFILE_CENTRE", "SOUSA_MURRAY_PROFILES"].includes(code)) return new Set(["SOUSA_MURRAY_PROFILES"]);
  if (["JA_DOMAIN_HUB", "SOUSA_MURRAY_DOMAINS"].includes(code)) return new Set(["SOUSA_MURRAY_DOMAINS", "SOUSA_MURRAY_SITES"]);
  if (["APTENVO", "COURSE_SELECT", "SOUSA_MURRAY_ELEARNING"].includes(code)) return new Set(["SOUSA_MURRAY_ELEARNING"]);
  return new Set();
}

export function requirePlatformBrand(platform, value) {
  const brand = brandDefinition(value);
  if (!brand) throw Object.assign(new Error("The requested payment brand is not approved for Central Payments."), { code: "PAYMENT_BRAND_NOT_APPROVED", status: 400 });
  if (!governedBrandsForPlatform(platform).has(brand.code)) {
    throw Object.assign(new Error("This connected platform is not authorised to create payments for the requested brand."), { code: "PAYMENT_BRAND_NOT_AUTHORISED", status: 403 });
  }
  return brand;
}

export async function findCentralCustomer(env, customerNumber) {
  const ucn = cleanText(customerNumber, 20).replace(/\s/g, "");
  if (!/^\d{10}$/.test(ucn)) throw Object.assign(new Error("A valid ten-digit JA Group Services UCN is required."), { code: "INVALID_CUSTOMER_NUMBER", status: 400 });
  const customer = await env.DB.prepare(`SELECT id,customer_number,display_name,verified_email,account_status,security_status
    FROM customers WHERE customer_number=? LIMIT 1`).bind(ucn).first();
  if (!customer) throw Object.assign(new Error("The central customer record could not be found."), { code: "CUSTOMER_NOT_FOUND", status: 404 });
  return customer;
}

export async function assertCustomerCanPay(env, customer) {
  const restriction = await env.DB.prepare(`SELECT r.id,t.code,t.label
    FROM restrictions r JOIN restriction_types t ON t.id=r.restriction_type_id
    WHERE r.customer_id=? AND r.status='active' AND t.enforcement_action='deny_payment'
    LIMIT 1`).bind(customer.id).first();
  if (restriction) {
    throw Object.assign(new Error("Head Office security controls currently prevent new payments for this customer."), {
      code: "CUSTOMER_PAYMENTS_RESTRICTED",
      status: 403,
      restrictionCode: restriction.code,
    });
  }
}

export async function ensureCentralStripeCustomer(env, customer, platform, brand) {
  await ensureCentralPaymentsSchema(env);
  const linked = await env.DB.prepare(`SELECT stripe_customer_id FROM central_payment_customer_links
    WHERE customer_id=? LIMIT 1`).bind(customer.id).first();
  if (linked?.stripe_customer_id) {
    try {
      return await centralStripeGet(env, `/customers/${encodeURIComponent(linked.stripe_customer_id)}`);
    } catch (cause) {
      if (cause.status !== 404) throw cause;
      await env.DB.prepare("DELETE FROM central_payment_customer_links WHERE customer_id=?").bind(customer.id).run();
    }
  }

  const stripeCustomer = await centralStripePost(env, "/customers", {
    email: validEmail(customer.verified_email) ? customer.verified_email : undefined,
    name: customer.display_name || undefined,
    "metadata[legal_entity]": "JA Group Services Ltd",
    "metadata[ja_customer_id]": customer.id,
    "metadata[ucn]": customer.customer_number,
    "metadata[source_platform]": platform.code,
    "metadata[first_brand]": brand.code,
    "metadata[central_payments]": "true",
  }, `central-customer-${customer.id}`);

  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO central_payment_customer_links(customer_id,customer_number,stripe_customer_id,created_at,updated_at)
    VALUES (?,?,?,?,?)
    ON CONFLICT(customer_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id,customer_number=excluded.customer_number,updated_at=excluded.updated_at`)
    .bind(customer.id, customer.customer_number, stripeCustomer.id, now, now).run();
  return stripeCustomer;
}

export async function resolveCentralPrice(env, brandCode, productCode, priceCode) {
  await ensureCentralPaymentsSchema(env);
  const row = await env.DB.prepare(`SELECT
      p.id product_id,p.brand_code,p.product_code,p.name product_name,p.stripe_product_id,p.status product_status,
      r.id price_id,r.price_code,r.stripe_price_id,r.amount_minor,r.currency,r.billing_type,r.recurring_interval,
      r.recurring_interval_count,r.tax_behavior,r.status price_status
    FROM central_payment_catalogue_prices r
    JOIN central_payment_catalogue_products p ON p.id=r.product_id
    WHERE p.brand_code=? AND p.product_code=? AND r.price_code=? LIMIT 1`)
    .bind(normaliseBrand(brandCode), cleanText(productCode, 100).toUpperCase(), cleanText(priceCode, 100).toUpperCase()).first();
  if (!row || row.product_status !== "active" || row.price_status !== "active") {
    throw Object.assign(new Error("The requested Central Payments product or price is not active."), { code: "CENTRAL_PRICE_NOT_FOUND", status: 404 });
  }
  return row;
}

export async function validatePlatformReturnUrl(env, platform, value) {
  const candidate = cleanText(value, 500);
  let parsed;
  try { parsed = new URL(candidate); } catch { throw Object.assign(new Error("The return address is invalid."), { code: "INVALID_RETURN_URL", status: 400 }); }
  if (parsed.protocol !== "https:") throw Object.assign(new Error("Central Payments return addresses must use HTTPS."), { code: "INSECURE_RETURN_URL", status: 400 });
  const allowed = await env.DB.prepare(`SELECT 1 ok FROM central_payment_platform_origins
    WHERE platform_id=? AND origin=? AND status='active' LIMIT 1`).bind(platform.id, parsed.origin).first();
  if (!allowed) throw Object.assign(new Error("The return address is not authorised for this connected platform."), { code: "RETURN_ORIGIN_NOT_AUTHORISED", status: 403 });
  return parsed.toString();
}

export function checkoutMetadata({ platform, brand, customer, product, orderReference, serviceReference, checkoutRequestId }) {
  return {
    legal_entity: "JA Group Services Ltd",
    central_payments: "true",
    source_platform_id: platform.id,
    source_platform_code: platform.code,
    brand_code: brand.code,
    brand_name: brand.name,
    product_code: product.product_code,
    price_code: product.price_code,
    customer_number: customer.customer_number,
    ucn: customer.customer_number,
    ja_customer_id: customer.id,
    order_reference: orderReference || "",
    service_reference: serviceReference || "",
    central_checkout_request_id: checkoutRequestId,
  };
}

export async function createCentralCheckout(env, input) {
  if (String(env.CENTRAL_PAYMENTS_ENABLED || "").toLowerCase() !== "true") {
    throw Object.assign(new Error("Central Payments checkout is not enabled in Head Office System Settings."), { code: "CENTRAL_PAYMENTS_DISABLED", status: 503 });
  }
  await ensureCentralPaymentsSchema(env);
  await verifyCentralStripeAccount(env);
  const { platform, brand, customer, product } = input;
  await assertCustomerCanPay(env, customer);
  const stripeCustomer = await ensureCentralStripeCustomer(env, customer, platform, brand);
  const successUrl = await validatePlatformReturnUrl(env, platform, input.successUrl);
  const cancelUrl = await validatePlatformReturnUrl(env, platform, input.cancelUrl);
  const checkoutRequestId = crypto.randomUUID();
  const orderReference = cleanText(input.orderReference, 120) || null;
  const serviceReference = cleanText(input.serviceReference, 120) || null;
  const mode = product.billing_type === "recurring" ? "subscription" : "payment";
  const metadata = checkoutMetadata({ platform, brand, customer, product, orderReference, serviceReference, checkoutRequestId });
  const fields = {
    mode,
    customer: stripeCustomer.id,
    client_reference_id: customer.customer_number,
    "line_items[0][price]": product.stripe_price_id,
    "line_items[0][quantity]": 1,
    success_url: successUrl,
    cancel_url: cancelUrl,
    billing_address_collection: "auto",
    "customer_update[address]": "auto",
  };
  for (const [key, value] of Object.entries(metadata)) fields[`metadata[${key}]`] = value;
  if (mode === "subscription") {
    for (const [key, value] of Object.entries(metadata)) fields[`subscription_data[metadata][${key}]`] = value;
  } else {
    for (const [key, value] of Object.entries(metadata)) fields[`payment_intent_data[metadata][${key}]`] = value;
  }

  const session = await centralStripePost(env, "/checkout/sessions", fields, `central-checkout-${checkoutRequestId}`);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO central_payment_checkout_requests
    (id,platform_id,brand_code,product_code,price_code,customer_id,customer_number,stripe_customer_id,stripe_checkout_session_id,
     order_reference,service_reference,success_url,cancel_url,mode,status,amount_minor,currency,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'created',?,?,?,?)`)
    .bind(checkoutRequestId, platform.id, brand.code, product.product_code, product.price_code, customer.id, customer.customer_number,
      stripeCustomer.id, session.id, orderReference, serviceReference, successUrl, cancelUrl, mode,
      product.amount_minor, product.currency, now, now).run();
  return { checkoutRequestId, sessionId: session.id, url: session.url, mode };
}

function parseStripeSignature(value) {
  const parsed = { timestamp: null, signatures: [] };
  for (const part of String(value || "").split(",")) {
    const [key, token] = part.trim().split("=", 2);
    if (key === "t" && /^\d+$/.test(token || "")) parsed.timestamp = Number(token);
    if (key === "v1" && /^[a-f0-9]{64}$/i.test(token || "")) parsed.signatures.push(token.toLowerCase());
  }
  return parsed;
}

export async function verifyCentralStripeWebhook(rawBody, signatureHeader, env, toleranceSeconds = 300) {
  const secret = String(env.CENTRAL_STRIPE_WEBHOOK_SECRET || "");
  if (!secret) throw Object.assign(new Error("CENTRAL_STRIPE_WEBHOOK_SECRET is not configured."), { code: "CENTRAL_STRIPE_WEBHOOK_NOT_CONFIGURED", status: 503 });
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed.timestamp || !parsed.signatures.length) throw Object.assign(new Error("The Stripe-Signature header is missing or invalid."), { code: "STRIPE_SIGNATURE_MISSING", status: 400 });
  const age = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
  if (age > toleranceSeconds) throw Object.assign(new Error("The Stripe webhook timestamp is outside the permitted replay window."), { code: "STRIPE_SIGNATURE_EXPIRED", status: 400 });
  const expected = await hmac(`${parsed.timestamp}.${rawBody}`, secret);
  if (!parsed.signatures.some(signature => safeEqual(signature, expected))) throw Object.assign(new Error("Stripe signature verification failed for Central Payments."), { code: "STRIPE_SIGNATURE_INVALID", status: 400 });
  return { timestamp: parsed.timestamp, ageSeconds: age };
}

function metadataOf(object) {
  return object?.metadata && typeof object.metadata === "object" ? object.metadata : {};
}

function stringId(value) {
  if (typeof value === "string") return value;
  return value?.id || null;
}

function unixIso(value, fallback = new Date().toISOString()) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : fallback;
}

async function contextFromObject(env, object) {
  const metadata = metadataOf(object);
  let customerNumber = cleanText(metadata.customer_number || metadata.ucn || object?.client_reference_id, 30);
  let customerId = cleanText(metadata.ja_customer_id, 80) || null;
  let platformId = cleanText(metadata.source_platform_id, 80) || null;
  let brandCode = normaliseBrand(metadata.brand_code);
  let productCode = cleanText(metadata.product_code, 100).toUpperCase() || null;
  let priceCode = cleanText(metadata.price_code, 100).toUpperCase() || null;
  let orderReference = cleanText(metadata.order_reference, 120) || null;
  let serviceReference = cleanText(metadata.service_reference, 120) || null;
  const stripeCustomerId = stringId(object?.customer);
  const subscriptionId = stringId(object?.subscription) || (object?.object === "subscription" ? object.id : null);
  const checkoutRequestId = cleanText(metadata.central_checkout_request_id, 80) || null;

  if (checkoutRequestId) {
    const request = await env.DB.prepare(`SELECT platform_id,brand_code,product_code,price_code,customer_id,customer_number,
      order_reference,service_reference,stripe_customer_id FROM central_payment_checkout_requests WHERE id=?`).bind(checkoutRequestId).first();
    if (request) {
      platformId ||= request.platform_id;
      brandCode ||= request.brand_code;
      productCode ||= request.product_code;
      priceCode ||= request.price_code;
      customerId ||= request.customer_id;
      customerNumber ||= request.customer_number;
      orderReference ||= request.order_reference;
      serviceReference ||= request.service_reference;
    }
  }

  if ((!customerId || !customerNumber) && stripeCustomerId) {
    const link = await env.DB.prepare(`SELECT customer_id,customer_number FROM central_payment_customer_links WHERE stripe_customer_id=?`).bind(stripeCustomerId).first();
    customerId ||= link?.customer_id || null;
    customerNumber ||= link?.customer_number || null;
  }

  if (subscriptionId && (!platformId || !brandCode || !productCode || !customerNumber)) {
    const subscription = await env.DB.prepare(`SELECT platform_id,brand_code,product_code,price_code,customer_id,customer_number,
      order_reference,service_reference,stripe_customer_id FROM central_payment_subscriptions WHERE stripe_subscription_id=?`).bind(subscriptionId).first();
    if (subscription) {
      platformId ||= subscription.platform_id;
      brandCode ||= subscription.brand_code;
      productCode ||= subscription.product_code;
      priceCode ||= subscription.price_code;
      customerId ||= subscription.customer_id;
      customerNumber ||= subscription.customer_number;
      orderReference ||= subscription.order_reference;
      serviceReference ||= subscription.service_reference;
    }
  }

  return { metadata, platformId, brandCode: brandCode || null, productCode, priceCode, customerId, customerNumber: customerNumber || null,
    orderReference, serviceReference, stripeCustomerId, subscriptionId, checkoutRequestId };
}

async function enqueuePlatformEvent(env, platformId, eventType, reference, payload) {
  if (!platformId || !reference) return;
  await env.DB.prepare(`INSERT OR IGNORE INTO central_payment_event_outbox
    (id,platform_id,event_type,central_reference,payload_json,status,created_at)
    VALUES (?,?,?,?,?,'pending',?)`).bind(crypto.randomUUID(), platformId, eventType, reference, JSON.stringify(payload), new Date().toISOString()).run();
}

async function upsertTransaction(env, event, object, context) {
  const amount = object.amount_total ?? object.amount_received ?? object.amount_paid ?? object.amount ?? object.amount_refunded ?? null;
  const now = new Date().toISOString();
  const objectId = object.id || event.id;
  const paymentIntentId = stringId(object.payment_intent) || (object.object === "payment_intent" ? object.id : null);
  const invoiceId = object.object === "invoice" ? object.id : stringId(object.invoice);
  await env.DB.prepare(`INSERT INTO central_payment_transactions
    (id,stripe_object_id,object_type,event_type,platform_id,brand_code,product_code,price_code,customer_id,customer_number,
     stripe_customer_id,stripe_payment_intent_id,stripe_subscription_id,stripe_invoice_id,order_reference,service_reference,status,
     amount_minor,currency,occurred_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(stripe_object_id) DO UPDATE SET event_type=excluded.event_type,status=excluded.status,
      amount_minor=COALESCE(excluded.amount_minor,central_payment_transactions.amount_minor),
      currency=COALESCE(excluded.currency,central_payment_transactions.currency),updated_at=excluded.updated_at,
      metadata_json=excluded.metadata_json`)
    .bind(crypto.randomUUID(), objectId, object.object || "stripe_object", event.type,
      context.platformId, context.brandCode, context.productCode, context.priceCode, context.customerId, context.customerNumber,
      context.stripeCustomerId, paymentIntentId, context.subscriptionId, invoiceId, context.orderReference, context.serviceReference,
      cleanText(object.payment_status || object.status || event.type.split(".").at(-1), 80),
      Number.isFinite(Number(amount)) ? Number(amount) : null, cleanText(object.currency, 3).toUpperCase() || null,
      unixIso(object.created, unixIso(event.created, now)), now, JSON.stringify({ ...context.metadata, stripeEventType: event.type })).run();
  await enqueuePlatformEvent(env, context.platformId, event.type, objectId, {
    eventType: event.type, stripeObjectId: objectId, brandCode: context.brandCode, productCode: context.productCode,
    priceCode: context.priceCode, customerNumber: context.customerNumber, orderReference: context.orderReference,
    serviceReference: context.serviceReference, status: object.payment_status || object.status || null,
    amountMinor: Number.isFinite(Number(amount)) ? Number(amount) : null, currency: cleanText(object.currency, 3).toUpperCase() || null,
  });
}

async function upsertSubscription(env, event, object, context) {
  if (!object?.id) return;
  const now = new Date().toISOString();
  const item = object.items?.data?.[0] || null;
  const metadata = { ...context.metadata };
  const productCode = context.productCode;
  const priceCode = context.priceCode;
  await env.DB.prepare(`INSERT INTO central_payment_subscriptions
    (id,stripe_subscription_id,platform_id,brand_code,product_code,price_code,customer_id,customer_number,stripe_customer_id,status,
     quantity,current_period_start,current_period_end,cancel_at_period_end,cancelled_at,order_reference,service_reference,created_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(stripe_subscription_id) DO UPDATE SET status=excluded.status,quantity=excluded.quantity,
      current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
      cancel_at_period_end=excluded.cancel_at_period_end,cancelled_at=excluded.cancelled_at,updated_at=excluded.updated_at,
      metadata_json=excluded.metadata_json`)
    .bind(crypto.randomUUID(), object.id, context.platformId, context.brandCode, productCode, priceCode, context.customerId,
      context.customerNumber, context.stripeCustomerId, cleanText(object.status, 80) || "unknown", Number(item?.quantity || 1),
      unixIso(object.current_period_start || item?.current_period_start, null), unixIso(object.current_period_end || item?.current_period_end, null),
      object.cancel_at_period_end ? 1 : 0, unixIso(object.canceled_at, null), context.orderReference, context.serviceReference,
      unixIso(object.created, now), now, JSON.stringify(metadata)).run();
  await enqueuePlatformEvent(env, context.platformId, event.type, object.id, {
    eventType: event.type, subscriptionId: object.id, status: object.status, customerNumber: context.customerNumber,
    brandCode: context.brandCode, productCode, priceCode, currentPeriodEnd: unixIso(object.current_period_end || item?.current_period_end, null),
    cancelAtPeriodEnd: Boolean(object.cancel_at_period_end), orderReference: context.orderReference, serviceReference: context.serviceReference,
  });
}

export async function processCentralStripeEvent(env, event, rawBody) {
  await ensureCentralPaymentsSchema(env);
  const object = event?.data?.object;
  if (!event?.id || !event?.type || !object) throw Object.assign(new Error("The Stripe event payload is incomplete."), { code: "INVALID_STRIPE_EVENT", status: 400 });
  const digest = await sha256(rawBody);
  const now = new Date().toISOString();
  const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO central_payment_webhook_events
    (event_id,event_type,livemode,api_version,object_id,payload_hash,processing_status,received_at)
    VALUES (?,?,?,?,?,?,'processing',?)`).bind(event.id, event.type, event.livemode ? 1 : 0, event.api_version || null, object.id || null, digest, now).run();
  if (Number(inserted.meta?.changes || 0) === 0) return { duplicate: true };

  try {
    const context = await contextFromObject(env, object);
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      if (context.checkoutRequestId) {
        await env.DB.prepare(`UPDATE central_payment_checkout_requests SET status='completed',completed_at=?,updated_at=? WHERE id=?`)
          .bind(now, now, context.checkoutRequestId).run();
      }
      await upsertTransaction(env, event, object, context);
    } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      if (context.checkoutRequestId) await env.DB.prepare(`UPDATE central_payment_checkout_requests SET status=?,updated_at=? WHERE id=?`)
        .bind(event.type.endsWith("expired") ? "expired" : "failed", now, context.checkoutRequestId).run();
      await upsertTransaction(env, event, object, context);
    } else if (event.type.startsWith("customer.subscription.")) {
      await upsertSubscription(env, event, object, context);
      await upsertTransaction(env, event, object, context);
    } else if (
      event.type.startsWith("payment_intent.") || event.type.startsWith("invoice.") || event.type.startsWith("refund.")
      || event.type.startsWith("charge.refund") || event.type.startsWith("charge.dispute")
    ) {
      await upsertTransaction(env, event, object, context);
    }

    await env.DB.prepare(`UPDATE central_payment_webhook_events SET processing_status='processed',processed_at=? WHERE event_id=?`)
      .bind(now, event.id).run();
    return { duplicate: false, processed: true };
  } catch (cause) {
    await env.DB.prepare(`UPDATE central_payment_webhook_events SET processing_status='failed',processed_at=?,error_message=? WHERE event_id=?`)
      .bind(now, cleanText(cause?.message || "Central webhook processing failed.", 500), event.id).run();
    throw cause;
  }
}

export function centralPaymentError(cause, fallback = "Central Payments could not complete this request.") {
  return error(cause?.code || "CENTRAL_PAYMENTS_FAILED", cause?.message || fallback, cause?.status || 500,
    cause?.stripeParam ? { stripeParameter: cause.stripeParam } : undefined);
}
