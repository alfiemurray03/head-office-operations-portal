import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bounded = await readFile('functions/_customer-entra-bounded-sync.js', 'utf8');
const wrapper = await readFile('functions/_customer-entra-sync.js', 'utf8');
const manualEndpoint = await readFile('functions/api/customer-directory/sync.js', 'utf8');
const automationEndpoint = await readFile('functions/api/automation/customer-directory/sync.js', 'utf8');
const migration = await readFile('migrations/0013_customer_directory_bounded_sync.sql', 'utf8');

assert.match(bounded, /DIRECTORY_USERS_PER_PAGE = 15/);
assert.match(bounded, /DIRECTORY_PAGES_PER_INVOCATION = 2/);
assert.match(bounded, /customer_directory_sync_checkpoints/);
assert.match(bounded, /@odata\.nextLink/);
assert.match(bounded, /continuationPending/);
assert.match(bounded, /odata\.maxpagesize/);
assert.match(wrapper, /_customer-entra-bounded-sync\.js/);
assert.match(manualEndpoint, /result\.partial/);
assert.match(manualEndpoint, /notificationLimit = result\.partial/);
assert.match(automationEndpoint, /syncCustomerDirectory\(context\.env, "delta"/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS customer_directory_sync_checkpoints/);

console.log('Bounded customer-directory sync checks passed.');
