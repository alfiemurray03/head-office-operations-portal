import { audit, cleanText, error, json, readJson } from "../../_shared.js";
import { requirePermission } from "../../_operations.js";
import { ensureCentralPlatformSchema, jsonValue } from "../../_central-schema.js";

const PLATFORM_STATUSES = new Set(["setup", "active", "degraded", "offline"]);
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

function parseCapabilities(value) {
  if (Array.isArray(value)) return [...new Set(value.map(item => cleanText(item, 100)).filter(Boolean))].slice(0, 100);
  return [...new Set(String(value || "").split(/[\n,]/).map(item => cleanText(item, 100)).filter(Boolean))].slice(0, 100);
}

async function findPlatform(env, id) {
  return env.DB.prepare(`SELECT p.*,o.public_url,o.environment,o.hosting_provider,o.release_version,o.release_commit,
      o.health_status,o.health_message,o.capabilities_json,o.integrations_json,o.metadata_json
    FROM platforms p LEFT JOIN platform_operational_profiles o ON o.platform_id=p.id
    WHERE p.id=? LIMIT 1`).bind(id).first();
}

export const onRequestGet = async context => {
  await ensureCentralPlatformSchema(context.env);
  const auth = await requirePermission(context, "platforms:read");
  if (auth.response) return auth.response;
  const platform = await findPlatform(context.env, context.params.id);
  if (!platform || platform.status === "disabled") return error("PLATFORM_NOT_FOUND", "The connected system was not found.", 404);
  return json({
    platform: {
      ...platform,
      capabilities: (() => { try { return JSON.parse(platform.capabilities_json || "[]"); } catch { return []; } })(),
      integrations: (() => { try { return JSON.parse(platform.integrations_json || "{}"); } catch { return {}; } })(),
      metadata: (() => { try { return JSON.parse(platform.metadata_json || "{}"); } catch { return {}; } })()
    }
  });
};

