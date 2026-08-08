import { error, json, requirePlatform } from "../../../_shared.js";
import {
  ownCourseCataloguePrice,
  ownCourseCommerceConfiguration,
  splitVatInclusive,
  validateOwnCourseCode,
} from "../../../_elearning-own-course-commerce.js";

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["payments:checkout"]);
  if (auth.response) return auth.response;

  const url = new URL(context.request.url);
  const rawCodes = String(url.searchParams.get("codes") || "").split(",").map(value => value.trim()).filter(Boolean);
  if (!rawCodes.length || rawCodes.length > 25) {
    return error("INVALID_COURSE_CODES", "Provide between 1 and 25 Sousa Murray course codes.", 400);
  }

  const codes = [...new Set(rawCodes.map(validateOwnCourseCode))];
  if (codes.includes(null) || codes.length !== new Set(rawCodes.map(value => value.toUpperCase())).size) {
    return error("INVALID_COURSE_CODES", "One or more Sousa Murray course codes are invalid.", 400);
  }

  const configuration = ownCourseCommerceConfiguration(context.env);
  const items = await Promise.all(codes.map(async code => {
    const grossPence = await ownCourseCataloguePrice(context.env, code);
    const split = grossPence ? splitVatInclusive(grossPence) : null;
    return {
      courseCode: code,
      configured: Boolean(split),
      grossPence: split?.gross ?? null,
      netPence: split?.net ?? null,
      vatPence: split?.vat ?? null,
      currency: "GBP",
    };
  }));
  const pricesConfigured = items.every(item => item.configured);

  return json({
    configured: pricesConfigured,
    checkoutConfigured: pricesConfigured && configuration.accessConfigured,
    accessConfigured: configuration.accessConfigured,
    accessDays: configuration.accessDays,
    accessMonths: configuration.accessMonths,
    accessTerm: configuration.accessTerm,
    accessLabel: configuration.accessLabel,
    pricingModel: configuration.pricingModel,
    items,
  });
};