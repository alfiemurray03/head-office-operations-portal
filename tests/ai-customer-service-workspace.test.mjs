import assert from 'node:assert/strict';
import fs from 'node:fs';

const workspace = fs.readFileSync('public/js/customer-service-centre.js', 'utf8');
const stylesheet = fs.readFileSync('public/customer-service-centre.css', 'utf8');
const interfaceScript = fs.readFileSync('public/js/professional-interface.js', 'utf8');
const actions = fs.readFileSync('public/js/actions.js', 'utf8');
const websiteControls = fs.readFileSync('public/js/customer-service-website-controls.js', 'utf8');
const websiteControlsCss = fs.readFileSync('public/customer-service-website-controls.css', 'utf8');
const websiteControlsApi = fs.readFileSync('functions/api/support-centre/website-controls/[[path]].js', 'utf8');

assert.match(interfaceScript, /customer-service-centre/);
assert.match(interfaceScript, /root\.dataset\.currentRoute = route/,
  'The view container may expose its current route only through non-actionable page metadata.');
assert.doesNotMatch(interfaceScript, /root\.dataset\.route = route/,
  'The view container must not masquerade as a data-route navigation control and intercept all nested clicks.');
assert.match(actions, /button\[data-route\], a\[data-route\], \[role="button"\]\[data-route\]/,
  'Global routing must react only to actionable navigation controls, never route metadata on page containers.');
assert.doesNotMatch(actions, /target\.closest\('\[data-route\]'\)/,
  'A click inside route-labelled page chrome must not be mistaken for navigation.');
assert.match(interfaceScript, /AI Customer Service Centre/);
assert.match(interfaceScript, /customer-service-centre\.js/);
assert.match(interfaceScript, /customer-service-centre\.css/);
assert.match(interfaceScript, /communications:read/);
assert.match(interfaceScript, /customer-service-website-controls\.js/);
assert.match(interfaceScript, /customer-service-website-controls\.css/);
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
assert.match(workspace, /conversationRoute\(open\.dataset\.supportOpen\)/,
  'Opening a conversation must use a stable deep route instead of volatile in-memory state.');
assert.match(workspace, /conversationIdFromRoute\(route\)/,
  'Route rerenders must restore the selected conversation instead of returning to the queue.');
assert.match(workspace, /if \(routedConversationId\) return openConversation\(routedConversationId\)/,
  'Any workspace rerender on a deep conversation route must preserve the selected conversation.');
assert.match(workspace, /activeSupportForm \|\| unsentDraft/,
  'Live refresh must not replace the reply editor while a staff member is composing.');
assert.match(workspace, /openConversation\(form\.dataset\.conversationId, \{ background: true \}\)/,
  'Sending a reply must refresh the same conversation without a full-page loading jump.');
assert.match(workspace, /Reply to customer[\s\S]*button type="submit" class="button primary">Send reply/,
  'The customer reply action must use an explicit submit control.');
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

for (const profile of ['ja-group-services', 'ja-domain-hub', 'planyx', 'profile-centre']) {
  assert.match(websiteControls, new RegExp(profile), `The ${profile} website must have its own Head Office control profile.`);
  assert.match(websiteControlsApi, new RegExp(profile), `The API must identify the ${profile} platform independently.`);
}
assert.match(websiteControls, /data-full-support-profile-form/);
assert.match(websiteControls, /launchGateEnabled/);
assert.match(websiteControls, /accentColour/);
assert.match(websiteControls, /operatingHours/);
assert.match(websiteControls, /safeguardingEscalation/);
assert.match(websiteControls, /dataProtectionEscalation/);
assert.match(websiteControls, /selfServiceFirst/);
assert.match(websiteControlsApi, /website_control_settings/);
assert.match(websiteControlsApi, /support_branch_connections/);
assert.match(websiteControlsApi, /support\.website_profile\.configure/);
assert.doesNotMatch(websiteControls, /CUSTOMEROPS_API_KEY|Authorization\s*:/i,
  'The Head Office browser workspace must never contain a website credential.');
assert.match(websiteControlsCss, /full-control-section/);
assert.match(websiteControlsCss, /@media\(max-width:780px\)/);

assert.match(stylesheet, /support-conversation-layout/);
assert.match(stylesheet, /support-transcript/);
assert.match(stylesheet, /data-ops-theme="dark"/);
assert.match(stylesheet, /@media \(max-width: 780px\)/);

console.log('AI Customer Service Centre, four-website controls and startup-isolation checks passed.');
