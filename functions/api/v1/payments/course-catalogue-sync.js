import {
  cleanText,
  error,
  json,
  platformAudit,
  readJson,
  requirePlatform,
} from "../../../_shared.js";
import {
  centralPaymentError,
  centralStripeGet,
  centralStripePost,
  ensureCentralPaymentsSchema,
  requirePlatformBrand,
  verifyCentralStripeAccount,
} from "../../../_central-payments.js";
import {
  ownCourseCommerceConfiguration,
  validateOwnCourseCode,
} from "../../../_elearning-own-course-commerce.js";
import { approvedOwnCoursePriceFromMetrics } from "../../../_elearning-course-pricing-model.js";

const MAX_ITEMS = 25;
const BRAND = "SOUSA_MURRAY_ELEARNING";
const FAMILY_OWN = "sousa_murray";
const FAMILY_HIGHFIELD = "highfield";

function productCodeFor(item) {
  if (item.family === FAMILY_OWN) return `SME-COURSE-${item.courseCode}`.toUpperCase();
  return `HF-COURSE-${item.courseCode}`.toUpperCase();
}

function priceCodeFor(item) {
  return `${productCodeFor(item)}-INDIVIDUAL`.toUpperCase();
}

function lookupKeyFor(productCode, grossPence) {
  return `${productCode}_${grossPence}`.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 180);
}

