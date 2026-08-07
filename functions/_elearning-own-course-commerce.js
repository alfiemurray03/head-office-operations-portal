const COURSE_CODE_PATTERN = /^SME-[A-Z0-9]{2,4}-\d{3}$/;

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

function accessConfiguration(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "permanent" || raw === "unlimited" || raw === "lifetime") {
    return { configured: true, accessDays: null, label: "Permanent course access" };
  }
  const days = positiveInteger(raw);
  if (!days) return { configured: false, accessDays: null, label: null };
  return { configured: true, accessDays: days, label: `${days} days of course access` };
}

export function ownCourseCommerceConfiguration(env) {
  const defaultGrossPence = positiveInteger(env.ELEARNING_OWN_COURSE_DEFAULT_GROSS_PENCE);
  const prices = pricingMap(env.ELEARNING_OWN_COURSE_PRICES_JSON);
  const access = accessConfiguration(env.ELEARNING_OWN_COURSE_ACCESS_DAYS);
  return {
    defaultGrossPence,
    prices,
    accessDays: access.accessDays,
    accessLabel: access.label,
    accessConfigured: access.configured,
    pricingConfigured: Boolean(defaultGrossPence || Object.keys(prices).length),
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

export function splitVatInclusive(grossPence) {
  const gross = positiveInteger(grossPence);
  if (!gross) return null;
  const net = Math.round(gross / 1.2);
  return { gross, net, vat: gross - net };
}
