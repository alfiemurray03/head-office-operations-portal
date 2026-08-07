import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../functions/_central-payments.js', import.meta.url), 'utf8');
const checkout = await readFile(new URL('../functions/api/v1/payments/checkout.js', import.meta.url), 'utf8');
const events = await readFile(new URL('../functions/api/v1/payments/events.js', import.meta.url), 'utf8');
const webhook = await readFile(new URL('../functions/api/webhooks/stripe.js', import.meta.url), 'utf8');
const credentials = await readFile(new URL('../functions/api/platforms/[id]/credentials.js', import.meta.url), 'utf8');
const workspace = await readFile(new URL('../public/js/central-payments.js', import.meta.url), 'utf8');
const loader = await readFile(new URL('../public/js/head-office-context.js', import.meta.url), 'utf8');

for (const brand of [
  'SOUSA_MURRAY_DOMAINS',
  'SOUSA_MURRAY_SITES',
  'SOUSA_MURRAY_PLANEIA',
  'SOUSA_MURRAY_PROFILES',
  'SOUSA_MURRAY_ELEARNING',
]) assert.ok(core.includes(brand), `Central Payments must govern ${brand}.`);

for (const binding of [
  'CENTRAL_PAYMENTS_ENABLED',
  'CENTRAL_STRIPE_SECRET_KEY',
  'CENTRAL_STRIPE_WEBHOOK_SECRET',
  'CENTRAL_STRIPE_ACCOUNT_ID',
]) assert.ok(core.includes(binding), `${binding} must remain an explicit Head Office configuration boundary.`);

assert.ok(core.includes('central_payment_customer_links'), 'A central one-customer-to-one-Stripe-customer link is required.');
assert.ok(core.includes('UNIQUE'), 'Central payment records must enforce stable unique references.');
assert.ok(core.includes('product_code') && core.includes('price_code'), 'Internal product and price codes must remain first-class records.');
assert.ok(core.includes('resolveCentralPrice'), 'Checkout must resolve Head Office governed prices.');
assert.ok(!checkout.includes('stripePriceId') && !checkout.includes('priceId'), 'Connected websites must not submit arbitrary Stripe Price IDs.');
assert.ok(checkout.includes('productCode') && checkout.includes('priceCode'), 'Connected websites must submit internal product and price codes.');
assert.ok(core.includes('central_payment_platform_origins'), 'Return URLs must be governed by a Head Office origin allow-list.');
assert.ok(core.includes('parsed.protocol !== "https:"'), 'Central payment return URLs must require HTTPS.');
assert.ok(core.includes('deny_payment'), 'Central checkout must honour Head Office payment restrictions.');
assert.ok(core.includes('customer_number') && core.includes('ucn'), 'UCN must be carried into central payment metadata.');
assert.ok(core.includes('legal_entity') && core.includes('JA Group Services Ltd'), 'Payment metadata must identify the legal entity.');
assert.ok(core.includes('source_platform_code') && core.includes('brand_code'), 'Source platform and brand must be recorded separately.');
assert.ok(core.includes('central_payment_event_outbox'), 'Stripe outcomes must be routed back to connected platforms through the outbox.');
assert.ok(events.includes('platform_id=?') && events.includes("status='pending'"), 'Platforms may only read their own pending routed payment events.');
assert.ok(webhook.includes('verifyCentralStripeWebhook'), 'The central Stripe webhook must verify Stripe signatures.');
assert.ok(webhook.includes('processCentralStripeEvent'), 'The central Stripe webhook must use the central event processor.');
assert.ok(credentials.includes('payments:checkout'), 'Platform credentials must support checkout scope.');
assert.ok(credentials.includes('payments:status'), 'Platform credentials must support payment status scope.');
assert.ok(credentials.includes('payments:portal'), 'Platform credentials must support billing portal scope.');
assert.ok(workspace.includes('Central Payments'), 'Head Office must expose an operational Central Payments workspace.');
assert.ok(workspace.includes('Create central product') && workspace.includes('Create central price'), 'Head Office must control the central product and price catalogue.');
assert.ok(loader.includes('/js/central-payments.js') && loader.includes('/central-payments.css'), 'The Central Payments workspace must be loaded by the Head Office shell.');

console.log('Central Payments governance checks passed.');
