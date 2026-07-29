import assert from 'node:assert/strict';
import fs from 'node:fs';

const sync = fs.readFileSync('functions/_staff-entra-sync.js', 'utf8');
const directoryApi = fs.readFileSync('functions/api/staff-directory.js', 'utf8');
const manualSyncApi = fs.readFileSync('functions/api/staff-directory/sync.js', 'utf8');
const automaticSyncApi = fs.readFileSync('functions/api/automation/staff-directory/sync.js', 'utf8');
const ui = fs.readFileSync('public/js/staff-directory.js', 'utf8');
const worker = fs.readFileSync('workers/customer-directory-automation.js', 'utf8');
const migration = fs.readFileSync('migrations/0015_staff_tenant_directory_sync.sql', 'utf8');

assert.match(sync, /ADMIN_OIDC_TENANT_ID/);
assert.match(sync, /ADMIN_OIDC_CLIENT_ID/);
assert.match(sync, /AZURE_AD_CLIENT_SECRET/);
assert.doesNotMatch(sync, /STAFF_ENTRA_CLIENT_ID|STAFF_ENTRA_CLIENT_SECRET|STAFF_ENTRA_TENANT_ID/,
  'The Staff Directory must reuse the existing Head Office Microsoft application.');
assert.match(sync, /scope: "https:\/\/graph\.microsoft\.com\/\.default"/);
assert.match(sync, /grant_type: "client_credentials"/);
assert.match(sync, /\/v1\.0\/users\/delta/);
assert.match(sync, /USERS_PER_PAGE = 10/);
assert.match(sync, /PAGES_PER_INVOCATION = 1/);
assert.match(sync, /UNIQUE\(provider,tenant_id,object_id\)/);
assert.match(sync, /profile_created_by_sync/);
assert.doesNotMatch(sync, /FROM customers|JOIN customers|UPDATE customers|INSERT INTO customers/i,
  'Staff tenant synchronisation must never read or modify customer records.');
assert.doesNotMatch(sync, /INSERT INTO staff_role_assignments|INSERT INTO staff_members/i,
  'Tenant membership must not grant Head Office portal access.');

assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_directory_identities/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_directory_sync_checkpoints/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_directory_sync_runs/);
assert.doesNotMatch(migration, /REFERENCES customers|customer_id/i);

assert.match(directoryApi, /directoryMembershipGrantsPortalAccess: false/);
assert.match(directoryApi, /LEFT JOIN staff_directory_identities/);
assert.match(manualSyncApi, /requirePermission\(context, "administration:write"\)/);
assert.match(manualSyncApi, /portalAccessGranted: false/);
assert.match(automaticSyncApi, /AUTOMATION_SECRET/);
assert.match(automaticSyncApi, /customerRecordsAffected: false/);

assert.match(ui, /Synchronise Microsoft tenant/);
assert.match(ui, /Directory membership does not grant portal access/);
assert.match(ui, /\/api\/staff-directory\/sync/);
assert.match(worker, /\/api\/automation\/staff-directory\/sync/);
assert.match(worker, /JA Group Services Microsoft staff tenant/);

console.log('Staff Directory Microsoft tenant sync checks passed.');
