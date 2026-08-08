import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = await readFile(new URL('../functions/_central-payment-catalogue-manifest.js', import.meta.url), 'utf8');
const standard = await readFile(new URL('../functions/_central-payment-standard-catalogue.js', import.meta.url), 'utf8');

for (const [code, amount] of [
  ['PROFILES_STARTER_MONTHLY', 500],
  ['PROFILES_PROFESSIONAL_MONTHLY', 1600],
  ['PROFILES_ORGANISATION_MONTHLY', 3000],
  ['PROFILES_ULTIMATE_ORGANISATION_MONTHLY', 8000],
]) {
  const entry = manifest.split('\n').find(line => line.includes(`priceCode: "${code}"`));
  assert.ok(entry, `${code} must remain in the governed standard catalogue.`);
  assert.ok(entry.includes(`amountMinor: ${amount}`), `${code} must use the approved current monthly amount.`);
}

assert.ok(standard.includes('stripePriceMatches'), 'Standard catalogue must validate immutable Stripe Price properties before reuse.');
assert.ok(standard.includes('Number(stripePrice.unit_amount) !== Number(item.amountMinor)'), 'Stripe Price amount mismatches must trigger replacement.');
assert.ok(standard.includes('transfer_lookup_key: "true"'), 'Replacement Prices must atomically inherit the stable lookup key.');
assert.ok(standard.includes('{ active: "false" }'), 'A replaced Stripe Price must be retired from new purchases.');
assert.ok(standard.includes('item.amountMinor'), 'Price idempotency must vary when the governed amount changes.');

console.log('Sousa Murray Profiles custom-domain pricing and Stripe Price replacement checks passed.');
