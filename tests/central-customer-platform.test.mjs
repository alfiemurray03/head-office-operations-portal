import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  migration,
  centralSchema,
  upsert,
  restrictions,
  restrictionAction,
  access,
  events,
  customerApi,
  workspace,
  platforms,
  platformsApi,
  platformRecordApi,
  actions,
  index,
  tokens,
  shell,
  components,
  layoutFixes,
  headOfficeContext,
  router
] = await Promise.all([
  read('migrations/0008_central_customer_platform.sql'),
  read('functions/_central-schema.js'),
  read('functions/api/platform/customers/upsert.js'),
  read('functions/api/security/restrictions.js'),
  read('functions/api/security/restrictions/[id].js'),
  read('functions/_central-access.js'),
  read('functions/_central-events.js'),
  read('functions/api/customers/[id].js'),
  read('public/js/customer-record-workspace.js'),
  read('public/js/central-platform-ui.js'),
  read('functions/api/platforms.js'),
  read('functions/api/platforms/[id].js'),
  read('public/js/actions.js'),
  read('public/index.html'),
  read('public/planyx-tokens.css'),
  read('public/planyx-shell.css'),
  read('public/planyx-components.css'),
  read('public/planyx-layout-fixes.css'),
  read('public/js/head-office-context.js'),
  read('public/js/central-router.js')
]);

