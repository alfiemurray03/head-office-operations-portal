import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [migration, service, syncApi, automationApi, webhook, recordsApi, statusApi, worker, ui, boot] = await Promise.all([
  read('migrations/0012_stripe_reconciliation_and_catalog.sql'),
  read('functions/_stripe-reconciliation.js'),
  read('functions/api/integrations/stripe/sync.js'),
  read('functions/api/automation/stripe/sync.js'),
  read('functions/_stripe-webhook-handler.js'),
  read('functions/api/integrations/stripe/records.js'),
  read('functions/api/integrations/stripe/status.js'),
  read('workers/customer-directory-automation.js'),
  read('public/js/stripe-reconciliation.js'),
  read('public/js/boot.js')
]);

for (const table of [
  'stripe_division_customer_records', 'stripe_division_balance_transactions', 'stripe_division_refund_records',
  'stripe_division_dispute_records', 'stripe_division_product_records', 'stripe_division_price_records',
  'stripe_division_sync_checkpoints', 'stripe_division_sync_runs'
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must exist in the reconciliation migration.`);
}

for (const resource of ['customers','charges','checkout/sessions','subscriptions','refunds','disputes','products','prices','balance_transactions']) {
  assert.match(service, new RegExp(resource.replace('/', '\\/')), `Stripe reconciliation must import ${resource}.`);
}
assert.match(service, /starting_after/, 'Stripe list pagination must use a cursor.');
assert.match(service, /backfill_complete/, 'Historical backfill progress must be persisted.');
assert.match(service, /STRIPE_RECONCILIATION_EVENTS/, 'Required live catalogue, refund and dispute events must be governed.');
assert.match(service, /stripe_division_balance_transactions/, 'The canonical Stripe financial ledger must be retained.');
assert.match(service, /gross_minor[\s\S]*refunds_minor[\s\S]*fees_minor[\s\S]*net_minor/, 'Financial metrics must include gross, refunds, fees and net movement.');

assert.match(syncApi, /configuration:write/, 'Only authorised configuration staff may run a manual Stripe backfill.');
assert.match(syncApi, /integration\.stripe_reconciled/, 'Manual reconciliation must be audited.');
assert.match(automationApi, /AUTOMATION_SECRET/, 'Automatic Stripe reconciliation must require the automation secret.');
assert.match(worker, /\/api\/automation\/stripe\/sync/, 'The hourly automation worker must invoke Stripe reconciliation.');

assert.match(webhook, /processStripeReconciliationEvent/, 'Signed webhooks must update reconciliation records immediately.');
for (const eventType of ['refund.created','refund.updated','refund.failed','charge.dispute.updated','charge.dispute.closed']) {
  assert.match(webhook, new RegExp(eventType.replace('.', '\\.')), `${eventType} must enter the payment risk pipeline.`);
}
assert.match(recordsApi, /customers[\s\S]*transactions[\s\S]*refunds[\s\S]*disputes[\s\S]*products[\s\S]*prices/, 'The records API must expose the full Stripe operating dataset.');
assert.match(statusApi, /stripeReconciliationStatus/, 'The Stripe status API must expose reconciliation metrics.');

assert.match(ui, /Import & reconcile all data/, 'Staff must have a visible historical import control.');
for (const label of ['Customers','Transactions','Refunds','Disputes','Products','Prices']) {
  assert.match(ui, new RegExp(label), `${label} must be visible in the Stripe workspace.`);
}
assert.match(boot, /loadStripeReconciliationModule/, 'The Stripe reconciliation workspace must load during portal startup.');

console.log('Stripe reconciliation regression checks passed.');
