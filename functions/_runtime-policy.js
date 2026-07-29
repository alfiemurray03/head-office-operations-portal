import { error } from "./_shared.js";
import { getSystemSetting } from "./_system-settings.js";

const EMERGENCY_WRITE_PREFIXES = Object.freeze([
  "/api/configuration",
  "/api/system-tests",
  "/api/security/lockdowns",
  "/api/v7/incidents",
  "/api/v7/events"
]);

export async function systemServiceEnabled(env, key, fallback = true) {
  return (await getSystemSetting(env, key, fallback)) !== false;
}

export async function assertSystemServiceEnabled(env, key, label) {
  if (await systemServiceEnabled(env, key, true)) return;
  throw Object.assign(new Error(`${label} is disabled in Head Office System Settings.`), {
    code: "SYSTEM_SERVICE_DISABLED",
    status: 503,
    details: { settingKey: key }
  });
}

export async function portalWritePolicyResponse(env, request) {
  const mode = String(await getSystemSetting(env, "system.portal_mode", "normal") || "normal");
  if (mode === "normal") return null;
  const path = new URL(request.url).pathname;
  if (EMERGENCY_WRITE_PREFIXES.some(prefix => path.startsWith(prefix))) return null;
  if (mode === "read_only") {
    return error("SYSTEM_READ_ONLY", "The Head Office portal is in read-only mode. Normal record changes are temporarily disabled.", 503, { mode });
  }
  return error("SYSTEM_MAINTENANCE_MODE", "The Head Office portal is in maintenance mode. Only configuration, diagnostics and emergency security actions are available.", 503, { mode });
}