for (const table of [
  'platform_operational_profiles', 'platform_heartbeats', 'platform_deployments',
  'customer_platform_snapshots', 'customer_subscriptions', 'customer_orders',
  'customer_sessions', 'customer_security_events', 'fraud_signals',
  'platform_enforcement_commands', 'customer_access_decisions', 'customer_timeline_events'
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must exist in the central data model.`);
}
assert.doesNotMatch(migration, /PROFILE_CENTRE/, 'No website or hosting configuration may be invented in a database migration.');
assert.doesNotMatch(migration, /GoDaddy Airo/, 'Hosting providers must be entered or reported, never assumed.');
assert.match(migration, /awaiting_connection/, 'Newly registered systems need an explicit awaiting-connection state.');
assert.match(centralSchema, /retireIncorrectAssumedProfileCentre/, 'The previously assumed Profile Centre record must be safely retired from existing preview data.');
assert.match(centralSchema, /credential_count[\s\S]*account_count/, 'Automatic cleanup must not remove a platform that has real credentials or linked customer accounts.');

assert.match(upsert, /account_status=CASE WHEN account_status='pending' AND \?='active' THEN 'active' ELSE account_status END/, 'A website must not reactivate a restricted or suspended Head Office customer.');
assert.doesNotMatch(upsert, /account_status=CASE WHEN account_status IN \('pending','active','suspended'\) THEN \?/, 'The former unsafe website-authoritative status update must not return.');
assert.match(upsert, /calculateAccessDecision/, 'Every customer upsert must return an authoritative access decision.');

assert.match(restrictions, /applyRestrictionEnforcement/, 'Applying a restriction must trigger real enforcement.');
assert.match(restrictionAction, /liftRestrictionEnforcement/, 'Lifting a restriction must refresh website and identity access.');
assert.match(access, /restriction\.scope === "company_wide"/, 'Company-wide controls must be distinguished from platform-only controls.');
assert.match(access, /manageCustomerDirectoryAccount\(env,identity\.id,"suspend"\)/, 'A company-wide sign-in block must disable JA Group Services ID.');
assert.match(access, /manageCustomerDirectoryAccount\(env,identity\.id,"revoke_sessions"\)/, 'Microsoft sign-in sessions must be revoked.');
assert.match(access, /remaining[\s\S]*Another company-wide block/, 'Access must not be restored while another company-wide block remains.');
assert.match(access, /platform_enforcement_commands/, 'Connected websites must receive enforceable commands.');

assert.match(events, /customer_subscriptions/, 'Subscriptions must enter the central customer record.');
assert.match(events, /customer_orders/, 'Orders must enter the central customer record.');
assert.match(events, /payment_references/, 'Payments and refunds must enter the central customer record.');
assert.match(events, /customer_security_events/, 'Security events must enter the central customer record.');
assert.match(events, /fraud_signals/, 'Fraud signals must enter the central customer record.');
assert.match(events, /customer_timeline_events/, 'All activity must feed the central customer timeline.');
assert.match(customerApi, /subscriptions, orders, timeline/, 'The complete central relationship record must be returned to staff.');

for (const heading of [
  'Subscriptions &amp; entitlements', 'Orders', 'Payments, refunds &amp; disputes',
  'Sessions &amp; devices', 'Fraud signals', 'Security activity', 'Access decisions',
  'Complete customer timeline'
]) assert.match(workspace, new RegExp(heading), `${heading} must appear in the universal customer workspace.`);
assert.match(workspace, /data-action="restriction-lift"/, 'Staff must be able to lift active restrictions from the customer record.');
assert.doesNotMatch(workspace, /openModal\s*\(/, 'The full customer record must never return to a modal.');

assert.match(platforms, /Nothing is assumed automatically/, 'The platform workspace must state that system details are controlled, not guessed.');
assert.match(platforms, /data-action="edit-platform"/, 'Every connected-system card must expose an edit control.');
assert.match(platforms, /data-action="delete-platform"/, 'Every connected-system card must expose a delete control.');
assert.match(platforms, /Edit configuration/, 'The edit action must be plainly labelled.');
assert.match(platforms, /Delete configuration/, 'The delete action must be plainly labelled.');
assert.doesNotMatch(platforms, /Profile Centre is preconfigured/, 'The UI must not repeat the incorrect automatic Profile Centre assumption.');
assert.match(platformsApi, /WHERE p\.status!='disabled'/, 'Deleted configurations must disappear from the active platform list.');
assert.match(platformsApi, /publicUrl[\s\S]*hostingProvider[\s\S]*healthStatus/, 'Registration must accept the real operational configuration.');
assert.match(platformRecordApi, /onRequestPut/, 'A connected-system configuration must be editable.');
assert.match(platformRecordApi, /onRequestDelete/, 'A connected-system configuration must be deletable.');
assert.match(platformRecordApi, /UPDATE platform_api_credentials SET status='revoked'/, 'Deleting a configuration must revoke its connector keys.');
assert.match(platformRecordApi, /DELETE FROM platform_operational_profiles/, 'Deleting a configuration must remove its active operational profile.');
assert.match(actions, /formName === 'edit-platform'/, 'The edit form must call the platform configuration API.');
assert.match(actions, /formName === 'delete-platform'/, 'The delete confirmation form must call the platform deletion API.');

const oldCss = index.indexOf('/modal-system.css');
const tokensCss = index.indexOf('/planyx-tokens.css');
const shellCss = index.indexOf('/planyx-shell.css');
const componentsCss = index.indexOf('/planyx-components.css');
assert.ok(oldCss >= 0 && tokensCss > oldCss && shellCss > tokensCss && componentsCss > shellCss,
  'The transferred Planyx design system must load after every older CustomerOps design layer.');
assert.match(tokens, /--px-font-heading:\s*"Plus Jakarta Sans"/, 'Planyx heading typography must be transferred.');
assert.match(tokens, /--px-font-sans:\s*"Inter"/, 'Planyx body typography must be transferred.');
assert.match(tokens, /--px-primary:\s*#2563eb/, 'Planyx primary blue token must be transferred.');
assert.match(tokens, /--px-radius:\s*10px/, 'Planyx component radius system must be transferred.');
assert.match(tokens, /--px-shadow-md:/, 'Planyx elevation system must be transferred.');
assert.match(shell, /backdrop-filter:\s*blur\(22px\)/, 'The modern Planyx glass header treatment must be present.');
assert.match(components, /\.platform-card/, 'Modern connected-platform cards must be styled.');
assert.match(components, /\.customer-record-header/, 'The central customer workspace must use the transferred visual system.');
assert.match(layoutFixes, /\.app-shell[\s\S]*padding-top:\s*0 !important/, 'The current sticky header must start at the top of the viewport without a legacy spacer.');
assert.doesNotMatch(layoutFixes, /--customerops-header-height|padding-top:\s*var\(--customerops-header-height\)/, 'The obsolete fixed-header offset must never return.');
assert.doesNotMatch(layoutFixes, /\.tools-drawer[\s\S]*left:\s*0 !important/, 'The All admin tools menu must not be forced back into a permanent left sidebar.');
assert.match(headOfficeContext, /planyx-admin-parity\.css/, 'The final Planyx Admin parity stylesheet must remain authoritative after lazy modules load.');
assert.match(router, /navigate\(`customers\//, 'Customer rows must navigate into a full central workspace.');

console.log('Central Customer Platform regression checks passed.');
