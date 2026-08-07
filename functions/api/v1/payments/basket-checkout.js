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
import { professionalTrainingPrice } from "../../../_professional-training-catalogue.js";

const PRODUCT_CODE = "ELEARNING_PROFESSIONAL_TRAINING";
const PRICE_CODE = "PROFESSIONAL_TRAINING_BASKET";
const MAX_LINES = 25;
const MAX_TOTAL_LICENCES = 250;

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

function normaliseItems(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_LINES) return null;
  const combined = new Map();
  for (const raw of value) {
    const courseId = cleanText(raw?.courseId, 180);
    const quantity = Number(raw?.quantity);
    if (!courseId || !Number.isInteger(quantity) || quantity < 1 || quantity > 25) return null;
    combined.set(courseId, (combined.get(courseId) || 0) + quantity);
  }
  if ([...combined.values()].some(quantity => quantity > 25)) return null;
  const totalLicences = [...combined.values()].reduce((total, quantity) => total + quantity, 0);
  if (totalLicences > MAX_TOTAL_LICENCES) return null;
  const rows = [...combined.entries()].map(([courseId, quantity]) => professionalTrainingPrice(courseId, quantity));
  if (rows.some(row => !row)) return null;
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

    await ensureBasketSchema(context.env);
    await verifyCentralStripeAccount(context.env);
    const brand = requirePlatformBrand(auth.platform, body.brand);
    if (brand.code !== "SOUSA_MURRAY_ELEARNING") {
      return error("PROFESSIONAL_TRAINING_BRAND_REQUIRED", "Professional Training basket checkout is restricted to Sousa Murray eLearning.", 403);
    }

    const customer = await findCentralCustomer(context.env, body.customerNumber || body.ucn);
    await assertCustomerCanPay(context.env, customer, auth.platform);
    const items = normaliseItems(body.items);
    if (!items) {
      return error("INVALID_PROFESSIONAL_TRAINING_BASKET", "The Professional Training basket contains an unknown course, invalid quantity or too many licences.", 400);
    }

    const stripeCustomer = await ensureCentralStripeCustomer(context.env, customer, auth.platform, brand);
    const successUrl = await validatePlatformReturnUrl(context.env, auth.platform, body.successUrl);
    const cancelUrl = await validatePlatformReturnUrl(context.env, auth.platform, body.cancelUrl);
    const orderReference = cleanText(body.orderReference, 120) || null;
    const serviceReference = cleanText(body.serviceReference, 120) || "professional_training";
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
    const totalLicences = items.reduce((sum, item) => sum + item.quantity, 0);

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
      fields[`line_items[${index}][price_data][product_data][name]`] = item.title;
      fields[`line_items[${index}][price_data][product_data][description]`] = "Sousa Murray eLearning · Highfield Professional Training licence";
      fields[`line_items[${index}][price_data][product_data][metadata][course_id]`] = item.id;
      fields[`line_items[${index}][price_data][product_data][metadata][provider]`] = "Highfield e-learning";
      fields[`line_items[${index}][quantity]`] = String(item.quantity);
    });

    const extendedMetadata = {
      ...metadata,
      service: "professional_training",
      provider: "Highfield e-learning",
      basket_lines: String(items.length),
      licence_count: String(totalLicences),
      subtotal_net_minor: String(totalNet),
      vat_minor: String(totalVat),
      total_gross_minor: String(totalGross),
    };
    for (const [key, value] of Object.entries(extendedMetadata)) fields[`metadata[${key}]`] = value;
    for (const [key, value] of Object.entries(extendedMetadata)) fields[`payment_intent_data[metadata][${key}]`] = value;

    const session = await centralStripePost(context.env, "/checkout/sessions", fields, `professional-training-${checkoutRequestId}`);
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
        .bind(crypto.randomUUID(), checkoutRequestId, index, item.id, item.title, item.quantity, item.unitNetPence,
          item.unitVatPence, item.unitGrossPence, item.lineNetPence, item.lineVatPence, item.lineGrossPence, "GBP",
          JSON.stringify({ provider: "Highfield e-learning", scheduleCode: item.scheduleCode, providerRetailPence: item.providerRetailPence }), now)),
    ];
    await context.env.DB.batch(statements);

    await platformAudit(context.env, auth.platform, "central_payment.professional_training_checkout.create", "central_payment_checkout", checkoutRequestId, {
      label: "Connected eLearning platform created governed Professional Training basket checkout",
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
        licenceCount: totalLicences,
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
      totals: { subtotalNetMinor: totalNet, vatMinor: totalVat, totalGrossMinor: totalGross, licenceCount: totalLicences },
    }, 201);
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments could not create the Professional Training basket checkout.");
  }
};
