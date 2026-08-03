import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../functions/api/platforms/[id]/credentials.js', import.meta.url),
  'utf8',
);

test('JA Group Services website credentials include central customer profile scopes', () => {
  assert.match(source, /platform\.code === "JA_GROUP_SERVICES"/);
  assert.match(source, /requested\.includes\("support:read"\)/);
  assert.match(source, /requested\.includes\("support:write"\)/);
  assert.match(source, /scopes\.push\("customers:read", "customers:write"\)/);
});

test('credential audit records requested and policy-added scopes', () => {
  assert.match(source, /requestedScopes: requested/);
  assert.match(source, /policyAddedScopes/);
  assert.match(source, /JSON\.stringify\(scopes\)/);
});
