import { audit, cleanNullableText, cleanText, error, json, readJson, validEmail } from "../_shared.js";
import { findCustomer, requirePermission } from "../_operations.js";

function allocateCustomerNumber() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return String(Number((BigInt(values[0]) << 32n | BigInt(values[1])) % 9_000_000_000n) + 1_000_000_000);
}

export const onRequestGet = async context => {
  const auth = await requirePermission(context, "customers:read");
  if (auth.response) return auth.response;
  const url = new URL(context.request.url);
  const query = cleanText(url.searchParams.get("q") || "", 100);
  const accountStatus = cleanText(url.searchParams.get("accountStatus") || "", 30);
  const securityStatus = cleanText(url.searchParams.get("securityStatus") || "", 30);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 100), 1), 200);
  const search = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const result = await context.env.DB.prepare(`SELECT c.id,c.customer_number,c.display_name,c.verified_email,
      c.account_status,c.security_status,c.last_activity_at,c.created_at,COUNT(a.id) platform_count,
      (SELECT COUNT(*) FROM cases x WHERE x.customer_id=c.id AND x.status NOT IN ('closed','cancelled')) open_case_count
    FROM customers c LEFT JOIN customer_platform_accounts a ON a.customer_id=c.id
    WHERE (?='' OR c.display_name LIKE ? ESCAPE '\\' OR c.verified_email LIKE ? ESCAPE '\\'
      OR c.customer_number LIKE ? ESCAPE '\\' OR COALESCE(c.external_identity_id,'') LIKE ? ESCAPE '\\')
      AND (?='' OR c.account_status=?) AND (?='' OR c.security_status=?)
    GROUP BY c.id ORDER BY COALESCE(c.last_activity_at,c.created_at) DESC LIMIT ?`)
    .bind(query, search, search, search, search, accountStatus, accountStatus, securityStatus, securityStatus, limit).all();
  return json({
    customers: result.results.map(customer => ({
      ...customer,
      initials: customer.display_name.split(/\s+/).map(part => part[0]).slice(0, 2).join("").toUpperCase()
    }))
  });
};

export const onRequestPost = async context => {
  const auth = await requirePermission(context, "customers:write");
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }

  const displayName = cleanText(body.displayName, 160);
  const verifiedEmail = cleanText(body.verifiedEmail, 254).toLowerCase();
  const mobile = cleanNullableText(body.mobile, 40);
  const externalIdentityId = cleanNullableText(body.externalIdentityId, 100);
  const originatingPlatformId = cleanNullableText(body.originatingPlatformId, 100);
  if (displayName.length < 2 || !validEmail(verifiedEmail)) return error("INVALID_CUSTOMER", "Enter a valid customer name and verified email address.");
  if (originatingPlatformId && !await context.env.DB.prepare("SELECT id FROM platforms WHERE id=?").bind(originatingPlatformId).first()) {
    return error("INVALID_PLATFORM", "The selected originating platform does not exist.");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const customerNumber = allocateCustomerNumber();
    const statements = [context.env.DB.prepare(`INSERT INTO customers
      (id,customer_number,external_identity_id,display_name,verified_email,originating_platform_id,
       account_status,security_status,first_registered_at,last_activity_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'active','clear',?,?,?,?)`)
      .bind(id, customerNumber, externalIdentityId, displayName, verifiedEmail, originatingPlatformId, now, now, now, now)];
    if (mobile) {
      statements.push(context.env.DB.prepare(`INSERT INTO customer_contact_points
        (id,customer_id,contact_type,contact_value,is_primary,verification_status,created_at,updated_at)
        VALUES (?,?,'mobile',?,1,'unverified',?,?)`).bind(crypto.randomUUID(), id, mobile, now, now));
    }
    try {
      await context.env.DB.batch(statements);
      await audit(context.env, auth.session, "customer.create", "customer", id, {
        label: "Universal customer registered",
        reference: customerNumber,
        customerId: id,
        requestId: context.data.requestId,
        after: { displayName, verifiedEmail, accountStatus: "active", securityStatus: "clear" }
      });
      return json({ id, customerNumber, customer: await findCustomer(context.env, id) }, 201);
    } catch (cause) {
      const message = String(cause);
      if (message.includes("verified_email")) return error("DUPLICATE_EMAIL", "A customer record already uses this verified email address.", 409);
      if (externalIdentityId && message.includes("external_identity_id")) return error("DUPLICATE_IDENTITY", "That external identity is already linked to a customer.", 409);
      if (!message.includes("customer_number")) throw cause;
    }
  }
  return error("NUMBER_ALLOCATION_FAILED", "A unique customer number could not be allocated.", 503);
};
