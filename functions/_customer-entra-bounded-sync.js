import { cleanText, validEmail } from "./_shared.js";
import {
  CUSTOMER_DIRECTORY_CONNECTOR_ID,
  CUSTOMER_DIRECTORY_PROVIDER,
  acquireCustomerGraphToken,
  customerGraphRequest,
  ensureCustomerDirectorySchema
} from "./_customer-entra.js";

const GRAPH_ROOT = "https://graph.microsoft.com";
const USER_SELECT = "id,displayName,givenName,surname,mail,userPrincipalName,identities,accountEnabled,createdDateTime,userType";
const DIRECTORY_USERS_PER_PAGE = 15;
const DIRECTORY_PAGES_PER_INVOCATION = 2;
const STAT_KEYS = ["received", "created", "updated", "linked", "review", "disabled", "deleted"];

function graphError(code, message, status = 502, details = undefined) {
  return Object.assign(new Error(message), { code, status, details });
}

async function ensureCheckpointSchema(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS customer_directory_sync_checkpoints (
    connector_id TEXT PRIMARY KEY REFERENCES customer_directory_connectors(id),
    mode TEXT,
    next_link TEXT,
    stats_json TEXT NOT NULL DEFAULT '{}',
    started_by TEXT,
    started_at TEXT,
    last_chunk_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  )`).run();
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

async function createUniqueCustomer(env, user, tenantId, email, now) {
  const id = crypto.randomUUID();
  const displayName = cleanText(user.displayName, 160) || email;
  const externalIdentityId = `${tenantId}:${cleanText(user.id, 100)}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const customerNumber = allocateCustomerNumber();
    try {
      await env.DB.prepare(`INSERT INTO customers
        (id,customer_number,external_identity_id,display_name,verified_email,originating_platform_id,
         account_status,security_status,first_registered_at,last_activity_at,created_at,updated_at)
        VALUES (?,?,?,?,?,NULL,?,'clear',?,?,?,?)`)
        .bind(id, customerNumber, externalIdentityId, displayName, email,
          user.accountEnabled === false ? "suspended" : "active", user.createdDateTime || now, now, now, now).run();
      return { id, customerNumber };
    } catch (cause) {
      const message = String(cause);
      if (message.includes("verified_email")) return null;
      if (message.includes("external_identity_id")) {
        return env.DB.prepare("SELECT id,customer_number FROM customers WHERE external_identity_id=?")
          .bind(externalIdentityId).first();
      }
      if (!message.includes("customer_number")) throw cause;
    }
  }
  throw graphError("CUSTOMER_NUMBER_ALLOCATION_FAILED", "A Unique Customer Number could not be allocated.", 503);
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
      conflict ? "The Microsoft sign-in email is already used by another unique customer." : "Microsoft reports a different sign-in email. Head Office must confirm the identity change before replacing the verified email.",
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
      customer = await createUniqueCustomer(env, user, tenantId, email, now);
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
      if (emailMatch && await createReview(env, identityId, "email_match", "A unique customer already uses this email. Confirm that both records belong to the same person before linking them.", emailMatch.id, now)) review += 1;
      if (!emailMatch && await createReview(env, identityId, "manual_review", "The Microsoft identity could not be linked automatically.", null, now)) review += 1;
    }
  }

  return { received: 1, created, linked: customer ? 1 : 0, review, disabled: user.accountEnabled === false ? 1 : 0 };
}

function emptyStats() {
  return { pages: 0, received: 0, created: 0, updated: 0, linked: 0, review: 0, disabled: 0, deleted: 0 };
}

function parseStats(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return { ...emptyStats(), ...(parsed && typeof parsed === "object" ? parsed : {}) };
  } catch {
    return emptyStats();
  }
}

function addStats(target, source) {
  target.pages += Number(source.pages || 0);
  for (const key of STAT_KEYS) target[key] += Number(source[key] || 0);
  return target;
}

