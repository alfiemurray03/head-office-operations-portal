import { error, json, requirePlatform } from "../../../_shared.js";
import {
  ownCourseCommerceConfiguration,
  ownCoursePrice,
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
  const items = codes.map(code => {
    const grossPence = ownCoursePrice(context.env, code);
    const split = grossPence ? splitVatInclusive(grossPence) : null;
    return {
      courseCode: code,
      configured: Boolean(split),
      grossPence: split?.gross ?? null,
      netPence: split?.net ?? null,
      vatPence: split?.vat ?? null,
      currency: "GBP",
    };
  });

  return json({
    configured: configuration.pricingConfigured && configuration.accessConfigured && items.every(item => item.configured),
    accessDays: configuration.accessDays,
    accessLabel: configuration.accessLabel,
    items,
  });
};
