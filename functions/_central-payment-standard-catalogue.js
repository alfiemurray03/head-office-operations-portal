import {
  centralStripeGet,
  centralStripePost,
  ensureCentralPaymentsSchema,
} from "./_central-payments.js";
import { CENTRAL_PAYMENT_STANDARD_CATALOGUE } from "./_central-payment-catalogue-manifest.js";

function code(value) {
  return String(value || "").trim().toUpperCase();
}

function manifestItem(brandCode, productCode, priceCode) {
  const brand = code(brandCode);
  const product = code(productCode);
  const price = code(priceCode);
  return CENTRAL_PAYMENT_STANDARD_CATALOGUE.find(item =>
    code(item.brandCode) === brand
    && code(item.productCode) === product
    && code(item.priceCode) === price
  ) || null;
}

async function stripeObject(env, path) {
  try {
    const object = await centralStripeGet(env, path);
    return object?.id && !object?.deleted ? object : null;
  } catch (cause) {
    if (cause?.status === 404 || cause?.stripeStatus === 404) return null;
    throw cause;
  }
}

function productIdempotencyKey(item) {
  return item.priceCode.endsWith("_TRIAL_FREE")
    ? `central-trial-product-${item.productCode.toLowerCase()}`
    : `central-product-${item.productCode.toLowerCase()}`;
}

function priceIdempotencyKey(item) {
  return item.priceCode.endsWith("_TRIAL_FREE")
    ? `central-trial-price-${item.priceCode.toLowerCase()}`
    : `central-price-${item.priceCode.toLowerCase()}`;
}

async function ensureProduct(env, item) {
  const existing = await env.DB.prepare(`SELECT id,stripe_product_id FROM central_payment_catalogue_products
    WHERE product_code=? LIMIT 1`).bind(item.productCode).first();

  let stripeProduct = existing?.stripe_product_id
    ? await stripeObject(env, `/products/${encodeURIComponent(existing.stripe_product_id)}`)
    : null;

  if (!stripeProduct) {
    stripeProduct = await centralStripePost(env, "/products", {
      name: item.name,
      description: item.description,
      active: "true",
      "metadata[legal_entity]": "JA Group Services Ltd",
      "metadata[central_payments]": "true",
      "metadata[brand_code]": item.brandCode,
      "metadata[product_code]": item.productCode,
      ...(item.priceCode.endsWith("_TRIAL_FREE") ? {
        "metadata[free_trial]": "true",
        "metadata[trial_duration_days]": "7",
      } : {}),
    }, productIdempotencyKey(item));
  }

  if (!stripeProduct?.id) {
    throw Object.assign(new Error(`Stripe did not return a Product for ${item.productCode}.`), {
      code: "CENTRAL_STANDARD_PRODUCT_CREATE_FAILED",
      status: 502,
    });
  }

  const now = new Date().toISOString();
  const id = existing?.id || crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO central_payment_catalogue_products
    (id,brand_code,product_code,name,description,service_type,stripe_product_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'service',?,'active',?,?)
    ON CONFLICT(product_code) DO UPDATE SET
      brand_code=excluded.brand_code,
      name=excluded.name,
      description=excluded.description,
      service_type='service',
      stripe_product_id=excluded.stripe_product_id,
      status='active',
      updated_at=excluded.updated_at`)
    .bind(id, item.brandCode, item.productCode, item.name, item.description, stripeProduct.id, now, now).run();

  return { id, stripeProduct };
}

async function ensurePrice(env, item, product) {
  const existing = await env.DB.prepare(`SELECT id,stripe_price_id,amount_minor,currency,billing_type,
      recurring_interval,recurring_interval_count,tax_behavior,status
    FROM central_payment_catalogue_prices WHERE price_code=? LIMIT 1`).bind(item.priceCode).first();

  let stripePrice = existing?.stripe_price_id
    ? await stripeObject(env, `/prices/${encodeURIComponent(existing.stripe_price_id)}`)
    : null;

  if (stripePrice && String(stripePrice.product || "") !== String(product.stripeProduct.id)) {
    stripePrice = null;
  }

  if (!stripePrice) {
    const fields = {
      product: product.stripeProduct.id,
      currency: String(item.currency || "GBP").toLowerCase(),
      unit_amount: item.amountMinor,
      lookup_key: item.priceCode.toLowerCase(),
      tax_behavior: item.taxBehavior || "inclusive",
      "metadata[legal_entity]": "JA Group Services Ltd",
      "metadata[central_payments]": "true",
      "metadata[brand_code]": item.brandCode,
      "metadata[product_code]": item.productCode,
      "metadata[price_code]": item.priceCode,
      ...(item.priceCode.endsWith("_TRIAL_FREE") ? {
        "metadata[free_trial]": "true",
        "metadata[trial_duration_days]": "7",
      } : {}),
    };
    if (item.billingType === "recurring") {
      fields["recurring[interval]"] = item.interval || "month";
      fields["recurring[interval_count]"] = 1;
    }
    stripePrice = await centralStripePost(env, "/prices", fields, priceIdempotencyKey(item));
  }

  if (!stripePrice?.id) {
    throw Object.assign(new Error(`Stripe did not return a Price for ${item.priceCode}.`), {
      code: "CENTRAL_STANDARD_PRICE_CREATE_FAILED",
      status: 502,
    });
  }

  const now = new Date().toISOString();
  const id = existing?.id || crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO central_payment_catalogue_prices
    (id,product_id,price_code,stripe_price_id,amount_minor,currency,billing_type,recurring_interval,
     recurring_interval_count,tax_behavior,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?)
    ON CONFLICT(price_code) DO UPDATE SET
      product_id=excluded.product_id,
      stripe_price_id=excluded.stripe_price_id,
      amount_minor=excluded.amount_minor,
      currency=excluded.currency,
      billing_type=excluded.billing_type,
      recurring_interval=excluded.recurring_interval,
      recurring_interval_count=excluded.recurring_interval_count,
      tax_behavior=excluded.tax_behavior,
      status='active',
      updated_at=excluded.updated_at`)
    .bind(
      id,
      product.id,
      item.priceCode,
      stripePrice.id,
      item.amountMinor,
      String(item.currency || "GBP").toUpperCase(),
      item.billingType,
      item.billingType === "recurring" ? item.interval || "month" : null,
      item.billingType === "recurring" ? 1 : null,
      item.taxBehavior || "inclusive",
      now,
      now,
    ).run();

  return { id, stripePrice };
}

