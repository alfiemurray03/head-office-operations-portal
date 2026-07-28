import { audit, cleanText, error, json, requireSession } from "../_shared.js";

function customerNumber() {
  const digits = new Uint32Array(3); crypto.getRandomValues(digits);
  return String((BigInt(digits[0]) << 32n | BigInt(digits[1])) % 9000000000n + 1000000000n);
}

export const onRequestGet = async context => {
  const auth = await requireSession(context); if (auth.response) return auth.response;
  const q = cleanText(new URL(context.request.url).searchParams.get("q") || "", 100);
  const search = `%${q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const result = await context.env.DB.prepare(`SELECT c.id,c.customer_number,c.display_name,c.verified_email,c.account_status,c.security_status,c.last_activity_at,COUNT(a.id) platform_count
    FROM customers c LEFT JOIN customer_platform_accounts a ON a.customer_id=c.id
    WHERE (?='' OR c.display_name LIKE ? ESCAPE '\\' OR c.verified_email LIKE ? ESCAPE '\\' OR c.customer_number LIKE ? ESCAPE '\\' OR COALESCE(c.external_identity_id,'') LIKE ? ESCAPE '\\')
    GROUP BY c.id ORDER BY c.created_at DESC LIMIT 100`).bind(q, search, search, search, search).all();
  return json({ customers: result.results.map(c => ({ ...c, initials: c.display_name.split(/\s+/).map(x => x[0]).slice(0,2).join("").toUpperCase() })) });
};

export const onRequestPost = async context => {
  const auth = await requireSession(context); if (auth.response) return auth.response;
  const body = await context.request.json().catch(() => ({}));
  const displayName = cleanText(body.displayName, 160);
  const verifiedEmail = cleanText(body.verifiedEmail, 254).toLowerCase();
  const externalIdentityId = cleanText(body.externalIdentityId, 100) || null;
  const originatingPlatformId = cleanText(body.originatingPlatformId, 100) || null;
  if (displayName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedEmail)) return error("INVALID_CUSTOMER", "Enter a valid full name and email address.");
  if (originatingPlatformId && !await context.env.DB.prepare("SELECT id FROM platforms WHERE id=?").bind(originatingPlatformId).first()) return error("INVALID_PLATFORM", "The selected originating platform does not exist.");
  const id = crypto.randomUUID(), now = new Date().toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = customerNumber();
    try {
      await context.env.DB.prepare(`INSERT INTO customers (id,customer_number,external_identity_id,display_name,verified_email,originating_platform_id,account_status,security_status,first_registered_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'active','clear',?,?,?)`)
        .bind(id, number, externalIdentityId, displayName, verifiedEmail, originatingPlatformId, now, now, now).run();
      await audit(context.env, auth.session, "customer.create", "customer", id, { label: "Universal customer registered", reference: number });
      return json({ id, customerNumber: number }, 201);
    } catch (cause) {
      if (String(cause).includes("verified_email")) return error("DUPLICATE_EMAIL", "A customer record already uses this verified email address.", 409);
      if (!String(cause).includes("customer_number")) throw cause;
    }
  }
  return error("NUMBER_ALLOCATION_FAILED", "A unique customer number could not be allocated.", 503);
};
