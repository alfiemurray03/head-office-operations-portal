import { audit, cleanText, error, json, readJson } from "../_shared.js";
import { requirePermission } from "../_operations.js";

const CATEGORIES = new Set(["service","account","security","billing","complaint","data_protection","safeguarding","general"]);
const SEVERITIES = new Set(["information","important","urgent","critical"]);
const STATUSES = new Set(["draft","published","withdrawn","expired"]);

function noticeReference() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const code = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `NTC-${new Date().getUTCFullYear()}-${code}`;
}

function safeActionHref(value) {
  const href = cleanText(value, 500);
  if (!href) return null;
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  if (/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(href)) return href;
  try {
    const url = new URL(href);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

async function resolveCustomer(env, body) {
  const customerId = cleanText(body.customerId, 100);
  const customerNumber = cleanText(body.customerNumber || body.ucn, 40);
  if (!customerId && !customerNumber) return null;
  return env.DB.prepare("SELECT id,customer_number,display_name FROM customers WHERE id=? OR customer_number=? LIMIT 1")
    .bind(customerId || "", customerNumber || "").first();
}

async function resolvePlatform(env, code) {
  const platformCode = cleanText(code, 100).toUpperCase();
  if (!platformCode) return null;
  return env.DB.prepare("SELECT id,code,name FROM platforms WHERE upper(code)=? LIMIT 1").bind(platformCode).first();
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "communications:read");
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const customerId = cleanText(url.searchParams.get("customerId"), 100);
  const customerNumber = cleanText(url.searchParams.get("customerNumber") || url.searchParams.get("ucn"), 40);
  const status = cleanText(url.searchParams.get("status"), 30);
  const conditions = [];
  const values = [];
  if (customerId) { conditions.push("n.customer_id=?"); values.push(customerId); }
  if (customerNumber) { conditions.push("c.customer_number=?"); values.push(customerNumber); }
  if (STATUSES.has(status)) { conditions.push("n.status=?"); values.push(status); }
  const result = await context.env.DB.prepare(`SELECT n.*,c.customer_number,c.display_name customer_name,p.code platform_code,p.name platform_name
    FROM customer_notices n JOIN customers c ON c.id=n.customer_id
    LEFT JOIN platforms p ON p.id=n.platform_id
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY n.created_at DESC LIMIT 100`).bind(...values).all();
  return json({ notices: result.results || [] });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "communications:write");
  if (auth.response) return auth.response;
  try {
    const body = await readJson(context.request, 32_768);
    const customer = await resolveCustomer(context.env, body);
    if (!customer) return error("CUSTOMER_NOT_FOUND", "Select a valid universal customer before creating a notice.", 404);
    const platform = await resolvePlatform(context.env, body.platformCode);
    if (body.platformCode && !platform) return error("PLATFORM_NOT_FOUND", "The selected website or service was not found.", 404);
    const category = CATEGORIES.has(body.category) ? body.category : "service";
    const severity = SEVERITIES.has(body.severity) ? body.severity : "information";
    const status = STATUSES.has(body.status) ? body.status : "published";
    const title = cleanText(body.title, 180);
    const message = cleanText(body.message, 4_000);
    const actionLabel = cleanText(body.actionLabel, 100) || null;
    const actionHref = safeActionHref(body.actionHref);
    if (title.length < 3 || message.length < 5) return error("INVALID_CUSTOMER_NOTICE", "Enter a clear notice title and message.", 400);
    if (body.actionHref && !actionHref) return error("INVALID_NOTICE_ACTION", "Notice actions must use a secure HTTPS, same-site or email link.", 400);
    const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const reference = noticeReference();
    await context.env.DB.prepare(`INSERT INTO customer_notices
      (id,notice_reference,customer_id,platform_id,category,severity,title,message,action_label,action_href,
       status,published_at,expires_at,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, reference, customer.id, platform?.id || null, category, severity, title, message, actionLabel, actionHref,
        status, status === "published" ? now : null, expiresAt, auth.session.sub, now, now).run();
    await audit(context.env, auth.session, "customer.notice.create", "customer_notice", id, {
      label: "Customer notice created",
      reference,
      customerId: customer.id,
      requestId: context.data.requestId,
      metadata: { platformCode: platform?.code || "ALL_LINKED_PLATFORMS", category, severity, status }
    });
    return json({ notice: { id, reference, customerId: customer.id, customerNumber: customer.customer_number, platformCode: platform?.code || null, category, severity, title, message, actionLabel, actionHref, status, publishedAt: status === "published" ? now : null, expiresAt } }, 201);
  } catch (cause) {
    return error(cause.code || "CUSTOMER_NOTICE_CREATE_FAILED", cause.message || "The customer notice could not be created.", cause.status || 500, cause.details);
  }
};
