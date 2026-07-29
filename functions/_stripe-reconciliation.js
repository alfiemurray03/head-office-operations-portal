import { cleanText, validEmail } from "./_shared.js";
import { ensureStripeControlSchema, resolveStripeConnector } from "./_stripe-control.js";

export const STRIPE_RECONCILIATION_EVENTS = Object.freeze([
  "customer.deleted",
  "charge.succeeded",
  "charge.failed",
  "charge.updated",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "product.created",
  "product.updated",
  "product.deleted",
  "price.created",
  "price.updated",
  "price.deleted"
]);

const RECONCILIATION_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS stripe_division_customer_records (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,stripe_customer_id TEXT NOT NULL,customer_id TEXT,customer_number TEXT,
    email TEXT,name TEXT,phone TEXT,currency TEXT,balance_minor INTEGER NOT NULL DEFAULT 0,delinquent INTEGER NOT NULL DEFAULT 0,
    tax_exempt TEXT,livemode INTEGER NOT NULL DEFAULT 0,source_created_at TEXT,source_updated_at TEXT,deleted_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(connector_code,stripe_customer_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_division_balance_transactions (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,stripe_transaction_id TEXT NOT NULL,source_id TEXT,transaction_type TEXT NOT NULL,
    reporting_category TEXT,status TEXT,amount_minor INTEGER NOT NULL,fee_minor INTEGER NOT NULL DEFAULT 0,net_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,description TEXT,exchange_rate REAL,source_created_at TEXT NOT NULL,available_on TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(connector_code,stripe_transaction_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_division_refund_records (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,stripe_refund_id TEXT NOT NULL,charge_id TEXT,payment_intent_id TEXT,
    stripe_customer_id TEXT,customer_id TEXT,customer_number TEXT,status TEXT,reason TEXT,amount_minor INTEGER NOT NULL,currency TEXT NOT NULL,
    description TEXT,failure_reason TEXT,source_created_at TEXT NOT NULL,metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(connector_code,stripe_refund_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_division_dispute_records (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,stripe_dispute_id TEXT NOT NULL,charge_id TEXT,payment_intent_id TEXT,
    stripe_customer_id TEXT,customer_id TEXT,customer_number TEXT,status TEXT NOT NULL,reason TEXT,amount_minor INTEGER NOT NULL,
    currency TEXT NOT NULL,evidence_due_by TEXT,is_charge_refundable INTEGER NOT NULL DEFAULT 0,source_created_at TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(connector_code,stripe_dispute_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_division_product_records (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,stripe_product_id TEXT NOT NULL,name TEXT NOT NULL,description TEXT,
    active INTEGER NOT NULL DEFAULT 1,default_price_id TEXT,statement_descriptor TEXT,unit_label TEXT,shippable INTEGER,
    livemode INTEGER NOT NULL DEFAULT 0,source_created_at TEXT,source_updated_at TEXT,deleted_at TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(connector_code,stripe_product_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_division_price_records (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,stripe_price_id TEXT NOT NULL,stripe_product_id TEXT,active INTEGER NOT NULL DEFAULT 1,
    currency TEXT,unit_amount_minor INTEGER,price_type TEXT,recurring_interval TEXT,recurring_interval_count INTEGER,usage_type TEXT,
    lookup_key TEXT,nickname TEXT,tax_behavior TEXT,billing_scheme TEXT,livemode INTEGER NOT NULL DEFAULT 0,source_created_at TEXT,
    deleted_at TEXT,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    UNIQUE(connector_code,stripe_price_id)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_division_sync_checkpoints (
    connector_code TEXT NOT NULL,resource_name TEXT NOT NULL,cursor TEXT,backfill_complete INTEGER NOT NULL DEFAULT 0,
    last_started_at TEXT,last_completed_at TEXT,last_error TEXT,updated_at TEXT NOT NULL,
    PRIMARY KEY(connector_code,resource_name)
  )`,
  `CREATE TABLE IF NOT EXISTS stripe_division_sync_runs (
    id TEXT PRIMARY KEY,connector_code TEXT NOT NULL,sync_mode TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,
    completed_at TEXT,stats_json TEXT NOT NULL DEFAULT '{}',error_message TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_stripe_customer_records_connector ON stripe_division_customer_records(connector_code,updated_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_stripe_balance_transactions_connector ON stripe_division_balance_transactions(connector_code,source_created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_stripe_refunds_connector ON stripe_division_refund_records(connector_code,source_created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_stripe_disputes_connector ON stripe_division_dispute_records(connector_code,source_created_at DESC)",
  "CREATE INDEX IF NOT EXISTS idx_stripe_products_connector ON stripe_division_product_records(connector_code,active,name)",
  "CREATE INDEX IF NOT EXISTS idx_stripe_prices_connector ON stripe_division_price_records(connector_code,active,stripe_product_id)",
  "CREATE INDEX IF NOT EXISTS idx_stripe_sync_runs_connector ON stripe_division_sync_runs(connector_code,started_at DESC)"
];

export async function ensureStripeReconciliationSchema(env) {
  await ensureStripeControlSchema(env);
  for (const statement of RECONCILIATION_SCHEMA) await env.DB.prepare(statement).run();
}

const nowIso = () => new Date().toISOString();

function isoFromUnix(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : fallback;
}

function metadataOf(object) {
  return object?.metadata && typeof object.metadata === "object" ? object.metadata : {};
}

function cleanCurrency(value) {
  return cleanText(value, 3).toUpperCase() || null;
}

function stripeCustomerId(object) {
  if (typeof object?.customer === "string") return object.customer;
  if (object?.customer?.id) return object.customer.id;
  if (object?.object === "customer") return object.id;
  return null;
}

function ucnFromObject(object) {
  const metadata = metadataOf(object);
  const values = [metadata.ucn, metadata.customerNumber, metadata.customer_number, object?.client_reference_id];
  return values.map(value => cleanText(value, 30)).find(value => /^\d{10}$/.test(value)) || null;
}

function emailFromObject(object) {
  const values = [
    object?.email,
    object?.receipt_email,
    object?.customer_email,
    object?.customer_details?.email,
    object?.billing_details?.email,
    metadataOf(object).email
  ];
  return values.map(value => cleanText(value, 254).toLowerCase()).find(validEmail) || null;
}

async function resolveCentralCustomer(env, connector, object, explicitStripeCustomerId = null) {
  const ucn = ucnFromObject(object);
  if (ucn) {
    const customer = await env.DB.prepare("SELECT id,customer_number,verified_email,display_name FROM customers WHERE customer_number=?")
      .bind(ucn).first();
    if (customer) return customer;
  }
  const providerCustomer = explicitStripeCustomerId || stripeCustomerId(object);
  if (providerCustomer) {
    const linked = await env.DB.prepare(`SELECT c.id,c.customer_number,c.verified_email,c.display_name
      FROM stripe_division_customer_links l JOIN customers c ON c.id=l.customer_id
      WHERE l.connector_code=? AND l.stripe_customer_id=?`).bind(connector.code, providerCustomer).first();
    if (linked) return linked;
  }
  const email = emailFromObject(object);
  if (!email) return null;
  const matches = await env.DB.prepare("SELECT id,customer_number,verified_email,display_name FROM customers WHERE lower(verified_email)=? LIMIT 2")
    .bind(email).all();
  return matches.results?.length === 1 ? matches.results[0] : null;
}

async function upsertCustomerLink(env, connector, object, customer) {
  const stripeId = object?.id || stripeCustomerId(object);
  if (!stripeId) return;
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO stripe_division_customer_links
    (id,connector_code,stripe_customer_id,customer_id,customer_number,email,name,livemode,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_customer_id) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,stripe_division_customer_links.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_division_customer_links.customer_number),
      email=COALESCE(excluded.email,stripe_division_customer_links.email),
      name=COALESCE(excluded.name,stripe_division_customer_links.name),livemode=excluded.livemode,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), connector.code, stripeId, customer?.id || null, customer?.customer_number || ucnFromObject(object),
      emailFromObject(object), cleanText(object?.name, 160) || null, object?.livemode ? 1 : 0, now, now).run();
}

export async function upsertStripeCustomerRecord(env, connector, object) {
  if (!object?.id) return;
  const customer = await resolveCentralCustomer(env, connector, object, object.id);
  await upsertCustomerLink(env, connector, object, customer);
  const now = nowIso();
  const deleted = Boolean(object.deleted);
  await env.DB.prepare(`INSERT INTO stripe_division_customer_records
    (id,connector_code,stripe_customer_id,customer_id,customer_number,email,name,phone,currency,balance_minor,delinquent,tax_exempt,
     livemode,source_created_at,source_updated_at,deleted_at,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_customer_id) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,stripe_division_customer_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_division_customer_records.customer_number),
      email=COALESCE(excluded.email,stripe_division_customer_records.email),name=COALESCE(excluded.name,stripe_division_customer_records.name),
      phone=COALESCE(excluded.phone,stripe_division_customer_records.phone),currency=COALESCE(excluded.currency,stripe_division_customer_records.currency),
      balance_minor=excluded.balance_minor,delinquent=excluded.delinquent,tax_exempt=COALESCE(excluded.tax_exempt,stripe_division_customer_records.tax_exempt),
      source_updated_at=COALESCE(excluded.source_updated_at,stripe_division_customer_records.source_updated_at),
      deleted_at=COALESCE(excluded.deleted_at,stripe_division_customer_records.deleted_at),metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), connector.code, object.id, customer?.id || null, customer?.customer_number || ucnFromObject(object),
      emailFromObject(object), cleanText(object.name, 160) || null, cleanText(object.phone, 80) || null, cleanCurrency(object.currency),
      Number.isFinite(Number(object.balance)) ? Number(object.balance) : 0, object.delinquent ? 1 : 0,
      cleanText(object.tax_exempt, 40) || null, object.livemode ? 1 : 0, isoFromUnix(object.created),
      isoFromUnix(object.updated), deleted ? now : null, JSON.stringify(metadataOf(object)), now, now).run();
}

async function upsertStripeCharge(env, connector, object, eventType = "stripe.sync.charge") {
  if (!object?.id) return;
  const customer = await resolveCentralCustomer(env, connector, object);
  const now = nowIso();
  let status = cleanText(object.status, 80);
  if (!status) status = object.refunded ? "refunded" : object.paid ? "succeeded" : object.failure_code ? "failed" : "unknown";
  await env.DB.prepare(`INSERT INTO stripe_division_payment_records
    (id,connector_code,stripe_object_id,object_type,event_type,customer_id,customer_number,stripe_customer_id,platform_code,status,
     amount_minor,currency,description,receipt_email,occurred_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_object_id) DO UPDATE SET
      event_type=excluded.event_type,customer_id=COALESCE(excluded.customer_id,stripe_division_payment_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_division_payment_records.customer_number),status=excluded.status,
      amount_minor=excluded.amount_minor,currency=excluded.currency,description=COALESCE(excluded.description,stripe_division_payment_records.description),
      receipt_email=COALESCE(excluded.receipt_email,stripe_division_payment_records.receipt_email),updated_at=excluded.updated_at,
      metadata_json=excluded.metadata_json`)
    .bind(crypto.randomUUID(), connector.code, object.id, object.object || "charge", eventType, customer?.id || null,
      customer?.customer_number || ucnFromObject(object), stripeCustomerId(object), connector.code, status,
      Number.isFinite(Number(object.amount)) ? Number(object.amount) : null, cleanCurrency(object.currency),
      cleanText(object.description, 500) || null, emailFromObject(object), isoFromUnix(object.created, now), now,
      JSON.stringify({ ...metadataOf(object), amountRefunded: object.amount_refunded || 0, balanceTransaction: object.balance_transaction || null })).run();
}

async function upsertStripeOrder(env, connector, object) {
  if (!object?.id) return;
  const customer = await resolveCentralCustomer(env, connector, object);
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO stripe_division_order_records
    (id,connector_code,stripe_object_id,customer_id,customer_number,stripe_customer_id,platform_code,status,payment_status,
     amount_total_minor,currency,customer_email,occurred_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_object_id) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,stripe_division_order_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_division_order_records.customer_number),status=excluded.status,
      payment_status=excluded.payment_status,amount_total_minor=excluded.amount_total_minor,currency=excluded.currency,
      customer_email=COALESCE(excluded.customer_email,stripe_division_order_records.customer_email),updated_at=excluded.updated_at,
      metadata_json=excluded.metadata_json`)
    .bind(crypto.randomUUID(), connector.code, object.id, customer?.id || null, customer?.customer_number || ucnFromObject(object),
      stripeCustomerId(object), connector.code, cleanText(object.status, 80) || null, cleanText(object.payment_status, 80) || null,
      Number.isFinite(Number(object.amount_total)) ? Number(object.amount_total) : null, cleanCurrency(object.currency),
      emailFromObject(object), isoFromUnix(object.created, now), now, JSON.stringify(metadataOf(object))).run();
}

async function upsertStripeSubscription(env, connector, object) {
  if (!object?.id) return;
  const customer = await resolveCentralCustomer(env, connector, object);
  const item = object.items?.data?.[0];
  const price = item?.price;
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO stripe_division_subscription_records
    (id,connector_code,stripe_subscription_id,customer_id,customer_number,stripe_customer_id,platform_code,status,price_id,product_id,
     quantity,current_period_start,current_period_end,cancel_at_period_end,cancelled_at,created_at,updated_at,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_subscription_id) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,stripe_division_subscription_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_division_subscription_records.customer_number),status=excluded.status,
      price_id=COALESCE(excluded.price_id,stripe_division_subscription_records.price_id),
      product_id=COALESCE(excluded.product_id,stripe_division_subscription_records.product_id),quantity=excluded.quantity,
      current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,
      cancel_at_period_end=excluded.cancel_at_period_end,cancelled_at=excluded.cancelled_at,updated_at=excluded.updated_at,
      metadata_json=excluded.metadata_json`)
    .bind(crypto.randomUUID(), connector.code, object.id, customer?.id || null, customer?.customer_number || ucnFromObject(object),
      stripeCustomerId(object), connector.code, cleanText(object.status, 80) || "unknown", cleanText(price?.id, 120) || null,
      typeof price?.product === "string" ? price.product : cleanText(price?.product?.id, 120) || null,
      Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : null, isoFromUnix(object.current_period_start),
      isoFromUnix(object.current_period_end), object.cancel_at_period_end ? 1 : 0, isoFromUnix(object.canceled_at),
      isoFromUnix(object.created, now), now, JSON.stringify(metadataOf(object))).run();
}

export async function upsertStripeRefundRecord(env, connector, object) {
  if (!object?.id) return;
  const customerId = stripeCustomerId(object);
  const customer = await resolveCentralCustomer(env, connector, object, customerId);
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO stripe_division_refund_records
    (id,connector_code,stripe_refund_id,charge_id,payment_intent_id,stripe_customer_id,customer_id,customer_number,status,reason,
     amount_minor,currency,description,failure_reason,source_created_at,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_refund_id) DO UPDATE SET
      charge_id=COALESCE(excluded.charge_id,stripe_division_refund_records.charge_id),
      payment_intent_id=COALESCE(excluded.payment_intent_id,stripe_division_refund_records.payment_intent_id),
      stripe_customer_id=COALESCE(excluded.stripe_customer_id,stripe_division_refund_records.stripe_customer_id),
      customer_id=COALESCE(excluded.customer_id,stripe_division_refund_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_division_refund_records.customer_number),status=excluded.status,
      reason=COALESCE(excluded.reason,stripe_division_refund_records.reason),amount_minor=excluded.amount_minor,currency=excluded.currency,
      description=COALESCE(excluded.description,stripe_division_refund_records.description),failure_reason=excluded.failure_reason,
      metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), connector.code, object.id, typeof object.charge === "string" ? object.charge : object.charge?.id || null,
      typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id || null, customerId,
      customer?.id || null, customer?.customer_number || ucnFromObject(object), cleanText(object.status, 80) || "unknown",
      cleanText(object.reason, 80) || null, Number(object.amount || 0), cleanCurrency(object.currency) || "GBP",
      cleanText(object.description, 500) || null, cleanText(object.failure_reason, 160) || null,
      isoFromUnix(object.created, now), JSON.stringify(metadataOf(object)), now, now).run();
}

export async function upsertStripeDisputeRecord(env, connector, object) {
  if (!object?.id) return;
  const customerId = stripeCustomerId(object);
  const customer = await resolveCentralCustomer(env, connector, object, customerId);
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO stripe_division_dispute_records
    (id,connector_code,stripe_dispute_id,charge_id,payment_intent_id,stripe_customer_id,customer_id,customer_number,status,reason,
     amount_minor,currency,evidence_due_by,is_charge_refundable,source_created_at,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_dispute_id) DO UPDATE SET
      charge_id=COALESCE(excluded.charge_id,stripe_division_dispute_records.charge_id),
      payment_intent_id=COALESCE(excluded.payment_intent_id,stripe_division_dispute_records.payment_intent_id),
      stripe_customer_id=COALESCE(excluded.stripe_customer_id,stripe_division_dispute_records.stripe_customer_id),
      customer_id=COALESCE(excluded.customer_id,stripe_division_dispute_records.customer_id),
      customer_number=COALESCE(excluded.customer_number,stripe_division_dispute_records.customer_number),status=excluded.status,
      reason=COALESCE(excluded.reason,stripe_division_dispute_records.reason),amount_minor=excluded.amount_minor,currency=excluded.currency,
      evidence_due_by=excluded.evidence_due_by,is_charge_refundable=excluded.is_charge_refundable,
      metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), connector.code, object.id, typeof object.charge === "string" ? object.charge : object.charge?.id || null,
      typeof object.payment_intent === "string" ? object.payment_intent : object.payment_intent?.id || null, customerId,
      customer?.id || null, customer?.customer_number || ucnFromObject(object), cleanText(object.status, 80) || "unknown",
      cleanText(object.reason, 120) || null, Number(object.amount || 0), cleanCurrency(object.currency) || "GBP",
      isoFromUnix(object.evidence_details?.due_by), object.is_charge_refundable ? 1 : 0, isoFromUnix(object.created, now),
      JSON.stringify(metadataOf(object)), now, now).run();
}

export async function upsertStripeProductRecord(env, connector, object) {
  if (!object?.id) return;
  const now = nowIso();
  const deleted = Boolean(object.deleted);
  const defaultPrice = typeof object.default_price === "string" ? object.default_price : object.default_price?.id || null;
  await env.DB.prepare(`INSERT INTO stripe_division_product_records
    (id,connector_code,stripe_product_id,name,description,active,default_price_id,statement_descriptor,unit_label,shippable,
     livemode,source_created_at,source_updated_at,deleted_at,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_product_id) DO UPDATE SET
      name=CASE WHEN excluded.name='Deleted product' THEN stripe_division_product_records.name ELSE excluded.name END,
      description=COALESCE(excluded.description,stripe_division_product_records.description),active=excluded.active,
      default_price_id=COALESCE(excluded.default_price_id,stripe_division_product_records.default_price_id),
      statement_descriptor=COALESCE(excluded.statement_descriptor,stripe_division_product_records.statement_descriptor),
      unit_label=COALESCE(excluded.unit_label,stripe_division_product_records.unit_label),shippable=COALESCE(excluded.shippable,stripe_division_product_records.shippable),
      source_updated_at=COALESCE(excluded.source_updated_at,stripe_division_product_records.source_updated_at),
      deleted_at=COALESCE(excluded.deleted_at,stripe_division_product_records.deleted_at),metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), connector.code, object.id, cleanText(object.name, 180) || "Deleted product",
      cleanText(object.description, 1000) || null, deleted ? 0 : object.active === false ? 0 : 1, defaultPrice,
      cleanText(object.statement_descriptor, 80) || null, cleanText(object.unit_label, 80) || null,
      typeof object.shippable === "boolean" ? (object.shippable ? 1 : 0) : null, object.livemode ? 1 : 0,
      isoFromUnix(object.created), isoFromUnix(object.updated), deleted ? now : null, JSON.stringify(metadataOf(object)), now, now).run();
}

export async function upsertStripePriceRecord(env, connector, object) {
  if (!object?.id) return;
  const now = nowIso();
  const deleted = Boolean(object.deleted);
  const productId = typeof object.product === "string" ? object.product : object.product?.id || null;
  await env.DB.prepare(`INSERT INTO stripe_division_price_records
    (id,connector_code,stripe_price_id,stripe_product_id,active,currency,unit_amount_minor,price_type,recurring_interval,
     recurring_interval_count,usage_type,lookup_key,nickname,tax_behavior,billing_scheme,livemode,source_created_at,deleted_at,
     metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_price_id) DO UPDATE SET
      stripe_product_id=COALESCE(excluded.stripe_product_id,stripe_division_price_records.stripe_product_id),active=excluded.active,
      currency=COALESCE(excluded.currency,stripe_division_price_records.currency),unit_amount_minor=COALESCE(excluded.unit_amount_minor,stripe_division_price_records.unit_amount_minor),
      price_type=COALESCE(excluded.price_type,stripe_division_price_records.price_type),recurring_interval=COALESCE(excluded.recurring_interval,stripe_division_price_records.recurring_interval),
      recurring_interval_count=COALESCE(excluded.recurring_interval_count,stripe_division_price_records.recurring_interval_count),
      usage_type=COALESCE(excluded.usage_type,stripe_division_price_records.usage_type),lookup_key=COALESCE(excluded.lookup_key,stripe_division_price_records.lookup_key),
      nickname=COALESCE(excluded.nickname,stripe_division_price_records.nickname),tax_behavior=COALESCE(excluded.tax_behavior,stripe_division_price_records.tax_behavior),
      billing_scheme=COALESCE(excluded.billing_scheme,stripe_division_price_records.billing_scheme),
      deleted_at=COALESCE(excluded.deleted_at,stripe_division_price_records.deleted_at),metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), connector.code, object.id, productId, deleted ? 0 : object.active === false ? 0 : 1,
      cleanCurrency(object.currency), Number.isFinite(Number(object.unit_amount)) ? Number(object.unit_amount) : null,
      cleanText(object.type, 40) || null, cleanText(object.recurring?.interval, 40) || null,
      Number.isFinite(Number(object.recurring?.interval_count)) ? Number(object.recurring.interval_count) : null,
      cleanText(object.recurring?.usage_type, 40) || null, cleanText(object.lookup_key, 120) || null,
      cleanText(object.nickname, 160) || null, cleanText(object.tax_behavior, 40) || null,
      cleanText(object.billing_scheme, 40) || null, object.livemode ? 1 : 0, isoFromUnix(object.created),
      deleted ? now : null, JSON.stringify(metadataOf(object)), now, now).run();
}

async function upsertBalanceTransaction(env, connector, object) {
  if (!object?.id) return;
  const now = nowIso();
  const sourceId = typeof object.source === "string" ? object.source : object.source?.id || null;
  await env.DB.prepare(`INSERT INTO stripe_division_balance_transactions
    (id,connector_code,stripe_transaction_id,source_id,transaction_type,reporting_category,status,amount_minor,fee_minor,net_minor,
     currency,description,exchange_rate,source_created_at,available_on,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,stripe_transaction_id) DO UPDATE SET
      source_id=COALESCE(excluded.source_id,stripe_division_balance_transactions.source_id),transaction_type=excluded.transaction_type,
      reporting_category=excluded.reporting_category,status=excluded.status,amount_minor=excluded.amount_minor,fee_minor=excluded.fee_minor,
      net_minor=excluded.net_minor,currency=excluded.currency,description=COALESCE(excluded.description,stripe_division_balance_transactions.description),
      exchange_rate=excluded.exchange_rate,available_on=excluded.available_on,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
    .bind(crypto.randomUUID(), connector.code, object.id, sourceId, cleanText(object.type, 80) || "unknown",
      cleanText(object.reporting_category, 80) || null, cleanText(object.status, 40) || null, Number(object.amount || 0),
      Number(object.fee || 0), Number(object.net || 0), cleanCurrency(object.currency) || "GBP",
      cleanText(object.description, 500) || null, Number.isFinite(Number(object.exchange_rate)) ? Number(object.exchange_rate) : null,
      isoFromUnix(object.created, now), isoFromUnix(object.available_on), JSON.stringify({ feeDetails: object.fee_details || [] }), now, now).run();
}

export async function processStripeReconciliationEvent(env, connector, event) {
  await ensureStripeReconciliationSchema(env);
  const object = event?.data?.object;
  if (!object?.id) return { handled: false };
  if (object.object === "customer") await upsertStripeCustomerRecord(env, connector, object);
  else if (object.object === "charge") await upsertStripeCharge(env, connector, object, event.type);
  else if (object.object === "checkout.session") await upsertStripeOrder(env, connector, object);
  else if (object.object === "subscription") await upsertStripeSubscription(env, connector, object);
  else if (object.object === "refund") await upsertStripeRefundRecord(env, connector, object);
  else if (object.object === "dispute") await upsertStripeDisputeRecord(env, connector, object);
  else if (object.object === "product") await upsertStripeProductRecord(env, connector, object);
  else if (object.object === "price") await upsertStripePriceRecord(env, connector, object);
  else return { handled: false, objectType: object.object };
  return { handled: true, objectType: object.object, connectorCode: connector.code };
}

async function stripeGet(connector, path, parameters = {}) {
  const url = new URL(`https://api.stripe.com/v1/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(parameters)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach(item => url.searchParams.append(key, String(item)));
    else url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, { headers: { Authorization: `Bearer ${connector.secretKey}`, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(cleanText(payload?.error?.message, 500) || `${connector.name} Stripe request failed.`), {
      code: "STRIPE_SYNC_API_FAILED",
      status: response.status || 502,
      details: { division: connector.slug, path, stripeType: payload?.error?.type || null }
    });
  }
  return payload;
}

const RESOURCE_DEFINITIONS = [
  { name: "customers", path: "customers", parameters: {}, store: upsertStripeCustomerRecord },
  { name: "charges", path: "charges", parameters: {}, store: upsertStripeCharge },
  { name: "checkout_sessions", path: "checkout/sessions", parameters: {}, store: upsertStripeOrder },
  { name: "subscriptions", path: "subscriptions", parameters: { status: "all" }, store: upsertStripeSubscription },
  { name: "refunds", path: "refunds", parameters: {}, store: upsertStripeRefundRecord },
  { name: "disputes", path: "disputes", parameters: {}, store: upsertStripeDisputeRecord },
  { name: "products", path: "products", parameters: {}, store: upsertStripeProductRecord },
  { name: "prices_active", path: "prices", parameters: { active: "true" }, store: upsertStripePriceRecord },
  { name: "prices_inactive", path: "prices", parameters: { active: "false" }, store: upsertStripePriceRecord },
  { name: "balance_transactions", path: "balance_transactions", parameters: {}, store: upsertBalanceTransaction }
];

async function checkpoint(env, connectorCode, resourceName) {
  return env.DB.prepare("SELECT * FROM stripe_division_sync_checkpoints WHERE connector_code=? AND resource_name=?")
    .bind(connectorCode, resourceName).first();
}

async function saveCheckpoint(env, connectorCode, resourceName, values) {
  const now = nowIso();
  await env.DB.prepare(`INSERT INTO stripe_division_sync_checkpoints
    (connector_code,resource_name,cursor,backfill_complete,last_started_at,last_completed_at,last_error,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_code,resource_name) DO UPDATE SET
      cursor=excluded.cursor,backfill_complete=excluded.backfill_complete,last_started_at=excluded.last_started_at,
      last_completed_at=excluded.last_completed_at,last_error=excluded.last_error,updated_at=excluded.updated_at`)
    .bind(connectorCode, resourceName, values.cursor || null, values.backfillComplete ? 1 : 0,
      values.lastStartedAt || null, values.lastCompletedAt || null, values.lastError || null, now).run();
}

async function syncResource(env, connector, definition, mode, reset) {
  const startedAt = nowIso();
  let state = await checkpoint(env, connector.code, definition.name);
  if (reset) {
    state = null;
    await saveCheckpoint(env, connector.code, definition.name, { cursor: null, backfillComplete: false, lastStartedAt: startedAt });
  }
  const continuingBackfill = mode === "full" && !Number(state?.backfill_complete || 0);
  let cursor = continuingBackfill ? state?.cursor || null : null;
  const maximumPages = continuingBackfill ? 10 : 3;
  let imported = 0;
  let page = 0;
  let hasMore = false;
  try {
    do {
      const payload = await stripeGet(connector, definition.path, { ...definition.parameters, limit: 100, starting_after: cursor });
      const rows = Array.isArray(payload.data) ? payload.data : [];
      for (const row of rows) {
        await definition.store(env, connector, row);
        imported += 1;
      }
      hasMore = Boolean(payload.has_more && rows.length);
      cursor = rows.at(-1)?.id || cursor;
      page += 1;
    } while (hasMore && page < maximumPages);
    const backfillComplete = continuingBackfill ? !hasMore : Boolean(state?.backfill_complete);
    await saveCheckpoint(env, connector.code, definition.name, {
      cursor: continuingBackfill && hasMore ? cursor : null,
      backfillComplete,
      lastStartedAt: startedAt,
      lastCompletedAt: nowIso(),
      lastError: null
    });
    return { resource: definition.name, imported, pages: page, partial: continuingBackfill && hasMore, backfillComplete };
  } catch (cause) {
    await saveCheckpoint(env, connector.code, definition.name, {
      cursor, backfillComplete: Boolean(state?.backfill_complete), lastStartedAt: startedAt,
      lastCompletedAt: null, lastError: cleanText(cause?.message || String(cause), 1000)
    });
    throw cause;
  }
}

export async function syncStripeDivision(env, division, options = {}) {
  await ensureStripeReconciliationSchema(env);
  const connector = resolveStripeConnector(env, division);
  if (!connector.secretKey) {
    throw Object.assign(new Error(`${connector.secretKeyBinding} is not configured.`), { code: "STRIPE_API_NOT_CONFIGURED", status: 503 });
  }
  const mode = options.mode === "recent" ? "recent" : "full";
  const runId = crypto.randomUUID();
  const startedAt = nowIso();
  await env.DB.prepare(`INSERT INTO stripe_division_sync_runs
    (id,connector_code,sync_mode,status,started_at,stats_json) VALUES (?,?,?,'running',?,'{}')`)
    .bind(runId, connector.code, mode, startedAt).run();
  const resources = [];
  try {
    for (const definition of RESOURCE_DEFINITIONS) {
      resources.push(await syncResource(env, connector, definition, mode, Boolean(options.reset)));
    }
    const partial = resources.some(item => item.partial);
    const stats = Object.fromEntries(resources.map(item => [item.resource, item.imported]));
    await env.DB.prepare("UPDATE stripe_division_sync_runs SET status=?,completed_at=?,stats_json=? WHERE id=?")
      .bind(partial ? "partial" : "completed", nowIso(), JSON.stringify({ resources, totals: stats }), runId).run();
    return { runId, connector: { slug: connector.slug, code: connector.code, name: connector.name }, mode, partial, resources, totals: stats };
  } catch (cause) {
    await env.DB.prepare("UPDATE stripe_division_sync_runs SET status='failed',completed_at=?,stats_json=?,error_message=? WHERE id=?")
      .bind(nowIso(), JSON.stringify({ resources }), cleanText(cause?.message || String(cause), 1000), runId).run();
    throw cause;
  }
}

export async function syncStripeAccounts(env, options = {}) {
  const divisions = options.division ? [options.division] : ["planyx", "profile-centre"];
  const results = [];
  for (const division of divisions) results.push(await syncStripeDivision(env, division, options));
  return { completedAt: nowIso(), mode: options.mode === "recent" ? "recent" : "full", results };
}

export async function stripeReconciliationStatus(env) {
  await ensureStripeReconciliationSchema(env);
  const connectors = [];
  for (const division of ["planyx", "profile-centre"]) {
    const connector = resolveStripeConnector(env, division);
    const [counts, financials, lastRun, checkpoints] = await env.DB.batch([
      env.DB.prepare(`SELECT
        (SELECT COUNT(*) FROM stripe_division_customer_records WHERE connector_code=? AND deleted_at IS NULL) customers,
        (SELECT COUNT(*) FROM stripe_division_balance_transactions WHERE connector_code=?) transactions,
        (SELECT COUNT(*) FROM stripe_division_refund_records WHERE connector_code=?) refunds,
        (SELECT COUNT(*) FROM stripe_division_dispute_records WHERE connector_code=?) disputes,
        (SELECT COUNT(*) FROM stripe_division_dispute_records WHERE connector_code=? AND status NOT IN ('won','lost','warning_closed')) open_disputes,
        (SELECT COUNT(*) FROM stripe_division_product_records WHERE connector_code=?) products,
        (SELECT COUNT(*) FROM stripe_division_product_records WHERE connector_code=? AND active=1 AND deleted_at IS NULL) active_products,
        (SELECT COUNT(*) FROM stripe_division_price_records WHERE connector_code=?) prices,
        (SELECT COUNT(*) FROM stripe_division_price_records WHERE connector_code=? AND active=1 AND deleted_at IS NULL) active_prices`)
        .bind(connector.code,connector.code,connector.code,connector.code,connector.code,connector.code,connector.code,connector.code,connector.code),
      env.DB.prepare(`SELECT currency,
        SUM(CASE WHEN reporting_category='charge' OR transaction_type IN ('charge','payment') THEN amount_minor ELSE 0 END) gross_minor,
        ABS(SUM(CASE WHEN reporting_category='refund' OR transaction_type IN ('refund','payment_refund','payment_failure_refund') THEN amount_minor ELSE 0 END)) refunds_minor,
        SUM(fee_minor) fees_minor,SUM(net_minor) net_minor
        FROM stripe_division_balance_transactions WHERE connector_code=? GROUP BY currency ORDER BY currency`).bind(connector.code),
      env.DB.prepare("SELECT id,sync_mode,status,started_at,completed_at,stats_json,error_message FROM stripe_division_sync_runs WHERE connector_code=? ORDER BY started_at DESC LIMIT 1")
        .bind(connector.code),
      env.DB.prepare("SELECT resource_name,backfill_complete,last_completed_at,last_error FROM stripe_division_sync_checkpoints WHERE connector_code=? ORDER BY resource_name")
        .bind(connector.code)
    ]);
    connectors.push({
      connector: { slug: connector.slug, code: connector.code, name: connector.name },
      counts: counts.results?.[0] || {},
      financials: financials.results || [],
      lastRun: lastRun.results?.[0] || null,
      checkpoints: checkpoints.results || []
    });
  }
  const totalKeys = ["customers","transactions","refunds","disputes","open_disputes","products","active_products","prices","active_prices"];
  const totals = Object.fromEntries(totalKeys.map(key => [key, connectors.reduce((sum, item) => sum + Number(item.counts?.[key] || 0), 0)]));
  const currencies = new Map();
  for (const item of connectors) {
    for (const row of item.financials) {
      const current = currencies.get(row.currency) || { currency: row.currency, gross_minor: 0, refunds_minor: 0, fees_minor: 0, net_minor: 0 };
      for (const key of ["gross_minor","refunds_minor","fees_minor","net_minor"]) current[key] += Number(row[key] || 0);
      currencies.set(row.currency, current);
    }
  }
  return { connectors, totals, financials: [...currencies.values()] };
}

function searchPattern(value) {
  return `%${cleanText(value, 120).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

export async function stripeReconciliationRecords(env, division, query = "", limit = 100) {
  await ensureStripeReconciliationSchema(env);
  const connector = resolveStripeConnector(env, division);
  const cleanQuery = cleanText(query, 120);
  const pattern = searchPattern(cleanQuery);
  const safeLimit = Math.max(10, Math.min(Number(limit) || 100, 250));
  const [customers, transactions, refunds, disputes, products, prices, syncRuns] = await env.DB.batch([
    env.DB.prepare(`SELECT r.*,c.display_name customer_name FROM stripe_division_customer_records r LEFT JOIN customers c ON c.id=r.customer_id
      WHERE r.connector_code=? AND (?='' OR r.stripe_customer_id LIKE ? ESCAPE '\\' OR r.email LIKE ? ESCAPE '\\' OR r.name LIKE ? ESCAPE '\\' OR r.customer_number LIKE ? ESCAPE '\\')
      ORDER BY r.updated_at DESC LIMIT ?`).bind(connector.code,cleanQuery,pattern,pattern,pattern,pattern,safeLimit),
    env.DB.prepare(`SELECT * FROM stripe_division_balance_transactions WHERE connector_code=? AND
      (?='' OR stripe_transaction_id LIKE ? ESCAPE '\\' OR source_id LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\' OR transaction_type LIKE ? ESCAPE '\\')
      ORDER BY source_created_at DESC LIMIT ?`).bind(connector.code,cleanQuery,pattern,pattern,pattern,pattern,safeLimit),
    env.DB.prepare(`SELECT r.*,c.display_name customer_name FROM stripe_division_refund_records r LEFT JOIN customers c ON c.id=r.customer_id
      WHERE r.connector_code=? AND (?='' OR r.stripe_refund_id LIKE ? ESCAPE '\\' OR r.charge_id LIKE ? ESCAPE '\\' OR r.customer_number LIKE ? ESCAPE '\\' OR c.display_name LIKE ? ESCAPE '\\')
      ORDER BY r.source_created_at DESC LIMIT ?`).bind(connector.code,cleanQuery,pattern,pattern,pattern,pattern,safeLimit),
    env.DB.prepare(`SELECT d.*,c.display_name customer_name FROM stripe_division_dispute_records d LEFT JOIN customers c ON c.id=d.customer_id
      WHERE d.connector_code=? AND (?='' OR d.stripe_dispute_id LIKE ? ESCAPE '\\' OR d.charge_id LIKE ? ESCAPE '\\' OR d.customer_number LIKE ? ESCAPE '\\' OR c.display_name LIKE ? ESCAPE '\\')
      ORDER BY d.source_created_at DESC LIMIT ?`).bind(connector.code,cleanQuery,pattern,pattern,pattern,pattern,safeLimit),
    env.DB.prepare(`SELECT * FROM stripe_division_product_records WHERE connector_code=? AND
      (?='' OR stripe_product_id LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
      ORDER BY active DESC,name LIMIT ?`).bind(connector.code,cleanQuery,pattern,pattern,pattern,safeLimit),
    env.DB.prepare(`SELECT p.*,r.name product_name FROM stripe_division_price_records p LEFT JOIN stripe_division_product_records r
      ON r.connector_code=p.connector_code AND r.stripe_product_id=p.stripe_product_id
      WHERE p.connector_code=? AND (?='' OR p.stripe_price_id LIKE ? ESCAPE '\\' OR p.stripe_product_id LIKE ? ESCAPE '\\' OR r.name LIKE ? ESCAPE '\\' OR p.lookup_key LIKE ? ESCAPE '\\')
      ORDER BY p.active DESC,p.source_created_at DESC LIMIT ?`).bind(connector.code,cleanQuery,pattern,pattern,pattern,pattern,safeLimit),
    env.DB.prepare("SELECT * FROM stripe_division_sync_runs WHERE connector_code=? ORDER BY started_at DESC LIMIT 20").bind(connector.code)
  ]);
  return {
    connector: { slug: connector.slug, code: connector.code, name: connector.name },
    customers: customers.results || [], transactions: transactions.results || [], refunds: refunds.results || [],
    disputes: disputes.results || [], products: products.results || [], prices: prices.results || [], syncRuns: syncRuns.results || []
  };
}
