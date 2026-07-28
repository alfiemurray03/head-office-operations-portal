import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../public/js/customer-record-workspace.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../public/customer-record-workspace.css', import.meta.url), 'utf8');
const overrides = await readFile(new URL('../public/js/v7-overrides.js', import.meta.url), 'utf8');

assert.match(workspace, /window\.renderCustomerRecordWorkspace\s*=/, 'Customer workspace renderer must be defined.');
assert.match(overrides, /resolvedRoute\.startsWith\('customers\/'\)/, 'Customer detail routes must be handled as workspace pages.');
assert.match(overrides, /openCustomer\s*=\s*function\(id\)/, 'Customer row opening must navigate to the workspace route.');
assert.match(overrides, /customer-record-workspace\.js/, 'The customer workspace module must be loaded.');
assert.match(styles, /\.customer-record-layout/, 'The full customer record layout must be styled.');
assert.match(styles, /overflow:\s*visible/, 'Customer record sections must not introduce nested scrolling.');
assert.doesNotMatch(workspace, /openModal\s*\(/, 'The customer file itself must never open as a modal.');
assert.doesNotMatch(workspace, /<table/i, 'The customer workspace must not force wide tables into the record page.');

console.log('Customer record workspace regression checks passed.');
