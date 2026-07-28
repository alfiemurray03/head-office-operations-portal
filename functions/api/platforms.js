import { audit, cleanText, error, json, requireSession } from "../_shared.js";

export const onRequestGet = async context => {
  const auth = await requireSession(context); if (auth.response) return auth.response;
  const result = await context.env.DB.prepare(`SELECT p.id,p.code,p.name,p.status,p.last_health_check_at,p.created_at,
    COUNT(c.id) credential_count,
    SUM(CASE WHEN c.status='active' THEN 1 ELSE 0 END) active_credential_count,
    MAX(c.last_used_at) last_api_activity_at
    FROM platforms p LEFT JOIN platform_api_credentials c ON c.platform_id=p.id
    GROUP BY p.id ORDER BY p.name`).all();
  return json({ platforms: result.results });
};

export const onRequestPost = async context => {
  const auth = await requireSession(context); if (auth.response) return auth.response;
  const body = await context.request.json().catch(() => ({}));
  const name = cleanText(body.name, 120);
  const code = cleanText(body.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  if (name.length < 2 || code.length < 2) return error("INVALID_PLATFORM", "Enter a valid platform name and code.");
  const id = crypto.randomUUID(), now = new Date().toISOString();
  try {
    await context.env.DB.prepare("INSERT INTO platforms (id,code,name,status,created_at,updated_at) VALUES (?,?,?,'setup',?,?)")
      .bind(id, code, name, now, now).run();
  } catch (cause) {
    if (String(cause).includes("platforms.code")) return error("DUPLICATE_PLATFORM_CODE", "That platform code is already in use.", 409);
    throw cause;
  }
  await audit(context.env, auth.session, "platform.create", "platform", id, { label: "Connected platform registered", reference: code });
  return json({ id, code }, 201);
};
