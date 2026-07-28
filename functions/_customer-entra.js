import { cleanText, validEmail } from "./_shared.js";

export const CUSTOMER_DIRECTORY_PROVIDER = "microsoft_entra_external_id";
export const CUSTOMER_DIRECTORY_CONNECTOR_ID = "customer-entra-external-id";
const GRAPH_ROOT = "https://graph.microsoft.com";
const USER_SELECT = "id,displayName,givenName,surname,mail,userPrincipalName,identities,accountEnabled,createdDateTime,userType";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS customer_directory_connectors (
    id TEXT PRIMARY KEY, provider TEXT NOT NULL UNIQUE, tenant_id TEXT, display_name TEXT,
    status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN ('not_configured','configured','testing','connected','syncing','degraded','suspended')),
    delta_link TEXT, last_tested_at TEXT, last_sync_started_at TEXT, last_sync_completed_at TEXT, last_success_at TEXT,
    last_error_code TEXT, last_error_message TEXT, users_discovered INTEGER NOT NULL DEFAULT 0,
    users_linked INTEGER NOT NULL DEFAULT 0, users_review_required INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS customer_directory_identities (
    id TEXT PRIMARY KEY, customer_id TEXT REFERENCES customers(id), connector_id TEXT NOT NULL REFERENCES customer_directory_connectors(id),
    provider TEXT NOT NULL, tenant_id TEXT NOT NULL, object_id TEXT NOT NULL, display_name TEXT NOT NULL,
    given_name TEXT, surname TEXT, primary_email TEXT, user_principal_name TEXT,
    account_enabled INTEGER NOT NULL DEFAULT 1 CHECK (account_enabled IN (0,1)),
    directory_status TEXT NOT NULL DEFAULT 'active' CHECK (directory_status IN ('active','disabled','deleted','review_required')),
    identities_json TEXT NOT NULL DEFAULT '[]', source_created_at TEXT, first_seen_at TEXT NOT NULL,
    last_synced_at TEXT NOT NULL, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    UNIQUE(provider, tenant_id, object_id)
  )`,
  `CREATE TABLE IF NOT EXISTS customer_directory_reviews (
    id TEXT PRIMARY KEY, connector_id TEXT NOT NULL REFERENCES customer_directory_connectors(id),
    identity_id TEXT NOT NULL REFERENCES customer_directory_identities(id),
    review_type TEXT NOT NULL CHECK (review_type IN ('email_match','email_conflict','missing_email','multiple_match','manual_review')),
    proposed_customer_id TEXT REFERENCES customers(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','linked','new_customer_created','dismissed')),
    reason TEXT NOT NULL, reviewed_by TEXT, reviewed_at TEXT, decision_reason TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(identity_id, review_type, status)
  )`,
  `CREATE TABLE IF NOT EXISTS customer_directory_sync_runs (
    id TEXT PRIMARY KEY, connector_id TEXT NOT NULL REFERENCES customer_directory_connectors(id),
    mode TEXT NOT NULL CHECK (mode IN ('initial','full','delta','test')),
    status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled')),
    started_by TEXT, started_at TEXT NOT NULL, completed_at TEXT, pages_processed INTEGER NOT NULL DEFAULT 0,
    users_received INTEGER NOT NULL DEFAULT 0, customers_created INTEGER NOT NULL DEFAULT 0,
    customers_updated INTEGER NOT NULL DEFAULT 0, identities_linked INTEGER NOT NULL DEFAULT 0,
    review_items_created INTEGER NOT NULL DEFAULT 0, disabled_accounts INTEGER NOT NULL DEFAULT 0,
    deleted_accounts INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT, summary_json TEXT NOT NULL DEFAULT '{}'
  )`,
  "CREATE INDEX IF NOT EXISTS idx_directory_identity_customer ON customer_directory_identities(customer_id, directory_status)",
  "CREATE INDEX IF NOT EXISTS idx_directory_identity_object ON customer_directory_identities(tenant_id, object_id)",
  "CREATE INDEX IF NOT EXISTS idx_directory_identity_email ON customer_directory_identities(primary_email)",
  "CREATE INDEX IF NOT EXISTS idx_directory_reviews_status ON customer_directory_reviews(status, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_directory_sync_runs ON customer_directory_sync_runs(started_at DESC)"
];

function connectorConfig(env) {
  return {
    tenantId: cleanText(env.CUSTOMER_ENTRA_TENANT_ID, 100),
    clientId: cleanText(env.CUSTOMER_ENTRA_CLIENT_ID, 100),
    clientSecret: String(env.CUSTOMER_ENTRA_CLIENT_SECRET || "")
  };
}

export function customerDirectoryConfigured(env) {
  const config = connectorConfig(env);
  return Boolean(config.tenantId && config.clientId && config.clientSecret);
}

export async function ensureCustomerDirectorySchema(env) {
  for (const statement of SCHEMA_STATEMENTS) await env.DB.prepare(statement).run();
  const now = new Date().toISOString();
  const config = connectorConfig(env);
  await env.DB.prepare(`INSERT OR IGNORE INTO customer_directory_connectors
    (id,provider,tenant_id,display_name,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)`)
    .bind(CUSTOMER_DIRECTORY_CONNECTOR_ID, CUSTOMER_DIRECTORY_PROVIDER, config.tenantId || null,
      "JA Group Services ID", customerDirectoryConfigured(env) ? "configured" : "not_configured", now, now).run();
  await env.DB.prepare(`UPDATE customer_directory_connectors SET tenant_id=?,
      status=CASE WHEN status IN ('connected','syncing','degraded','suspended') THEN status ELSE ? END,
      updated_at=? WHERE id=?`)
    .bind(config.tenantId || null, customerDirectoryConfigured(env) ? "configured" : "not_configured", now, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();
}

function graphError(code, message, status = 502, details = undefined) {
  return Object.assign(new Error(message), { code, status, details });
}

export async function acquireCustomerGraphToken(env) {
  const config = connectorConfig(env);
  if (!customerDirectoryConfigured(env)) throw graphError("CUSTOMER_ENTRA_NOT_CONFIGURED", "The Microsoft customer directory secrets are not fully configured.", 503);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials"
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw graphError("CUSTOMER_ENTRA_TOKEN_FAILED", "Microsoft rejected the customer directory connection.", response.status || 502, {
      microsoftCode: cleanText(data.error, 100),
      microsoftMessage: cleanText(data.error_description, 500)
    });
  }
  return data.access_token;
}

function permittedGraphUrl(pathOrUrl) {
  const url = pathOrUrl.startsWith("http") ? new URL(pathOrUrl) : new URL(pathOrUrl, GRAPH_ROOT);
  if (url.origin !== GRAPH_ROOT) throw graphError("INVALID_GRAPH_URL", "The Microsoft Graph continuation URL was rejected.", 500);
  return url.toString();
}

export async function customerGraphRequest(env, pathOrUrl, options = {}) {
  const token = options.token || await acquireCustomerGraphToken(env);
  const url = permittedGraphUrl(pathOrUrl);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retryAfter = Math.min(Number(response.headers.get("Retry-After") || 1), 5);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    if (response.status === 204) return null;
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw graphError("CUSTOMER_ENTRA_GRAPH_FAILED", cleanText(data.error?.message, 500) || "Microsoft Graph rejected the customer directory request.", response.status || 502, {
        microsoftCode: cleanText(data.error?.code, 120)
      });
    }
    return data;
  }
  throw graphError("CUSTOMER_ENTRA_GRAPH_UNAVAILABLE", "Microsoft Graph did not respond after retrying.", 503);
}

function identityEmail(user) {
  const identities = Array.isArray(user.identities) ? user.identities : [];
  const signIn = identities.find(identity => ["emailAddress", "userName"].includes(identity?.signInType) && validEmail(identity?.issuerAssignedId));
  const candidates = [signIn?.issuerAssignedId, user.mail, user.userPrincipalName];
  return candidates.map(value => cleanText(value, 254).toLowerCase()).find(validEmail) || null;
}

function allocateCustomerNumber() {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return String(Number(((BigInt(values[0]) << 32n) | BigInt(values[1])) % 9_000_000_000n) + 1_000_000_000);
}

async function createUniversalCustomer(env, user, tenantId, email, now) {
  const id = crypto.randomUUID();
  const displayName = cleanText(user.displayName, 160) || email;
  const externalIdentityId = `${tenantId}:${cleanText(user.id, 100)}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const customerNumber = allocateCustomerNumber();
    try {
      await env.DB.prepare(`INSERT INTO customers
        (id,customer_number,external_identity_id,display_name,verified_email,originating_platform_id,
         account_status,security_status,first_registered_at,last_activity_at,created_at,updated_at)
        VALUES (?,?,?,?,?,NULL,?,'clear',?,?,?,?,?)`)
        .bind(id, customerNumber, externalIdentityId, displayName, email, user.accountEnabled === false ? "suspended" : "active",
          user.createdDateTime || now, now, now, now, now).run();
      return { id, customerNumber };
    } catch (cause) {
      const message = String(cause);
      if (message.includes("verified_email")) return null;
      if (message.includes("external_identity_id")) {
        return await env.DB.prepare("SELECT id,customer_number FROM customers WHERE external_identity_id=?").bind(externalIdentityId).first();
      }
      if (!message.includes("customer_number")) throw cause;
    }
  }
  throw graphError("CUSTOMER_NUMBER_ALLOCATION_FAILED", "A universal customer number could not be allocated.", 503);
}

