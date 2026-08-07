import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PROFESSIONAL_TRAINING_COURSE_COUNT,
  professionalTrainingCourse,
  professionalTrainingPrice,
} from '../functions/_professional-training-catalogue.js';

const endpoint = await readFile(new URL('../functions/api/v1/payments/basket-checkout.js', import.meta.url), 'utf8');

assert.equal(PROFESSIONAL_TRAINING_COURSE_COUNT, 101, 'Head Office must govern every current Professional Training course.');

const mentalHealth = professionalTrainingCourse('hf-an-awareness-of-mental-health-and-wellbeing');
assert.equal(mentalHealth?.title, 'An Awareness of Mental Health and Wellbeing');
const twoLicences = professionalTrainingPrice(mentalHealth.id, 2);
assert.equal(twoLicences.unitNetPence, 1950);
assert.equal(twoLicences.unitVatPence, 390);
assert.equal(twoLicences.unitGrossPence, 2340);
assert.equal(twoLicences.lineNetPence, 3900);
assert.equal(twoLicences.lineVatPence, 780);
assert.equal(twoLicences.lineGrossPence, 4680, 'The live two-licence basket must price to £46.80 including VAT.');

assert.equal(professionalTrainingPrice('hf-not-a-real-course', 1), null, 'Unknown course IDs must be rejected.');
assert.equal(professionalTrainingPrice(mentalHealth.id, 26), null, 'Online basket quantities above 25 per course must be rejected.');

for (const securityBoundary of [
  'requirePlatform(context, ["payments:checkout"])',
  'SOUSA_MURRAY_ELEARNING',
  'findCentralCustomer',
  'assertCustomerCanPay',
  'verifyCentralStripeAccount',
  'validatePlatformReturnUrl',
  'professionalTrainingPrice',
  'centralStripePost',
  'central_payment_checkout_items',
]) assert.ok(endpoint.includes(securityBoundary), `Professional Training basket checkout must retain ${securityBoundary}.`);

assert.ok(!endpoint.includes('body.amount') && !endpoint.includes('body.unitAmount'), 'The connected eLearning site must not set arbitrary charge amounts.');
assert.ok(endpoint.includes('unitGrossPence') && endpoint.includes('lineGrossPence'), 'Stripe line amounts must be calculated from the Head Office price manifest.');
assert.ok(endpoint.includes('tax_behavior') && endpoint.includes('inclusive'), 'Professional Training basket prices must remain VAT-inclusive at Stripe Checkout.');

console.log('Professional Training Central Payments manifest and basket governance checks passed.');
