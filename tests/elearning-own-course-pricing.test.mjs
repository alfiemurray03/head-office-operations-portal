import assert from 'node:assert/strict';
import {
  OWN_COURSE_COMMERCIAL_UPLIFT_BASIS_POINTS,
  OWN_COURSE_PRICE_BANDS,
  OWN_COURSE_VAT_BASIS_POINTS,
  approvedOwnCoursePriceFromMetrics,
} from '../functions/_elearning-course-pricing-model.js';

assert.equal(OWN_COURSE_COMMERCIAL_UPLIFT_BASIS_POINTS, 3000);
assert.equal(OWN_COURSE_VAT_BASIS_POINTS, 2000);
assert.deepEqual(OWN_COURSE_PRICE_BANDS.map((band) => band.grossPence), [799, 1099, 1399, 1699, 2299, 2999]);

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
assert.equal(typicalFoundation?.grossPence, 1099);

const intermediate = approvedOwnCoursePriceFromMetrics({
  level: 'Intermediate',
  durationMinutes: 125,
  moduleCount: 4,
  lessonCount: 8,
  assessmentQuestionCount: 8,
});
assert.equal(intermediate?.id, 'professional');
assert.equal(intermediate?.grossPence, 2299);

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

console.log('Sousa Murray own-course pricing bands validated.');
