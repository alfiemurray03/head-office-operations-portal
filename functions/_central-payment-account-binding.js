import {
  centralStripeGet,
  ensureCentralPaymentsSchema,
  verifyCentralStripeAccount,
} from "./_central-payments.js";

const BINDING_KEY = "primary";

async function ensureBindingSchema(env) {
  await ensureCentralPaymentsSchema(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS central_payment_stripe_account_binding (
    binding_key TEXT PRIMARY KEY,
    stripe_account_id TEXT NOT NULL,
    bound_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
}

async function readBinding(env) {
  return env.DB.prepare(`SELECT stripe_account_id,bound_at,updated_at
    FROM central_payment_stripe_account_binding WHERE binding_key=? LIMIT 1`)
    .bind(BINDING_KEY).first();
}

async function writeBinding(env, stripeAccountId) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO central_payment_stripe_account_binding(binding_key,stripe_account_id,bound_at,updated_at)
    VALUES (?,?,?,?)
    ON CONFLICT(binding_key) DO UPDATE SET stripe_account_id=excluded.stripe_account_id,
      bound_at=excluded.bound_at,updated_at=excluded.updated_at`)
    .bind(BINDING_KEY, stripeAccountId, now, now).run();
}

async function currentCatalogueSample(env) {
  const [product, price] = await env.DB.batch([
    env.DB.prepare(`SELECT stripe_product_id FROM central_payment_catalogue_products
      WHERE status='active' AND stripe_product_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1`),
    env.DB.prepare(`SELECT stripe_price_id FROM central_payment_catalogue_prices
      WHERE status='active' AND stripe_price_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1`),
  ]);
  return {
    productId: product.results?.[0]?.stripe_product_id || null,
    priceId: price.results?.[0]?.stripe_price_id || null,
  };
}

async function stripeObjectExists(env, path) {
  try {
    const object = await centralStripeGet(env, path);
    return Boolean(object?.id && !object?.deleted);
  } catch (cause) {
    if (cause?.status === 404 || cause?.stripeStatus === 404) return false;
    throw cause;
  }
}

async function sampleBelongsToCurrentAccount(env, sample) {
  if (!sample.productId && !sample.priceId) return true;
  if (sample.productId) {
    const productExists = await stripeObjectExists(env, `/products/${encodeURIComponent(sample.productId)}`);
    if (!productExists) return false;
  }
  if (sample.priceId) {
    const priceExists = await stripeObjectExists(env, `/prices/${encodeURIComponent(sample.priceId)}`);
    if (!priceExists) return false;
  }
  return true;
}

async function clearStaleAccountLinks(env) {
  const before = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS total FROM central_payment_catalogue_products"),
    env.DB.prepare("SELECT COUNT(*) AS total FROM central_payment_catalogue_prices"),
    env.DB.prepare("SELECT COUNT(*) AS total FROM central_payment_customer_links"),
  ]);

  // Product and Price IDs are scoped to one Stripe account. When Head Office is
  // deliberately moved to another approved Stripe account, retaining the old
  // IDs makes the catalogue look ready while Checkout fails with "No such ...".
  // Clear only account-scoped lookup rows. Payment history remains intact.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM central_payment_catalogue_prices"),
    env.DB.prepare("DELETE FROM central_payment_catalogue_products"),
    env.DB.prepare("DELETE FROM central_payment_customer_links"),
  ]);

  return {
    products: Number(before[0].results?.[0]?.total || 0),
    prices: Number(before[1].results?.[0]?.total || 0),
    customerLinks: Number(before[2].results?.[0]?.total || 0),
  };
}

/**
 * Binds the D1 Central Payments catalogue to the currently approved Stripe
 * account. The first deployment adopts the existing catalogue only when a
 * sample Product/Price can be read through the current Stripe secret. If the
 * configured account changes, stale account-scoped IDs are cleared so the
 * existing idempotent provisioning/synchronisation routes rebuild them safely.
 */
export async function ensureCentralStripeAccountBinding(env) {
  const expectedAccountId = String(env.CENTRAL_STRIPE_ACCOUNT_ID || "").trim();
  if (!expectedAccountId || !env.DB) {
    return { configured: false, rebound: false, stripeAccountId: expectedAccountId || null };
  }

  await ensureBindingSchema(env);
  const binding = await readBinding(env);
  if (binding?.stripe_account_id === expectedAccountId) {
    return {
      configured: true,
      rebound: false,
      stripeAccountId: expectedAccountId,
      previousStripeAccountId: expectedAccountId,
    };
  }

  // Verify that the secret key really belongs to the configured account before
  // changing any D1 account-scoped references.
  const account = await verifyCentralStripeAccount(env);
  const actualAccountId = String(account?.id || "");
  if (!actualAccountId || actualAccountId !== expectedAccountId) {
    return {
      configured: true,
      rebound: false,
      stripeAccountId: actualAccountId || null,
      previousStripeAccountId: binding?.stripe_account_id || null,
    };
  }

  let stale = Boolean(binding?.stripe_account_id && binding.stripe_account_id !== actualAccountId);
  if (!binding) {
    const sample = await currentCatalogueSample(env);
    stale = !(await sampleBelongsToCurrentAccount(env, sample));
  }

  let cleared = { products: 0, prices: 0, customerLinks: 0 };
  if (stale) cleared = await clearStaleAccountLinks(env);

  await writeBinding(env, actualAccountId);
  return {
    configured: true,
    rebound: stale,
    stripeAccountId: actualAccountId,
    previousStripeAccountId: binding?.stripe_account_id || null,
    cleared,
  };
}
