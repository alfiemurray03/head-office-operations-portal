import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('migration 0026 adds the reviewed PIN and customer notice structures', async () => {
  const migration = await read('migrations/0026_principal_pin_and_customer_notices.sql');
  for (const table of ['principal_pin_credentials', 'principal_pin_events', 'customer_notices', 'customer_notice_receipts']) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}\\b`));
  }
  assert.match(migration, /ALTER TABLE portal_sessions ADD COLUMN pin_verified_at TEXT/);
  assert.match(migration, /REFERENCES portal_users\(id\)/);
  assert.match(migration, /REFERENCES customers\(id\)/);
  assert.match(migration, /REFERENCES platforms\(id\)/);
});

test('personal PINs use a separate Cloudflare pepper and controlled lockout', async () => {
  const source = await read('functions/_principal-pin.js');
  assert.match(source, /PORTAL_PIN_PEPPER/);
  assert.match(source, /PBKDF2/);
  assert.match(source, /SHA-256/);
  assert.match(source, /210_000/);
  assert.match(source, /MAX_FAILED_ATTEMPTS = 5/);
  assert.match(source, /LOCKOUT_MS = 15 \* 60 \* 1000/);
  assert.match(source, /pinVerifiedAt/);
  assert.doesNotMatch(source, /ALFIE.*PIN|JACK.*PIN/i);
});

test('protected APIs enforce the PIN after Microsoft authentication', async () => {
  const shared = await read('functions/_shared.js');
  const session = await read('functions/api/auth/session.js');
  const boot = await read('public/js/boot.js');
  const browser = await read('public/js/principal-pin.js');
  assert.match(shared, /PRINCIPAL_PIN_REQUIRED/);
  assert.match(shared, /!session\.pinVerifiedAt/);
  assert.match(session, /getPrincipalPinStatus/);
  assert.match(boot, /await loadPrincipalPinModule\(\)/);
  assert.ok(boot.indexOf('await window.ensurePrincipalPin(state.session)') < boot.indexOf('state.reference = await loadReference()'));
  assert.match(browser, /Create your Head Office PIN/);
  assert.match(browser, /Five-attempt limit/);
  assert.match(browser, /15-minute lockout/);
});

test('customer notices remain server-side and use scoped platform credentials', async () => {
  const platform = await read('functions/api/platform/customer-notices.js');
  const staff = await read('functions/api/customer-notices.js');
  const credentials = await read('functions/api/platforms/[id]/credentials.js');
  assert.match(platform, /requirePlatform\(context, \["support:read"\]\)/);
  assert.match(platform, /requirePlatform\(context, \["support:write"\]\)/);
  assert.match(platform, /customer_notice_receipts/);
  assert.match(staff, /requirePermission\(context, "communications:write"\)/);
  assert.match(credentials, /"support:read"/);
  assert.match(credentials, /"support:write"/);
  assert.doesNotMatch(platform, /CUSTOMEROPS_API_KEY\s*=/);
});

test('the Cloudflare pepper is never committed as a Wrangler variable', async () => {
  const wrangler = await read('wrangler.jsonc');
  assert.doesNotMatch(wrangler, /PORTAL_PIN_PEPPER/);
});