async function saveCheckpoint(env, mode, nextLink, stats, startedBy, startedAt, completedAt = null) {
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO customer_directory_sync_checkpoints
    (connector_id,mode,next_link,stats_json,started_by,started_at,last_chunk_at,completed_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_id) DO UPDATE SET mode=excluded.mode,next_link=excluded.next_link,stats_json=excluded.stats_json,
      started_by=COALESCE(customer_directory_sync_checkpoints.started_by,excluded.started_by),
      started_at=COALESCE(customer_directory_sync_checkpoints.started_at,excluded.started_at),
      last_chunk_at=excluded.last_chunk_at,completed_at=excluded.completed_at,updated_at=excluded.updated_at`)
    .bind(CUSTOMER_DIRECTORY_CONNECTOR_ID, nextLink ? mode : null, nextLink || null, JSON.stringify(stats), startedBy || null,
      startedAt || now, now, completedAt, now).run();
}

function initialDeltaUrl() {
  return `${GRAPH_ROOT}/v1.0/users/delta?$top=${DIRECTORY_USERS_PER_PAGE}&$select=${encodeURIComponent(USER_SELECT)}`;
}

export async function syncCustomerDirectoryBounded(env, requestedMode, startedBy) {
  await ensureCustomerDirectorySchema(env);
  await ensureCheckpointSchema(env);
  const [connector, checkpoint] = await Promise.all([
    env.DB.prepare("SELECT * FROM customer_directory_connectors WHERE id=?").bind(CUSTOMER_DIRECTORY_CONNECTOR_ID).first(),
    env.DB.prepare("SELECT * FROM customer_directory_sync_checkpoints WHERE connector_id=?").bind(CUSTOMER_DIRECTORY_CONNECTOR_ID).first()
  ]);
  if (!connector) throw graphError("CUSTOMER_DIRECTORY_CONNECTOR_NOT_FOUND", "The customer directory connector is unavailable.", 503);

  const pending = Boolean(checkpoint?.next_link);
  const mode = pending
    ? checkpoint.mode
    : requestedMode === "full"
      ? "full"
      : connector.delta_link ? "delta" : "initial";
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const chunkStats = emptyStats();
  const cumulativeStats = pending ? parseStats(checkpoint.stats_json) : emptyStats();

  await env.DB.prepare(`INSERT INTO customer_directory_sync_runs
    (id,connector_id,mode,status,started_by,started_at) VALUES (?,?,?,'running',?,?)`)
    .bind(runId, CUSTOMER_DIRECTORY_CONNECTOR_ID, mode, startedBy || null, startedAt).run();
  await env.DB.prepare(`UPDATE customer_directory_connectors SET status='syncing',last_sync_started_at=?,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?`)
    .bind(startedAt, startedAt, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();

  try {
    const token = await acquireCustomerGraphToken(env);
    let nextUrl = pending ? checkpoint.next_link : mode === "delta" && connector.delta_link ? connector.delta_link : initialDeltaUrl();
    let deltaLink = null;

    while (nextUrl && chunkStats.pages < DIRECTORY_PAGES_PER_INVOCATION) {
      const page = await customerGraphRequest(env, nextUrl, {
        token,
        headers: { Prefer: `odata.maxpagesize=${DIRECTORY_USERS_PER_PAGE}` }
      });
      const pageStats = emptyStats();
      pageStats.pages = 1;
      for (const user of Array.isArray(page.value) ? page.value : []) {
        const result = await upsertDirectoryUser(env, user, connector.tenant_id, new Date().toISOString());
        for (const key of STAT_KEYS) pageStats[key] += Number(result[key] || 0);
      }
      addStats(chunkStats, pageStats);
      addStats(cumulativeStats, pageStats);
      nextUrl = page["@odata.nextLink"] || null;
      deltaLink = page["@odata.deltaLink"] || deltaLink;
      if (nextUrl) await saveCheckpoint(env, mode, nextUrl, cumulativeStats, startedBy, checkpoint?.started_at || startedAt);
    }

    const partial = Boolean(nextUrl);
    const completedAt = new Date().toISOString();
    const totals = await env.DB.prepare(`SELECT COUNT(*) discovered,
      SUM(CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END) linked,
      SUM(CASE WHEN directory_status='review_required' THEN 1 ELSE 0 END) review_required
      FROM customer_directory_identities WHERE connector_id=?`).bind(CUSTOMER_DIRECTORY_CONNECTOR_ID).first();
    const totalSummary = {
      discovered: Number(totals?.discovered || 0),
      linked: Number(totals?.linked || 0),
      reviewRequired: Number(totals?.review_required || 0)
    };
    const summary = { chunk: chunkStats, cumulative: cumulativeStats, partial, continuationPending: partial };

    await env.DB.prepare(`UPDATE customer_directory_sync_runs SET status='completed',completed_at=?,pages_processed=?,users_received=?,customers_created=?,
      customers_updated=?,identities_linked=?,review_items_created=?,disabled_accounts=?,deleted_accounts=?,summary_json=? WHERE id=?`)
      .bind(completedAt, chunkStats.pages, chunkStats.received, chunkStats.created, chunkStats.updated, chunkStats.linked,
        chunkStats.review, chunkStats.disabled, chunkStats.deleted, JSON.stringify(summary), runId).run();

    if (partial) {
      await env.DB.prepare(`UPDATE customer_directory_connectors SET status='syncing',last_sync_completed_at=?,users_discovered=?,users_linked=?,
        users_review_required=?,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?`)
        .bind(completedAt, totalSummary.discovered, totalSummary.linked, totalSummary.reviewRequired, completedAt, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();
    } else {
      await saveCheckpoint(env, mode, null, cumulativeStats, startedBy, checkpoint?.started_at || startedAt, completedAt);
      await env.DB.prepare(`UPDATE customer_directory_connectors SET status='connected',delta_link=COALESCE(?,delta_link),last_sync_completed_at=?,last_success_at=?,
        users_discovered=?,users_linked=?,users_review_required=?,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?`)
        .bind(deltaLink, completedAt, completedAt, totalSummary.discovered, totalSummary.linked, totalSummary.reviewRequired,
          completedAt, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();
    }

    return {
      runId,
      mode,
      partial,
      continuationPending: partial,
      stats: chunkStats,
      cumulativeStats,
      totals: totalSummary,
      limits: { usersPerPage: DIRECTORY_USERS_PER_PAGE, pagesPerInvocation: DIRECTORY_PAGES_PER_INVOCATION }
    };
  } catch (cause) {
    const failedAt = new Date().toISOString();
    await env.DB.prepare(`UPDATE customer_directory_sync_runs SET status='failed',completed_at=?,pages_processed=?,users_received=?,customers_created=?,
      customers_updated=?,identities_linked=?,review_items_created=?,disabled_accounts=?,deleted_accounts=?,error_code=?,error_message=?,summary_json=? WHERE id=?`)
      .bind(failedAt, chunkStats.pages, chunkStats.received, chunkStats.created, chunkStats.updated, chunkStats.linked,
        chunkStats.review, chunkStats.disabled, chunkStats.deleted, cause.code || "SYNC_FAILED", cleanText(cause.message, 500),
        JSON.stringify({ chunk: chunkStats, cumulative: cumulativeStats }), runId).run();
    await env.DB.prepare(`UPDATE customer_directory_connectors SET status='degraded',last_sync_completed_at=?,last_error_code=?,last_error_message=?,updated_at=? WHERE id=?`)
      .bind(failedAt, cause.code || "SYNC_FAILED", cleanText(cause.message, 500), failedAt, CUSTOMER_DIRECTORY_CONNECTOR_ID).run();
    throw cause;
  }
}
