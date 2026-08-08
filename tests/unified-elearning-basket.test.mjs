import assert from 'node:assert/strict';
import fs from 'node:fs';

const checkout = fs.readFileSync('functions/api/v1/payments/elearning-basket-checkout.js', 'utf8');
const status = fs.readFileSync('functions/api/v1/payments/status.js', 'utf8');

assert.match(checkout, /ELEARNING_UNIFIED_COURSE_BASKET/);
assert.match(checkout, /FAMILY_OWN = "sousa_murray"/);
assert.match(checkout, /FAMILY_HIGHFIELD = "highfield"/);
assert.match(checkout, /SME-COURSE-/);
assert.match(checkout, /HF-COURSE-/);
assert.match(checkout, /price_data\]\[product\]/);
assert.match(checkout, /ownCoursePrice/);
assert.match(checkout, /professionalTrainingPrice/);
assert.match(checkout, /central_payment_checkout_items/);
assert.match(checkout, /manual_sale_enabled|centralProductCode/);
assert.match(status, /checkoutItems/);
assert.match(status, /CREATE TABLE IF NOT EXISTS central_payment_checkout_items/);

console.log('Unified Sousa Murray eLearning basket contract checks passed.');