export const onRequestPut = async context => {
  await ensureCentralPlatformSchema(context.env);
  const auth = await requirePermission(context, "platforms:write");
  if (auth.response) return auth.response;
  const existing = await findPlatform(context.env, context.params.id);
  if (!existing || existing.status === "disabled") return error("PLATFORM_NOT_FOUND", "The connected system was not found.", 404);
  let body;
  try { body = await readJson(context.request, 96_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  try {
    const name = cleanText(body.name ?? existing.name, 120);
    const code = cleanCode(body.code ?? existing.code);
    const status = cleanText(body.status ?? existing.status, 30);
    const environment = cleanText(body.environment ?? existing.environment ?? "production", 40).toLowerCase();
    const healthStatus = cleanText(body.healthStatus ?? existing.health_status ?? "awaiting_connection", 40).toLowerCase();
    if (name.length < 2 || code.length < 2) return error("INVALID_PLATFORM", "Enter a valid system name and code.");
    if (!PLATFORM_STATUSES.has(status)) return error("INVALID_PLATFORM_STATUS", "Select a valid connected-system status.");
    if (!ENVIRONMENTS.has(environment)) return error("INVALID_PLATFORM_ENVIRONMENT", "Select a valid environment.");
    if (!HEALTH_STATUSES.has(healthStatus)) return error("INVALID_PLATFORM_HEALTH", "Select a valid health status.");

    const publicUrl = cleanUrl(body.publicUrl ?? existing.public_url);
    const hostingProvider = cleanText(body.hostingProvider ?? existing.hosting_provider, 120) || null;
    const releaseVersion = cleanText(body.releaseVersion ?? existing.release_version, 120) || null;
    const releaseCommit = cleanText(body.releaseCommit ?? existing.release_commit, 120) || null;
    const healthMessage = cleanText(body.healthMessage ?? existing.health_message, 1000) || null;
    const capabilities = parseCapabilities(body.capabilities ?? existing.capabilities_json);
    const integrations = parseJsonObject(body.integrations ?? body.integrationsJson ?? existing.integrations_json, "Integrations");
    const metadata = parseJsonObject(body.metadata ?? body.metadataJson ?? existing.metadata_json, "Metadata");
    const now = new Date().toISOString();

    try {
      await context.env.DB.batch([
        context.env.DB.prepare("UPDATE platforms SET code=?,name=?,status=?,updated_at=? WHERE id=?")
          .bind(code, name, status, now, existing.id),
        context.env.DB.prepare(`INSERT INTO platform_operational_profiles
          (platform_id,public_url,environment,hosting_provider,release_version,release_commit,health_status,health_message,
           capabilities_json,integrations_json,metadata_json,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(platform_id) DO UPDATE SET public_url=excluded.public_url,environment=excluded.environment,
            hosting_provider=excluded.hosting_provider,release_version=excluded.release_version,
            release_commit=excluded.release_commit,health_status=excluded.health_status,
            health_message=excluded.health_message,capabilities_json=excluded.capabilities_json,
            integrations_json=excluded.integrations_json,metadata_json=excluded.metadata_json,updated_at=excluded.updated_at`)
          .bind(existing.id, publicUrl, environment, hostingProvider, releaseVersion, releaseCommit, healthStatus,
            healthMessage, jsonValue(capabilities, []), jsonValue(integrations, {}), jsonValue(metadata, {}),
            existing.created_at || now, now)
      ]);
    } catch (cause) {
      if (String(cause).includes("platforms.code")) return error("DUPLICATE_PLATFORM_CODE", "That system code is already in use.", 409);
      throw cause;
    }

    await audit(context.env, auth.session, "platform.configuration.update", "platform", existing.id, {
      label: "Connected-system configuration updated",
      reference: code,
      requestId: context.data.requestId,
      before: { name: existing.name, code: existing.code, status: existing.status, publicUrl: existing.public_url, hostingProvider: existing.hosting_provider },
      after: { name, code, status, publicUrl, environment, hostingProvider, releaseVersion, releaseCommit, healthStatus, healthMessage, capabilities, integrations }
    });
    return json({ updated: true, id: existing.id, code });
  } catch (cause) {
    return error(cause.code || "PLATFORM_UPDATE_FAILED", cause.message || "The connected-system configuration could not be updated.", cause.status || 500);
  }
};

export const onRequestDelete = async context => {
  await ensureCentralPlatformSchema(context.env);
  const auth = await requirePermission(context, "platforms:write");
  if (auth.response) return auth.response;
  const existing = await findPlatform(context.env, context.params.id);
  if (!existing || existing.status === "disabled") return error("PLATFORM_NOT_FOUND", "The connected system was not found.", 404);
  let body = {};
  try { body = await readJson(context.request, 16_000); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const confirmation = cleanText(body.confirmation, 120);
  if (confirmation !== existing.name && confirmation !== existing.code) {
    return error("PLATFORM_DELETE_CONFIRMATION_REQUIRED", "Enter the exact system name or code to delete its configuration.", 400);
  }

  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(`UPDATE platform_api_credentials SET status='revoked',revoked_by=?,revoked_at=?
      WHERE platform_id=? AND status='active'`).bind(auth.session.sub, now, existing.id),
    context.env.DB.prepare(`UPDATE platform_enforcement_commands SET status='cancelled',acknowledged_at=COALESCE(acknowledged_at,?)
      WHERE platform_id=? AND status IN ('pending','delivered')`).bind(now, existing.id),
    context.env.DB.prepare("DELETE FROM platform_operational_profiles WHERE platform_id=?").bind(existing.id),
    context.env.DB.prepare("UPDATE platforms SET status='disabled',updated_at=? WHERE id=?").bind(now, existing.id)
  ]);

  await audit(context.env, auth.session, "platform.configuration.delete", "platform", existing.id, {
    label: "Connected-system configuration deleted",
    reference: existing.code,
    requestId: context.data.requestId,
    before: { name: existing.name, code: existing.code, status: existing.status, publicUrl: existing.public_url, hostingProvider: existing.hosting_provider },
    after: { status: "disabled", credentialsRevoked: true, operationalConfigurationDeleted: true }
  });
  return json({ deleted: true, id: existing.id });
};
