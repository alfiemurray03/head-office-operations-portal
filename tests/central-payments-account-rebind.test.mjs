import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const binding = await readFile(new URL('../functions/_central-payment-account-binding.js', import.meta.url), 'utf8');
const standard = await readFile(new URL('../functions/_central-payment-standard-catalogue.js', import.meta.url), 'utf8');
const platformMiddleware = await readFile(new URL('../functions/api/v1/payments/_middleware.js', import.meta.url), 'utf8');
const operationsMiddleware = await readFile(new URL('../functions/api/integrations/central-payments/_middleware.js', import.meta.url), 'utf8');
const provision = await readFile(new URL('../functions/api/integrations/central-payments/provision.js', import.meta.url), 'utf8');
const checkout = await readFile(new URL('../functions/api/v1/payments/checkout.js', import.meta.url), 'utf8');

assert.ok(binding.includes('central_payment_stripe_account_binding'), 'Head Office must persist the Stripe account associated with account-scoped D1 references.');
assert.ok(binding.includes('verifyCentralStripeAccount'), 'Account-scoped D1 references must never be cleared before the configured Stripe account is verified.');
assert.ok(binding.includes('binding_state') && binding.includes("'migrating'"), 'Concurrent account rebinding must be serialised instead of repeatedly clearing the catalogue.');
for (const table of ['central_payment_catalogue_prices', 'central_payment_catalogue_products', 'central_payment_customer_links']) {
  assert.ok(binding.includes(`DELETE FROM ${table}`), `${table} must be rebuilt when Head Office changes Stripe account.`);
}
assert.ok(binding.includes('/products/') && binding.includes('/prices/') && binding.includes('/customers/'), 'First-run migration must verify existing Product, Price and Customer references against the current Stripe account.');

const platformAuthIndex = platformMiddleware.indexOf('requirePlatform(context, [])');
const platformBindingIndex = platformMiddleware.indexOf('ensureCentralStripeAccountBinding(context.env)');
assert.ok(platformAuthIndex >= 0 && platformBindingIndex > platformAuthIndex, 'Connected payment APIs must authenticate a platform before Stripe verification or D1 rebinding can run.');
assert.ok(platformMiddleware.includes('context.next()'), 'Connected payment APIs must continue to the scoped route after the account binding guard passes.');

const staffAuthIndex = operationsMiddleware.indexOf('requireSession(context)');
const staffBindingIndex = operationsMiddleware.indexOf('ensureCentralStripeAccountBinding(context.env)');
assert.ok(staffAuthIndex >= 0 && staffBindingIndex > staffAuthIndex, 'Head Office diagnostics must authenticate staff before Stripe verification or D1 rebinding can run.');
assert.ok(operationsMiddleware.includes('context.next()'), 'Authenticated Head Office diagnostics must continue to the route after the account binding guard.');

assert.ok(standard.includes('CENTRAL_PAYMENT_STANDARD_CATALOGUE'), 'Standard catalogue repair must be driven by the approved manifest.');
assert.ok(standard.includes('/products/') && standard.includes('/prices/'), 'Standard catalogue repair must validate Stripe object IDs in the currently connected account.');
assert.ok(standard.includes('ON CONFLICT(product_code) DO UPDATE') && standard.includes('ON CONFLICT(price_code) DO UPDATE'), 'Standard catalogue repair must replace stale account-scoped Stripe IDs idempotently.');
assert.ok(provision.includes('provisionStandardCatalogue'), 'Head Office provisioning must use the account-aware standard catalogue repair helper.');

const ensureIndex = checkout.indexOf('ensureStandardCatalogueItem(context.env');
const resolveIndex = checkout.indexOf('resolveCentralPrice(context.env');
assert.ok(ensureIndex >= 0 && resolveIndex > ensureIndex, 'Checkout must self-heal an approved standard catalogue item before resolving its Stripe Price ID.');

console.log('Central Payments Stripe account rebinding checks passed.');
