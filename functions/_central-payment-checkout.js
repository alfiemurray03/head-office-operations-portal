import { cleanText } from "./_shared.js";
import {
  assertCustomerCanPay,
  centralStripePost,
  checkoutMetadata,
  ensureCentralPaymentsSchema,
  ensureCentralStripeCustomer,
  validatePlatformReturnUrl,
  verifyCentralStripeAccount,
} from "./_central-payments.js";

const CHECKOUT_POLICIES = Object.freeze({
  PLANEIA_EXPLORE_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PLANEIA_PLAN_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PLANEIA_COMPLETE_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PLANEIA_TOGETHER_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PLANEIA_BUSINESS_EXPLORE_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PLANEIA_BUSINESS_PLAN_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PLANEIA_BUSINESS_COMPLETE_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PLANEIA_BUSINESS_TOGETHER_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PROFILES_STARTER_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PROFILES_PROFESSIONAL_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PROFILES_ORGANISATION_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  PROFILES_ULTIMATE_ORGANISATION_MONTHLY: Object.freeze({ trialPeriodDays: 30, allowPromotionCodes: true }),
  ELEARNING_AI_LITERACY_TRIAL_FREE: Object.freeze({ trialPeriodDays: 0, allowPromotionCodes: false }),
});

function policyFor(product) {
  return CHECKOUT_POLICIES[cleanText(product?.price_code, 100).toUpperCase()] || Object.freeze({
    trialPeriodDays: 0,
    allowPromotionCodes: true,
  });
}

export async function createGovernedCentralCheckout(env, input) {
  // Central Payments is the production payment path. The switch is an emergency
  // kill switch only: an explicit `false` disables checkout, while an absent
  // value no longer blocks every connected website. Stripe account/key checks
  // below continue to fail closed if production credentials are missing/wrong.
  if (String(env.CENTRAL_PAYMENTS_ENABLED || "").trim().toLowerCase() === "false") {
    throw Object.assign(new Error("Central Payments checkout has been disabled by the Head Office emergency payment switch."), {
      code: "CENTRAL_PAYMENTS_DISABLED",
      status: 503,
    });
  }

  await ensureCentralPaymentsSchema(env);
  await verifyCentralStripeAccount(env);
  const { platform, brand, customer, product } = input;
  await assertCustomerCanPay(env, customer, platform);
  const stripeCustomer = await ensureCentralStripeCustomer(env, customer, platform, brand);
  const successUrl = await validatePlatformReturnUrl(env, platform, input.successUrl);
  const cancelUrl = await validatePlatformReturnUrl(env, platform, input.cancelUrl);
  const checkoutRequestId = crypto.randomUUID();
  const orderReference = cleanText(input.orderReference, 120) || null;
  const serviceReference = cleanText(input.serviceReference, 120) || null;
  const mode = product.billing_type === "recurring" ? "subscription" : "payment";
  const policy = policyFor(product);
  const noCostPayment = mode === "payment" && Number(product.amount_minor || 0) === 0;
  const metadata = checkoutMetadata({
    platform,
    brand,
    customer,
    product,
    orderReference,
    serviceReference,
    checkoutRequestId,
  });

  const fields = {
    mode,
    customer: stripeCustomer.id,
    client_reference_id: customer.customer_number,
    "line_items[0][price]": product.stripe_price_id,
    "line_items[0][quantity]": 1,
    success_url: successUrl,
    cancel_url: cancelUrl,
    billing_address_collection: "auto",
    "customer_update[address]": "auto",
    allow_promotion_codes: policy.allowPromotionCodes ? "true" : undefined,
    payment_method_collection: noCostPayment ? "if_required" : undefined,
  };

  for (const [key, value] of Object.entries(metadata)) fields[`metadata[${key}]`] = value;

  // Free Checkout orders do not create a PaymentIntent, so payment_intent_data
  // must not be used for a £0.00 order. Checkout-session metadata remains the
  // authoritative routing metadata for no-cost fulfilment.
  if (mode === "subscription") {
    for (const [key, value] of Object.entries(metadata)) fields[`subscription_data[metadata][${key}]`] = value;
  } else if (!noCostPayment) {
    for (const [key, value] of Object.entries(metadata)) fields[`payment_intent_data[metadata][${key}]`] = value;
  }

  if (mode === "subscription" && Number(policy.trialPeriodDays || 0) > 0) {
    fields["subscription_data[trial_period_days]"] = String(policy.trialPeriodDays);
  }

  const session = await centralStripePost(env, "/checkout/sessions", fields, `central-checkout-${checkoutRequestId}`);
  if (!session?.id || !session?.url) {
    throw Object.assign(new Error("Stripe did not return a hosted Checkout Session URL."), {
      code: "STRIPE_CHECKOUT_URL_MISSING",
      status: 502,
    });
  }

  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO central_payment_checkout_requests
    (id,platform_id,brand_code,product_code,price_code,customer_id,customer_number,stripe_customer_id,stripe_checkout_session_id,
     order_reference,service_reference,success_url,cancel_url,mode,status,amount_minor,currency,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'created',?,?,?,?)`)
    .bind(
      checkoutRequestId,
      platform.id,
      brand.code,
      product.product_code,
      product.price_code,
      customer.id,
      customer.customer_number,
      stripeCustomer.id,
      session.id,
      orderReference,
      serviceReference,
      successUrl,
      cancelUrl,
      mode,
      product.amount_minor,
      product.currency,
      now,
      now,
    ).run();

  return {
    checkoutRequestId,
    sessionId: session.id,
    url: session.url,
    mode,
    noCostPayment,
    trialPeriodDays: mode === "subscription" ? Number(policy.trialPeriodDays || 0) : 0,
  };
}
