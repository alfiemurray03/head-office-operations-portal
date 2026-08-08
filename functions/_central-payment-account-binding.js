import {
  centralStripeGet,
  ensureCentralPaymentsSchema,
  verifyCentralStripeAccount,
} from "./_central-payments.js";

const BINDING_KEY = "primary";

function configuredStripeMode(env) {
  const key = String(env.CENTRAL_STRIPE_SECRET_KEY || "").trim();
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  return "unknown";
}

async function ensureBindingSchema(env) {
  await ensureCentralPaymentsSchema(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS central_payment_stripe_account_binding (
    binding_key TEXT PRIMARY KEY,
    stripe_account_id TEXT NOT NULL,
    stripe_mode TEXT NOT NULL DEFAULT 'unknown',
    binding_state TEXT NOT NULL DEFAULT 'ready',
    bound_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`).run();
  const columns = await env.DB.prepare("PRAGMA table_info(central_payment_stripe_account_binding)").all();
  const names = new Set((columns.results || []).map(column => column.name));
  if (!names.has("stripe_mode")) {
    await env.DB.prepare("ALTER TABLE central_payment_stripe_account_binding ADD COLUMN stripe_mode TEXT NOT NULL DEFAULT 'unknown'").run();
  }
  if (!names.has("binding_state")) {
    await env.DB.prepare("ALTER TABLE central_payment_stripe_account_binding ADD COLUMN binding_state TEXT NOT NULL DEFAULT 'ready'").run();
  }
}

async function readBinding(env) {
  return env.DB.prepare(`SELECT stripe_account_id,stripe_mode,binding_state,bound_at,updated_at
    FROM central_payment_stripe_account_binding WHERE binding_key=? LIMIT 1`)
    .bind(BINDING_KEY).first();
}

async function claimBindingMigration(env, binding, stripeAccountId, stripeMode) {
  const now = new Date().toISOString();
  if (!binding) {
    const result = await env.DB.prepare(`INSERT OR IGNORE INTO central_payment_stripe_account_binding
      (binding_key,stripe_account_id,stripe_mode,binding_state,bound_at,updated_at)
      VALUES (?,?,?,'migrating',?,?)`)
      .bind(BINDING_KEY, stripeAccountId, stripeMode, now, now).run();
    return Number(result.meta?.changes || 0) === 1;
  }

  const result = await env.DB.prepare(`UPDATE central_payment_stripe_account_binding
    SET stripe_account_id=?,stripe_mode=?,binding_state='migrating',updated_at=?
    WHERE binding_key=? AND updated_at=? AND binding_state<>'migrating'`)
    .bind(stripeAccountId, stripeMode, now, BINDING_KEY, binding.updated_at).run();
  return Number(result.meta?.changes || 0) === 1;
}

async function finishBindingMigration(env, stripeAccountId, stripeMode, state = "ready") {
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE central_payment_stripe_account_binding
    SET stripe_account_id=?,stripe_mode=?,binding_state=?,bound_at=?,updated_at=?
    WHERE binding_key=?`)
    .bind(stripeAccountId, stripeMode, state, now, now, BINDING_KEY).run();
}

async function currentAccountScopedSample(env) {
  const [product, price, customer] = await env.DB.batch([
    env.DB.prepare(`SELECT stripe_product_id FROM central_payment_catalogue_products
      WHERE status='active' AND stripe_product_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1`),
    env.DB.prepare(`SELECT stripe_price_id FROM central_payment_catalogue_prices
      WHERE status='active' AND stripe_price_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1`),
    env.DB.prepare(`SELECT stripe_customer_id FROM central_payment_customer_links
      WHERE stripe_customer_id IS NOT NULL ORDER BY updated_at DESC LIMIT 1`),
  ]);
  return {
    productId: product.results?.[0]?.stripe_product_id || null,
    priceId: price.results?.[0]?.stripe_price_id || null,
    customerId: customer.results?.[0]?.stripe_customer_id || null,
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
  if (!sample.productId && !sample.priceId && !sample.customerId) return true;
  if (sample.productId) {
    const productExists = await stripeObjectExists(env, `/products/${encodeURIComponent(sample.productId)}`);
    if (!productExists) return false;
  }
  if (sample.priceId) {
    const priceExists = await stripeObjectExists(env, `/prices/${encodeURIComponent(sample.priceId)}`);
    if (!priceExists) return false;
  }
  if (sample.customerId) {
    const customerExists = await stripeObjectExists(env, `/customers/${encodeURIComponent(sample.customerId)}`);
    if (!customerExists) return false;
  }
  return true;
}

async function clearStaleAccountLinks(env) {
  const before = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) AS total FROM central_payment_catalogue_products"),
    env.DB.prepare("SELECT COUNT(*) AS total FROM central_payment_catalogue_prices"),
    env.DB.prepare("SELECT COUNT(*) AS total FROM central_payment_customer_links"),
  ]);

  // Stripe Product, Price and Customer IDs are account- and mode-scoped. When
  // Head Office moves to another approved account or between test/live mode,
  // keeping those IDs makes D1 look healthy while Stripe returns "No such ...".
  // Clear only lookup rows that can be rebuilt. Payment history remains intact.
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
 * Binds D1 Central Payments account-scoped references to the currently approved
 * Stripe account and mode. The Stripe secret is verified on every guarded
 * request before account-scoped data can be used or changed. Rebinding is
 * serialised in D1 so simultaneous Head Office/API requests cannot repeatedly
 * clear a catalogue while another request is already rebuilding it.
 */
