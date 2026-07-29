import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { canonicalDiditJson, verifyDiditWebhookRequest } from '../functions/_didit-webhook.js';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [handler, helper, migration] = await Promise.all([
  read('functions/api/webhooks/didit.js'),
  read('functions/_didit-webhook.js'),
  read('migrations/0009_didit_identity_verification.sql')
]);

assert.match(handler, /verifyDiditWebhookRequest\(context\.request, context\.env\)/, 'The live route must verify the original request before processing.');
assert.match(handler, /DIDIT_WEBHOOK_PROCESSING_FAILED[\s\S]*503/, 'A processing failure must return 5xx so Didit retries.');
assert.match(handler, /processDiditWebhook\(context\.env, verified\)/, 'A verified event must update the central customer record before acknowledgement.');
assert.match(handler, /duplicate: !accepted\.accepted/, 'Repeated deliveries must be handled idempotently.');

assert.match(helper, /request\.arrayBuffer\(\)/, 'The webhook must read the raw request body before parsing JSON.');
assert.match(helper, /X-Signature-V2/, 'Didit v3 X-Signature-V2 must be required.');
assert.match(helper, /MAX_CLOCK_SKEW_SECONDS = 300/, 'Didit webhook timestamps must be restricted to five minutes.');
assert.match(helper, /canonicalDiditJson/, 'The Unicode-preserved recursively sorted JSON must be canonicalised.');
assert.match(helper, /ON CONFLICT\(event_id\) DO NOTHING/, 'Webhook delivery must be idempotent by event ID.');
assert.match(helper, /payload_hash/, 'The payload must be fingerprinted without retaining raw identity evidence.');
assert.match(helper, /REQUIRE_ENHANCED_VERIFICATION/, 'Approved Didit results must be linked only to the enhanced-verification control.');
assert.match(helper, /status='lifted'/, 'An approved linked verification must lift the enhanced-verification restriction.');
assert.match(helper, /IDENTITY_VERIFICATION_DECLINED/, 'A declined verification must create a central fraud/security signal.');
assert.doesNotMatch(helper, /X-Signature-Simple/, 'The fallback signature must not be used because it does not authenticate the decision body.');
assert.doesNotMatch(helper, /JSON\.stringify\(payload\.decision\)/, 'Full Didit decision evidence must not be copied into operational metadata.');

for (const table of ['identity_verification_sessions', 'identity_verification_webhook_events']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must exist in the D1 migration.`);
}
assert.match(migration, /provider_session_id TEXT NOT NULL UNIQUE/, 'Didit sessions must be unique by provider session ID.');
assert.match(migration, /event_id TEXT PRIMARY KEY/, 'Didit events must have a durable idempotency key.');

const payload = {
  webhook_type: 'status.updated',
  status: 'In Review',
  session_id: '11111111-2222-3333-4444-555555555555',
  timestamp: Math.floor(Date.now() / 1000),
  vendor_data: 'ucn:1000000001',
  metadata: { surname: 'Müller', city: 'São Paulo', nested: { z: 1, a: 2 } },
  decision: { warnings: [{ text: 'José 日本' }], score: 95.5 }
};

function independentSort(value) {
  if (Array.isArray(value)) return value.map(independentSort);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, independentSort(value[key])]));
}

const canonical = JSON.stringify(independentSort(payload));
assert.equal(canonicalDiditJson(payload), canonical, 'Canonical JSON must sort nested keys while preserving Unicode.');
const secret = 'test-webhook-secret-not-for-production';
const signature = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
const request = new Request('https://customerops.example/api/webhooks/didit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Timestamp': String(payload.timestamp),
    'X-Signature-V2': signature
  },
  body: JSON.stringify(payload)
});
const verified = await verifyDiditWebhookRequest(request, { DIDIT_WEBHOOK_SECRET: secret });
assert.equal(verified.sessionId, payload.session_id);
assert.equal(verified.webhookType, 'status.updated');
assert.equal(verified.status, 'In Review');

const stalePayload = { ...payload, timestamp: payload.timestamp - 301 };
const staleCanonical = JSON.stringify(independentSort(stalePayload));
const staleSignature = crypto.createHmac('sha256', secret).update(staleCanonical).digest('hex');
await assert.rejects(
  verifyDiditWebhookRequest(new Request('https://customerops.example/api/webhooks/didit', {
    method: 'POST',
    headers: { 'X-Timestamp': String(stalePayload.timestamp), 'X-Signature-V2': staleSignature },
    body: JSON.stringify(stalePayload)
  }), { DIDIT_WEBHOOK_SECRET: secret }),
  error => error?.code === 'DIDIT_TIMESTAMP_REJECTED'
);

await assert.rejects(
  verifyDiditWebhookRequest(new Request('https://customerops.example/api/webhooks/didit', {
    method: 'POST',
    headers: { 'X-Timestamp': String(payload.timestamp), 'X-Signature-V2': '0'.repeat(64) },
    body: JSON.stringify(payload)
  }), { DIDIT_WEBHOOK_SECRET: secret }),
  error => error?.code === 'DIDIT_SIGNATURE_INVALID'
);

console.log('Didit webhook security regression checks passed.');
