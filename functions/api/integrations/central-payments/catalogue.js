import { audit, cleanText, error, json, readJson } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";
import {
  brandDefinition,
  centralPaymentError,
  centralStripePost,
  ensureCentralPaymentsSchema,
  verifyCentralStripeAccount,
} from "../../../_central-payments.js";

function code(value, max = 100) {
  return cleanText(value, max).toUpperCase().replace(/[^A-Z0-9_\-]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "payments:read");
  if (auth.response) return auth.response;
  try {
    await ensureCentralPaymentsSchema(context.env);
    const result = await context.env.DB.prepare(`SELECT p.id,p.brand_code,p.product_code,p.name,p.description,p.service_type,p.stripe_product_id,
      p.status,p.created_at,p.updated_at,r.id price_id,r.price_code,r.stripe_price_id,r.amount_minor,r.currency,r.billing_type,
      r.recurring_interval,r.recurring_interval_count,r.tax_behavior,r.status price_status
      FROM central_payment_catalogue_products p
      LEFT JOIN central_payment_catalogue_prices r ON r.product_id=p.id
      ORDER BY p.brand_code,p.name,r.amount_minor`).all();
    const products = new Map();
    for (const row of result.results || []) {
      if (!products.has(row.id)) products.set(row.id, {
        id: row.id,
        brandCode: row.brand_code,
        productCode: row.product_code,
        name: row.name,
        description: row.description,
        serviceType: row.service_type,
        stripeProductId: row.stripe_product_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        prices: [],
      });
      if (row.price_id) products.get(row.id).prices.push({
        id: row.price_id,
        priceCode: row.price_code,
        stripePriceId: row.stripe_price_id,
        amountMinor: row.amount_minor,
        currency: row.currency,
        billingType: row.billing_type,
        recurringInterval: row.recurring_interval,
        recurringIntervalCount: row.recurring_interval_count,
        taxBehavior: row.tax_behavior,
        status: row.price_status,
      });
    }
    return json({ products: [...products.values()] });
  } catch (cause) {
    return centralPaymentError(cause, "The Central Payments catalogue could not be read.");
  }
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "payments:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 32_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    await ensureCentralPaymentsSchema(context.env);
    await verifyCentralStripeAccount(context.env);
    const action = cleanText(body.action, 40);
    const now = new Date().toISOString();

    if (action === "createProduct") {
      const brand = brandDefinition(body.brandCode);
      const productCode = code(body.productCode);
      const name = cleanText(body.name, 180);
      const description = cleanText(body.description, 1000);
      const serviceType = code(body.serviceType || "SERVICE", 40).toLowerCase();
      if (!brand || !productCode || name.length < 2) return error("INVALID_CATALOGUE_PRODUCT", "Enter an approved brand, product code and product name.", 400);
      const existing = await context.env.DB.prepare("SELECT id FROM central_payment_catalogue_products WHERE product_code=?").bind(productCode).first();
      if (existing) return error("PRODUCT_CODE_EXISTS", "That Central Payments product code is already in use.", 409);

      const stripeProduct = await centralStripePost(context.env, "/products", {
        name: `${brand.name} — ${name}`,
        description: description || undefined,
        "metadata[legal_entity]": "JA Group Services Ltd",
        "metadata[brand_code]": brand.code,
        "metadata[product_code]": productCode,
        "metadata[service_type]": serviceType,
        "metadata[central_payments]": "true",
      }, `central-product-${productCode}`);
      const id = crypto.randomUUID();
      await context.env.DB.prepare(`INSERT INTO central_payment_catalogue_products
        (id,brand_code,product_code,name,description,service_type,stripe_product_id,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'active',?,?)`).bind(id, brand.code, productCode, name, description || null, serviceType, stripeProduct.id, now, now).run();
      await audit(context.env, auth.session, "central_payment.catalogue.product_create", "central_payment_product", id, {
        label: "Central Payments product created",
        reference: productCode,
        requestId: context.data.requestId,
        metadata: { brandCode: brand.code, stripeProductId: stripeProduct.id },
      });
      return json({ product: { id, brandCode: brand.code, productCode, name, stripeProductId: stripeProduct.id } }, 201);
    }

    if (action === "createPrice") {
      const productCode = code(body.productCode);
      const priceCode = code(body.priceCode);
      const amountMinor = Math.round(Number(body.amountMinor));
      const currency = code(body.currency || "GBP", 3).toLowerCase();
      const billingType = cleanText(body.billingType, 20) === "recurring" ? "recurring" : "one_time";
      const recurringInterval = billingType === "recurring" ? cleanText(body.recurringInterval || "month", 20) : null;
      const recurringIntervalCount = billingType === "recurring" ? Math.max(1, Math.min(Number(body.recurringIntervalCount) || 1, 36)) : null;
      const taxBehavior = ["inclusive", "exclusive", "unspecified"].includes(body.taxBehavior) ? body.taxBehavior : "inclusive";
      if (!productCode || !priceCode || !Number.isFinite(amountMinor) || amountMinor < 0 || !/^[a-z]{3}$/.test(currency)) {
        return error("INVALID_CATALOGUE_PRICE", "Enter a valid product code, price code, amount and currency.", 400);
      }
      const product = await context.env.DB.prepare(`SELECT id,brand_code,product_code,stripe_product_id FROM central_payment_catalogue_products
        WHERE product_code=? AND status='active' LIMIT 1`).bind(productCode).first();
      if (!product?.stripe_product_id) return error("CATALOGUE_PRODUCT_NOT_FOUND", "The active Central Payments product could not be found.", 404);
      const existing = await context.env.DB.prepare("SELECT id FROM central_payment_catalogue_prices WHERE price_code=?").bind(priceCode).first();
      if (existing) return error("PRICE_CODE_EXISTS", "That Central Payments price code is already in use.", 409);

      const stripeFields = {
        product: product.stripe_product_id,
        unit_amount: amountMinor,
        currency,
        tax_behavior: taxBehavior,
        "metadata[legal_entity]": "JA Group Services Ltd",
        "metadata[brand_code]": product.brand_code,
        "metadata[product_code]": product.product_code,
        "metadata[price_code]": priceCode,
        "metadata[central_payments]": "true",
      };
      if (billingType === "recurring") {
        stripeFields["recurring[interval]"] = recurringInterval;
        stripeFields["recurring[interval_count]"] = recurringIntervalCount;
      }
      const stripePrice = await centralStripePost(context.env, "/prices", stripeFields, `central-price-${priceCode}`);
      const id = crypto.randomUUID();
      await context.env.DB.prepare(`INSERT INTO central_payment_catalogue_prices
        (id,product_id,price_code,stripe_price_id,amount_minor,currency,billing_type,recurring_interval,recurring_interval_count,tax_behavior,status,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?)`)
        .bind(id, product.id, priceCode, stripePrice.id, amountMinor, currency.toUpperCase(), billingType, recurringInterval, recurringIntervalCount, taxBehavior, now, now).run();
      await audit(context.env, auth.session, "central_payment.catalogue.price_create", "central_payment_price", id, {
        label: "Central Payments price created",
        reference: priceCode,
        requestId: context.data.requestId,
        metadata: { productCode, stripePriceId: stripePrice.id, amountMinor, currency, billingType },
      });
      return json({ price: { id, productCode, priceCode, stripePriceId: stripePrice.id, amountMinor, currency: currency.toUpperCase(), billingType } }, 201);
    }

    return error("UNKNOWN_CATALOGUE_ACTION", "Choose createProduct or createPrice.", 400);
  } catch (cause) {
    return centralPaymentError(cause, "The Central Payments catalogue could not be changed.");
  }
};