async function createReview(env, identityId, type, reason, proposedCustomerId, now) {
  const existing = await env.DB.prepare(`SELECT id FROM customer_directory_reviews
    WHERE identity_id=? AND review_type=? AND status='open'`).bind(identityId, type).first();
  if (existing) return false;
  await env.DB.prepare(`INSERT INTO customer_directory_reviews
    (id,connector_id,identity_id,review_type,proposed_customer_id,status,reason,created_at,updated_at)
    VALUES (?,?,?,?,?,'open',?,?,?)`)
    .bind(crypto.randomUUID(), CUSTOMER_DIRECTORY_CONNECTOR_ID, identityId, type, proposedCustomerId || null, reason, now, now).run();
  return true;
}

async function updateLinkedCustomer(env, identity, user, email, tenantId, now) {
  if (!identity.customer_id) return { updated: 0, review: 0 };
  const customer = await env.DB.prepare("SELECT * FROM customers WHERE id=?").bind(identity.customer_id).first();
  if (!customer) return { updated: 0, review: 0 };
  const desiredStatus = user.accountEnabled === false ? "suspended" : "active";
  const accountStatus = ["active", "pending", "suspended"].includes(customer.account_status) ? desiredStatus : customer.account_status;
  const displayName = cleanText(user.displayName, 160) || customer.display_name;
  let review = 0;
  if (email && email !== customer.verified_email) {
    const conflict = await env.DB.prepare("SELECT id FROM customers WHERE verified_email=? AND id<>?").bind(email, customer.id).first();
    const created = await createReview(env, identity.id, conflict ? "email_conflict" : "manual_review",
      conflict ? "The Microsoft sign-in email is already used by another universal customer." : "Microsoft reports a different sign-in email. Head Office must confirm the identity change before replacing the verified email.",
      conflict?.id || customer.id, now);
    if (created) review += 1;
  }
  await env.DB.prepare(`UPDATE customers SET display_name=?,account_status=?,external_identity_id=COALESCE(external_identity_id,?),last_activity_at=?,updated_at=? WHERE id=?`)
    .bind(displayName, accountStatus, `${tenantId}:${user.id}`, now, now, customer.id).run();
  return { updated: 1, review };
}

