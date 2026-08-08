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
  ownCourseCataloguePrice,
  ownCourseCommerceConfiguration,
  ownCoursePriceCode,
  splitVatInclusive,
  validateOwnCourseCode,
} from "../../../_elearning-own-course-commerce.js";

const PRODUCT_CODE = "ELEARNING_OWN_COURSE_BASKET";
const PRICE_CODE = "OWN_COURSE_BASKET";
const MAX_LINES = 25;

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

async function normaliseItems(value, env) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LINES) return null;
  const seen = new Set();
  const rows = [];
  for (const raw of value) {
    const courseCode = validateOwnCourseCode(raw?.courseCode);
    const courseTitle = cleanText(raw?.courseTitle, 180);
    if (!courseCode || !courseTitle || seen.has(courseCode)) return null;
    const grossPence = await ownCourseCataloguePrice(env, courseCode);
    const split = grossPence ? splitVatInclusive(grossPence) : null;
    const priceCode = ownCoursePriceCode(courseCode);
    const cataloguePrice = priceCode
      ? await env.DB.prepare(`SELECT stripe_price_id FROM central_payment_catalogue_prices WHERE price_code=? AND status='active' LIMIT 1`).bind(priceCode).first()
      : null;
    if (!split || !cataloguePrice?.stripe_price_id) return null;
    seen.add(courseCode);
    rows.push({
      courseCode,
      courseTitle,
      stripePriceId: cataloguePrice.stripe_price_id,
      quantity: 1,
      unitNetPence: split.net,
      unitVatPence: split.vat,
      unitGrossPence: split.gross,
      lineNetPence: split.net,
      lineVatPence: split.vat,
      lineGrossPence: split.gross,
    });
  }
  return rows;
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["payments:checkout"]);
  if (auth.response) return auth.response;

  let body;
  try { body = await readJson(context.request, 64_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    if (String(context.env.CENTRAL_PAYMENTS_ENABLED || "").trim().toLowerCase() === "false") {
      throw Object.assign(new Error("Central Payments checkout has been disabled by the Head Office emergency payment switch."), {
        code: "CENTRAL_PAYMENTS_DISABLED", status: 503,
      });
    }

    const commerce = ownCourseCommerceConfiguration(context.env);
    if (!commerce.accessConfigured) {
      return error(
        "ELEARNING_OWN_COURSE_ACCESS_NOT_CONFIGURED",
        "Individual Sousa Murray course access duration must be configured in Head Office before checkout can be used.",
        503,
      );
    }

    await ensureBasketSchema(context.env);
    await verifyCentralStripeAccount(context.env);
    const brand = requirePlatformBrand(auth.platform, body.brand);
    if (brand.code !== "SOUSA_MURRAY_ELEARNING") {
      return error("ELEARNING_BRAND_REQUIRED", "Sousa Murray own-course checkout is restricted to Sousa Murray eLearning.", 403);
    }

    const customer = await findCentralCustomer(context.env, body.customerNumber || body.ucn);
    await assertCustomerCanPay(context.env, customer, auth.platform);
    const items = await normaliseItems(body.items, context.env);
    if (!items) {
      return error("INVALID_ELEARNING_COURSE_BASKET", "The Sousa Murray course basket contains an unknown, duplicated or unpriced course.", 400);
    }

    const stripeCustomer = await ensureCentralStripeCustomer(context.env, customer, auth.platform, brand);
    const successUrl = await validatePlatformReturnUrl(context.env, auth.platform, body.successUrl);
    const cancelUrl = await validatePlatformReturnUrl(context.env, auth.platform, body.cancelUrl);
    const orderReference = cleanText(body.orderReference, 120) || null;
    const serviceReference = cleanText(body.serviceReference, 120) || "own_course_purchase";
    const checkoutRequestId = crypto.randomUUID();
    const syntheticProduct = { product_code: PRODUCT_CODE, price_code: PRICE_CODE };
    const metadata = checkoutMetadata({
      platform: auth.platform,
      brand,
      customer,
      product: syntheticProduct,
      orderReference,
      serviceReference,
      checkoutRequestId,
    });

    const totalNet = items.reduce((sum, item) => sum + item.lineNetPence, 0);
    const totalVat = items.reduce((sum, item) => sum + item.lineVatPence, 0);
    const totalGross = items.reduce((sum, item) => sum + item.lineGrossPence, 0);

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
      fields[`line_items[${index}][price]`] = item.stripePriceId;
      fields[`line_items[${index}][quantity]`] = "1";
    });

    const extendedMetadata = {
      ...metadata,
      service: "own_course_purchase",
      provider: "Sousa Murray eLearning",
      learning_platform: "Sousa Murray LMS",
      basket_lines: String(items.length),
      subtotal_net_minor: String(totalNet),
      vat_minor: String(totalVat),
      total_gross_minor: String(totalGross),
      access_days: commerce.accessDays === null ? "permanent" : String(commerce.accessDays),
    };
    for (const [key, value] of Object.entries(extendedMetadata)) fields[`metadata[${key}]`] = value;
    for (const [key, value] of Object.entries(extendedMetadata)) fields[`payment_intent_data[metadata][${key}]`] = value;

    const session = await centralStripePost(context.env, "/checkout/sessions", fields, `elearning-own-course-${checkoutRequestId}`);
    if (!session?.id || !session?.url) {
      throw Object.assign(new Error("Stripe did not return a hosted Checkout Session URL."), {
        code: "STRIPE_CHECKOUT_URL_MISSING", status: 502,
      });
    }

    const now = new Date().toISOString();
    const statements = [
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
        .bind(crypto.randomUUID(), checkoutRequestId, index, item.courseCode, item.courseTitle, 1, item.unitNetPence,
          item.unitVatPence, item.unitGrossPence, item.lineNetPence, item.lineVatPence, item.lineGrossPence, "GBP",
          JSON.stringify({ provider: "Sousa Murray eLearning", learningPlatform: "Sousa Murray LMS", accessDays: commerce.accessDays, stripePriceId: item.stripePriceId }), now)),
    ];
    await context.env.DB.batch(statements);

    await platformAudit(context.env, auth.platform, "central_payment.elearning_own_course_checkout.create", "central_payment_checkout", checkoutRequestId, {
      label: "Connected eLearning platform created governed own-course basket checkout",
      reference: orderReference || checkoutRequestId,
      customerId: customer.id,
      requestId: context.data.requestId,
      metadata: {
        brandCode: brand.code,
        productCode: PRODUCT_CODE,
        priceCode: PRICE_CODE,
        customerNumber: customer.customer_number,
        stripeCheckoutSessionId: session.id,
        lineCount: items.length,
        subtotalNetMinor: totalNet,
        vatMinor: totalVat,
        totalGrossMinor: totalGross,
        accessDays: commerce.accessDays,
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
      commerce: { accessDays: commerce.accessDays, accessLabel: commerce.accessLabel },
      totals: { subtotalNetMinor: totalNet, vatMinor: totalVat, totalGrossMinor: totalGross, courseCount: items.length },
    }, 201);
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments could not create the Sousa Murray course basket checkout.");
  }
};