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
  if (input.centralCustomerId) {
    const central = await env.DB.prepare("SELECT * FROM customers WHERE id=? LIMIT 1").bind(input.centralCustomerId).first();
    if (central) return {customer:central,match:"central_customer_id"};
    return {customer:null,match:"central_customer_not_found"};
  }
  if (input.customerNumber) {
    const ucn = await env.DB.prepare("SELECT * FROM customers WHERE customer_number=? LIMIT 1").bind(input.customerNumber).first();
    if (ucn) return {customer:ucn,match:"ucn"};
    return {customer:null,match:"ucn_not_found"};
  }
  const platformAccount = await env.DB.prepare(`SELECT c.* FROM customer_platform_accounts a
    JOIN customers c ON c.id=a.customer_id WHERE a.platform_id=? AND a.external_account_id=? LIMIT 1`)
    .bind(platform.id,input.platformCustomerId).first();
  if (platformAccount) return {customer:platformAccount,match:"platform_account"};
  if (input.externalPersonId) {
    const platformPerson = await env.DB.prepare(`SELECT c.* FROM customer_platform_accounts a
      JOIN customers c ON c.id=a.customer_id WHERE a.platform_id=? AND a.external_person_id=? LIMIT 1`)
      .bind(platform.id,input.externalPersonId).first();
    if (platformPerson) return {customer:platformPerson,match:"platform_person"};
  }
  const directoryIdentity = await env.DB.prepare(`SELECT c.* FROM customer_directory_identities i
    JOIN customers c ON c.id=i.customer_id WHERE i.provider=? AND i.tenant_id=? AND i.object_id=? LIMIT 1`)
    .bind(CUSTOMER_DIRECTORY_PROVIDER,input.tenantId,input.objectId).first();
  if (directoryIdentity) return {customer:directoryIdentity,match:"microsoft_identity"};
  const external = await env.DB.prepare("SELECT * FROM customers WHERE external_identity_id IN (?,?) LIMIT 1")
    .bind(input.externalKey,input.objectId).first();
  if (external) return {customer:external,match:"external_identity"};
  const email = await env.DB.prepare("SELECT * FROM customers WHERE verified_email=? LIMIT 1").bind(input.email).first();
  if (email) return {customer:null,match:"verified_email_reconciliation_required",conflict:email};
  return {customer:null,match:"new_verified_identity"};
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

async function upsertPlatformAccount(env, platform, customer, input, now) {
  const existing = await env.DB.prepare("SELECT id FROM customer_platform_accounts WHERE customer_id=? AND platform_id=? LIMIT 1")
    .bind(customer.id,platform.id).first();
  if (existing) {
    await env.DB.prepare(`UPDATE customer_platform_accounts SET external_account_id=?,external_person_id=?,platform_code=?,
      status=?,registration_date=COALESCE(registration_date,?),last_activity_date=?,source_system='Profile Centre',
      synchronisation_status='linked',last_synced_at=?,updated_at=?,secure_record_url=? WHERE id=?`)
      .bind(input.platformCustomerId,input.externalPersonId,platform.code,input.accountStatus,input.createdAt,
        input.lastActivityAt||now,now,now,input.secureRecordUrl,existing.id).run();
    return existing.id;
  }
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO customer_platform_accounts
    (id,customer_id,platform_id,external_account_id,status,linked_at,last_synced_at,platform_code,
     external_person_id,registration_date,last_activity_date,source_system,synchronisation_status,updated_at,secure_record_url)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform_id,external_account_id) DO UPDATE SET
    customer_id=excluded.customer_id,status=excluded.status,external_person_id=excluded.external_person_id,
    registration_date=COALESCE(customer_platform_accounts.registration_date,excluded.registration_date),
    last_activity_date=excluded.last_activity_date,source_system=excluded.source_system,
    synchronisation_status='linked',last_synced_at=excluded.last_synced_at,updated_at=excluded.updated_at,
    secure_record_url=excluded.secure_record_url`)
    .bind(id,customer.id,platform.id,input.platformCustomerId,input.accountStatus,now,now,platform.code,
      input.externalPersonId,input.createdAt,input.lastActivityAt||now,"Profile Centre","linked",now,input.secureRecordUrl).run();
  return id;
}

async function recordReconciliationFailure(env, platform, input, reasonCode, now) {
  await env.DB.prepare(`INSERT INTO platform_reconciliation_failures
    (id,platform_id,platform_code,external_account_id,external_person_id,supplied_customer_id,
     supplied_customer_number,reason_code,status,safe_metadata_json,first_seen_at,last_seen_at)
    VALUES (?,?,?,?,?,?,?,?,'unresolved','{}',?,?)
    ON CONFLICT(platform_id,external_account_id,reason_code) DO UPDATE SET
      external_person_id=excluded.external_person_id,supplied_customer_id=excluded.supplied_customer_id,
      supplied_customer_number=excluded.supplied_customer_number,last_seen_at=excluded.last_seen_at,status='unresolved'`)
    .bind(crypto.randomUUID(),platform.id,platform.code,input.platformCustomerId,input.externalPersonId,
      input.centralCustomerId,input.customerNumber,reasonCode,now,now).run();
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
    createdAt:body.createdAt?new Date(body.createdAt).toISOString():null,
    lastActivityAt:body.lastActivityAt?new Date(body.lastActivityAt).toISOString():null,
    centralCustomerId:cleanText(body.centralCustomerId,100)||null,
    customerNumber:cleanText(body.customerNumber||body.ucn,40)||null,
    externalPersonId:cleanText(body.platformPersonId||body.profileId,160)||null,
    secureRecordUrl:cleanText(body.secureRecordUrl,500)||null,
    platformId:auth.platform.id
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
    if (["central_customer_not_found","ucn_not_found","verified_email_reconciliation_required"].includes(found.match)) {
      await recordReconciliationFailure(context.env,auth.platform,input,found.match,now);
      return error("CUSTOMER_IDENTITY_REVIEW_REQUIRED",
        "The supplied identifiers could not be reconciled authoritatively. Head Office review is required.",409);
    }
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
    const platformAccountId = await upsertPlatformAccount(context.env,auth.platform,customer,input,now);
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
        reason:access.reason,restrictions:access.restrictions,ageAssurance:access.ageAssurance}
    },created?201:200);
  } catch (cause) {
    return error(cause.code||"CUSTOMER_UPSERT_FAILED",cause.message||"The customer could not be synchronised with Head Office.",cause.status||500,cause.details);
  }
};
