import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [staffApi, platformApi, credentialApi, workspace, stylesheet, migration, registrationMigration, registrationHelper, branchRoute, index] = await Promise.all([
  read('functions/api/support-controls/[[path]].js'),
  read('functions/api/v1/platform/support-control.js'),
  read('functions/api/platforms/[id]/credentials.js'),
  read('public/js/customer-service-controls.js'),
  read('public/customer-service-controls.css'),
  read('migrations/0024_customer_service_full_controls.sql'),
  read('migrations/0025_register_customer_service_platforms.sql'),
  read('functions/_support-platform-registration.js'),
  read('functions/api/support-controls/branches.js'),
  read('public/index.html'),
]);

for (const name of ['JA Group Services', 'JA Domain Hub', 'Planyx', 'Profile Centre']) {
  assert.match(staffApi, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${name} must have a separate controlled branch slot.`);
  assert.match(registrationHelper, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${name} must be covered by safe platform registration.`);
}

assert.match(staffApi, /configuration:write/, 'Saving branch controls must require configuration authority.');
assert.match(staffApi, /support\.branch\.full_control/, 'Material control changes must be audited.');
assert.match(staffApi, /appearance_json/, 'Design controls must be persisted centrally.');
assert.match(staffApi, /operating_hours_json/, 'Operating hours must be persisted centrally.');
assert.match(staffApi, /escalation_rules_json/, 'Escalation rules must be persisted centrally.');
assert.match(staffApi, /contact_options_json/, 'Contact controls must be persisted centrally.');
assert.match(staffApi, /LAUNCH_GATE_NOT_SUPPORTED/, 'The Launch Gate must be restricted to its authorised website.');
assert.match(staffApi, /slot\.launchGateSupported && booleanValue\(gate\.enabled\)/, 'No unsupported branch may activate a launch gate.');

assert.match(platformApi, /support_branch_connections/, 'Website configuration fetches must record connection evidence.');
assert.match(platformApi, /website_control_settings/, 'The public configuration endpoint must include website controls.');
assert.match(platformApi, /isLiveSupportPlatform/, 'Only the four approved support platforms may use this endpoint.');
assert.match(platformApi, /launchGate/, 'The JA Group Services website must receive its Head Office Launch Gate state.');
assert.doesNotMatch(platformApi, /CUSTOMEROPS_API_KEY|Bearer\s+[A-Za-z0-9]/, 'No website credential may be embedded in the public endpoint.');

for (const scope of ['support:read', 'support:write', 'support:ai']) {
  assert.match(credentialApi, new RegExp(scope.replace(':', '\\:')), `${scope} must be an authorised generated credential scope.`);
}
assert.match(credentialApi, /token = `ho_live_/, 'The credential token must be generated server-side.');
assert.match(credentialApi, /secret_hash/, 'Only the credential hash must be stored.');

assert.match(registrationHelper, /ensureCentralPlatformSchema/);
assert.match(registrationHelper, /INSERT INTO platforms/);
assert.match(registrationHelper, /ON CONFLICT\(code\) DO UPDATE/);
assert.match(registrationHelper, /health_status,health_message/);
assert.match(registrationHelper, /awaiting_connection/);
assert.doesNotMatch(registrationHelper, /connection_status[^\n]*connected|health_status[^\n]*operational/i,
  'Registration must not manufacture a successful live connection.');
assert.match(branchRoute, /ensureApprovedSupportPlatforms/,
  'The live controls route must repair missing approved platform records before rendering.');
assert.match(branchRoute, /getBranchControls/);
assert.match(registrationMigration, /JA_GROUP_SERVICES/);
assert.match(registrationMigration, /JA_DOMAIN_HUB/);
assert.match(registrationMigration, /awaiting its first authenticated configuration check/);
assert.doesNotMatch(registrationMigration, /'connected'|'operational'/,
  'The migration must not falsely record a website heartbeat.');

assert.match(workspace, /Website Customer Service Controls/);
assert.match(workspace, /data-csc-manage/);
assert.match(workspace, /Design and appearance/);
assert.match(workspace, /Operating hours/);
assert.match(workspace, /Escalation and safety rules/);
assert.match(workspace, /JA Group Services Launch Gate/);
assert.match(workspace, /Safe control boundary/);
assert.match(workspace, /do not change DNS, authentication, payments, databases, customer accounts/i);
assert.match(workspace, /\/api\/support-controls\/branches/);
assert.match(workspace, /launchGateEnabled/);
assert.match(workspace, /accentColour/);
assert.match(workspace, /connection.*lastSeenAt/s);
assert.match(workspace, /CUSTOMEROPS_API_KEY/, 'The portal must identify the exact Cloudflare secret name.');
assert.match(workspace, /data-csc-generate-key/, 'Registered website profiles must expose a key generator.');
assert.match(workspace, /support:read/);
assert.match(workspace, /support:write/);
assert.match(workspace, /support:ai/);
assert.match(workspace, /routeFor\(branch\)/, 'Each website editor must have a stable route.');
assert.match(workspace, /window\.navigate\(routeFor/, 'Opening a website profile must navigate instead of rendering a temporary view.');
assert.match(workspace, /event\.stopImmediatePropagation\(\)/, 'Customer Service actions must not fall through to competing portal handlers.');
assert.doesNotMatch(workspace, /ho_live_[A-Za-z0-9_-]{10,}/, 'No live platform key may be embedded in the browser workspace.');

assert.match(stylesheet, /csc-branch-control-grid/);
assert.match(stylesheet, /csc-design-preview/);
assert.match(stylesheet, /data-branch-slot="ja_group_services"/,
  'The JA Group Services control card must be visually promoted.');
assert.match(stylesheet, /Priority public website control/,
  'The Launch Gate status must have a clear priority label.');
assert.match(stylesheet, /csc-launch-gate-panel\{order:-1/,
  'The Launch Gate editor must appear before the longer customer-service settings.');
assert.match(stylesheet, /@media\(max-width:720px\)/);
assert.match(migration, /launch_gate_enabled INTEGER NOT NULL DEFAULT 0/, 'The Launch Gate must default to off.');
assert.doesNotMatch(migration, /launch_gate_enabled[^\n]*DEFAULT 1/, 'The migration must never open with a gate active.');
assert.match(index, /customer-service-controls\.css/);
assert.match(index, /customer-service-controls\.js/);
assert.ok(index.indexOf('customer-service-controls.js') < index.indexOf('boot.js'),
  'Full controls must register their stable routes before the secure boot selects the requested workspace.');

console.log('Four registered website controls, stable routes, scoped key generation and prominent JA Group Services Launch Gate checks passed.');
