import { cleanText, error, json, platformAudit, readJson, requirePlatform } from "../../../_shared.js";
import {
  assertCustomerCanPay,
  centralPaymentError,
  centralStripePost,
  checkoutMetadata,
  ensureCentralPaymentsSchema,
  ensureCentralStripeCustomer,
  findCentralCustomer,
  requirePlatformBrand,
  validatePlatformReturnUrl,
  verifyCentralStripeAccount,
} from "../../../_central-payments.js";
import {
  ownCourseCommerceConfiguration,
  ownCoursePrice,
  splitVatInclusive,
  validateOwnCourseCode,
} from "../../../_elearning-own-course-commerce.js";
import { professionalTrainingPrice } from "../../../_professional-training-catalogue.js";

const BRAND_CODE = "SOUSA_MURRAY_ELEARNING";
const PRODUCT_CODE = "ELEARNING_UNIFIED_COURSE_BASKET";
const PRICE_CODE = "ELEARNING_UNIFIED_BASKET";
const FAMILY_OWN = "sousa_murray";
const FAMILY_HIGHFIELD = "highfield";
const MAX_LINES = 25;
const MAX_HIGHFIELD_LICENCES = 25;

async function ensureBasketSchema(env) {
  await ensureCentralPaymentsSchema(env);
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS central_payment_checkout_items (
    id TEXT PRIMARY KEY,
    checkout_request_id TEXT NOT NULL,
    line_position INTEGER NOT NULL,
    item_code TEXT NOT NULL,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    unit_net_minor INTEGER NOT NULL,
    unit_tax_minor INTEGER NOT NULL,
    unit_gross_minor INTEGER NOT NULL,
    line_net_minor INTEGER NOT NULL,
    line_tax_minor INTEGER NOT NULL,
    line_gross_minor INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'GBP',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    UNIQUE(checkout_request_id,line_position),
    FOREIGN KEY (checkout_request_id) REFERENCES central_payment_checkout_requests(id) ON DELETE CASCADE
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_central_checkout_items_request
    ON central_payment_checkout_items(checkout_request_id,line_position)`).run();
}

function highfieldCode(value) {
  let hash = 0x811c9dc5;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `HF-${hash.toString(16).toUpperCase().padStart(8, "0")}`;
}

async function catalogueProduct(env, productCode) {
  const row = await env.DB.prepare(`SELECT product_code,name,stripe_product_id,status
    FROM central_payment_catalogue_products
    WHERE product_code=? AND status='active' LIMIT 1`).bind(productCode).first();
  if (!row?.stripe_product_id) {
    throw Object.assign(new Error(`Stripe product ${productCode} is not ready in the Central Payments catalogue.`), {
      code: "COURSE_PRODUCT_NOT_READY",
      status: 409,
    });
  }
  return row;
}

async function normaliseItems(value, env) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LINES) return null;
  const seen = new Set();
  const rows = [];
  let highfieldLicenceCount = 0;

  for (const raw of value) {
    const family = cleanText(raw?.family, 40).toLowerCase();
    if (family === FAMILY_OWN) {
      const courseCode = validateOwnCourseCode(raw?.courseCode);
      if (!courseCode || seen.has(`${family}:${courseCode}`)) return null;
      const grossPence = ownCoursePrice(env, courseCode);
      const split = grossPence ? splitVatInclusive(grossPence) : null;
      if (!split) return null;
      const centralProductCode = `SME-COURSE-${courseCode}`.toUpperCase();
      const product = await catalogueProduct(env, centralProductCode);
      seen.add(`${family}:${courseCode}`);
      rows.push({
        family,
        itemCode: courseCode,
        itemName: product.name,
        stripeProductId: product.stripe_product_id,
        quantity: 1,
        unitNetPence: split.net,
        unitVatPence: split.vat,
        unitGrossPence: split.gross,
        lineNetPence: split.net,
        lineVatPence: split.vat,
        lineGrossPence: split.gross,
        metadata: {
          provider: "Sousa Murray eLearning",
          learningPlatform: "Sousa Murray LMS",
          centralProductCode,
        },
      });
      continue;
    }

    if (family === FAMILY_HIGHFIELD) {
      const courseId = cleanText(raw?.courseId, 180);
      const quantity = Number(raw?.quantity);
      if (!courseId || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_HIGHFIELD_LICENCES) return null;
      if (seen.has(`${family}:${courseId}`)) return null;
      const priced = professionalTrainingPrice(courseId, quantity);
      if (!priced) return null;
      highfieldLicenceCount += quantity;
      if (highfieldLicenceCount > MAX_HIGHFIELD_LICENCES) return null;
      const courseCode = highfieldCode(courseId);
      const centralProductCode = `HF-COURSE-${courseCode}`.toUpperCase();
      const product = await catalogueProduct(env, centralProductCode);
      seen.add(`${family}:${courseId}`);
      rows.push({
        family,
        itemCode: courseId,
        itemName: product.name || priced.title,
        stripeProductId: product.stripe_product_id,
        quantity,
        unitNetPence: priced.unitNetPence,
        unitVatPence: priced.unitVatPence,
        unitGrossPence: priced.unitGrossPence,
        lineNetPence: priced.lineNetPence,
        lineVatPence: priced.lineVatPence,
        lineGrossPence: priced.lineGrossPence,
        metadata: {
          provider: "Highfield Online Training",
          learningPlatform: "Highfield LMS",
          centralProductCode,
          courseCode,
          scheduleCode: priced.scheduleCode,
          providerRetailPence: priced.providerRetailPence,
        },
      });
      continue;
    }

    return null;
  }

  return rows;
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["payments:checkout"]);
  if (auth.response) return auth.response;

  let body;
  try { body = await readJson(context.request, 96_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    if (String(context.env.CENTRAL_PAYMENTS_ENABLED || "").trim().toLowerCase() === "false") {
      throw Object.assign(new Error("Central Payments checkout has been disabled by the Head Office emergency payment switch."), {
        code: "CENTRAL_PAYMENTS_DISABLED",
        status: 503,
      });
    }

    const brand = requirePlatformBrand(auth.platform, body.brand);
    if (brand.code !== BRAND_CODE) {
      return error("ELEARNING_BRAND_REQUIRED", "Unified course checkout is restricted to Sousa Murray eLearning.", 403);
    }

    const requestedItems = Array.isArray(body.items) ? body.items : [];
    const containsOwnCourses = requestedItems.some(item => cleanText(item?.family, 40).toLowerCase() === FAMILY_OWN);
    if (containsOwnCourses) {
      const commerce = ownCourseCommerceConfiguration(context.env);
      if (!commerce.pricingConfigured || !commerce.accessConfigured) {
        return error(
          "ELEARNING_OWN_COURSE_COMMERCE_NOT_CONFIGURED",
          "Individual Sousa Murray course pricing and access duration must be configured in Head Office before checkout can be used.",
          503,
        );
      }
    }

    await ensureBasketSchema(context.env);
    await verifyCentralStripeAccount(context.env);
    const customer = await findCentralCustomer(context.env, body.customerNumber || body.ucn);
    await assertCustomerCanPay(context.env, customer, auth.platform);
    const items = await normaliseItems(requestedItems, context.env);
    if (!items) {
      return error("INVALID_ELEARNING_BASKET", "The eLearning basket contains an unknown, duplicated, unpriced or unavailable course.", 400);
    }

    const stripeCustomer = await ensureCentralStripeCustomer(context.env, customer, auth.platform, brand);
    const successUrl = await validatePlatformReturnUrl(context.env, auth.platform, body.successUrl);
    const cancelUrl = await validatePlatformReturnUrl(context.env, auth.platform, body.cancelUrl);
    const orderReference = cleanText(body.orderReference, 120) || null;
    const serviceReference = cleanText(body.serviceReference, 120) || "unified_course_basket";
    const checkoutRequestId = crypto.randomUUID();
    const metadata = checkoutMetadata({
      platform: auth.platform,
      brand,
      customer,
      product: { product_code: PRODUCT_CODE, price_code: PRICE_CODE },
      orderReference,
      serviceReference,
      checkoutRequestId,
    });

    const totalNet = items.reduce((sum, item) => sum + item.lineNetPence, 0);
    const totalVat = items.reduce((sum, item) => sum + item.lineVatPence, 0);
    const totalGross = items.reduce((sum, item) => sum + item.lineGrossPence, 0);
    const ownCourseCount = items.filter(item => item.family === FAMILY_OWN).length;
    const highfieldLineCount = items.filter(item => item.family === FAMILY_HIGHFIELD).length;
    const highfieldLicenceCount = items.filter(item => item.family === FAMILY_HIGHFIELD).reduce((sum, item) => sum + item.quantity, 0);

    const fields = {
      mode: "payment",
      customer: stripeCustomer.id,
      client_reference_id: customer.customer_number,
      success_url: successUrl,
      cancel_url: cancelUrl,
      billing_address_collection: "auto",
      "customer_update[address]": "auto",
    };

    items.forEach((item, index) => {
      fields[`line_items[${index}][price_data][currency]`] = "gbp";
      fields[`line_items[${index}][price_data][unit_amount]`] = String(item.unitGrossPence);
      fields[`line_items[${index}][price_data][tax_behavior]`] = "inclusive";
      fields[`line_items[${index}][price_data][product]`] = item.stripeProductId;
      fields[`line_items[${index}][quantity]`] = String(item.quantity);
    });

    const extendedMetadata = {
      ...metadata,
      service: "unified_course_basket",
      provider: ownCourseCount && highfieldLineCount ? "mixed" : ownCourseCount ? "Sousa Murray eLearning" : "Highfield Online Training",
      basket_lines: String(items.length),
      own_course_count: String(ownCourseCount),
      highfield_line_count: String(highfieldLineCount),
      highfield_licence_count: String(highfieldLicenceCount),
      subtotal_net_minor: String(totalNet),
      vat_minor: String(totalVat),
      total_gross_minor: String(totalGross),
    };
    for (const [key, value] of Object.entries(extendedMetadata)) fields[`metadata[${key}]`] = value;
    for (const [key, value] of Object.entries(extendedMetadata)) fields[`payment_intent_data[metadata][${key}]`] = value;

    const session = await centralStripePost(context.env, "/checkout/sessions", fields, `elearning-unified-${checkoutRequestId}`);
    if (!session?.id || !session?.url) {
      throw Object.assign(new Error("Stripe did not return a hosted Checkout Session URL."), {
        code: "STRIPE_CHECKOUT_URL_MISSING",
        status: 502,
      });
    }

    const now = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(`INSERT INTO central_payment_checkout_requests
        (id,platform_id,brand_code,product_code,price_code,customer_id,customer_number,stripe_customer_id,stripe_checkout_session_id,
         order_reference,service_reference,success_url,cancel_url,mode,status,amount_minor,currency,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,'created',?,?,?,?)`)
        .bind(checkoutRequestId, auth.platform.id, brand.code, PRODUCT_CODE, PRICE_CODE, customer.id, customer.customer_number,
          stripeCustomer.id, session.id, orderReference, serviceReference, successUrl, cancelUrl, "payment", totalGross, "GBP", now, now),
      ...items.map((item, index) => context.env.DB.prepare(`INSERT INTO central_payment_checkout_items
        (id,checkout_request_id,line_position,item_code,item_name,quantity,unit_net_minor,unit_tax_minor,unit_gross_minor,
         line_net_minor,line_tax_minor,line_gross_minor,currency,metadata_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), checkoutRequestId, index, item.itemCode, item.itemName, item.quantity,
          item.unitNetPence, item.unitVatPence, item.unitGrossPence, item.lineNetPence, item.lineVatPence,
          item.lineGrossPence, "GBP", JSON.stringify({ family: item.family, ...item.metadata }), now)),
    ]);

    await platformAudit(context.env, auth.platform, "central_payment.elearning_unified_checkout.create", "central_payment_checkout", checkoutRequestId, {
      label: "Connected eLearning platform created one governed mixed course checkout",
      reference: orderReference || checkoutRequestId,
      customerId: customer.id,
      requestId: context.data.requestId,
      metadata: {
        customerNumber: customer.customer_number,
        stripeCheckoutSessionId: session.id,
        lineCount: items.length,
        ownCourseCount,
        highfieldLineCount,
        highfieldLicenceCount,
        subtotalNetMinor: totalNet,
        vatMinor: totalVat,
        totalGrossMinor: totalGross,
      },
    });

    return json({
      checkout: {
        reference: checkoutRequestId,
        sessionId: session.id,
        url: session.url,
        mode: "payment",
        customerNumber: customer.customer_number,
        brandCode: brand.code,
        productCode: PRODUCT_CODE,
        priceCode: PRICE_CODE,
        amountMinor: totalGross,
        currency: "GBP",
      },
      totals: {
        subtotalNetMinor: totalNet,
        vatMinor: totalVat,
        totalGrossMinor: totalGross,
        lineCount: items.length,
        ownCourseCount,
        highfieldLineCount,
        highfieldLicenceCount,
      },
    }, 201);
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments could not create the unified Sousa Murray eLearning basket checkout.");
  }
};
