import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [staffApi, platformApi, workspace, stylesheet, migration, index] = await Promise.all([
  read('functions/api/support-controls/[[path]].js'),
  read('functions/api/v1/platform/support-control.js'),
  read('public/js/customer-service-controls.js'),
  read('public/customer-service-controls.css'),
  read('migrations/0024_customer_service_full_controls.sql'),
  read('public/index.html'),
]);

for (const name of ['JA Group Services', 'JA Domain Hub', 'Planyx', 'Profile Centre']) {
  assert.match(staffApi, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${name} must have a separate controlled branch slot.`);
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

assert.match(stylesheet, /csc-branch-control-grid/);
assert.match(stylesheet, /csc-design-preview/);
assert.match(stylesheet, /@media\(max-width:720px\)/);
assert.match(migration, /launch_gate_enabled INTEGER NOT NULL DEFAULT 0/, 'The Launch Gate must default to off.');
assert.doesNotMatch(migration, /launch_gate_enabled[^\n]*DEFAULT 1/, 'The migration must never open with a gate active.');
assert.match(index, /customer-service-controls\.css/);
assert.match(index, /customer-service-controls\.js/);
assert.ok(index.indexOf('boot.js') < index.indexOf('customer-service-controls.js'), 'Full controls must load after the secure portal boot script.');

console.log('Full four-website Customer Service controls and JA Group Services Launch Gate checks passed.');
