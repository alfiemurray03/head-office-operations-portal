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
for (const table of ['central_payment_catalogue_prices', 'central_payment_catalogue_products', 'central_payment_customer_links']) {
  assert.ok(binding.includes(`DELETE FROM ${table}`), `${table} must be rebuilt when Head Office changes Stripe account.`);
}
assert.ok(binding.includes('/products/') && binding.includes('/prices/') && binding.includes('/customers/'), 'First-run migration must verify existing Product, Price and Customer references against the current Stripe account.');

assert.ok(platformMiddleware.includes('ensureCentralStripeAccountBinding') && platformMiddleware.includes('context.next()'), 'Connected payment APIs must run the Stripe account binding guard.');
assert.ok(operationsMiddleware.includes('ensureCentralStripeAccountBinding') && operationsMiddleware.includes('context.next()'), 'Head Office payment diagnostics must run the Stripe account binding guard.');

assert.ok(standard.includes('CENTRAL_PAYMENT_STANDARD_CATALOGUE'), 'Standard catalogue repair must be driven by the approved manifest.');
assert.ok(standard.includes('/products/') && standard.includes('/prices/'), 'Standard catalogue repair must validate Stripe object IDs in the currently connected account.');
assert.ok(standard.includes('ON CONFLICT(product_code) DO UPDATE') && standard.includes('ON CONFLICT(price_code) DO UPDATE'), 'Standard catalogue repair must replace stale account-scoped Stripe IDs idempotently.');
assert.ok(provision.includes('provisionStandardCatalogue'), 'Head Office provisioning must use the account-aware standard catalogue repair helper.');

const ensureIndex = checkout.indexOf('ensureStandardCatalogueItem');
const resolveIndex = checkout.indexOf('resolveCentralPrice(context.env');
assert.ok(ensureIndex >= 0 && resolveIndex > ensureIndex, 'Checkout must self-heal an approved standard catalogue item before resolving its Stripe Price ID.');

console.log('Central Payments Stripe account rebinding checks passed.');
