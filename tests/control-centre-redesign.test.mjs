import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the control-centre shell is stable, branded and guarded by the reviewed PIN flow', async () => {
  const [index, boot, professionalCss, modalSystem, contextLoader] = await Promise.all([
    read('public/index.html'),
    read('public/js/boot.js'),
    read('public/professional-interface.css'),
    read('public/js/modal-system.js'),
    read('public/js/head-office-context.js')
  ]);

  assert.match(index, /id="entranceTitle"[\s\S]*Customer control room[\s\S]*Security command[\s\S]*Website operations/,
    'The pre-authentication landing page must explain the Head Office control environment.');
  assert.doesNotMatch(index, /id="pinScreen"/,
    'The page must not duplicate the reviewed principal PIN module with a second static PIN screen.');
  assert.match(index, /data-route="notifications"/);
  assert.match(index, /data-route="security-procedures"/);

  const finalStyle = index.indexOf('/professional-interface.css?v=20260802-control-centre-1');
  for (const stylesheet of [
    '/security-operations-centre.css',
    '/customer-service-centre.css',
    '/customer-directory.css',
    '/principal-pin.css'
  ]) {
    assert.ok(index.indexOf(stylesheet) >= 0 && index.indexOf(stylesheet) < finalStyle,
      `${stylesheet} must load before the governed interface to avoid post-paint layout replacement.`);
  }

  assert.match(professionalCss, /grid-template-columns:\s*248px minmax\(0, 1fr\)/,
    'Desktop navigation must reserve a stable column.');
  assert.match(professionalCss, /html\[data-ops-theme="dark"\]/,
    'The redesigned control centre must preserve dark mode.');
  assert.match(professionalCss, /--ho-focus:\s*#155eef/,
    'The visual system must retain the blue command colour.');
  assert.match(professionalCss, /--ho-danger:\s*#b42318/,
    'The visual system must retain the red incident colour.');
  assert.doesNotMatch(modalSystem, /observe\(document\.head/,
    'Modal setup must not create a self-triggering document.head observer.');
  assert.doesNotMatch(contextLoader, /(?:src|href)\s*=\s*['"][^'"]*clean-shell\.js/,
    'The late shell rewrite must not run after first paint.');
  assert.match(boot, /initialRoute = await prepareRequestedRoute\(requestedRoute\)[\s\S]*navigate\(initialRoute, true\)[\s\S]*initialiseOptionalModules\(generation\)/,
    'Boot must prepare the requested route, render it once, then load optional modules in the background.');
  assert.ok(boot.indexOf('await window.ensurePrincipalPin(state.session)') < boot.indexOf('state.reference = await loadReference()'),
    'The reviewed personal PIN gate must run before protected portal data is loaded.');
});
test('the live Control Room refreshes real operational metrics without replacing the route', async () => {
  const [overviewApi, views] = await Promise.all([
    read('functions/api/v7/overview.js'),
    read('public/js/views-v7.js')
  ]);

  assert.match(overviewApi, /refreshAfterSeconds:\s*15/);
  for (const metric of [
    'highRiskCustomers',
    'activeRestrictions',
    'activeCustomerSessions',
    'connectedPlatforms',
    'openConversations',
    'failedAuthentication24h'
  ]) {
    assert.match(overviewApi, new RegExp(metric), `${metric} must come from the live Head Office overview API.`);
  }
  assert.match(views, /api\('\/api\/v7\/overview'/);
  assert.match(views, /setTimeout\(async \(\) =>/);
  assert.match(views, /data-live-alerts[\s\S]*data-live-incidents[\s\S]*data-live-events/);
  assert.match(views, /Security codes, lockdown &amp; response procedures/);
  assert.match(views, /Lockdown remains a manual security decision/,
    'Security procedures must retain an authorised human decision for lockdown.');
});

test('the notification panel extends the reviewed customer-notice service', async () => {
  const [migration, staffApi, platformApi, notificationCentre, deploymentGuide] = await Promise.all([
    read('migrations/0026_principal_pin_and_customer_notices.sql'),
    read('functions/api/customer-notices.js'),
    read('functions/api/platform/customer-notices.js'),
    read('public/js/notification-centre.js'),
    read('docs/PRINCIPAL_PIN_AND_CUSTOMER_NOTICES_DEPLOYMENT.md')
  ]);

  for (const table of [
    'principal_pin_credentials',
    'principal_pin_events',
    'customer_notices',
    'customer_notice_receipts'
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}\\b`));
  }
  assert.match(migration, /ALTER TABLE portal_sessions ADD COLUMN pin_verified_at TEXT/);

  assert.match(staffApi, /requirePermission\(context, "communications:read"\)/);
  assert.match(staffApi, /requirePermission\(context, "communications:write"\)/);
  assert.match(staffApi, /receipt_count/);
  assert.match(staffApi, /dismissal_count/);
  assert.match(staffApi, /INVALID_NOTICE_TRANSITION/);
  assert.match(staffApi, /customer\.notice\.\$\{action\}/,
    'Publishing and withdrawal must be audited.');

  assert.match(platformApi, /requirePlatform\(context, \["support:read"\]\)/);
  assert.match(platformApi, /requirePlatform\(context, \["support:write"\]\)/);
  assert.match(platformApi, /resolvePlatformCustomer/);
  assert.match(platformApi, /COALESCE\(r\.status,'delivered'\)<>'dismissed'/,
    'Dismissed notices must stay hidden for that customer and website.');
  assert.match(platformApi, /customer_notice_receipts/);

  assert.match(notificationCentre, /Customer notification panel[\s\S]*Customer notice register/);
  assert.match(notificationCentre, /api\('\/api\/customer-notices'/);
  assert.match(notificationCentre, /data-notice-action="publish"/);
  assert.match(notificationCentre, /data-notice-action="withdraw"/);
  assert.doesNotMatch(notificationCentre, /Authorization|Bearer|clientSecret|apiKey/i,
    'The browser notification panel must never contain website credentials.');
  assert.match(deploymentGuide, /GET \/api\/platform\/customer-notices/);
  assert.match(deploymentGuide, /action `read` or `dismiss`/);
});
