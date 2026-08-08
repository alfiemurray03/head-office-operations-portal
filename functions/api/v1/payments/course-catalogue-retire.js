import { cleanText, error, json, platformAudit, readJson, requirePlatform } from '../../../_shared.js';
import {
  centralPaymentError,
  centralStripePost,
  ensureCentralPaymentsSchema,
  requirePlatformBrand,
  verifyCentralStripeAccount,
} from '../../../_central-payments.js';
import { validateOwnCourseCode } from '../../../_elearning-own-course-commerce.js';

const BRAND = 'SOUSA_MURRAY_ELEARNING';

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ['payments:checkout']);
  if (auth.response) return auth.response;

  let body;
  try { body = await readJson(context.request, 64_000); }
  catch (cause) { return error(cause.code || 'INVALID_REQUEST', cause.message, cause.status || 400); }

  try {
    await ensureCentralPaymentsSchema(context.env);
    await verifyCentralStripeAccount(context.env);
    const brand = requirePlatformBrand(auth.platform, body.brand);
    if (brand.code !== BRAND) return error('ELEARNING_BRAND_REQUIRED', 'Course catalogue retirement is restricted to Sousa Murray eLearning.', 403);

    if (!Array.isArray(body.activeCourseCodes) || body.activeCourseCodes.length < 1 || body.activeCourseCodes.length > 100) {
      return error('INVALID_ACTIVE_COURSE_CODES', 'Provide the complete active Sousa Murray course-code list.', 400);
    }
    const activeCodes = [...new Set(body.activeCourseCodes.map(validateOwnCourseCode))];
    if (activeCodes.includes(null) || activeCodes.length !== body.activeCourseCodes.length) {
      return error('INVALID_ACTIVE_COURSE_CODES', 'One or more active Sousa Murray course codes are invalid or duplicated.', 400);
    }
    const activeProductCodes = new Set(activeCodes.map(code => `SME-COURSE-${code}`.toUpperCase()));

    const products = await context.env.DB.prepare(`SELECT id,product_code,stripe_product_id,name
      FROM central_payment_catalogue_products
      WHERE brand_code=? AND service_type='digital_course' AND product_code LIKE 'SME-COURSE-%' AND status='active'`)
      .bind(BRAND).all();

    const retired = [];
    for (const product of products.results || []) {
      const productCode = String(product.product_code || '').toUpperCase();
      if (activeProductCodes.has(productCode)) continue;

      if (product.stripe_product_id) {
        try {
          await centralStripePost(context.env, `/products/${encodeURIComponent(product.stripe_product_id)}`, { active: 'false' }, `retire-${product.stripe_product_id}`);
        } catch (cause) {
          if (cause?.status !== 404) throw cause;
        }
      }

      const prices = await context.env.DB.prepare(`SELECT id,stripe_price_id,price_code FROM central_payment_catalogue_prices WHERE product_id=? AND status='active'`)
        .bind(product.id).all();
      for (const price of prices.results || []) {
        if (price.stripe_price_id) {
          try {
            await centralStripePost(context.env, `/prices/${encodeURIComponent(price.stripe_price_id)}`, { active: 'false' }, `retire-${price.stripe_price_id}`);
          } catch (cause) {
            if (cause?.status !== 404) throw cause;
          }
        }
      }

      await context.env.DB.batch([
        context.env.DB.prepare(`UPDATE central_payment_catalogue_products SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(product.id),
        context.env.DB.prepare(`UPDATE central_payment_catalogue_prices SET status='archived',updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND status='active'`).bind(product.id),
      ]);
      retired.push({ productCode, name: cleanText(product.name, 180), stripeProductId: product.stripe_product_id || null });
    }

    await platformAudit(context.env, auth.platform, 'central_payment.elearning_course_catalogue.retire', 'central_payment_catalogue', BRAND, {
      label: 'Retired Sousa Murray topic-sized course products after programme catalogue reconciliation',
      reference: `active:${activeCodes.length}`,
      requestId: context.data.requestId,
      metadata: { activeCourseCodes: activeCodes, retiredCount: retired.length },
    });

    return json({ activeCourseCount: activeCodes.length, retiredCount: retired.length, retired });
  } catch (cause) {
    return centralPaymentError(cause, 'Central Payments could not retire the old Sousa Murray course catalogue products.');
  }
};
