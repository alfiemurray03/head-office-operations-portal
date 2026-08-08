const COURSE_CODE_PATTERN = /^SME-[A-Z0-9]{2,4}-\d{3}$/;

export const OWN_COURSE_ACCESS_DAYS = 365;
export const OWN_COURSE_ACCESS_MONTHS = 12;
export const OWN_COURSE_ACCESS_TERM = "12_months";
export const OWN_COURSE_ACCESS_LABEL = "12 months of course access";

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function pricingMap(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result = {};
    for (const [rawCode, rawPrice] of Object.entries(parsed)) {
      const code = String(rawCode || "").trim().toUpperCase();
      const price = positiveInteger(rawPrice);
      if (COURSE_CODE_PATTERN.test(code) && price) result[code] = price;
    }
    return result;
  } catch {
    return {};
  }
}

export function ownCourseCommerceConfiguration(env) {
  const defaultGrossPence = positiveInteger(env?.ELEARNING_OWN_COURSE_DEFAULT_GROSS_PENCE);
  const prices = pricingMap(env?.ELEARNING_OWN_COURSE_PRICES_JSON);
  return {
    defaultGrossPence,
    prices,
    accessDays: OWN_COURSE_ACCESS_DAYS,
    accessMonths: OWN_COURSE_ACCESS_MONTHS,
    accessTerm: OWN_COURSE_ACCESS_TERM,
    accessLabel: OWN_COURSE_ACCESS_LABEL,
    accessConfigured: true,
    pricingConfigured: true,
    pricingModel: "governed_complexity_bands",
  };
}

export function ownCoursePrice(env, courseCode) {
  const code = String(courseCode || "").trim().toUpperCase();
  if (!COURSE_CODE_PATTERN.test(code)) return null;
  const configuration = ownCourseCommerceConfiguration(env);
  return configuration.prices[code] || configuration.defaultGrossPence || null;
}

export function validateOwnCourseCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return COURSE_CODE_PATTERN.test(code) ? code : null;
}

export function ownCourseProductCode(courseCode) {
  const code = validateOwnCourseCode(courseCode);
  return code ? `SME-COURSE-${code}`.toUpperCase() : null;
}

export function ownCoursePriceCode(courseCode) {
  const productCode = ownCourseProductCode(courseCode);
  return productCode ? `${productCode}-INDIVIDUAL`.toUpperCase() : null;
}

export async function ownCourseCataloguePrice(env, courseCode) {
  const code = validateOwnCourseCode(courseCode);
  if (!code) return null;
  const priceCode = ownCoursePriceCode(code);
  if (env?.DB && priceCode) {
    const row = await env.DB.prepare(`SELECT amount_minor,currency,billing_type,status
      FROM central_payment_catalogue_prices
      WHERE price_code=? AND status='active' LIMIT 1`).bind(priceCode).first();
    const amount = positiveInteger(row?.amount_minor);
    if (amount && String(row?.currency || "").toUpperCase() === "GBP" && row?.billing_type === "one_time") return amount;
  }
  return ownCoursePrice(env, code);
}

export function splitVatInclusive(grossPence) {
  const gross = positiveInteger(grossPence);
  if (!gross) return null;
  const net = Math.round(gross / 1.2);
  return { gross, net, vat: gross - net };
}