export async function ensureCentralStripeAccountBinding(env) {
  const expectedAccountId = String(env.CENTRAL_STRIPE_ACCOUNT_ID || "").trim();
  const stripeMode = configuredStripeMode(env);
  if (!expectedAccountId || !env.DB || stripeMode === "unknown") {
    return {
      configured: false,
      rebound: false,
      stripeAccountId: expectedAccountId || null,
      stripeMode,
    };
  }

  await ensureBindingSchema(env);

  // Always verify the actual secret. A stored binding is not authority to use a
  // later replacement key that may belong to another Stripe account.
  const account = await verifyCentralStripeAccount(env);
  const actualAccountId = String(account?.id || "");
  let binding = await readBinding(env);

  if (
    binding?.stripe_account_id === actualAccountId
    && binding?.stripe_mode === stripeMode
    && binding?.binding_state === "ready"
  ) {
    return {
      configured: true,
      rebound: false,
      stripeAccountId: actualAccountId,
      stripeMode,
      previousStripeAccountId: actualAccountId,
      previousStripeMode: stripeMode,
    };
  }

  if (binding?.binding_state === "migrating") {
    return {
      configured: false,
      migrating: true,
      rebound: false,
      stripeAccountId: actualAccountId,
      stripeMode,
    };
  }

  const previousBinding = binding;
  const claimed = await claimBindingMigration(env, binding, actualAccountId, stripeMode);
  if (!claimed) {
    binding = await readBinding(env);
    return {
      configured: Boolean(
        binding?.binding_state === "ready"
        && binding?.stripe_account_id === actualAccountId
        && binding?.stripe_mode === stripeMode
      ),
      migrating: binding?.binding_state === "migrating",
      rebound: false,
      stripeAccountId: actualAccountId,
      stripeMode,
    };
  }

  try {
    let stale = Boolean(previousBinding && (
      previousBinding.stripe_account_id !== actualAccountId
      || previousBinding.stripe_mode !== stripeMode
    ));
    if (!previousBinding || previousBinding.binding_state === "failed") {
      const sample = await currentAccountScopedSample(env);
      stale = !(await sampleBelongsToCurrentAccount(env, sample));
    }

    let cleared = { products: 0, prices: 0, customerLinks: 0 };
    if (stale) cleared = await clearStaleAccountLinks(env);

    await finishBindingMigration(env, actualAccountId, stripeMode, "ready");
    return {
      configured: true,
      rebound: stale,
      stripeAccountId: actualAccountId,
      stripeMode,
      previousStripeAccountId: previousBinding?.stripe_account_id || null,
      previousStripeMode: previousBinding?.stripe_mode || null,
      cleared,
    };
  } catch (cause) {
    await finishBindingMigration(env, actualAccountId, stripeMode, "failed").catch(() => undefined);
    throw cause;
  }
}
