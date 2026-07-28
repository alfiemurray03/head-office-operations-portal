import { cleanText, error, json, platformAudit, requirePlatform } from "../../../_shared.js";

function customerNumber() {
  const digits = new Uint32Array(2); crypto.getRandomValues(digits);
  return String(((BigInt(digits[0]) << 32n | BigInt(digits[1])) % 9000000000n) + 1000000000n);
}

export const onRequestGet = async context => {
  const auth = await requirePlatform(context, ["customers:read"]); if (auth.response) return auth.response;
  const externalAccountId = cleanText(new URL(context.request.url).searchParams.get("externalAccountId") || "", 160);
  if (!externalAccountId) return error("EXTERNAL_ACCOUNT_ID_REQUIRED", "externalAccountId is required.");
  const record = await context.env.DB.prepare(`SELECT c.customer_number,c.display_name,c.verified_email,c.account_status,c.security_status,a.external_account_id,a.status platform_account_status
    FROM customer_platform_accounts a JOIN customers c ON c.id=a.customer_id
    WHERE a.platform_id=? AND a.external_account_id=?`).bind(auth.platform.id, externalAccountId).first();
  if (!record) return error("CUSTOMER_LINK_NOT_FOUND", "No universal customer is linked to that platform account.", 404);
  return json({ customer: record });
};

export const onRequestPost = async context => {
  const auth = await requirePlatform(context, ["customers:write"]); if (auth.response) return auth.response;
  const body = await context.request.json().catch(() => ({}));
  const externalAccountId = cleanText(body.externalAccountId, 160);
  const displayName = cleanText(body.displayName, 160);
  const verifiedEmail = cleanText(body.verifiedEmail, 254).toLowerCase();
  const externalIdentityId = cleanText(body.externalIdentityId, 160) || null;
  if (!externalAccountId || displayName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(verifiedEmail)) {
    return error("INVALID_CUSTOMER", "externalAccountId, displayName and a valid verifiedEmail are required.");
  }
  const existingLink = await context.env.DB.prepare(`SELECT c.id,c.customer_number FROM customer_platform_accounts a
    JOIN customers c ON c.id=a.customer_id WHERE a.platform_id=? AND a.external_account_id=?`)
    .bind(auth.platform.id, externalAccountId).first();
  if (existingLink) return json({ customerId: existingLink.id, customerNumber: existingLink.customer_number, created: false });

  let customer = externalIdentityId
    ? await context.env.DB.prepare("SELECT id,customer_number FROM customers WHERE external_identity_id=?").bind(externalIdentityId).first()
    : null;
  if (!customer) customer = await context.env.DB.prepare("SELECT id,customer_number FROM customers WHERE verified_email=?").bind(verifiedEmail).first();
  const now = new Date().toISOString();
  let created = false;
  if (!customer) {
    for (let attempt = 0; attempt < 5 && !customer; attempt++) {
      const id = crypto.randomUUID(), number = customerNumber();
      try {
        await context.env.DB.prepare(`INSERT INTO customers
          (id,customer_number,external_identity_id,display_name,verified_email,originating_platform_id,account_status,security_status,first_registered_at,last_activity_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,'active','clear',?,?,?,?)`)
          .bind(id, number, externalIdentityId, displayName, verifiedEmail, auth.platform.id, now, now, now, now).run();
        customer = { id, customer_number: number }; created = true;
      } catch (cause) {
        if (!String(cause).includes("customer_number")) throw cause;
      }
    }
  }
  if (!customer) return error("NUMBER_ALLOCATION_FAILED", "A unique customer number could not be allocated.", 503);
  await context.env.DB.prepare(`INSERT INTO customer_platform_accounts
    (id,customer_id,platform_id,external_account_id,status,linked_at,last_synced_at)
    VALUES (?,?,?,?,'active',?,?)`).bind(crypto.randomUUID(), customer.id, auth.platform.id, externalAccountId, now, now).run();
  await platformAudit(context.env, auth.platform, created ? "customer.create" : "customer.link", "customer", customer.id, {
    label: created ? "Universal customer registered by platform" : "Platform account linked to customer",
    reference: customer.customer_number, customerId: customer.id, requestId: context.data.requestId,
    metadata: { externalAccountId }
  });
  return json({ customerId: customer.id, customerNumber: customer.customer_number, created }, created ? 201 : 200);
};
