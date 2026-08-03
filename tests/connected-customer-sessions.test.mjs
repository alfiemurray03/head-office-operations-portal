import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [migration, service, platformRegister, platformSession, customerSessions, staffSessions, staffControl, middleware] = await Promise.all([
  read('migrations/0027_connected_customer_sessions.sql'),
  read('functions/_connected-sessions.js'),
  read('functions/api/platform/sessions.js'),
  read('functions/api/platform/sessions/[reference].js'),
  read('functions/api/platform/identity/sessions.js'),
  read('functions/api/customers/[id]/sessions.js'),
  read('public/js/connected-session-controls.js'),
  read('functions/_middleware.js'),
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS connected_customer_sessions/);
assert.match(migration, /UNIQUE\(platform_id, external_session_id\)/);
assert.match(migration, /revocation_required/);
assert.match(service, /TERMINAL_STATUSES|revocation_required/);
assert.match(service, /customer_directory_identities/);
assert.match(service, /requestAllSessionRevocations/);
assert.match(platformRegister, /registerConnectedSession/);
assert.match(platformRegister, /CUSTOMER_NOT_FOUND/);
assert.match(platformSession, /platformSessionDecision/);
assert.match(platformSession, /onRequestDelete/);
assert.match(customerSessions, /customers:read/);
assert.match(customerSessions, /customers:write/);
assert.match(customerSessions, /revoke_others/);
assert.match(staffSessions, /security:write/);
assert.match(staffSessions, /customer\.sessions_revoke_all/);
assert.match(staffControl, /Revoke all live sessions/);
assert.match(staffControl, /data-central-session-revoke/);
assert.match(middleware, /connected-session-controls\.js/);
assert.doesNotMatch(service, /verified_email=\?/);

console.log('Connected customer session contract validated.');
