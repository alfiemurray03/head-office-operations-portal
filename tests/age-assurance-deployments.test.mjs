import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [
  migration,
  settings,
  assurance,
  access,
  didit,
  webhook,
  configApi,
  sessionApi,
  customerUpsert,
  ui
] = await Promise.all([
  read('migrations/0018_central_age_assurance.sql'),
  read('functions/_system-settings.js'),
  read('functions/_age-assurance.js'),
  read('functions/_central-access.js'),
  read('functions/_didit-operations.js'),
  read('functions/_didit-webhook.js'),
  read('functions/api/platform/age-assurance/config.js'),
  read('functions/api/platform/age-assurance/session.js'),
  read('functions/api/platform/customers/upsert.js'),
  read('public/js/system-control.js')
]);

assert.match(migration, /age_assurance\.enforcement_master_enabled','age_assurance','false'/, 'Age-assurance enforcement must be off when the migration is deployed.');
assert.match(migration, /age_assurance\.planyx_status','age_assurance','"disabled"'/, 'The Planyx deployment must start disabled.');
assert.match(migration, /age_assurance\.planyx_minimum_age','age_assurance','16'/, 'Planyx must be configured as 16+.');
assert.match(migration, /age_assurance\.profile_centre_status','age_assurance','"disabled"'/, 'The Profile Centre deployment must start disabled.');
assert.match(migration, /age_assurance\.profile_centre_minimum_age','age_assurance','18'/, 'Profile Centre must be configured as 18+.');
assert.match(migration, /verification_purpose TEXT/, 'Verification evidence must identify its governed purpose.');
assert.match(migration, /required_age INTEGER/, 'Verification evidence must retain the threshold actually requested.');

assert.match(settings, /"age_assurance\.enforcement_master_enabled"[\s\S]*defaultValue: false/, 'The runtime settings catalogue must retain the inactive master default.');
assert.match(settings, /"age_assurance\.planyx_status"[\s\S]*defaultValue: "disabled"/, 'Runtime recovery must keep Planyx disabled.');
assert.match(settings, /"age_assurance\.planyx_minimum_age"[\s\S]*defaultValue: 16/, 'Runtime recovery must keep the Planyx threshold at 16.');
assert.match(settings, /"age_assurance\.profile_centre_status"[\s\S]*defaultValue: "disabled"/, 'Runtime recovery must keep Profile Centre disabled.');
assert.match(settings, /"age_assurance\.profile_centre_minimum_age"[\s\S]*defaultValue: 18/, 'Runtime recovery must keep the Profile Centre threshold at 18.');
assert.match(settings, /oneOf\(\["disabled", "paused", "enabled"\]\)/, 'Each website must support disabled, paused and enabled deployment states.');

assert.match(assurance, /accountPopulation: "customers_only"/, 'The service must identify its population as customers only.');
assert.match(assurance, /staffAccountsExcluded: true/, 'The policy must permanently exclude staff accounts.');
assert.match(assurance, /!deployment\.masterEnabled \|\| deployment\.status === "disabled"/, 'No access requirement may apply before Head Office starts enforcement.');
assert.match(assurance, /verification_purpose='age_verification'/, 'Only signed age-assurance sessions may satisfy an age threshold.');
assert.match(assurance, /required_age>=\?/, 'An approved 16+ result must never satisfy an 18+ service unless its retained threshold is high enough.');
assert.match(assurance, /deployment\.status === "paused"/, 'Paused deployments must be governed separately from disabled deployments.');
assert.doesNotMatch(assurance, /staff_directory_profiles|staff_members|staff_directory_identities/, 'Age assurance must never read or write the staff directory.');

assert.match(access, /ageAssuranceForAccess/, 'The authoritative connected-site decision must consult Head Office age policy.');
assert.match(access, /ageAssurance\.decision === "deny"/, 'A live customer deployment must be able to deny access safely.');
assert.match(access, /ageAssurance\.decision === "step_up"/, 'A live customer deployment must be able to request verification.');
assert.match(access, /resolvePlatformCustomer/, 'Platform checks must resolve a customer or UCN, not a staff identity.');
assert.doesNotMatch(access, /staff_directory_profiles|staff_members/, 'The central age decision path must not touch staff records.');

assert.match(didit, /purpose === "age_verification" && accessMode !== "request_only"/, 'Age assurance must not create a generic identity restriction.');
assert.match(didit, /account_population: "customers_only"/, 'Didit age sessions must carry the customer-only scope.');
assert.match(didit, /verification_purpose,required_age/, 'The requested purpose and threshold must be retained in D1.');
assert.match(didit, /actorType === "platform"[\s\S]*platformAudit/, 'Connected-service session creation must be audited as a platform action, not a staff action.');
assert.doesNotMatch(didit, /staff_directory_profiles|staff_members/, 'Didit customer session creation must not touch staff records.');

assert.match(webhook, /purpose === "age_verification" \? null : await findRestriction/, 'An age result must never lift an unrelated enhanced-identity restriction.');
assert.match(webhook, /verified\.status === "Declined" && purpose !== "age_verification"/, 'Failing an age threshold must not automatically create a customer fraud signal.');
assert.match(webhook, /staffAccountsExcluded: true/, 'Signed age evidence must retain the staff-exclusion policy.');

assert.match(configApi, /requirePlatform/, 'Only an authenticated connected service may read its deployment.');
assert.match(configApi, /staffIdentitySystemAffected: false/, 'The branch configuration response must explicitly confirm staff identity is unaffected.');
assert.match(sessionApi, /requireAgeAssuranceSessionDeployment/, 'A branch must not create a session while enforcement is off, disabled or paused.');
assert.match(sessionApi, /consentAccepted !== true/, 'The platform must show and record customer disclosure before opening Didit.');
assert.match(sessionApi, /resolvePlatformCustomer/, 'The session endpoint must resolve only the linked customer record.');
assert.match(sessionApi, /purpose: "age_verification"/, 'Branch sessions must use the age-verification purpose.');
assert.match(sessionApi, /accessMode: "request_only"/, 'The provider session itself must not create a generic login restriction.');
assert.match(sessionApi, /staffAccountsExcluded: true/, 'The branch response must confirm staff accounts are excluded.');
assert.doesNotMatch(`${configApi}\n${sessionApi}`, /staff_directory_profiles|staff_members|staff_directory_identities/, 'Branch age APIs must never query the staff tenant or Staff Directory.');
assert.match(customerUpsert, /ageAssurance:access\.ageAssurance/, 'Customer sign-in synchronisation must receive the same age policy detail as a normal access check.');

assert.match(ui, /Customer Age Assurance Deployments/, 'System Settings must expose the central deployment workspace.');
assert.match(ui, /Start group age-assurance enforcement/, 'Head Office must have a separate master start control.');
assert.match(ui, /Disabled — no age requirement/, 'Head Office must be able to disable a deployment.');
assert.match(ui, /Paused — keep requirement, stop new sessions/, 'Head Office must be able to pause a deployment.');
assert.match(ui, /Enabled — enforce customer threshold/, 'Head Office must be able to enable a deployment.');
assert.match(ui, /Customer platform threshold: 16\+/, 'The Planyx control must show 16+.');
assert.match(ui, /Customer platform threshold: 18\+/, 'The Profile Centre control must show 18+.');
assert.match(ui, /Staff accounts are excluded from age assurance/, 'The staff exclusion must be visible as a fixed safety policy.');
assert.match(ui, /Customer age-assurance enforcement remains off/, 'Saving settings with the master switch off must not imply enforcement started.');

console.log('Central age assurance deployment regression checks passed.');
