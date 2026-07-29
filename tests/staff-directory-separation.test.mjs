import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('migrations/0014_separate_staff_directory.sql', 'utf8');
const api = fs.readFileSync('functions/api/staff-directory.js', 'utf8');
const helper = fs.readFileSync('functions/_staff-directory.js', 'utf8');
const ui = fs.readFileSync('public/js/staff-directory.js', 'utf8');
const loader = fs.readFileSync('public/js/views-control.js', 'utf8');

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
assert.doesNotMatch(api, /FROM customers|JOIN customers|UPDATE customers|INSERT INTO customers/i,
  'The Staff Directory API must never read, write, merge or validate against customer records.');
assert.match(api, /action === "open_review"/);
assert.match(api, /automatic: false/);

assert.match(helper, /STF-\$\{String/);
assert.match(helper, /ensureStaffDirectoryProfiles/);
assert.doesNotMatch(helper, /customers/i, 'Staff helper code must not depend on the customer register.');

assert.match(ui, /Staff is staff\. Customer is customer\./);
assert.match(ui, /same email may appear/i);
assert.match(ui, /No automatic checks are created/i);
assert.match(ui, /Manual staff assurance reviews/);
assert.match(loader, /staff-directory\.js/);

console.log('Staff Directory separation checks passed.');
