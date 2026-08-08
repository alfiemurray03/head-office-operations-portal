import assert from 'node:assert/strict';
import {
  OWN_COURSE_COMMERCIAL_UPLIFT_BASIS_POINTS,
  OWN_COURSE_PRICE_BANDS,
  OWN_COURSE_VAT_BASIS_POINTS,
  approvedOwnCoursePriceFromMetrics,
} from '../functions/_elearning-course-pricing-model.js';
import {
  OWN_COURSE_ACCESS_DAYS,
  OWN_COURSE_ACCESS_LABEL,
  OWN_COURSE_ACCESS_MONTHS,
  OWN_COURSE_ACCESS_TERM,
  ownCourseCommerceConfiguration,
} from '../functions/_elearning-own-course-commerce.js';

assert.equal(OWN_COURSE_COMMERCIAL_UPLIFT_BASIS_POINTS, 3000);
assert.equal(OWN_COURSE_VAT_BASIS_POINTS, 2000);
assert.deepEqual(OWN_COURSE_PRICE_BANDS.map((band) => band.grossPence), [799, 1100, 1399, 1699, 2299, 2999]);

assert.equal(OWN_COURSE_ACCESS_DAYS, 365);
assert.equal(OWN_COURSE_ACCESS_MONTHS, 12);
assert.equal(OWN_COURSE_ACCESS_TERM, '12_months');
assert.equal(OWN_COURSE_ACCESS_LABEL, '12 months of course access');
const commerce = ownCourseCommerceConfiguration({ ELEARNING_OWN_COURSE_ACCESS_DAYS: 'permanent' });
assert.equal(commerce.accessConfigured, true);
assert.equal(commerce.accessDays, 365);
assert.equal(commerce.accessMonths, 12);
assert.equal(commerce.accessTerm, '12_months');
assert.equal(commerce.accessLabel, '12 months of course access');

for (const band of OWN_COURSE_PRICE_BANDS) {
  assert.equal(band.retailNetPence, Math.round(band.baseValuePence * 1.30));
  assert.equal(band.vatPence, Math.round(band.retailNetPence * 0.20));
  assert.equal(band.grossPence, band.retailNetPence + band.vatPence);
}

const low = approvedOwnCoursePriceFromMetrics({
  level: 'Foundation',
  durationMinutes: 75,
  moduleCount: 3,
  lessonCount: 6,
  assessmentQuestionCount: 6,
});
assert.equal(low?.id, 'value');
assert.equal(low?.grossPence, 799);

const typicalFoundation = approvedOwnCoursePriceFromMetrics({
  level: 'Foundation',
  durationMinutes: 95,
  moduleCount: 3,
  lessonCount: 6,
  assessmentQuestionCount: 6,
});
assert.equal(typicalFoundation?.id, 'essential');
assert.equal(typicalFoundation?.grossPence, 1100);

const intermediate = approvedOwnCoursePriceFromMetrics({
  level: 'Intermediate',
  durationMinutes: 125,
  moduleCount: 4,
  lessonCount: 8,
  assessmentQuestionCount: 8,
});
assert.equal(intermediate?.id, 'enhanced');
assert.equal(intermediate?.grossPence, 1699);

const extended = approvedOwnCoursePriceFromMetrics({
  level: 'Intermediate',
  durationMinutes: 220,
  moduleCount: 6,
  lessonCount: 14,
  assessmentQuestionCount: 12,
});
assert.equal(extended?.id, 'extended');
assert.equal(extended?.grossPence, 2999);

assert.equal(approvedOwnCoursePriceFromMetrics({ level: 'Unknown', durationMinutes: 90, moduleCount: 3, lessonCount: 6, assessmentQuestionCount: 6 }), null);
assert.equal(approvedOwnCoursePriceFromMetrics({ level: 'Foundation', durationMinutes: 10, moduleCount: 3, lessonCount: 6, assessmentQuestionCount: 6 }), null);

console.log('Sousa Murray own-course pricing and 12-month access term validated.');