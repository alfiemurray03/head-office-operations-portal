import { audit, cleanText, error, json, readJson } from "../_shared.js";
import { requirePermission } from "../_operations.js";
import { ensureCentralPlatformSchema } from "../_central-schema.js";

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
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const name = cleanText(body.name, 120);
  const code = cleanText(body.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (name.length < 2 || code.length < 2) return error("INVALID_PLATFORM", "Enter a valid platform name and code.");
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await context.env.DB.prepare("INSERT INTO platforms (id,code,name,status,created_at,updated_at) VALUES (?,?,?,'setup',?,?)")
      .bind(id, code, name, now, now).run();
    await context.env.DB.prepare(`INSERT INTO platform_operational_profiles
      (platform_id,environment,health_status,health_message,capabilities_json,integrations_json,created_at,updated_at)
      VALUES (?,'production','awaiting_connection','Connector registered; awaiting its first secure heartbeat.','[]','{}',?,?)`)
      .bind(id,now,now).run();
  } catch (cause) {
    if (String(cause).includes("platforms.code")) return error("DUPLICATE_PLATFORM_CODE", "That platform code is already in use.", 409);
    throw cause;
  }
  await audit(context.env, auth.session, "platform.create", "platform", id, {
    label: "Connected platform registered",
    reference: code,
    requestId: context.data.requestId,
    after: { code, name, status: "setup", healthStatus: "awaiting_connection" }
  });
  return json({ id, code }, 201);
};
