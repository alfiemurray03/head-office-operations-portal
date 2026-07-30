import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [service, lifecycle, collectionApi, recordApi, ui, css, boot, webhook] = await Promise.all([
  read('functions/_didit-operations.js'),
  read('functions/_didit-lifecycle-policy.js'),
  read('functions/api/identity-verifications.js'),
  read('functions/api/identity-verifications/[id].js'),
  read('public/js/didit-operations.js'),
  read('public/didit-operations.css'),
  read('public/js/boot.js'),
  read('functions/_didit-webhook.js')
]);

assert.match(service, /https:\/\/verification\.didit\.me/, 'CustomerOps must call the official Didit verification API.');
assert.match(service, /"x-api-key": apiKey/, 'The Didit API key must stay in the server-side request header.');
assert.match(service, /DIDIT_API_KEY/, 'CustomerOps must use the encrypted Didit API binding.');
assert.match(service, /DIDIT_WEBHOOK_SECRET/, 'Configuration health must include the signed webhook binding.');
assert.match(service, /DIDIT_WORKFLOW_ID/, 'The Head Office identity workflow must be configurable.');
assert.match(service, /DIDIT_AGE_WORKFLOW_ID/, 'Age verification must use a separate optional workflow.');
assert.match(service, /purpose === "age_verification"[\s\S]*DIDIT_AGE_WORKFLOW_ID/, 'Age requests must not silently use the KYC identity workflow.');
assert.match(service, /accessMode === "require_before_access"/, 'A restriction may only be created after the explicit block-until-complete choice.');
assert.match(service, /accessMode \|\| "request_only"/, 'Ordinary manual verification must default to request-only rather than blocking login.');
assert.match(service, /verification_url_hash/, 'CustomerOps must store only a hash of the hosted verification URL.');
assert.doesNotMatch(service, /verification_url\s+TEXT/, 'The readable hosted Didit token URL must not be stored in the database.');
assert.match(service, /vendor_data: `ucn:\$\{customer\.customer_number\}`/, 'Every Didit request must be linked to the UCN.');
assert.match(service, /randomVerificationCandidates/, 'CustomerOps must support controlled random customer selection.');
assert.match(service, /Math\.min\(25/, 'Random verification batches must be capped to prevent accidental mass requests.');
assert.match(service, /NOT EXISTS[\s\S]*identity_verification_sessions/, 'Random selection must exclude customers with an active verification.');
assert.match(service, /createIdentityVerification/, 'The server must own Didit session initiation.');

assert.match(lifecycle, /refreshIdentityVerificationSafely/, 'Provider status refresh must use the governed lifecycle policy.');
assert.match(lifecycle, /sourceOfTruth: "signed_webhook_for_access_changes"/, 'A manual provider refresh must not become the access-control source of truth.');
assert.doesNotMatch(lifecycle, /liftRestrictionEnforcement/, 'Lifecycle actions must not lift a Head Office restriction directly.');
assert.match(lifecycle, /resumeIdentityVerificationSafely[\s\S]*createIdentityVerification/, 'Resume must create and retain a real replacement Didit session.');
assert.match(lifecycle, /sendNotificationEmails: true/, 'Replacement verification sessions must automatically notify the verified customer email.');
assert.match(lifecycle, /replacementProviderSessionId/, 'The superseded request must retain the replacement provider-session reference.');
assert.match(lifecycle, /cancelIdentityVerificationSafely/, 'Cancellation must be governed separately from access restoration.');
assert.match(lifecycle, /Cancelling a verification request does not remove its Head Office access requirement/, 'Cancellation must retain a linked access requirement for separate authorised review.');

assert.match(collectionApi, /requirePermission\(context, "security:read"\)/, 'Only security-authorised staff may view verification records.');
assert.match(collectionApi, /requirePermission\(context, "security:write"\)/, 'Only security-authorised staff may create verification requests.');
assert.match(collectionApi, /START RANDOM CHECKS/, 'Random batches must require an explicit typed confirmation.');
assert.match(collectionApi, /customerIds, 25/, 'The API must enforce the 25-customer maximum independently of the browser.');
assert.match(recordApi, /action === "refresh"/, 'The lifecycle API must support refresh.');
assert.match(recordApi, /action === "resume"/, 'The lifecycle API must support resume.');
assert.match(recordApi, /action === "cancel"/, 'The lifecycle API must support cancellation.');
assert.match(recordApi, /refreshIdentityVerificationSafely/, 'The live lifecycle API must use the safe refresh implementation.');
assert.match(recordApi, /resumeIdentityVerificationSafely/, 'The live lifecycle API must use the safe replacement-session implementation.');
assert.match(recordApi, /cancelIdentityVerificationSafely/, 'The live lifecycle API must use the safe cancellation implementation.');

assert.match(ui, /Identity Verification Centre/, 'CustomerOps must expose a complete Didit operations workspace.');
assert.match(ui, /Start identity verification/, 'Staff must have a plainly labelled manual initiation control.');
assert.match(ui, /Start ID verification/, 'Every universal customer record must expose the Head Office initiation control.');
assert.match(ui, /Random selection/, 'The operations workspace must expose controlled random selection.');
assert.match(ui, /Request only — do not block login/, 'The browser must make the safe non-blocking default explicit.');
assert.match(ui, /Require completion before access/, 'The stronger access control must be a deliberate separate option.');
assert.match(ui, /Ordinary customer sign-in does not automatically trigger an ID check/, 'The portal must state that ID checks are not ordinary login checks.');
assert.match(ui, /Resume \/ get link/, 'Staff must be able to resume an unfinished hosted journey.');
assert.match(ui, /Refresh status/, 'Staff must be able to refresh the provider decision.');
assert.match(ui, /Cancel/, 'Staff must be able to cancel an active verification request.');
assert.match(ui, /Webhook and decision history/, 'Signed Didit deliveries must be visible in CustomerOps.');
assert.match(ui, /apiKeyConfigured/, 'The UI may receive only non-sensitive configuration health flags.');
assert.doesNotMatch(ui, /DIDIT_API_KEY/, 'The browser must never reference the Didit API key.');
assert.doesNotMatch(ui, /DIDIT_WEBHOOK_SECRET/, 'The browser must never reference the Didit webhook secret.');
assert.match(css, /\.didit-page/, 'The Didit workspace must have a complete responsive visual system.');
assert.match(css, /@media\(max-width:760px\)/, 'The Didit controls must remain usable on smaller screens.');
assert.match(boot, /loadDiditOperationsModule/, 'The Didit module must load before the first portal route is rendered.');
assert.match(boot, /Promise\.all\(\[[\s\S]*loadDiditOperationsModule\(\)[\s\S]*loadSystemControlModule\(\)[\s\S]*\]\)/, 'Portal startup must wait for both Didit and System Control modules.');
assert.match(webhook, /verified\.status === "Approved"/, 'Only an approved signed provider result may automatically lift a linked restriction.');
assert.match(webhook, /verified\.status === "Declined"/, 'A declined signed provider result must create central risk activity.');

console.log('Didit operations regression checks passed.');
