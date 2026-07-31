import assert from "node:assert/strict";
import test from "node:test";
import { PRINCIPAL_ROLE, clearPrincipalSessionCookie, hasFreshPrincipalAuthentication, principalSessionCookie, validatePreferences, validateProfile } from "../functions/_principal-identity.js";

test("the Portal authority role is the equal principal role", () => {
  assert.equal(PRINCIPAL_ROLE, "HEAD_OFFICE_PRINCIPAL");
});

test("opaque principal cookies are host-only, secure and unavailable to JavaScript", () => {
  const value = principalSessionCookie("opaque-token");
  assert.match(value, /^__Host-ho_session=/);
  assert.match(value, /HttpOnly/);
  assert.match(value, /Secure/);
  assert.match(value, /SameSite=Lax/);
  assert.doesNotMatch(value, /Domain=/);
  assert.match(clearPrincipalSessionCookie(), /Max-Age=0/);
});

test("dashboard preferences accept only known non-executable widget identifiers", () => {
  const value = validatePreferences({ dashboard: {
    widgets: ["security_overview", "<script>alert(1)</script>", "security_overview"],
    hidden: ["active_incidents", "javascript:alert(1)"], pinnedPlatforms: ["platform-1"], pinnedIncidents: ["INC-1"]
  }});
  assert.deepEqual(value.dashboard.widgets, ["security_overview"]);
  assert.deepEqual(value.dashboard.hidden, ["active_incidents"]);
});

test("profile validation cannot mass-assign authority", () => {
  const value = validateProfile({ preferredName: "Alfie", displayName: "Alfie Murray", roleCode: "SYSTEM_ADMINISTRATOR", jobTitles: ["Head Office Principal"] });
  assert.equal(value.preferredName, "Alfie");
  assert.equal(value.roleCode, undefined);
});

test("critical actions distinguish recent authentication from stale sessions", () => {
  assert.equal(hasFreshPrincipalAuthentication({ lastMfaAt: new Date().toISOString() }), true);
  assert.equal(hasFreshPrincipalAuthentication({ lastMfaAt: new Date(Date.now() - 20 * 60 * 1000).toISOString() }), false);
});

test("migration defines separate principals and prevents self approval", async () => {
  const source = await import("node:fs/promises").then(fs => fs.readFile(new URL("../migrations/0021_head_office_principals.sql", import.meta.url), "utf8"));
  assert.match(source, /HOP-USER-001/);
  assert.match(source, /HOP-USER-002/);
  assert.match(source, /entra_object_id/);
  assert.match(source, /approved_by_user_id <> requested_by_user_id/);
  assert.doesNotMatch(source, /pending-identity@/);
});

test("browser code does not store or transport a Portal session token", async () => {
  const fs = await import("node:fs/promises");
  const core = await fs.readFile(new URL("../public/js/core.js", import.meta.url), "utf8");
  const boot = await fs.readFile(new URL("../public/js/boot.js", import.meta.url), "utf8");
  const callback = await fs.readFile(new URL("../functions/api/auth/microsoft/callback.js", import.meta.url), "utf8");
  assert.doesNotMatch(core, /sessionStorage\.setItem/);
  assert.doesNotMatch(boot, /auth_session/);
  assert.doesNotMatch(callback, /auth_session/);
});