export async function standardCatalogueState(env) {
  await ensureCentralPaymentsSchema(env);
  const products = await env.DB.prepare("SELECT product_code FROM central_payment_catalogue_products WHERE status='active'").all();
  const prices = await env.DB.prepare("SELECT price_code FROM central_payment_catalogue_prices WHERE status='active'").all();
  const productCodes = new Set((products.results || []).map(row => row.product_code));
  const priceCodes = new Set((prices.results || []).map(row => row.price_code));
  return CENTRAL_PAYMENT_STANDARD_CATALOGUE.map(item => ({
    brandCode: item.brandCode,
    productCode: item.productCode,
    priceCode: item.priceCode,
    name: item.name,
    amountMinor: item.amountMinor,
    currency: item.currency,
    billingType: item.billingType,
    interval: item.interval || null,
    productReady: productCodes.has(item.productCode),
    priceReady: priceCodes.has(item.priceCode),
  }));
}

export async function ensureStandardCatalogueItem(env, brandCode, productCode, priceCode) {
  const item = manifestItem(brandCode, productCode, priceCode);
  if (!item) return { standard: false, createdProduct: false, createdPrice: false };

  await ensureCentralPaymentsSchema(env);
  const priorProduct = await env.DB.prepare(`SELECT stripe_product_id,status FROM central_payment_catalogue_products
    WHERE product_code=? LIMIT 1`).bind(item.productCode).first();
  const priorPrice = await env.DB.prepare(`SELECT stripe_price_id,status FROM central_payment_catalogue_prices
    WHERE price_code=? LIMIT 1`).bind(item.priceCode).first();

  const product = await ensureProduct(env, item);
  const price = await ensurePrice(env, item, product);

  return {
    standard: true,
    item,
    createdProduct: !priorProduct?.stripe_product_id || priorProduct.stripe_product_id !== product.stripeProduct.id,
    createdPrice: !priorPrice?.stripe_price_id || priorPrice.stripe_price_id !== price.stripePrice.id,
  };
}

export async function provisionStandardCatalogue(env) {
  let createdProducts = 0;
  let createdPrices = 0;
  for (const item of CENTRAL_PAYMENT_STANDARD_CATALOGUE) {
    const result = await ensureStandardCatalogueItem(env, item.brandCode, item.productCode, item.priceCode);
    if (result.createdProduct) createdProducts += 1;
    if (result.createdPrice) createdPrices += 1;
  }
  const items = await standardCatalogueState(env);
  return {
    items,
    ready: items.every(item => item.productReady && item.priceReady),
    total: items.length,
    provisioned: items.filter(item => item.productReady && item.priceReady).length,
    createdProducts,
    createdPrices,
  };
}
