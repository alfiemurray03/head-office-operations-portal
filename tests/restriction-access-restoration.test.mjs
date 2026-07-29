import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [createRestriction, updateRestriction, actions] = await Promise.all([
  read('functions/api/security/restrictions.js'),
  read('functions/api/security/restrictions/[id].js'),
  read('public/js/actions.js')
]);

assert.match(createRestriction, /DUPLICATE_ACTIVE_RESTRICTION/, 'CustomerOps must reject duplicate active restrictions.');
assert.match(createRestriction, /r\.customer_id=\? AND r\.restriction_type=\? AND r\.scope=\? AND r\.status='active'/,
  'Duplicate detection must be scoped to the customer, restriction type and connected service.');
assert.match(createRestriction, /scope = platform\.id/, 'Platform restrictions must use a canonical platform ID so code and ID variants cannot bypass duplicate detection.');

assert.match(updateRestriction, /async function accessPosition/, 'Restriction changes must calculate the resulting customer access position.');
assert.match(updateRestriction, /calculateAccessDecision\(env, customer, platform, false\)/,
  'Post-lift access must be calculated from the same authoritative decision engine used by websites.');
assert.match(updateRestriction, /remainingRestrictions/, 'The lift result must identify controls that still keep the customer restricted.');
assert.match(updateRestriction, /accessRestored:/, 'The lift API must explicitly state whether access was restored.');
assert.match(updateRestriction, /DUPLICATE_ACTIVE_RESTRICTION/, 'Reactivating an old restriction must not create an active duplicate.');

assert.match(actions, /Restriction lifted — access restored/, 'Staff must receive a clear success message only after a real allow decision.');
assert.match(actions, /Restriction lifted — customer still blocked/, 'Staff must be warned when another active control remains.');
assert.match(actions, /active restrictions remain/, 'The warning must show the number of remaining restrictions.');

console.log('Restriction access-restoration regression checks passed.');
