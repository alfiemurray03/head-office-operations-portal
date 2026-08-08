import {
  error,
  json,
  platformAudit,
  readJson,
  requirePlatform,
} from "../../../_shared.js";
import {
  centralPaymentError,
  centralStripePost,
  ensureCentralPaymentsSchema,
  requirePlatformBrand,
  verifyCentralStripeAccount,
} from "../../../_central-payments.js";
import { CENTRAL_PAYMENT_STANDARD_CATALOGUE } from "../../../_central-payment-catalogue-manifest.js";

const BRAND = "SOUSA_MURRAY_ELEARNING";
const TRIAL_ITEMS = CENTRAL_PAYMENT_STANDARD_CATALOGUE.filter(item =>
  item.brandCode === BRAND
  && item.billingType === "one_time"
  && item.amountMinor === 0
  && String(item.priceCode || "").endsWith("_TRIAL_FREE")
);

async function syncProduct(env, item) {
  let product = await env.DB.prepare(`SELECT * FROM central_payment_catalogue_products
    WHERE product_code=? LIMIT 1`).bind(item.productCode).first();
  let created = false;

  if (!product) {
    const stripeProduct = await centralStripePost(env, "/products", {
      name: item.name,
      description: item.description,
      "metadata[legal_entity]": "JA Group Services Ltd",
      "metadata[central_payments]": "true",
      "metadata[brand_code]": item.brandCode,
      "metadata[product_code]": item.productCode,
      "metadata[free_trial]": "true",
      "metadata[trial_duration_days]": "7",
    }, `central-trial-product-${item.productCode.toLowerCase()}`);
    if (!stripeProduct?.id) throw Object.assign(new Error(`Stripe did not return a Product for ${item.productCode}.`), { status: 502 });
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO central_payment_catalogue_products
      (id,brand_code,product_code,name,description,service_type,stripe_product_id,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'service',?,'active',?,?)`)
      .bind(id, item.brandCode, item.productCode, item.name, item.description, stripeProduct.id, now, now).run();
    product = { id, stripe_product_id: stripeProduct.id };
    created = true;
  } else {
    await centralStripePost(env, `/products/${product.stripe_product_id}`, {
      name: item.name,
      description: item.description,
      active: "true",
      "metadata[legal_entity]": "JA Group Services Ltd",
      "metadata[central_payments]": "true",
      "metadata[brand_code]": item.brandCode,
      "metadata[product_code]": item.productCode,
      "metadata[free_trial]": "true",
      "metadata[trial_duration_days]": "7",
    });
    await env.DB.prepare(`UPDATE central_payment_catalogue_products
      SET brand_code=?,name=?,description=?,status='active',updated_at=CURRENT_TIMESTAMP
      WHERE id=?`)
      .bind(item.brandCode, item.name, item.description, product.id).run();
  }

  return { product, created };
}

async function syncPrice(env, item, product) {
  let price = await env.DB.prepare(`SELECT * FROM central_payment_catalogue_prices
    WHERE price_code=? LIMIT 1`).bind(item.priceCode).first();
  if (price) {
    await env.DB.prepare(`UPDATE central_payment_catalogue_prices
      SET status='active',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(price.id).run();
    return { price, created: false };
  }

  const stripePrice = await centralStripePost(env, "/prices", {
    product: product.stripe_product_id,
    currency: String(item.currency || "GBP").toLowerCase(),
    unit_amount: 0,
    lookup_key: item.priceCode.toLowerCase(),
    tax_behavior: item.taxBehavior || "inclusive",
    "metadata[legal_entity]": "JA Group Services Ltd",
    "metadata[central_payments]": "true",
    "metadata[brand_code]": item.brandCode,
    "metadata[product_code]": item.productCode,
    "metadata[price_code]": item.priceCode,
    "metadata[free_trial]": "true",
    "metadata[trial_duration_days]": "7",
  }, `central-trial-price-${item.priceCode.toLowerCase()}`);
  if (!stripePrice?.id) throw Object.assign(new Error(`Stripe did not return a Price for ${item.priceCode}.`), { status: 502 });

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO central_payment_catalogue_prices
    (id,product_id,price_code,stripe_price_id,amount_minor,currency,billing_type,recurring_interval,
     recurring_interval_count,tax_behavior,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'GBP','one_time',NULL,NULL,?,'active',?,?)`)
    .bind(id, product.id, item.priceCode, stripePrice.id, 0, item.taxBehavior || "inclusive", now, now).run();
  price = { id, stripe_price_id: stripePrice.id };
  return { price, created: true };
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["payments:checkout"]);
  if (auth.response) return auth.response;

  let body;
  try { body = await readJson(context.request, 16_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    await ensureCentralPaymentsSchema(context.env);
    await verifyCentralStripeAccount(context.env);
    const brand = requirePlatformBrand(auth.platform, body.brand);
    if (brand.code !== BRAND) return error("ELEARNING_BRAND_REQUIRED", "Programme trial catalogue sync is restricted to Sousa Murray eLearning.", 403);
    if (TRIAL_ITEMS.length !== 4) {
      return error("PROGRAMME_TRIAL_CATALOGUE_INVALID", `Expected four governed programme trial products, found ${TRIAL_ITEMS.length}.`, 500);
    }

    const results = [];
    for (const item of TRIAL_ITEMS) {
      const productResult = await syncProduct(context.env, item);
      const priceResult = await syncPrice(context.env, item, productResult.product);
      results.push({
        productCode: item.productCode,
        priceCode: item.priceCode,
        name: item.name,
        stripeProductId: productResult.product.stripe_product_id,
        stripePriceId: priceResult.price.stripe_price_id,
        productCreated: productResult.created,
        priceCreated: priceResult.created,
      });
    }

    await platformAudit(context.env, auth.platform, "central_payment.programme_trials.sync", "central_payment_catalogue", "sousa-murray-elearning-trials", {
      label: "Sousa Murray eLearning programme trial catalogue synchronised",
      requestId: context.data.requestId,
      metadata: {
        brandCode: BRAND,
        trialProducts: results.length,
        createdProducts: results.filter(item => item.productCreated).length,
        createdPrices: results.filter(item => item.priceCreated).length,
      },
    });

    return json({
      synced: results.length,
      createdProducts: results.filter(item => item.productCreated).length,
      updatedProducts: results.filter(item => !item.productCreated).length,
      createdPrices: results.filter(item => item.priceCreated).length,
      results,
    }, 200);
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments could not synchronise the Sousa Murray eLearning programme trial catalogue.");
  }
};
