import { cleanText, error, json, platformAudit, readJson, requirePlatform } from "../../../_shared.js";
import {
  centralPaymentError,
  createCentralCheckout,
  ensureCentralPaymentsSchema,
  findCentralCustomer,
  requirePlatformBrand,
  resolveCentralPrice,
} from "../../../_central-payments.js";

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["payments:checkout"]);
  if (auth.response) return auth.response;

  let body;
  try { body = await readJson(context.request, 32_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    await ensureCentralPaymentsSchema(context.env);
    const brand = requirePlatformBrand(auth.platform, body.brand);
    const productCode = cleanText(body.productCode, 100).toUpperCase();
    const priceCode = cleanText(body.priceCode, 100).toUpperCase();
    if (!productCode || !priceCode) return error("PAYMENT_PRODUCT_REQUIRED", "A Central Payments product code and price code are required.", 400);

    const customer = await findCentralCustomer(context.env, body.customerNumber || body.ucn);
    const product = await resolveCentralPrice(context.env, brand.code, productCode, priceCode);
    const result = await createCentralCheckout(context.env, {
      platform: auth.platform,
      brand,
      customer,
      product,
      orderReference: body.orderReference,
      serviceReference: body.serviceReference,
      successUrl: body.successUrl,
      cancelUrl: body.cancelUrl,
    });

    await platformAudit(context.env, auth.platform, "central_payment.checkout.create", "central_payment_checkout", result.checkoutRequestId, {
      label: "Connected platform created Central Payments Checkout",
      reference: body.orderReference || result.checkoutRequestId,
      customerId: customer.id,
      requestId: context.data.requestId,
      metadata: {
        brandCode: brand.code,
        productCode,
        priceCode,
        customerNumber: customer.customer_number,
        stripeCheckoutSessionId: result.sessionId,
        mode: result.mode,
      },
    });

    return json({
      checkout: {
        reference: result.checkoutRequestId,
        sessionId: result.sessionId,
        url: result.url,
        mode: result.mode,
        customerNumber: customer.customer_number,
        brandCode: brand.code,
        productCode,
        priceCode,
      },
    }, 201);
  } catch (cause) {
    return centralPaymentError(cause, "Central Payments could not create the checkout session.");
  }
};