async function upsertDirectoryUser(env, user, tenantId, now) {
  const objectId = cleanText(user.id, 100);
  if (!objectId) return { received: 1 };
  const existing = await env.DB.prepare(`SELECT * FROM customer_directory_identities
    WHERE provider=? AND tenant_id=? AND object_id=?`)
    .bind(CUSTOMER_DIRECTORY_PROVIDER, tenantId, objectId).first();

  if (user["@removed"]) {
    if (!existing) return { received: 1, deleted: 1 };
    await env.DB.prepare(`UPDATE customer_directory_identities SET account_enabled=0,directory_status='deleted',deleted_at=?,last_synced_at=?,updated_at=? WHERE id=?`)
      .bind(now, now, now, existing.id).run();
    if (existing.customer_id) {
      await env.DB.prepare(`UPDATE customers SET account_status=CASE WHEN account_status IN ('active','pending','suspended') THEN 'suspended' ELSE account_status END,updated_at=? WHERE id=?`)
        .bind(now, existing.customer_id).run();
    }
    return { received: 1, deleted: 1, updated: existing.customer_id ? 1 : 0 };
  }

  const email = identityEmail(user);
  const displayName = cleanText(user.displayName, 160) || email || `Microsoft customer ${objectId.slice(0, 8)}`;
  const givenName = cleanText(user.givenName, 100) || null;
  const surname = cleanText(user.surname, 100) || null;
  const upn = cleanText(user.userPrincipalName, 254) || null;
  const identitiesJson = JSON.stringify(Array.isArray(user.identities) ? user.identities.slice(0, 20) : []);
  const directoryStatus = user.accountEnabled === false ? "disabled" : "active";

  if (existing) {
    await env.DB.prepare(`UPDATE customer_directory_identities SET display_name=?,given_name=?,surname=?,primary_email=?,user_principal_name=?,
      account_enabled=?,directory_status=?,identities_json=?,source_created_at=?,last_synced_at=?,deleted_at=NULL,updated_at=? WHERE id=?`)
      .bind(displayName, givenName, surname, email, upn, user.accountEnabled === false ? 0 : 1, directoryStatus,
        identitiesJson, user.createdDateTime || null, now, now, existing.id).run();
    const linked = await updateLinkedCustomer(env, existing, user, email, tenantId, now);
    return { received: 1, updated: linked.updated, review: linked.review, disabled: user.accountEnabled === false ? 1 : 0 };
  }

  const identityId = crypto.randomUUID();
  const externalKey = `${tenantId}:${objectId}`;
  let customer = await env.DB.prepare("SELECT id,customer_number FROM customers WHERE external_identity_id IN (?,?)")
    .bind(externalKey, objectId).first();
  let created = 0;
  let review = 0;

  if (!customer && email) {
    const emailMatch = await env.DB.prepare("SELECT id,customer_number,external_identity_id FROM customers WHERE verified_email=?").bind(email).first();
    if (!emailMatch) {
      customer = await createUniversalCustomer(env, user, tenantId, email, now);
      created = customer ? 1 : 0;
    }
  }

  await env.DB.prepare(`INSERT INTO customer_directory_identities
    (id,customer_id,connector_id,provider,tenant_id,object_id,display_name,given_name,surname,primary_email,user_principal_name,
     account_enabled,directory_status,identities_json,source_created_at,first_seen_at,last_synced_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(identityId, customer?.id || null, CUSTOMER_DIRECTORY_CONNECTOR_ID, CUSTOMER_DIRECTORY_PROVIDER, tenantId, objectId,
      displayName, givenName, surname, email, upn, user.accountEnabled === false ? 0 : 1,
      customer ? directoryStatus : "review_required", identitiesJson, user.createdDateTime || null, now, now, now, now).run();

  if (!customer) {
    if (!email) {
      if (await createReview(env, identityId, "missing_email", "Microsoft did not return a usable customer sign-in email.", null, now)) review += 1;
    } else {
      const emailMatch = await env.DB.prepare("SELECT id FROM customers WHERE verified_email=?").bind(email).first();
      if (emailMatch && await createReview(env, identityId, "email_match", "A universal customer already uses this email. Confirm that both records belong to the same person before linking them.", emailMatch.id, now)) review += 1;
      if (!emailMatch && await createReview(env, identityId, "manual_review", "The Microsoft identity could not be linked automatically.", null, now)) review += 1;
    }
  }

  return { received: 1, created, linked: customer ? 1 : 0, review, disabled: user.accountEnabled === false ? 1 : 0 };
}

export async function testCustomerDirectory(env) {
  await ensureCustomerDirectorySchema(env);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE customer_directory_connectors SET status='testing',last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?")
    .bind(now, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();
  try {
    const token = await acquireCustomerGraphToken(env);
    const data = await customerGraphRequest(env, `/v1.0/users?$top=1&$select=id,displayName`, { token });
    await env.DB.prepare(`UPDATE customer_directory_connectors SET status='connected',last_tested_at=?,last_success_at=?,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?`)
      .bind(now, now, now, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();
    return { connected: true, sampleAvailable: Array.isArray(data.value) && data.value.length > 0 };
  } catch (cause) {
    await env.DB.prepare(`UPDATE customer_directory_connectors SET status='degraded',last_tested_at=?,last_error_code=?,last_error_message=?,updated_at=? WHERE id=?`)
      .bind(now, cause.code || "CONNECTION_FAILED", cleanText(cause.message, 500), now, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();
    throw cause;
  }
}

export async function syncCustomerDirectory(env, requestedMode, startedBy) {
  await ensureCustomerDirectorySchema(env);
  const connector = await env.DB.prepare("SELECT * FROM customer_directory_connectors WHERE id=?").bind(CUSTOMER_DIRECTORY_CONNECTOR_ID).first();
  const mode = requestedMode === "full" ? "full" : connector?.delta_link ? "delta" : "initial";
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const stats = { pages: 0, received: 0, created: 0, updated: 0, linked: 0, review: 0, disabled: 0, deleted: 0 };
  await env.DB.prepare(`INSERT INTO customer_directory_sync_runs
    (id,connector_id,mode,status,started_by,started_at) VALUES (?,?,?,'running',?,?)`)
    .bind(runId, CUSTOMER_DIRECTORY_CONNECTOR_ID, mode, startedBy || null, startedAt).run();
  await env.DB.prepare(`UPDATE customer_directory_connectors SET status='syncing',last_sync_started_at=?,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?`)
    .bind(startedAt, startedAt, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();

  try {
    const token = await acquireCustomerGraphToken(env);
    let nextUrl = mode === "delta" && connector?.delta_link
      ? connector.delta_link
      : `${GRAPH_ROOT}/v1.0/users/delta?$select=${encodeURIComponent(USER_SELECT)}`;
    let deltaLink = null;
    while (nextUrl) {
      if (stats.pages >= 100) throw graphError("CUSTOMER_DIRECTORY_PAGE_LIMIT", "The directory sync exceeded the safe page limit.", 503);
      const page = await customerGraphRequest(env, nextUrl, { token });
      stats.pages += 1;
      for (const user of Array.isArray(page.value) ? page.value : []) {
        const result = await upsertDirectoryUser(env, user, connector.tenant_id, new Date().toISOString());
        for (const key of ["received", "created", "updated", "linked", "review", "disabled", "deleted"]) stats[key] += Number(result[key] || 0);
      }
      nextUrl = page["@odata.nextLink"] || null;
      deltaLink = page["@odata.deltaLink"] || deltaLink;
    }
    const completedAt = new Date().toISOString();
    const totals = await env.DB.prepare(`SELECT COUNT(*) discovered,
      SUM(CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END) linked,
      SUM(CASE WHEN directory_status='review_required' THEN 1 ELSE 0 END) review_required
      FROM customer_directory_identities WHERE connector_id=?`).bind(CUSTOMER_DIRECTORY_CONNECTOR_ID).first();
    await env.DB.prepare(`UPDATE customer_directory_sync_runs SET status='completed',completed_at=?,pages_processed=?,users_received=?,customers_created=?,
      customers_updated=?,identities_linked=?,review_items_created=?,disabled_accounts=?,deleted_accounts=?,summary_json=? WHERE id=?`)
      .bind(completedAt, stats.pages, stats.received, stats.created, stats.updated, stats.linked, stats.review, stats.disabled, stats.deleted, JSON.stringify(stats), runId).run();
    await env.DB.prepare(`UPDATE customer_directory_connectors SET status='connected',delta_link=COALESCE(?,delta_link),last_sync_completed_at=?,last_success_at=?,
      users_discovered=?,users_linked=?,users_review_required=?,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?`)
      .bind(deltaLink, completedAt, completedAt, Number(totals?.discovered || 0), Number(totals?.linked || 0), Number(totals?.review_required || 0), completedAt, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();
    return { runId, mode, stats, totals: { discovered: Number(totals?.discovered || 0), linked: Number(totals?.linked || 0), reviewRequired: Number(totals?.review_required || 0) } };
  } catch (cause) {
    const failedAt = new Date().toISOString();
    await env.DB.prepare(`UPDATE customer_directory_sync_runs SET status='failed',completed_at=?,pages_processed=?,users_received=?,customers_created=?,
      customers_updated=?,identities_linked=?,review_items_created=?,disabled_accounts=?,deleted_accounts=?,error_code=?,error_message=?,summary_json=? WHERE id=?`)
      .bind(failedAt, stats.pages, stats.received, stats.created, stats.updated, stats.linked, stats.review, stats.disabled, stats.deleted,
        cause.code || "SYNC_FAILED", cleanText(cause.message, 500), JSON.stringify(stats), runId).run();
    await env.DB.prepare(`UPDATE customer_directory_connectors SET status='degraded',last_sync_completed_at=?,last_error_code=?,last_error_message=?,updated_at=? WHERE id=?`)
      .bind(failedAt, cause.code || "SYNC_FAILED", cleanText(cause.message, 500), failedAt, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();
    throw cause;
  }
}

export async function manageCustomerDirectoryAccount(env, identityId, action, input = {}) {
  await ensureCustomerDirectorySchema(env);
  const identity = await env.DB.prepare(`SELECT i.*,c.customer_number,c.display_name customer_name,c.account_status
    FROM customer_directory_identities i LEFT JOIN customers c ON c.id=i.customer_id WHERE i.id=?`).bind(identityId).first();
  if (!identity) throw graphError("DIRECTORY_IDENTITY_NOT_FOUND", "The Microsoft customer identity was not found.", 404);
  const objectPath = `/v1.0/users/${encodeURIComponent(identity.object_id)}`;
  const now = new Date().toISOString();

  if (action === "suspend" || action === "reactivate") {
    const enabled = action === "reactivate";
    await customerGraphRequest(env, objectPath, { method: "PATCH", body: { accountEnabled: enabled } });
    await env.DB.prepare(`UPDATE customer_directory_identities SET account_enabled=?,directory_status=?,last_synced_at=?,updated_at=? WHERE id=?`)
      .bind(enabled ? 1 : 0, enabled ? "active" : "disabled", now, now, identity.id).run();
    if (identity.customer_id) {
      await env.DB.prepare(`UPDATE customers SET account_status=CASE WHEN account_status IN ('active','pending','suspended') THEN ? ELSE account_status END,updated_at=? WHERE id=?`)
        .bind(enabled ? "active" : "suspended", now, identity.customer_id).run();
    }
    return { ok: true, action, accountEnabled: enabled, identity };
  }

  if (action === "revoke_sessions") {
    const result = await customerGraphRequest(env, `${objectPath}/revokeSignInSessions`, { method: "POST", body: {} });
    return { ok: Boolean(result?.value ?? true), action, identity };
  }

  if (action === "update_profile") {
    const patch = {};
    const displayName = cleanText(input.displayName, 160);
    const givenName = cleanText(input.givenName, 100);
    const surname = cleanText(input.surname, 100);
    if (displayName) patch.displayName = displayName;
    if (givenName) patch.givenName = givenName;
    if (surname) patch.surname = surname;
    if (!Object.keys(patch).length) throw graphError("INVALID_PROFILE_UPDATE", "Enter at least one profile value to update.", 400);
    await customerGraphRequest(env, objectPath, { method: "PATCH", body: patch });
    await env.DB.prepare(`UPDATE customer_directory_identities SET display_name=COALESCE(?,display_name),given_name=COALESCE(?,given_name),surname=COALESCE(?,surname),last_synced_at=?,updated_at=? WHERE id=?`)
      .bind(displayName || null, givenName || null, surname || null, now, now, identity.id).run();
    if (identity.customer_id && displayName) await env.DB.prepare("UPDATE customers SET display_name=?,updated_at=? WHERE id=?").bind(displayName, now, identity.customer_id).run();
    return { ok: true, action, identity };
  }

  throw graphError("INVALID_DIRECTORY_ACTION", "The requested Microsoft customer-account action is not supported.", 400);
}

export async function resolveCustomerDirectoryReview(env, reviewId, decision, customerId, reviewedBy, reason) {
  await ensureCustomerDirectorySchema(env);
  const review = await env.DB.prepare(`SELECT r.*,i.tenant_id,i.object_id,i.display_name,i.primary_email,i.account_enabled,i.customer_id
    FROM customer_directory_reviews r JOIN customer_directory_identities i ON i.id=r.identity_id WHERE r.id=? AND r.status='open'`).bind(reviewId).first();
  if (!review) throw graphError("DIRECTORY_REVIEW_NOT_FOUND", "The directory review item is no longer open.", 404);
  const now = new Date().toISOString();
  let linkedCustomerId = null;
  let status = "dismissed";

  if (decision === "link_existing") {
    const target = await env.DB.prepare("SELECT id,customer_number FROM customers WHERE id=?").bind(customerId || review.proposed_customer_id).first();
    if (!target) throw graphError("CUSTOMER_NOT_FOUND", "Select an existing universal customer.", 404);
    linkedCustomerId = target.id;
    status = "linked";
  } else if (decision === "create_new") {
    if (!validEmail(review.primary_email)) throw graphError("DIRECTORY_EMAIL_REQUIRED", "A valid email is required before creating a universal customer.", 400);
    const created = await createUniversalCustomer(env, { id: review.object_id, displayName: review.display_name, accountEnabled: Boolean(review.account_enabled) }, review.tenant_id, review.primary_email, now);
    if (!created) throw graphError("DUPLICATE_EMAIL", "A customer already uses that email. Link the identity to the existing customer instead.", 409);
    linkedCustomerId = created.id;
    status = "new_customer_created";
  } else if (decision !== "dismiss") {
    throw graphError("INVALID_REVIEW_DECISION", "Select a valid directory-review decision.", 400);
  }

  if (linkedCustomerId) {
    await env.DB.prepare(`UPDATE customer_directory_identities SET customer_id=?,directory_status=CASE WHEN account_enabled=1 THEN 'active' ELSE 'disabled' END,updated_at=? WHERE id=?`)
      .bind(linkedCustomerId, now, review.identity_id).run();
    await env.DB.prepare("UPDATE customers SET external_identity_id=COALESCE(external_identity_id,?),updated_at=? WHERE id=?")
      .bind(`${review.tenant_id}:${review.object_id}`, now, linkedCustomerId).run();
  }
  await env.DB.prepare(`UPDATE customer_directory_reviews SET status=?,reviewed_by=?,reviewed_at=?,decision_reason=?,updated_at=? WHERE id=?`)
    .bind(status, reviewedBy || null, now, cleanText(reason, 1000) || null, now, review.id).run();
  return { ok: true, status, customerId: linkedCustomerId };
}
