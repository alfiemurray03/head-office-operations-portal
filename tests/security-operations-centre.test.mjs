import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  migration,
  controlPlane,
  lockdownApi,
  platformState,
  platformAck,
  markerApi,
  securityApi,
  notifications,
  directorySync,
  stripeControl,
  stripeWebhook,
  stripeStatus,
  stripeRecords,
  socUi,
  socCss,
  boot
] = await Promise.all([
  read('migrations/0010_security_operations_control_plane.sql'),
  read('functions/_security-control-plane.js'),
  read('functions/api/security/lockdowns.js'),
  read('functions/api/platform/security/state.js'),
  read('functions/api/platform/security/commands/[id].js'),
  read('functions/api/security/markers.js'),
  read('functions/api/security.js'),
  read('functions/_customer-notifications.js'),
  read('functions/api/customer-directory/sync.js'),
  read('functions/_stripe-control.js'),
  read('functions/api/webhooks/stripe.js'),
  read('functions/api/integrations/stripe/status.js'),
  read('functions/api/integrations/stripe/records.js'),
  read('public/js/security-operations-centre.js'),
  read('public/security-operations-centre.css'),
  read('public/js/boot.js')
]);

for (const table of [
  'security_marker_definitions', 'security_marker_references', 'customer_notification_deliveries',
  'platform_lockdowns', 'platform_security_commands', 'stripe_webhook_events', 'stripe_customer_links',
  'stripe_payment_records', 'stripe_order_records', 'stripe_subscription_records'
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must exist in the operations control-plane schema.`);
}

for (const markerCode of ['SMC-IDC','SMC-ATO','SMC-PYR','SMC-SAF','SMC-EIV','SMC-UAA','SMC-CVU']) {
  assert.match(migration, new RegExp(markerCode), `${markerCode} must be a real governed marker code.`);
}
assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS idx_lockdown_one_active[\s\S]*WHERE status='active'/,
  'Only one active lockdown per platform may exist, while historical lockdowns remain available.');
assert.doesNotMatch(migration, /UNIQUE\(platform_id, status\)/,
  'A lifted lockdown must not prevent a later genuine incident from being recorded.');

assert.match(controlPlane, /automatedLockdownDisabled:\s*true/, 'The connected-site contract must explicitly disable automatic lockdown.');
assert.match(controlPlane, /siteMaintenanceAndLaunchGatesRemainLocallyControlled:\s*true/,
  'Head Office lockdown must not replace a site’s maintenance or launch gate.');
assert.match(controlPlane, /LOCKDOWN \$\{String\(platform\.code/, 'A platform-specific typed confirmation must be required.');
assert.match(controlPlane, /ENTER_SECURITY_LOCKDOWN/, 'A real lockdown command must be queued for the connected site.');
assert.match(controlPlane, /EXIT_SECURITY_LOCKDOWN/, 'A real lockdown release command must be queued for the connected site.');
assert.match(lockdownApi, /security\.platform_lockdown_initiated/, 'Manual lockdown initiation must enter the audit trail.');
assert.match(platformState, /platformSecurityState/, 'Connected sites must receive the authoritative central security state.');
assert.match(platformState, /platform_security_commands/, 'Connected sites must receive pending Head Office commands.');
assert.match(platformAck, /acknowledged_at/, 'Connected sites must acknowledge security commands.');

assert.match(markerApi, /ensureMarkerReference/, 'Every applied marker must receive a unique marker reference.');
assert.match(markerApi, /markerCode/, 'The applied marker response must expose its security marker code.');
assert.match(securityApi, /crm_display_label/, 'The staff security register must expose the approved CRM display label.');
assert.match(securityApi, /branch_instruction/, 'The staff security register must expose the approved connected-site instruction.');
assert.match(controlPlane, /confidentialReasonWithheld:\s*true/,
  'Connected sites must receive controlled marker instructions rather than confidential Head Office reasoning.');

assert.match(notifications, /RESEND_API_KEY/, 'Resend must be configured with a protected server-side API key.');
assert.match(notifications, /RESEND_FROM_EMAIL/, 'The approved Resend sender must be configurable.');
assert.match(notifications, /Unique Customer Number \(UCN\)/, 'The welcome email must communicate the customer’s UCN.');
assert.match(notifications, /Idempotency-Key/, 'Welcome messages must be sent idempotently.');
assert.match(directorySync, /dispatchPendingCustomerWelcomeNotifications/,
  'A completed JA Group Services ID sync must dispatch pending UCN welcome notices.');

assert.match(stripeWebhook, /Stripe-Signature/, 'Stripe webhook signatures must be verified against the raw payload.');
assert.match(stripeWebhook, /processStripeWebhookEvent/, 'The existing Stripe webhook must feed the central normalisation service.');
assert.match(stripeControl, /stripe_payment_records/, 'Stripe payment records must be normalised.');
assert.match(stripeControl, /stripe_order_records/, 'Stripe Checkout orders must be normalised.');
assert.match(stripeControl, /stripe_subscription_records/, 'Stripe subscriptions must be normalised.');
assert.match(stripeControl, /metadata\.ucn/, 'Stripe objects must support direct UCN linking through metadata.');
assert.match(stripeStatus, /stripeOperationalStatus/, 'Staff must be able to inspect Stripe configuration and webhook health.');
assert.match(stripeRecords, /payments[\s\S]*orders[\s\S]*subscriptions/, 'Staff must be able to read all three Stripe operational record classes.');

assert.match(socUi, /Security Operations Centre/, 'The new portal must present itself as a Security Operations Centre.');
assert.match(socUi, /Initiate critical lockdown/, 'The manual critical lockdown action must be visible to authorised staff.');
assert.match(socUi, /Stripe Control & Webhooks/, 'Stripe operations must have a dedicated staff workspace.');
assert.match(socUi, /Unique Customer Register/, 'The new interface must use the approved UCN terminology.');
assert.match(socCss, /max-height:\s*min\(54vh, 520px\)/, 'Large data tables must scroll internally instead of making the whole page excessively long.');
assert.match(socCss, /position:\s*sticky/, 'Dense operational tables must retain visible headings while scrolling.');
assert.match(socCss, /grid-template-columns:\s*repeat\(6/, 'The command centre must use a compact desktop metric grid.');
assert.match(boot, /loadSecurityOperationsModule/, 'The new Security Operations Centre module must load during boot.');
assert.match(boot, /hasPermission\('risk:read'\) \? 'security-operations'/,
  'Authorised risk staff must land in the Security Operations Centre by default.');

console.log('Security Operations Centre regression checks passed.');