function validateUrl(value) {
  const text = cleanText(value, 500);
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:") return null;
    if (parsed.hostname !== "sousamurrayelearning.jagroupservices.co.uk") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normaliseItem(raw) {
  const family = cleanText(raw?.family, 40).toLowerCase();
  if (![FAMILY_OWN, FAMILY_HIGHFIELD].includes(family)) return null;

  const name = cleanText(raw?.name, 180);
  const description = cleanText(raw?.description, 500);
  const courseSlug = cleanText(raw?.courseSlug, 180).toLowerCase();
  const url = validateUrl(raw?.url);
  if (!name || !courseSlug || !url) return null;

  if (family === FAMILY_OWN) {
    const courseCode = validateOwnCourseCode(raw?.courseCode);
    const approved = approvedOwnCoursePriceFromMetrics(raw);
    if (!courseCode || !approved) return null;

    const declaredGross = Number(raw?.grossPence);
    const declaredNet = Number(raw?.netPence);
    const declaredVat = Number(raw?.vatPence);
    const declaredBand = cleanText(raw?.pricingBand, 40).toLowerCase();
    const declaredScore = Number(raw?.pricingScore);
    const declaredBase = Number(raw?.baseValuePence);
    const declaredUplift = Number(raw?.commercialUpliftBasisPoints);
    const declaredVatRate = Number(raw?.vatBasisPoints);
    if (
      declaredGross !== approved.grossPence
      || declaredNet !== approved.retailNetPence
      || declaredVat !== approved.vatPence
      || declaredBand !== approved.id
      || declaredScore !== approved.score
      || declaredBase !== approved.baseValuePence
      || declaredUplift !== approved.commercialUpliftBasisPoints
      || declaredVatRate !== approved.vatBasisPoints
    ) return null;

    return {
      family,
      courseId: courseCode,
      courseCode,
      courseSlug,
      name,
      description,
      url,
      deliveryPlatform: "Sousa Murray LMS",
      provider: "Sousa Murray eLearning",
      grossPence: approved.grossPence,
      netPence: approved.retailNetPence,
      vatPence: approved.vatPence,
      pricingBand: approved.id,
      pricingScore: approved.score,
      baseValuePence: approved.baseValuePence,
      commercialUpliftBasisPoints: approved.commercialUpliftBasisPoints,
      vatBasisPoints: approved.vatBasisPoints,
      level: approved.level,
      durationMinutes: approved.durationMinutes,
      moduleCount: approved.moduleCount,
      lessonCount: approved.lessonCount,
      assessmentQuestionCount: approved.assessmentQuestionCount,
      priceSource: "Head Office governed Sousa Murray complexity band: 30% commercial uplift plus 20% UK VAT",
    };
  }

  const courseId = cleanText(raw?.courseId, 180).toLowerCase();
  const courseCode = cleanText(raw?.courseCode, 40).toUpperCase();
  const grossPence = Number(raw?.grossPence);
  const netPence = Number(raw?.netPence);
  const vatPence = Number(raw?.vatPence);
  if (!/^hf-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(courseId)) return null;
  if (!/^HF-[A-F0-9]{8}$/.test(courseCode)) return null;
  if (!Number.isInteger(grossPence) || grossPence <= 0) return null;
  if (!Number.isInteger(netPence) || netPence < 0 || !Number.isInteger(vatPence) || vatPence < 0 || netPence + vatPence !== grossPence) return null;

  return {
    family,
    courseId,
    courseCode,
    courseSlug,
    name,
    description,
    url,
    deliveryPlatform: "Highfield LMS",
    provider: "Highfield Online Training",
    grossPence,
    netPence,
    vatPence,
    priceSource: cleanText(raw?.priceSource, 260) || "Sousa Murray eLearning Highfield catalogue",
  };
}

async function findStripeProduct(env, item, productCode) {
  const local = await env.DB.prepare(`SELECT id,stripe_product_id,name,description,status
    FROM central_payment_catalogue_products WHERE product_code=? LIMIT 1`).bind(productCode).first();
  if (local?.stripe_product_id) {
    try {
      const product = await centralStripeGet(env, `/products/${encodeURIComponent(local.stripe_product_id)}`);
      if (product?.id && !product.deleted) return { product, local };
    } catch (cause) {
      if (cause?.status !== 404) throw cause;
    }
  }

  const searches = [
    `metadata['central_product_code']:'${productCode.replaceAll("'", "")}'`,
    `metadata['course_code']:'${item.courseCode.replaceAll("'", "")}'`,
  ];
  for (const query of searches) {
    const result = await centralStripeGet(env, `/products/search?limit=5&query=${encodeURIComponent(query)}`);
    const match = (result?.data || []).find(product => product?.active !== false);
    if (match?.id) return { product: match, local };
  }
  return { product: null, local };
}

function productFields(item, productCode) {
  const fields = {
    name: item.name,
    description: item.description,
    active: "true",
    url: item.url,
    "metadata[central_product_code]": productCode,
    "metadata[course_code]": item.courseCode,
    "metadata[course_id]": item.courseId,
    "metadata[course_slug]": item.courseSlug,
    "metadata[division]": "sousa_murray_elearning",
    "metadata[brand]": "Sousa Murray eLearning",
    "metadata[provider]": item.provider,
    "metadata[delivery_platform]": item.deliveryPlatform,
    "metadata[legal_operator]": "JA Group Services Ltd",
    "metadata[product_family]": item.family === FAMILY_OWN ? "own_course" : "highfield_course",
    "metadata[purchase_model]": "individual_course",
    "metadata[manual_sale_enabled]": "true",
    "metadata[price_status]": item.grossPence ? "approved" : "pending_approval",
    "metadata[price_source]": item.priceSource,
    "metadata[vat_inclusive]": item.grossPence ? "true" : "pending",
  };
  if (item.family === FAMILY_OWN) {
    fields["metadata[pricing_band]"] = item.pricingBand;
    fields["metadata[pricing_score]"] = String(item.pricingScore);
    fields["metadata[course_level]"] = item.level;
    fields["metadata[duration_minutes]"] = String(item.durationMinutes);
    fields["metadata[base_value_minor]"] = String(item.baseValuePence);
    fields["metadata[commercial_uplift_basis_points]"] = String(item.commercialUpliftBasisPoints);
    fields["metadata[vat_basis_points]"] = String(item.vatBasisPoints);
  }
  return fields;
}

async function upsertLocalProduct(env, item, productCode, stripeProductId) {
  const now = new Date().toISOString();
  const existing = await env.DB.prepare(`SELECT id FROM central_payment_catalogue_products WHERE product_code=? LIMIT 1`).bind(productCode).first();
  const id = existing?.id || crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO central_payment_catalogue_products
    (id,brand_code,product_code,name,description,service_type,stripe_product_id,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'digital_course',?,'active',?,?)
    ON CONFLICT(product_code) DO UPDATE SET
      brand_code=excluded.brand_code,
      name=excluded.name,
      description=excluded.description,
      service_type=excluded.service_type,
      stripe_product_id=excluded.stripe_product_id,
      status='active',
      updated_at=excluded.updated_at`)
    .bind(id, BRAND, productCode, item.name, item.description, stripeProductId, now, now).run();
  return id;
}

async function upsertPrice(env, item, productId, stripeProduct) {
  if (!item.grossPence) return { created: false, updated: false, stripePriceId: null, status: "pending_price" };

  const priceCode = priceCodeFor(item);
  const existing = await env.DB.prepare(`SELECT id,stripe_price_id,amount_minor,currency,status
    FROM central_payment_catalogue_prices WHERE price_code=? LIMIT 1`).bind(priceCode).first();

  if (existing?.stripe_price_id && Number(existing.amount_minor) === item.grossPence && existing.currency === "GBP" && existing.status === "active") {
    if (stripeProduct.default_price !== existing.stripe_price_id) {
      await centralStripePost(env, `/products/${encodeURIComponent(stripeProduct.id)}`, { default_price: existing.stripe_price_id }, `course-product-default-${stripeProduct.id}-${existing.stripe_price_id}`);
    }
    return { created: false, updated: false, stripePriceId: existing.stripe_price_id, status: "unchanged" };
  }

  const lookupKey = lookupKeyFor(productCodeFor(item), item.grossPence);
  const metadata = {
    "metadata[central_product_code]": productCodeFor(item),
    "metadata[price_code]": priceCode,
    "metadata[course_code]": item.courseCode,
    "metadata[provider]": item.provider,
    "metadata[legal_operator]": "JA Group Services Ltd",
    "metadata[purchase_model]": "individual_course",
    "metadata[manual_sale_enabled]": "true",
    "metadata[vat_inclusive]": "true",
  };
  if (item.family === FAMILY_OWN) {
    metadata["metadata[pricing_band]"] = item.pricingBand;
    metadata["metadata[base_value_minor]"] = String(item.baseValuePence);
    metadata["metadata[commercial_uplift_basis_points]"] = String(item.commercialUpliftBasisPoints);
    metadata["metadata[vat_basis_points]"] = String(item.vatBasisPoints);
    metadata["metadata[net_amount_minor]"] = String(item.netPence);
    metadata["metadata[vat_amount_minor]"] = String(item.vatPence);
  }

  const price = await centralStripePost(env, "/prices", {
    product: stripeProduct.id,
    currency: "gbp",
    unit_amount: item.grossPence,
    tax_behavior: "inclusive",
    lookup_key: lookupKey,
    ...metadata,
  }, `course-price-${lookupKey}`);
  if (!price?.id) throw Object.assign(new Error(`Stripe did not create a price for ${item.courseCode}.`), { status: 502, code: "STRIPE_PRICE_CREATE_FAILED" });

  await centralStripePost(env, `/products/${encodeURIComponent(stripeProduct.id)}`, { default_price: price.id }, `course-product-default-${stripeProduct.id}-${price.id}`);
  if (existing?.stripe_price_id && existing.stripe_price_id !== price.id) {
    try { await centralStripePost(env, `/prices/${encodeURIComponent(existing.stripe_price_id)}`, { active: "false" }, `course-price-archive-${existing.stripe_price_id}`); } catch {}
  }

  const now = new Date().toISOString();
  const priceId = existing?.id || crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO central_payment_catalogue_prices
    (id,product_id,price_code,stripe_price_id,amount_minor,currency,billing_type,recurring_interval,
     recurring_interval_count,tax_behavior,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'GBP','one_time',NULL,NULL,'inclusive','active',?,?)
    ON CONFLICT(price_code) DO UPDATE SET
      product_id=excluded.product_id,
      stripe_price_id=excluded.stripe_price_id,
      amount_minor=excluded.amount_minor,
      currency='GBP',
      billing_type='one_time',
      recurring_interval=NULL,
      recurring_interval_count=NULL,
      tax_behavior='inclusive',
      status='active',
      updated_at=excluded.updated_at`)
    .bind(priceId, productId, priceCode, price.id, item.grossPence, now, now).run();

  return { created: true, updated: Boolean(existing), stripePriceId: price.id, status: existing ? "replaced" : "created" };
}

