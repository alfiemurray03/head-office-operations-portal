import { cleanText, error, json, platformAudit, readJson, requirePlatform, validEmail } from "../../../_shared.js";
import { CUSTOMER_DIRECTORY_CONNECTOR_ID, CUSTOMER_DIRECTORY_PROVIDER, ensureCustomerDirectorySchema } from "../../../_customer-entra.js";
import { calculateAccessDecision } from "../../../_central-access.js";
import { ensureCentralPlatformSchema } from "../../../_central-schema.js";
import { upsertCustomerSnapshot } from "../../../_central-events.js";

function allocateCustomerNumber() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return String(Number(((BigInt(values[0]) << 32n) | BigInt(values[1])) % 9_000_000_000n) + 1_000_000_000);
}

async function createCustomer(env, identity, now) {
  const id = crypto.randomUUID();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const customerNumber = allocateCustomerNumber();
    try {
      await env.DB.prepare(`INSERT INTO customers
        (id,customer_number,external_identity_id,display_name,verified_email,originating_platform_id,
         account_status,security_status,first_registered_at,last_activity_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,'clear',?,?,?,?)`)
        .bind(id,customerNumber,identity.externalKey,identity.displayName,identity.email,identity.platformId,
          identity.accountEnabled?"active":"suspended",identity.createdAt||now,now,now,now).run();
      return await env.DB.prepare("SELECT * FROM customers WHERE id=?").bind(id).first();
    } catch (cause) {
      const message = String(cause);
      if (message.includes("customer_number")) continue;
      if (message.includes("verified_email")) return null;
      if (message.includes("external_identity_id")) return env.DB.prepare("SELECT * FROM customers WHERE external_identity_id=?").bind(identity.externalKey).first();
      throw cause;
    }
  }
  throw Object.assign(new Error("A universal customer number could not be allocated."),{code:"CUSTOMER_NUMBER_ALLOCATION_FAILED",status:503});
}

async function findCustomer(env, platform, input) {
  const platformAccount = await env.DB.prepare(`SELECT c.* FROM customer_platform_accounts a
    JOIN customers c ON c.id=a.customer_id WHERE a.platform_id=? AND a.external_account_id=? LIMIT 1`)
    .bind(platform.id,input.platformCustomerId).first();
  if (platformAccount) return {customer:platformAccount,match:"platform_account"};
  const directoryIdentity = await env.DB.prepare(`SELECT c.* FROM customer_directory_identities i
    JOIN customers c ON c.id=i.customer_id WHERE i.provider=? AND i.tenant_id=? AND i.object_id=? LIMIT 1`)
    .bind(CUSTOMER_DIRECTORY_PROVIDER,input.tenantId,input.objectId).first();
  if (directoryIdentity) return {customer:directoryIdentity,match:"microsoft_identity"};
  const external = await env.DB.prepare("SELECT * FROM customers WHERE external_identity_id IN (?,?) LIMIT 1")
    .bind(input.externalKey,input.objectId).first();
  if (external) return {customer:external,match:"external_identity"};
  const email = await env.DB.prepare("SELECT * FROM customers WHERE verified_email=? LIMIT 1").bind(input.email).first();
  if (!email) return {customer:null,match:"new"};
  if (email.external_identity_id && ![input.externalKey,input.objectId].includes(email.external_identity_id)) {
    return {customer:null,match:"identity_conflict",conflict:email};
  }
  return {customer:email,match:"verified_email"};
}

async function upsertDirectoryIdentity(env, customer, input, now) {
  const existing = await env.DB.prepare(`SELECT id,customer_id FROM customer_directory_identities
    WHERE provider=? AND tenant_id=? AND object_id=? LIMIT 1`)
    .bind(CUSTOMER_DIRECTORY_PROVIDER,input.tenantId,input.objectId).first();
  if (existing?.customer_id && existing.customer_id !== customer.id) {
    throw Object.assign(new Error("The Microsoft identity is already linked to another universal customer."),{code:"IDENTITY_ALREADY_LINKED",status:409});
  }
  if (existing) {
    await env.DB.prepare(`UPDATE customer_directory_identities SET customer_id=?,display_name=?,primary_email=?,
      account_enabled=?,directory_status=?,last_synced_at=?,updated_at=? WHERE id=?`)
      .bind(customer.id,input.displayName,input.email,input.accountEnabled?1:0,input.accountEnabled?"active":"disabled",now,now,existing.id).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO customer_directory_identities
    (id,customer_id,connector_id,provider,tenant_id,object_id,display_name,given_name,surname,primary_email,user_principal_name,
     account_enabled,directory_status,identities_json,source_created_at,first_seen_at,last_synced_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'[]',?,?,?,?,?)`)
    .bind(id,customer.id,CUSTOMER_DIRECTORY_CONNECTOR_ID,CUSTOMER_DIRECTORY_PROVIDER,input.tenantId,input.objectId,
      input.displayName,input.givenName,input.surname,input.email,input.userPrincipalName,input.accountEnabled?1:0,
      input.accountEnabled?"active":"disabled",input.createdAt||null,now,now,now,now).run();
  return id;
}

async function upsertPlatformAccount(env, platform, customer, platformCustomerId, status, now) {
  const existing = await env.DB.prepare("SELECT id FROM customer_platform_accounts WHERE customer_id=? AND platform_id=? LIMIT 1")
    .bind(customer.id,platform.id).first();
  if (existing) {
    await env.DB.prepare("UPDATE customer_platform_accounts SET external_account_id=?,status=?,last_synced_at=? WHERE id=?")
      .bind(platformCustomerId,status,now,existing.id).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO customer_platform_accounts
    (id,customer_id,platform_id,external_account_id,status,linked_at,last_synced_at)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(platform_id,external_account_id) DO UPDATE SET
    customer_id=excluded.customer_id,status=excluded.status,last_synced_at=excluded.last_synced_at`)
    .bind(id,customer.id,platform.id,platformCustomerId,status,now,now).run();
  return id;
}

