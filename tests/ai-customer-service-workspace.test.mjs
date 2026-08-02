import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace = fs.readFileSync('public/js/customer-service-centre.js', 'utf8');
const stylesheet = fs.readFileSync('public/customer-service-centre.css', 'utf8');
const interfaceScript = fs.readFileSync('public/js/professional-interface.js', 'utf8');

assert.match(interfaceScript, /customer-service-centre/);
assert.match(interfaceScript, /AI Customer Service Centre/);
assert.match(interfaceScript, /customer-service-centre\.js/);
assert.match(interfaceScript, /customer-service-centre\.css/);
assert.match(interfaceScript, /communications:read/);
assert.match(interfaceScript, /activateCustomerServiceAfterAuthentication/,
  'The specialist Customer Service workspace must be activated only after the secure application shell is available.');
assert.match(interfaceScript, /if \(appShell\.hidden\) return false/,
  'Customer Service assets must not load while the unauthenticated login screen is active.');
assert.match(interfaceScript, /observer\.observe\(appShell, \{ attributes: true, attributeFilter: \['hidden'\] \}\)/,
  'Customer Service activation must follow the authenticated application-shell transition.');
assert.match(interfaceScript, /the core Head Office Portal is continuing/,
  'A Customer Service module failure must explicitly preserve the core Head Office Portal.');
assert.doesNotMatch(
  interfaceScript,
  /function start\(\) \{[\s\S]{0,200}ensureCustomerServiceAssets\(\)/,
  'The Customer Service module must not be loaded directly during global pre-authentication startup.'
);

assert.match(workspace, /\/api\/support-centre\/conversations/);
assert.match(workspace, /\/api\/support-centre\/branches/);
assert.match(workspace, /data-support-takeover/);
assert.match(workspace, /const visibility = type === 'reply' \? 'customer'/);
assert.match(workspace, /branch_internal/);
assert.match(workspace, /head_office/);
assert.match(workspace, /handlingMode/);
assert.match(workspace, /AI replies are now in standby/);
assert.match(workspace, /customerNumber/);
assert.match(workspace, /verifiedEmail/);
assert.match(workspace, /currentPage/);
assert.match(workspace, /caseReference/);
assert.match(workspace, /providerEscalations/);
assert.match(workspace, /assistantEnabled/);
assert.match(workspace, /aiEnabled/);
assert.match(workspace, /maintenanceEnabled/);
assert.match(workspace, /humanTakeoverEnabled/);
assert.match(workspace, /retentionDays/);
assert.doesNotMatch(workspace, /Authorization\s*:/i);
assert.doesNotMatch(workspace, /Bearer\s+[A-Za-z0-9._-]+/i);
assert.doesNotMatch(workspace, /tawk\.to/i);

assert.match(stylesheet, /support-conversation-layout/);
assert.match(stylesheet, /support-transcript/);
assert.match(stylesheet, /data-ops-theme="dark"/);
assert.match(stylesheet, /@media \(max-width: 780px\)/);

console.log('AI Customer Service Centre workspace and startup-isolation checks passed.');
