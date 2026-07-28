import { audit, cleanText, error, json, readJson } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import { ensureCentralPlatformSchema, jsonValue } from "../_central-schema.js";

const HEALTH_STATUSES = new Set(["awaiting_connection", "operational", "degraded", "maintenance", "offline"]);
const ENVIRONMENTS = new Set(["production", "preview", "development", "staging", "test"]);

function cleanCode(value) {
  return cleanText(value, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function cleanUrl(value) {
  const text = cleanText(value, 500);
  if (!text) return null;
  let parsed;
  try { parsed = new URL(text); }
  catch { throw Object.assign(new Error("Enter a valid public website URL."), { code: "INVALID_PLATFORM_URL", status: 400 }); }
  if (parsed.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    throw Object.assign(new Error("Connected production websites must use HTTPS."), { code: "INVALID_PLATFORM_URL", status: 400 });
  }
  return parsed.toString().replace(/\/$/, "");
}

function parseCapabilities(value) {
  if (Array.isArray(value)) return [...new Set(value.map(item => cleanText(item, 100)).filter(Boolean))].slice(0, 100);
  return [...new Set(String(value || "").split(/[\n,]/).map(item => cleanText(item, 100)).filter(Boolean))].slice(0, 100);
}

function parseJsonObject(value, label) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw Object.assign(new Error(`${label} must be a valid JSON object.`), { code: "INVALID_PLATFORM_CONFIGURATION", status: 400 });
  }
}

export const onRequestGet = async context => {
  await ensureCentralPlatformSchema(context.env);
  const auth = await requirePermission(context, "platforms:read");
  if (auth.response) return auth.response;
  const result = await context.env.DB.prepare(`SELECT p.id,p.code,p.name,p.status,p.last_health_check_at,p.created_at,
    COUNT(DISTINCT c.id) credential_count,
    SUM(CASE WHEN c.status='active' THEN 1 ELSE 0 END) active_credential_count,
    MAX(c.last_used_at) last_api_activity_at,
    o.public_url,o.environment,o.hosting_provider,o.release_version,o.release_commit,o.health_status,o.health_message,
    o.capabilities_json,o.integrations_json,o.customer_count,o.active_session_count,o.open_error_count,
    o.last_heartbeat_at,o.last_deployment_at,o.last_customer_sync_at,o.metadata_json
    FROM platforms p
    LEFT JOIN platform_api_credentials c ON c.platform_id=p.id
    LEFT JOIN platform_operational_profiles o ON o.platform_id=p.id
    WHERE p.status!='disabled'
    GROUP BY p.id ORDER BY p.name`).all();
  return json({ platforms: result.results.map(row => ({
    ...row,
    capabilities: (()=>{try{return JSON.parse(row.capabilities_json||"[]");}catch{return[];}})(),
    integrations: (()=>{try{return JSON.parse(row.integrations_json||"{}");}catch{return{};}})(),
    metadata: (()=>{try{return JSON.parse(row.metadata_json||"{}");}catch{return{};}})()
  })) });
};

export const onRequestPost = async context => {
  await ensureCentralPlatformSchema(context.env);
  const auth = await requirePermission(context, "platforms:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request, 96_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    const name = cleanText(body.name, 120);
    const code = cleanCode(body.code);
    const environment = cleanText(body.environment || "production", 40).toLowerCase();
    const healthStatus = cleanText(body.healthStatus || "awaiting_connection", 40).toLowerCase();
    if (name.length < 2 || code.length < 2) return error("INVALID_PLATFORM", "Enter a valid system name and code.");
    if (!ENVIRONMENTS.has(environment)) return error("INVALID_PLATFORM_ENVIRONMENT", "Select a valid environment.");
    if (!HEALTH_STATUSES.has(healthStatus)) return error("INVALID_PLATFORM_HEALTH", "Select a valid health status.");

    const publicUrl = cleanUrl(body.publicUrl);
    const hostingProvider = cleanText(body.hostingProvider, 120) || null;
    const releaseVersion = cleanText(body.releaseVersion, 120) || null;
    const releaseCommit = cleanText(body.releaseCommit, 120) || null;
    const healthMessage = cleanText(body.healthMessage, 1000) || "Connector registered; awaiting its first secure heartbeat.";
    const capabilities = parseCapabilities(body.capabilities);
    const integrations = parseJsonObject(body.integrations || body.integrationsJson, "Integrations");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    try {
      await context.env.DB.batch([
        context.env.DB.prepare("INSERT INTO platforms (id,code,name,status,created_at,updated_at) VALUES (?,?,?,'setup',?,?)")
          .bind(id, code, name, now, now),
        context.env.DB.prepare(`INSERT INTO platform_operational_profiles
          (platform_id,public_url,environment,hosting_provider,release_version,release_commit,health_status,health_message,
           capabilities_json,integrations_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(id, publicUrl, environment, hostingProvider, releaseVersion, releaseCommit, healthStatus,
            healthMessage, jsonValue(capabilities, []), jsonValue(integrations, {}), now, now)
      ]);
    } catch (cause) {
      if (String(cause).includes("platforms.code")) return error("DUPLICATE_PLATFORM_CODE", "That system code is already in use.", 409);
      throw cause;
    }

    await audit(context.env, auth.session, "platform.create", "platform", id, {
      label: "Connected system registered",
      reference: code,
      requestId: context.data.requestId,
      after: { code, name, status: "setup", publicUrl, environment, hostingProvider, releaseVersion, releaseCommit, healthStatus, healthMessage, capabilities, integrations }
    });
    return json({ id, code }, 201);
  } catch (cause) {
    return error(cause.code || "PLATFORM_CREATE_FAILED", cause.message || "The connected system could not be registered.", cause.status || 500);
  }
};