export const onRequestPost = async context => {
  const auth = await requirePlatform(context,["customers:write"]);
  if (auth.response) return auth.response;
  let body;
  try { body = await readJson(context.request,65_536); }
  catch (cause) { return error(cause.code||"INVALID_REQUEST",cause.message,cause.status||400); }
  const input = {
    tenantId:cleanText(body.entraTenantId,100),objectId:cleanText(body.entraObjectId,100),
    platformCustomerId:cleanText(body.platformCustomerId,160),displayName:cleanText(body.displayName,160),
    givenName:cleanText(body.givenName,100)||null,surname:cleanText(body.surname,100)||null,
    email:cleanText(body.email,254).toLowerCase(),userPrincipalName:cleanText(body.userPrincipalName,254)||null,
    accountEnabled:body.accountEnabled!==false,
    accountStatus:["active","pending","suspended","closed"].includes(body.accountStatus)?body.accountStatus:"active",
    createdAt:body.createdAt?new Date(body.createdAt).toISOString():null,platformId:auth.platform.id
  };
  input.externalKey = `${input.tenantId}:${input.objectId}`;
  if (!input.tenantId || !input.objectId || !input.platformCustomerId || input.displayName.length<2 || !validEmail(input.email)) {
    return error("INVALID_CUSTOMER_IDENTITY","The website must provide the verified Microsoft tenant ID, object ID, platform account ID, name and email address.");
  }
  try {
    await ensureCustomerDirectorySchema(context.env);
    await ensureCentralPlatformSchema(context.env);
    const now = new Date().toISOString();
    const found = await findCustomer(context.env,auth.platform,input);
    if (found.match === "identity_conflict") return error("CUSTOMER_IDENTITY_REVIEW_REQUIRED",
      "The verified email belongs to a customer linked to a different Microsoft identity. Head Office review is required.",409,
      {customerNumber:found.conflict.customer_number});
    let customer = found.customer;
    let created = false;
    if (!customer) {
      customer = await createCustomer(context.env,input,now);
      if (!customer) return error("CUSTOMER_IDENTITY_REVIEW_REQUIRED","The email now matches another customer record. Head Office review is required.",409);
      created = true;
    } else {
      // Connected websites may refresh identity details, but they cannot undo a
      // Head Office restriction, suspension, closure or archive decision.
      await context.env.DB.prepare(`UPDATE customers SET display_name=?,verified_email=?,
        external_identity_id=COALESCE(external_identity_id,?),
        account_status=CASE WHEN account_status='pending' AND ?='active' THEN 'active' ELSE account_status END,
        last_activity_at=?,updated_at=? WHERE id=?`)
        .bind(input.displayName,input.email,input.externalKey,input.accountStatus,now,now,customer.id).run();
      customer = await context.env.DB.prepare("SELECT * FROM customers WHERE id=?").bind(customer.id).first();
    }
    const identityId = await upsertDirectoryIdentity(context.env,customer,input,now);
    const platformAccountId = await upsertPlatformAccount(context.env,auth.platform,customer,input.platformCustomerId,input.accountStatus,now);
    await upsertCustomerSnapshot(context.env,auth.platform,customer,{
      platformCustomerId:input.platformCustomerId,accountStatus:input.accountStatus,planCode:body.planCode,
      subscriptionStatus:body.subscriptionStatus,entitlements:body.entitlements,registeredAt:input.createdAt,
      lastSignInAt:body.lastSignInAt||now,lastActivityAt:body.lastActivityAt||now,metadata:body.platformMetadata
    });
    const access = await calculateAccessDecision(context.env,customer,auth.platform,true);
    await platformAudit(context.env,auth.platform,created?"customer.automatic_create":"customer.automatic_upsert","customer",customer.id,{
      label:created?"Connected website created universal customer":"Connected website synchronised customer",
      reference:customer.customer_number,customerId:customer.id,requestId:context.data.requestId,
      metadata:{match:found.match,identityId,platformAccountId,platformCustomerId:input.platformCustomerId,accessDecision:access.decision}
    });
    return json({
      customer:{id:customer.id,customerNumber:customer.customer_number,displayName:customer.display_name,
        accountStatus:customer.account_status,securityStatus:customer.security_status},
      created,matchedBy:found.match,
      enforcement:{action:access.decision,decision:access.decision,revokeSessions:access.revokeSessions,
        reason:access.reason,restrictions:access.restrictions}
    },created?201:200);
  } catch (cause) {
    return error(cause.code||"CUSTOMER_UPSERT_FAILED",cause.message||"The customer could not be synchronised with Head Office.",cause.status||500,cause.details);
  }
};
