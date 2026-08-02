import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("migrations/0023_ai_customer_service_centre.sql", "utf8");
const schema = fs.readFileSync("functions/_support-centre-schema.js", "utf8");
const platformApi = fs.readFileSync("functions/api/v1/platform/support/[[path]].js", "utf8");
const staffApi = fs.readFileSync("functions/api/support-centre/[[path]].js", "utf8");

for (const table of [
  "support_branch_settings",
  "support_conversations",
  "support_messages",
  "support_conversation_events",
  "support_knowledge_articles",
  "support_knowledge_assignments",
  "support_provider_escalations",
  "support_consents",
  "support_attachments",
  "support_staff_branch_access"
]) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(schema, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}

assert.match(platformApi, /support:\*/);
assert.match(platformApi, /support:read/);
assert.match(platformApi, /support:write/);
assert.match(platformApi, /resolveSupportCustomer/);
assert.match(platformApi, /central_customer_not_found/);
assert.match(platformApi, /ucn_not_found/);
assert.doesNotMatch(platformApi, /SELECT \* FROM customers WHERE verified_email=/);
assert.match(platformApi, /visibility='customer'/);
assert.match(platformApi, /conversation\.escalated/);
assert.match(platformApi, /allocateCaseReference/);
assert.match(platformApi, /data_protection/);
assert.match(platformApi, /safeguarding/);
assert.match(platformApi, /complaint_records/);
assert.match(platformApi, /marker_reason/);

assert.match(staffApi, /support_staff_branch_access/);
assert.match(staffApi, /SUPPORT_BRANCH_ACCESS_DENIED/);
assert.match(staffApi, /support\.conversation\.read/);
assert.match(staffApi, /support\.conversation\.takeover/);
assert.match(staffApi, /visibility === "internal"/);
assert.match(staffApi, /WHERE conversation_id=\? ORDER BY created_at,id/);
assert.match(staffApi, /configuration:write/);

console.log("AI Customer Service Centre foundation contract checks passed.");
