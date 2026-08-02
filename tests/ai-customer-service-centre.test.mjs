import assert from "node:assert/strict";
import fs from "node:fs";
import {
  normaliseSupportCategory,
  safeObject,
  isLiveSupportPlatform
} from "../functions/_support-centre-schema.js";

const migration = fs.readFileSync("migrations/0023_ai_customer_service_centre.sql", "utf8");
const schema = fs.readFileSync("functions/_support-centre-schema.js", "utf8");
const platformApi = fs.readFileSync("functions/api/v1/platform/support/[[path]].js", "utf8");
const staffApi = fs.readFileSync("functions/api/support-centre/[[path]].js", "utf8");
const portal = fs.readFileSync("public/index.html", "utf8");

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

assert.equal(normaliseSupportCategory("Data Protection"), "data_protection");
assert.equal(normaliseSupportCategory("subject access request"), "data_protection");
assert.equal(normaliseSupportCategory("Young Person"), "safeguarding");
assert.equal(normaliseSupportCategory("suspected account compromise"), "security");
assert.equal(normaliseSupportCategory("Sign-in"), "account_recovery");
assert.equal(isLiveSupportPlatform({ code: "PLANYX", name: "Planyx" }), true);
assert.equal(isLiveSupportPlatform({ code: "PROFILE_CENTRE", name: "Profile Centre" }), true);
assert.equal(isLiveSupportPlatform({ code: "UNRELATED", name: "Unrelated integration" }), false);

const safeMetadata = safeObject({
  appearance: { theme: "navy", layout: { density: "compact" }, secret: "must-not-survive" },
  operatingHours: { monday: ["09:00", "17:00"] },
  markerReason: "restricted",
  authorisationToken: "restricted"
});
assert.deepEqual(safeMetadata.appearance, { theme: "navy", layout: { density: "compact" } });
assert.deepEqual(safeMetadata.operatingHours, { monday: ["09:00", "17:00"] });
assert.equal("markerReason" in safeMetadata, false);
assert.equal("authorisationToken" in safeMetadata, false);

assert.match(platformApi, /support:\*/);
assert.match(platformApi, /support:read/);
assert.match(platformApi, /support:write/);
assert.match(platformApi, /support:ai/);
assert.match(platformApi, /SUPPORT_AI_SENDER_NOT_AUTHORISED/);
assert.match(platformApi, /assistantEnabled/);
assert.match(platformApi, /Head Office Customer Service/);
assert.match(platformApi, /addHumanAcknowledgement/);
assert.match(platformApi, /resolveSupportCustomer/);
assert.match(platformApi, /normaliseSupportCategory/);
assert.match(platformApi, /central_customer_not_found/);
assert.match(platformApi, /ucn_not_found/);
assert.doesNotMatch(platformApi, /SELECT \* FROM customers WHERE verified_email=/);
assert.match(platformApi, /visibility='customer'/);
assert.match(platformApi, /SUPPORT_AI_STANDBY/);
assert.match(platformApi, /HUMAN_ONLY_CATEGORIES/);
assert.match(platformApi, /human_pending/);
assert.match(platformApi, /conversation\.escalated/);
assert.match(platformApi, /allocateCaseReference/);
assert.match(platformApi, /data_protection/);
assert.match(platformApi, /safeguarding/);
assert.match(platformApi, /complaint_records/);
assert.match(platformApi, /created_by,created_at\)[\s\S]*NULL/);
assert.match(platformApi, /duplicate: true/);
assert.match(platformApi, /PLATFORM_SENDERS = new Set\(\["customer", "ai"\]\)/);
assert.doesNotMatch(platformApi, /PLATFORM_SENDERS = new Set\([^\n]*"system"/);

assert.match(schema, /ensureSupportCredentialScopes/);
assert.match(schema, /support:read/);
assert.match(schema, /support:write/);
assert.match(schema, /support:ai/);
assert.match(schema, /assistant_enabled,ai_enabled[\s\S]*VALUES \(\?,\?,1,\?/);
assert.match(schema, /retention_days INTEGER NOT NULL DEFAULT 180/);
assert.match(schema, /marker\[ _-\]\?reason/);
assert.match(schema, /safeguarding\[ _-\]\?detail/);
assert.match(schema, /depth > 3/);

assert.match(staffApi, /support_staff_branch_access/);
assert.match(staffApi, /SUPPORT_BRANCH_ACCESS_DENIED/);
assert.match(staffApi, /DPO_RESTRICTED/);
assert.match(staffApi, /SAFEGUARDING_RESTRICTED/);
assert.match(staffApi, /SECURITY_OFFICER/);
assert.match(staffApi, /COMPLAINTS_MANAGER/);
assert.match(staffApi, /support\.conversation\.read/);
assert.match(staffApi, /support\.conversation\.takeover/);
assert.match(staffApi, /SUPPORT_CONVERSATION_ALREADY_ASSIGNED/);
assert.match(staffApi, /async function resolveSupportStaffId/);
assert.match(staffApi, /external_identity_id=\?/);
assert.match(staffApi, /SUPPORT_STAFF_IDENTITY_REQUIRED/);
assert.match(staffApi, /COALESCE\(assigned_staff_id,\?\)[\s\S]*?\.bind\(authorised\.staffId, visibility/);
assert.match(staffApi, /assigned_staff_id=\?,status='assigned'[\s\S]*?\.bind\(authorised\.staffId, now/);
assert.doesNotMatch(staffApi, /assigned_staff_id=COALESCE\(assigned_staff_id,\?\)[\s\S]{0,250}\.bind\(auth\.session\.sub/);
assert.match(staffApi, /SUPPORT_NOTE_VISIBILITY_DENIED/);
assert.match(staffApi, /visibility IN \('customer','branch_internal'\)/);
assert.match(staffApi, /requested === "internal"/);
assert.match(staffApi, /head_office/);
assert.match(staffApi, /SUPPORT_AI_RESTRICTED_CATEGORY/);
assert.match(staffApi, /configuration:write/);
assert.match(staffApi, /escalationRules/);

assert.match(portal, /professional-interface\.js/);

console.log("Customer Service Centre foundation and live activation contract checks passed.");
