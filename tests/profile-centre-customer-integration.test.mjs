import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("migrations/0022_profile_centre_customer_integration.sql","utf8");
const upsert = fs.readFileSync("functions/api/platform/customers/upsert.js","utf8");
const events = fs.readFileSync("functions/api/v1/platform/events.js","utf8");
const customerApi = fs.readFileSync("functions/api/customers/[id].js","utf8");
const workspace = fs.readFileSync("public/js/customer-record-workspace.js","utf8");

assert.match(migration,/UNIQUE INDEX[\s\S]*platform_id, external_account_id/i,"Platform account links must be unique and retry-safe.");
assert.match(migration,/platform_reconciliation_failures/,"Unresolved matches must be retained for review.");
assert.match(migration,/UNIQUE\(platform_id, external_event_id\)/,"Event IDs must be idempotent per platform.");
assert.match(upsert,/central_customer_id/);
assert.match(upsert,/customerNumber/);
assert.match(upsert,/platform_person/);
assert.doesNotMatch(upsert,/match:"verified_email"/,"Email must not be an authoritative automatic match.");
assert.match(events,/PLATFORM_ACCOUNT_NOT_LINKED/);
assert.match(events,/CUSTOMER_EVENT_CORRELATION_MISMATCH/);
assert.match(events,/INSUFFICIENT_PLATFORM_SCOPE/);
assert.match(events,/duplicate:true/);
assert.match(events,/sourcePlatform:"Profile Centre"/);
assert.match(customerApi,/synchronisation_status/);
assert.match(workspace,/Open Profile Centre record/);
assert.match(workspace,/platform_name/);

console.log("Profile Centre customer integration contract checks passed.");
