import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = await readFile(new URL('../functions/_central-schema.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../migrations/0033_current_sousa_murray_platform_register.sql', import.meta.url), 'utf8');
const presentation = await readFile(new URL('../public/js/central-payments-current-platforms.js', import.meta.url), 'utf8');
const configuration = await readFile(new URL('../functions/api/integrations/central-payments/configuration.js', import.meta.url), 'utf8');
const loader = await readFile(new URL('../public/js/head-office-context.js', import.meta.url), 'utf8');

const currentWebsites = [
  'JA Group Services Ltd',
  'Sousa Murray Domains',
  'Sousa Murray Planeia',
  'Sousa Murray Profiles',
  'Sousa Murray eLearning',
];

for (const name of currentWebsites) {
  assert.ok(schema.includes(name), `${name} must exist in the runtime Head Office platform register.`);
  assert.ok(migration.includes(name), `${name} must exist in the append-only platform register migration.`);
  assert.ok(presentation.includes(name), `${name} must be exposed by the Central Payments website picker.`);
}

for (const url of [
  'https://jagroupservices.co.uk',
  'https://sousamurraydomains.jagroupservices.co.uk',
  'https://sousamurrayplaneia.jagroupservices.co.uk',
  'https://sousamurrayprofiles.jagroupservices.co.uk',
  'https://sousamurrayelearning.jagroupservices.co.uk',
]) {
  assert.ok(schema.includes(url), `${url} must be reconciled at runtime.`);
  assert.ok(migration.includes(url), `${url} must be present in the D1 migration.`);
}

assert.ok(schema.includes('JA_DOMAIN_HUB') && schema.includes('PLANYX') && schema.includes('PROFILE_CENTRE'),
  'Legacy platform codes must remain recognised so existing credentials and records are not broken.');
assert.ok(schema.includes('APTENVO') && schema.includes('COURSE_SELECT'),
  'Legacy eLearning platform aliases must remain recognised during migration.');
assert.ok(schema.includes('SOUSA_MURRAY_SITES') && schema.includes('Sousa Murray Domains'),
  'The historical Sites code must be folded into the Domains website family.');
assert.ok(presentation.includes("aliases: Object.freeze(['SOUSA_MURRAY_DOMAINS','JA_DOMAIN_HUB','SOUSA_MURRAY_SITES'])"),
  'Sites must not render as a separate website connection.');
assert.ok(configuration.includes('brand.code !== "SOUSA_MURRAY_SITES"'),
  'Central Payments must not offer Sousa Murray Sites as a separate new brand option.');
assert.ok(configuration.includes('businessName: "JA Group Services Ltd"'),
  'Head Office must display the legal payment recipient rather than a Stripe dashboard label.');
assert.ok(loader.includes('/js/central-payments-current-platforms.js'),
  'The current website-family presentation must be loaded by the Head Office shell.');
assert.ok(schema.includes('await reconcileCurrentPlatformRegister(env)'),
  'Live D1 must self-heal rather than relying only on migrations having been applied manually.');

console.log('Current JA Group Services / Sousa Murray platform register checks passed.');
