export const OWN_COURSE_COMMERCIAL_UPLIFT_BASIS_POINTS = 3000;
export const OWN_COURSE_VAT_BASIS_POINTS = 2000;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function commercialPrice(baseValuePence) {
  const retailNetPence = Math.round(baseValuePence * (1 + OWN_COURSE_COMMERCIAL_UPLIFT_BASIS_POINTS / 10_000));
  const vatPence = Math.round(retailNetPence * (OWN_COURSE_VAT_BASIS_POINTS / 10_000));
  return { retailNetPence, vatPence, grossPence: retailNetPence + vatPence };
}

function priceBand(id, maximumScore, baseValuePence) {
  return { id, maximumScore, baseValuePence, ...commercialPrice(baseValuePence) };
}

export const OWN_COURSE_PRICE_BANDS = Object.freeze([
  priceBand("value", 115, 512),
  priceBand("essential", 140, 705),
  priceBand("standard", 165, 897),
  priceBand("enhanced", 195, 1089),
  priceBand("professional", 230, 1474),
  priceBand("extended", null, 1922),
]);

const EXPECTED_GROSS_PRICES = [799, 1100, 1399, 1699, 2299, 2999];
OWN_COURSE_PRICE_BANDS.forEach((band, index) => {
  if (band.grossPence !== EXPECTED_GROSS_PRICES[index]) throw new Error(`Invalid Sousa Murray course pricing band ${band.id}.`);
});

const PROGRAMME_BAND_BY_PREFIX = Object.freeze({
  WRK: "standard",
  COM: "standard",
  SAF: "enhanced",
  SAL: "enhanced",
  CAR: "enhanced",
  BUS: "professional",
  DAI: "professional",
  SEC: "professional",
  DEV: "professional",
  M36: "extended",
  LDR: "extended",
  OPS: "extended",
  GOV: "extended",
});

function programmeBand(courseCode) {
  const code = String(courseCode || "").trim().toUpperCase();
  if (!/^SME-[A-Z0-9]{2,4}-5\d{2}$/.test(code)) return null;
  const prefix = code.split("-")[1] || "";
  return PROGRAMME_BAND_BY_PREFIX[prefix] || null;
}

export function approvedOwnCoursePriceFromMetrics(value) {
  const courseCode = String(value?.courseCode || "").trim().toUpperCase();
  const level = String(value?.level || "").trim();
  const durationMinutes = positiveInteger(value?.durationMinutes);
  const moduleCount = positiveInteger(value?.moduleCount);
  const lessonCount = positiveInteger(value?.lessonCount);
  const assessmentQuestionCount = positiveInteger(value?.assessmentQuestionCount);

  if (level !== "Foundation" && level !== "Intermediate") return null;
  if (!durationMinutes || durationMinutes < 45 || durationMinutes > 6000) return null;
  if (!moduleCount || moduleCount < 3 || moduleCount > 40) return null;
  if (!lessonCount || lessonCount < 6 || lessonCount > 160) return null;
  if (!assessmentQuestionCount || assessmentQuestionCount < 6 || assessmentQuestionCount > 120) return null;

  const isProgramme = Boolean(programmeBand(courseCode));
  if (isProgramme && (moduleCount !== 12 || lessonCount < 24 || assessmentQuestionCount < 30 || durationMinutes < 1800)) return null;

  const levelWeight = level === "Intermediate" ? 22 : 0;
  const score = isProgramme
    ? Math.round(durationMinutes / 40) + moduleCount * 4 + lessonCount + assessmentQuestionCount + levelWeight
    : durationMinutes + moduleCount * 4 + lessonCount + assessmentQuestionCount * 2 + levelWeight;

  const bandId = programmeBand(courseCode);
  const band = bandId
    ? OWN_COURSE_PRICE_BANDS.find(item => item.id === bandId)
    : OWN_COURSE_PRICE_BANDS.find(item => item.maximumScore === null || score <= item.maximumScore)
      || OWN_COURSE_PRICE_BANDS[OWN_COURSE_PRICE_BANDS.length - 1];
  if (!band) return null;

  return {
    ...band,
    courseCode,
    programme: isProgramme,
    level,
    durationMinutes,
    moduleCount,
    lessonCount,
    assessmentQuestionCount,
    score,
    commercialUpliftBasisPoints: OWN_COURSE_COMMERCIAL_UPLIFT_BASIS_POINTS,
    vatBasisPoints: OWN_COURSE_VAT_BASIS_POINTS,
  };
}
