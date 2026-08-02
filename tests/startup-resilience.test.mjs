import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [core, boot, reference] = await Promise.all([
  read('public/js/core.js'),
  read('public/js/boot.js'),
  read('functions/api/reference.js')
]);

assert.match(core, /DEFAULT_API_TIMEOUT_MS/, 'Every portal API request must have a hard timeout.');
assert.match(core, /AbortController/, 'Timed-out browser requests must be aborted rather than left pending forever.');
assert.match(boot, /Promise\.allSettled/, 'Optional Head Office modules must not block the entire portal startup.');
assert.match(boot, /const coreRoute = \/\^/, 'The portal must explicitly identify routes that are safe before optional modules load.');
assert.match(
  boot,
  /navigate\(coreRoute\.test\(requestedRoute\) \? requestedRoute : 'dashboard', true\)/,
  'An authenticated user must receive the requested core workspace or the dashboard fallback before optional modules finish loading.'
);
const initialNavigationIndex = boot.indexOf("navigate(coreRoute.test(requestedRoute) ? requestedRoute : 'dashboard', true)");
const optionalInitialisationIndex = boot.indexOf(
  'initialiseOptionalModules(requestedRoute, generation).catch',
  initialNavigationIndex
);
assert.ok(initialNavigationIndex >= 0 && optionalInitialisationIndex > initialNavigationIndex,
  'Core navigation must happen before optional specialist modules are initialised.');
assert.match(boot, /initialiseOptionalModules\(requestedRoute, generation\)/,
  'Specialist tools must initialise separately after the core portal opens.');
assert.doesNotMatch(boot, /showApp\(\);\s*setLoading\('Opening automated Head Office services/,
  'The portal must not reveal an endless loading shell before blocking module startup.');
assert.match(reference, /referenceSchemaExists/, 'The reference endpoint must use a lightweight schema readiness check.');
assert.match(reference, /sqlite_master/, 'The readiness check must avoid running the full bootstrap on an established production database.');
assert.match(reference, /referenceSchemaPromise/, 'Schema readiness must be memoised within each Worker isolate.');

console.log('Portal startup resilience checks passed.');
