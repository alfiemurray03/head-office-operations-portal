import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('migrations/0014_separate_staff_directory.sql', 'utf8');
const api = fs.readFileSync('functions/api/staff-directory.js', 'utf8');
const helper = fs.readFileSync('functions/_staff-directory.js', 'utf8');
const ui = fs.readFileSync('public/js/staff-directory.js', 'utf8');
const loader = fs.readFileSync('public/js/views-control.js', 'utf8');
const authorityApi = fs.readFileSync('functions/api/staff-directory/portal-access.js', 'utf8');
const authorityUi = fs.readFileSync('public/js/staff-portal-access.js', 'utf8');
const extensionLoader = fs.readFileSync('public/js/automation-settings-extension.js', 'utf8');

assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_directory_profiles/);
assert.match(migration, /staff_number TEXT NOT NULL UNIQUE/);
assert.match(migration, /linked_staff_member_id TEXT UNIQUE REFERENCES staff_members\(id\)/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS staff_manual_reviews/);
assert.doesNotMatch(migration, /REFERENCES customers/i, 'Staff records must not have a customer foreign key.');
assert.doesNotMatch(migration, /customer_id TEXT/i, 'Staff profiles must not carry customer IDs.');

assert.match(api, /matchingCustomerEmailAllowed: true/);
assert.match(api, /automaticCustomerLinking: false/);
assert.match(api, /automaticChecks: false/);
assert.match(api, /staffNumberSeparateFromUcn: true/);
assert.match(api, /prepareStaffDirectory/);
assert.match(api, /ensureStaffDirectoryReady/);
assert.doesNotMatch(api, /FROM customers|JOIN customers|UPDATE customers|INSERT INTO customers/i,
  'The Staff Directory API must never read, write, merge or validate against customer records.');
assert.match(api, /action === "open_review"/);
assert.match(api, /automatic: false/);

assert.match(helper, /STF-\$\{String/);
assert.match(helper, /ensureStaffDirectoryProfiles/);
assert.match(helper, /ensureStaffDirectoryReady/);
assert.match(helper, /initialiseStaffDirectorySchema/);
assert.match(helper, /CREATE TABLE IF NOT EXISTS staff_directory_profiles/);
assert.match(helper, /CREATE TABLE IF NOT EXISTS staff_manual_reviews/);
assert.match(helper, /CREATE TABLE IF NOT EXISTS staff_number_sequences/);
assert.doesNotMatch(helper, /customers/i, 'Staff helper code must not depend on the customer register.');

assert.match(ui, /Staff is staff\. Customer is customer\./);
assert.match(ui, /same email may appear/i);
assert.match(ui, /No automatic checks are created/i);
assert.match(ui, /Manual staff assurance reviews/);
assert.match(loader, /staff-directory\.js/);

assert.match(authorityApi, /requirePermission\(context, "administration:write"\)/);
assert.match(authorityApi, /staff_directory_identities/);
assert.match(authorityApi, /INSERT INTO staff_members/);
assert.match(authorityApi, /INSERT INTO staff_role_assignments/);
assert.match(authorityApi, /Microsoft staff identity is disabled or deleted/);
assert.match(authorityApi, /SELF_ADMIN_ROLE_REMOVAL_BLOCKED/);
assert.match(authorityApi, /LAST_SYSTEM_ADMINISTRATOR_PROTECTED/);
assert.match(authorityApi, /customerRecordIndependent: true/);
assert.doesNotMatch(authorityApi, /FROM customers|JOIN customers|UPDATE customers|INSERT INTO customers/i,
  'Granting portal authority from Staff Directory must never touch the customer register.');
assert.match(authorityUi, /Grant Head Office portal access/);
assert.match(authorityUi, /Head Office roles and security permissions/);
assert.match(authorityUi, /never creates, links or changes a customer account or UCN/);
assert.match(extensionLoader, /staff-portal-access\.js/);

console.log('Staff Directory separation and runtime readiness checks passed.');