async function syncOne(env, item) {
  const productCode = productCodeFor(item);
  const located = await findStripeProduct(env, item, productCode);
  let stripeProduct = located.product;
  let productCreated = false;

  if (!stripeProduct) {
    stripeProduct = await centralStripePost(env, "/products", productFields(item, productCode), `course-product-${productCode.toLowerCase()}`);
    productCreated = true;
  } else {
    stripeProduct = await centralStripePost(env, `/products/${encodeURIComponent(stripeProduct.id)}`, productFields(item, productCode));
  }
  if (!stripeProduct?.id) throw Object.assign(new Error(`Stripe did not return a product for ${item.courseCode}.`), { status: 502, code: "STRIPE_PRODUCT_SYNC_FAILED" });

  const localProductId = await upsertLocalProduct(env, item, productCode, stripeProduct.id);
  const price = await upsertPrice(env, item, localProductId, stripeProduct);
  return {
    courseCode: item.courseCode,
    family: item.family,
    productCode,
    stripeProductId: stripeProduct.id,
    productCreated,
    priceStatus: price.status,
    stripePriceId: price.stripePriceId,
    grossPence: item.grossPence,
    pricingBand: item.pricingBand || null,
  };
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["payments:checkout"]);
  if (auth.response) return auth.response;

  let body;
  try { body = await readJson(context.request, 128_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    await ensureCentralPaymentsSchema(context.env);
    await verifyCentralStripeAccount(context.env);
    const brand = requirePlatformBrand(auth.platform, body.brand);
    if (brand.code !== BRAND) return error("ELEARNING_BRAND_REQUIRED", "Course catalogue sync is restricted to Sousa Murray eLearning.", 403);

    if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_ITEMS) {
      return error("INVALID_COURSE_CATALOGUE_BATCH", `Provide between 1 and ${MAX_ITEMS} course products per sync batch.`, 400);
    }

    const normalised = body.items.map(normaliseItem);
    if (normalised.some(item => !item)) {
      return error("INVALID_COURSE_PRODUCT", "One or more course catalogue products are invalid or outside the approved Sousa Murray eLearning catalogue and pricing rules.", 400);
    }
    const productCodes = normalised.map(productCodeFor);
    if (new Set(productCodes).size !== productCodes.length) {
      return error("DUPLICATE_COURSE_PRODUCT", "The catalogue sync batch contains duplicate course products.", 400);
    }

    const results = [];
    for (const item of normalised) results.push(await syncOne(context.env, item));

    const ownConfig = ownCourseCommerceConfiguration(context.env);
    await platformAudit(context.env, auth.platform, "central_payment.course_catalogue.sync", "central_payment_catalogue", crypto.randomUUID(), {
      label: "Connected eLearning platform synchronised course products with Stripe",
      requestId: context.data.requestId,
      metadata: {
        brandCode: BRAND,
        batchSize: results.length,
        ownCoursePricingConfigured: ownConfig.pricingConfigured,
        ownCourseAccessConfigured: ownConfig.accessConfigured,
        createdProducts: results.filter(result => result.productCreated).length,
        createdPrices: results.filter(result => result.priceStatus === "created").length,
        replacedPrices: results.filter(result => result.priceStatus === "replaced").length,
        pendingPrices: results.filter(result => result.priceStatus === "pending_price").length,
      },
    });

    return json({
      synced: results.length,
      createdProducts: results.filter(result => result.productCreated).length,
      existingProducts: results.filter(result => !result.productCreated).length,
      createdPrices: results.filter(result => result.priceStatus === "created").length,
      replacedPrices: results.filter(result => result.priceStatus === "replaced").length,
      pendingPrices: results.filter(result => result.priceStatus === "pending_price").length,
      ownCoursePricingConfigured: ownConfig.pricingConfigured,
      ownCourseAccessConfigured: ownConfig.accessConfigured,
      results,
    }, 200);
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments could not synchronise the eLearning course catalogue with Stripe.");
  }
};