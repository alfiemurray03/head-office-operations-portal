import { audit, cleanText, error, json, readJson, sha256 } from "../../../_shared.js";
import { requirePermission } from "../../../_operations.js";

const permittedScopes = new Set(["customers:read", "customers:write", "security:read", "cases:write", "events:write", "platform:write"]);

function randomSecret(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "platforms:write");
  if (auth.response) return auth.response;
  const platformId = cleanText(context.params.id, 80);
  const platform = await context.env.DB.prepare("SELECT id,code,name FROM platforms WHERE id=?").bind(platformId).first();
  if (!platform) return error("PLATFORM_NOT_FOUND", "The connected platform was not found.", 404);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const name = cleanText(body.name, 100);
  const scopes = Array.isArray(body.scopes) ? [...new Set(body.scopes.map(value => cleanText(value, 40)).filter(value => permittedScopes.has(value)))] : [];
  if (name.length < 2 || scopes.length === 0) return error("INVALID_CREDENTIAL", "Enter a credential name and select at least one permitted scope.");
  const id = crypto.randomUUID();
  const keyPrefix = `${platform.code.toLowerCase().replace(/[^a-z0-9]/g, "")}_${randomSecret(6)}`;
  const token = `ho_live_${keyPrefix}_${randomSecret(32)}`;
  const now = new Date().toISOString();
  await context.env.DB.batch([
    context.env.DB.prepare(`INSERT INTO platform_api_credentials
      (id,platform_id,key_prefix,name,secret_hash,scopes_json,status,created_by,created_at)
      VALUES (?,?,?,?,?,?,'active',?,?)`)
      .bind(id, platform.id, keyPrefix, name, await sha256(token), JSON.stringify(scopes), auth.session.sub, now),
    context.env.DB.prepare("UPDATE platforms SET status='active',updated_at=? WHERE id=?").bind(now, platform.id)
  ]);
  await audit(context.env, auth.session, "platform.credential.create", "platform_api_credential", id, {
    label: "Platform API credential generated",
    reference: keyPrefix,
    requestId: context.data.requestId,
    metadata: { platformId, scopes }
  });
  return json({ credential: { id, keyPrefix, token, name, scopes, createdAt: now } }, 201);
};

export const onRequestDelete = async context => {
  const auth = await requirePermission(context, "platforms:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const credentialId = cleanText(body.credentialId, 80);
  const existing = await context.env.DB.prepare("SELECT id,key_prefix FROM platform_api_credentials WHERE id=? AND platform_id=? AND status='active'")
    .bind(credentialId, context.params.id).first();
  if (!existing) return error("CREDENTIAL_NOT_FOUND", "The active API credential was not found.", 404);
  const now = new Date().toISOString();
  await context.env.DB.prepare("UPDATE platform_api_credentials SET status='revoked',revoked_by=?,revoked_at=? WHERE id=?")
    .bind(auth.session.sub, now, credentialId).run();
  await audit(context.env, auth.session, "platform.credential.revoke", "platform_api_credential", credentialId, {
    label: "Platform API credential revoked",
    reference: existing.key_prefix,
    requestId: context.data.requestId
  });
  return json({ ok: true });
};
