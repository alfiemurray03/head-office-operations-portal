import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  migration,
  settings,
  runtime,
  middleware,
  runner,
  api,
  configuration,
  ui,
  css,
  boot,
  customerSync,
  staffSync,
  stripeSync,
  customerAutomation,
  staffAutomation,
  stripeAutomation,
  notifications,
  identity
] = await Promise.all([
  read('migrations/0016_system_control_and_diagnostics.sql'),
  read('functions/_system-settings.js'),
  read('functions/_runtime-policy.js'),
  read('functions/_middleware.js'),
  read('functions/_system-tests.js'),
  read('functions/api/system-tests.js'),
  read('functions/api/configuration.js'),
  read('public/js/system-control.js'),
  read('public/system-control.css'),
  read('public/js/boot.js'),
  read('functions/api/customer-directory/sync.js'),
  read('functions/api/staff-directory/sync.js'),
  read('functions/api/integrations/stripe/sync.js'),
  read('functions/api/automation/customer-directory/sync.js'),
  read('functions/api/automation/staff-directory/sync.js'),
  read('functions/api/automation/stripe/sync.js'),
  read('functions/_customer-notifications.js'),
  read('functions/api/identity-verifications.js')
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS service_test_runs/, 'Service-test evidence must have a retained database table.');
assert.match(migration, /system\.portal_mode/, 'The database must seed a global portal operating mode.');
assert.match(migration, /system\.test_centre_enabled/, 'The database must seed the System Test Centre control.');
assert.match(migration, /system\.external_test_actions_enabled/, 'Controlled external tests must be disabled by default.');
assert.match(migration, /automation\.stripe_reconciliation_enabled/, 'Stripe automation must have a governed setting.');

for (const key of [
  'integrations.customer_directory_enabled',
  'integrations.staff_directory_enabled',
  'integrations.stripe_planyx_enabled',
  'integrations.stripe_profile_centre_enabled',
  'integrations.didit_enabled',
  'integrations.resend_enabled',
  'integrations.connected_systems_enabled',
  'automation.customer_directory_enabled',
  'automation.staff_directory_enabled',
  'automation.stripe_reconciliation_enabled'
]) assert.match(settings, new RegExp(key.replaceAll('.', '\\.')), `${key} must be a validated governed setting.`);

assert.match(configuration, /body\.settings/, 'The configuration API must support atomic multi-setting updates.');
assert.match(configuration, /normaliseSystemSetting/, 'Every submitted setting must be validated before it is saved.');
assert.match(configuration, /configuration_changes/, 'Configuration changes must remain in the change ledger.');
assert.match(configuration, /configuration\.updated/, 'Settings changes must be audited.');

assert.match(runtime, /normal[\s\S]*read_only[\s\S]*maintenance/, 'The runtime policy must support normal, read-only and maintenance modes.');
assert.match(runtime, /\/api\/security\/lockdowns/, 'Manual critical-lockdown actions must remain available during a restricted portal mode.');
assert.doesNotMatch(runtime, /automatic.*lockdown|auto.*lockdown/i, 'The runtime policy must not automate critical security lockdowns.');
assert.match(middleware, /portalWritePolicyResponse/, 'The complete portal must enforce the selected operating mode on governed staff writes.');
assert.match(middleware, /\/api\/webhooks\//, 'Inbound signed webhooks must not be silently blocked by a staff-interface mode change.');

for (const code of [
  'core_database', 'staff_authentication', 'customer_directory', 'staff_directory',
  'stripe_planyx', 'stripe_profile_centre', 'didit', 'resend', 'webhooks',
  'automation', 'connected_systems', 'security_controls'
]) assert.match(runner, new RegExp(`code: "${code}"`), `${code} must have a registered safe test.`);

assert.match(runner, /SEND TEST EMAIL/, 'The real Resend delivery test must require an explicit typed confirmation.');
assert.match(runner, /system\.external_test_actions_enabled/, 'External test actions must be governed by a disabled-by-default setting.');
assert.match(runner, /actor\?\.email/, 'The controlled email test must target the authenticated staff identity, not a customer.');
assert.match(runner, /service_test_runs/, 'Every diagnostic result must be retained as evidence.');
assert.match(runner, /criticalLockdownPolicy: "manual_only"/, 'Diagnostics must report the fixed manual-only critical-lockdown policy.');
assert.match(api, /configuration:read/, 'Viewing the System Test Centre requires configuration read authority.');
assert.match(api, /configuration:write/, 'Running tests requires configuration write authority.');
assert.match(api, /system\.tests_run/, 'Test runs must be written to the audit history.');

assert.match(ui, /System Test Centre/, 'The portal must expose a System Test Centre workspace.');
assert.match(ui, /System Settings/, 'The former small configuration form must become a whole-system settings workspace.');
assert.match(ui, /Run all safe tests/, 'Authorised staff must be able to test all registered services safely.');
assert.match(ui, /Critical security lockdown is manual only/, 'The non-configurable lockdown policy must be explicit in Settings.');
assert.match(ui, /Staff and customer records never merge/, 'The fixed staff/customer separation rule must be explicit in Settings.');
assert.match(ui, /Website maintenance remains local/, 'Local website maintenance authority must remain explicit.');
assert.match(ui, /Didit invitations go to the customer/, 'Automatic customer delivery must remain explicit.');
assert.match(css, /\.service-test-grid/, 'The service tests must use a dedicated responsive workspace layout.');
assert.match(boot, /loadSystemControlModule/, 'The System Test Centre module must load before authenticated route navigation.');
assert.match(boot, /data-route = 'test-centre'|dataset\.route = 'test-centre'/, 'The complete All admin tools index must contain the System Test Centre.');

assert.match(customerSync, /integrations\.customer_directory_enabled/, 'Manual customer sync must obey System Settings.');
assert.match(staffSync, /integrations\.staff_directory_enabled/, 'Manual staff sync must obey System Settings.');
assert.match(stripeSync, /integrations\.stripe_planyx_enabled/, 'Manual Planyx Stripe reconciliation must obey System Settings.');
assert.match(stripeSync, /integrations\.stripe_profile_centre_enabled/, 'Manual Profile Centre Stripe reconciliation must obey System Settings.');
assert.match(customerAutomation, /automation\.customer_directory_enabled/, 'Customer automation must obey System Settings.');
assert.match(staffAutomation, /automation\.staff_directory_enabled/, 'Staff automation must obey System Settings.');
assert.match(stripeAutomation, /automation\.stripe_reconciliation_enabled/, 'Stripe automation must obey System Settings.');
assert.match(notifications, /notifications\.customer_welcome_enabled/, 'UCN welcome messages must obey the notification setting.');
assert.match(notifications, /integrations\.resend_enabled/, 'Customer email delivery must obey the Resend service setting.');
assert.match(identity, /integrations\.didit_enabled/, 'New Didit requests must obey the verification service setting.');
assert.match(identity, /sendNotificationEmails: true/, 'Didit invitations must still be sent automatically to the customer.');

console.log('System control and service diagnostics regression checks passed.');
