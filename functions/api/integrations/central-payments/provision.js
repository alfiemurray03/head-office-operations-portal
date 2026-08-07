import { audit, error, json } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import {
  centralPaymentError,
  centralStripePost,
  ensureCentralPaymentsSchema,
  verifyCentralStripeAccount,
} from "../../../_central-payments.js";
import { CENTRAL_PAYMENT_STANDARD_CATALOGUE } from "../../../_central-payment-catalogue-manifest.js";

async function catalogueState(env) {
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

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  try {
    const items = await catalogueState(context.env);
    return json({
      items,
      ready: items.every(item => item.productReady && item.priceReady),
      total: items.length,
      provisioned: items.filter(item => item.productReady && item.priceReady).length,
    });
  } catch (cause) {
    return centralPaymentError(cause, "The standard Central Payments catalogue could not be inspected.");
  }
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "payments:write");
  if (auth.response) return auth.response;
  try {
    await ensureCentralPaymentsSchema(context.env);
    await verifyCentralStripeAccount(context.env);
    let createdProducts = 0;
    let createdPrices = 0;

    for (const item of CENTRAL_PAYMENT_STANDARD_CATALOGUE) {
      let product = await context.env.DB.prepare(`SELECT * FROM central_payment_catalogue_products
        WHERE product_code=? LIMIT 1`).bind(item.productCode).first();
      if (!product) {
        const stripeProduct = await centralStripePost(context.env, "/products", {
          name: item.name,
          description: item.description,
          "metadata[legal_entity]": "JA Group Services Ltd",
          "metadata[central_payments]": "true",
          "metadata[brand_code]": item.brandCode,
          "metadata[product_code]": item.productCode,
        }, `central-product-${item.productCode.toLowerCase()}`);
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        await context.env.DB.prepare(`INSERT INTO central_payment_catalogue_products
          (id,brand_code,product_code,name,description,service_type,stripe_product_id,status,created_at,updated_at)
          VALUES (?,?,?,?,?,'service',?,'active',?,?)`)
          .bind(id, item.brandCode, item.productCode, item.name, item.description, stripeProduct.id, now, now).run();
        product = { id, stripe_product_id: stripeProduct.id };
        createdProducts += 1;
      }

      const existingPrice = await context.env.DB.prepare(`SELECT id FROM central_payment_catalogue_prices
        WHERE price_code=? LIMIT 1`).bind(item.priceCode).first();
      if (existingPrice) continue;

      const fields = {
        product: product.stripe_product_id,
        currency: String(item.currency || "GBP").toLowerCase(),
        unit_amount: item.amountMinor,
        lookup_key: item.priceCode.toLowerCase(),
        "metadata[legal_entity]": "JA Group Services Ltd",
        "metadata[central_payments]": "true",
        "metadata[brand_code]": item.brandCode,
        "metadata[product_code]": item.productCode,
        "metadata[price_code]": item.priceCode,
      };
      if (item.billingType === "recurring") {
        fields["recurring[interval]"] = item.interval || "month";
        fields["recurring[interval_count]"] = 1;
      }
      if (item.taxBehavior) fields.tax_behavior = item.taxBehavior;

      const stripePrice = await centralStripePost(context.env, "/prices", fields, `central-price-${item.priceCode.toLowerCase()}`);
      const now = new Date().toISOString();
      await context.env.DB.prepare(`INSERT INTO central_payment_catalogue_prices
        (id,product_id,price_code,stripe_price_id,amount_minor,currency,billing_type,recurring_interval,
         recurring_interval_count,tax_behavior,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?, 'active',?,?)`)
        .bind(
          crypto.randomUUID(),
          product.id,
          item.priceCode,
          stripePrice.id,
          item.amountMinor,
          item.currency,
          item.billingType,
          item.billingType === "recurring" ? item.interval || "month" : null,
          item.billingType === "recurring" ? 1 : null,
          item.taxBehavior || null,
          now,
          now,
        ).run();
      createdPrices += 1;
    }

    const state = await catalogueState(context.env);
    await audit(context.env, auth.session, "central_payments.catalogue.provision", "central_payment_catalogue", "standard", {
      label: "Standard Central Payments catalogue provisioned",
      reference: "standard",
      requestId: context.data.requestId,
      metadata: { createdProducts, createdPrices, total: state.length },
    });
    return json({
      ready: state.every(item => item.productReady && item.priceReady),
      createdProducts,
      createdPrices,
      total: state.length,
      items: state,
    });
  } catch (cause) {
    return centralPaymentError(cause, "The standard Central Payments catalogue could not be provisioned.");
  }
};
