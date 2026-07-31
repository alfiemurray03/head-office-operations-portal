import assert from "node:assert/strict";
import fs from "node:fs";

const migration = fs.readFileSync("migrations/0020_profile_centre_platform_onboarding.sql", "utf8");
const contract = fs.readFileSync("docs/PROFILE_CENTRE_PLATFORM_ONBOARDING.md", "utf8");
const age = fs.readFileSync("functions/_age-assurance.js", "utf8");

assert.match(migration, /code = 'PROFILE_CENTRE'/);
assert.match(migration, /Profile Centre/);
assert.match(migration, /DIV-020/);
assert.match(migration, /profilecentre\.jagroupservices\.co\.uk/);
assert.match(migration, /staffAccountsExcluded/);
assert.match(migration, /ageEnforcementEnabled":false/);
assert.match(contract, /customers:write/);
assert.match(contract, /security:read/);
assert.match(contract, /events:write/);
assert.match(contract, /confidential case reasoning is never/);
assert.match(age, /PROFILE_CENTRE/);
assert.match(age, /definition\.code === "PLANYX" \? 16 : 18/);

console.log("Profile Centre platform onboarding contract checks passed.");
