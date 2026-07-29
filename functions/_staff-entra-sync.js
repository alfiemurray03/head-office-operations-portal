import { cleanText, validEmail } from "./_shared.js";
import { allocateStaffNumber, ensureStaffDirectoryReady } from "./_staff-directory.js";

export const STAFF_DIRECTORY_CONNECTOR_ID = "staff-entra-tenant";
export const STAFF_DIRECTORY_PROVIDER = "microsoft_entra";

const DEFAULT_TENANT_ID = "53477196-db21-46d2-8123-00be3d6882da";
const DEFAULT_CLIENT_ID = "4f5c0708-f580-4514-b710-3cb780939348";
const GRAPH_ROOT = "https://graph.microsoft.com";
const USER_SELECT = [
  "id", "displayName", "givenName", "surname", "mail", "userPrincipalName", "otherMails",
  "userType", "accountEnabled", "createdDateTime", "jobTitle", "department", "employeeId",
  "employeeType", "officeLocation", "companyName", "mobilePhone", "businessPhones",
  "creationType", "externalUserState"
].join(",");
const USERS_PER_PAGE = 10;
const PAGES_PER_INVOCATION = 1;
const STAT_KEYS = ["received", "created", "linked", "updated", "disabled", "guest", "deleted"];

let schemaReadyPromise = null;

function graphError(code, message, status = 502, details = undefined) {
  return Object.assign(new Error(message), { code, status, details });
}

function connectorConfig(env) {
  return {
    tenantId: cleanText(env.ADMIN_OIDC_TENANT_ID, 100) || DEFAULT_TENANT_ID,
    clientId: cleanText(env.ADMIN_OIDC_CLIENT_ID, 100) || DEFAULT_CLIENT_ID,
    clientSecret: String(env.ADMIN_OIDC_CLIENT_SECRET || env.AZURE_AD_CLIENT_SECRET || "").trim()
  };
}

export function staffTenantDirectoryConfigured(env) {
  const config = connectorConfig(env);
  return Boolean(config.tenantId && config.clientId && config.clientSecret);
}

async function initialiseSyncSchema(env) {
  await ensureStaffDirectoryReady(env);
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS staff_directory_connectors (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL UNIQUE, tenant_id TEXT NOT NULL, display_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'configured' CHECK (status IN ('not_configured','configured','connected','syncing','degraded','suspended')),
      delta_link TEXT, last_sync_started_at TEXT, last_sync_completed_at TEXT, last_success_at TEXT,
      last_error_code TEXT, last_error_message TEXT, users_discovered INTEGER NOT NULL DEFAULT 0,
      active_users INTEGER NOT NULL DEFAULT 0, disabled_users INTEGER NOT NULL DEFAULT 0,
      guest_users INTEGER NOT NULL DEFAULT 0, deleted_users INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS staff_directory_identities (
      id TEXT PRIMARY KEY, staff_profile_id TEXT NOT NULL UNIQUE REFERENCES staff_directory_profiles(id),
      connector_id TEXT NOT NULL REFERENCES staff_directory_connectors(id), provider TEXT NOT NULL,
      tenant_id TEXT NOT NULL, object_id TEXT NOT NULL, display_name TEXT NOT NULL, given_name TEXT,
      surname TEXT, mail TEXT, user_principal_name TEXT, user_type TEXT,
      account_enabled INTEGER NOT NULL DEFAULT 1 CHECK (account_enabled IN (0,1)),
      directory_status TEXT NOT NULL DEFAULT 'active' CHECK (directory_status IN ('active','disabled','guest','deleted','unclassified')),
      employee_id TEXT, employee_type TEXT, job_title TEXT, department TEXT, office_location TEXT,
      company_name TEXT, mobile_phone TEXT, business_phones_json TEXT NOT NULL DEFAULT '[]',
      creation_type TEXT, external_user_state TEXT,
      profile_created_by_sync INTEGER NOT NULL DEFAULT 0 CHECK (profile_created_by_sync IN (0,1)),
      source_created_at TEXT, first_seen_at TEXT NOT NULL, last_synced_at TEXT NOT NULL,
      deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(provider,tenant_id,object_id)
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS staff_directory_sync_checkpoints (
      connector_id TEXT PRIMARY KEY REFERENCES staff_directory_connectors(id), mode TEXT, next_link TEXT,
      stats_json TEXT NOT NULL DEFAULT '{}', started_by TEXT, started_at TEXT, last_chunk_at TEXT,
      completed_at TEXT, updated_at TEXT NOT NULL
    )`),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS staff_directory_sync_runs (
      id TEXT PRIMARY KEY, connector_id TEXT NOT NULL REFERENCES staff_directory_connectors(id),
      mode TEXT NOT NULL CHECK (mode IN ('initial','full','delta')),
      status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
      started_by TEXT, started_at TEXT NOT NULL, completed_at TEXT,
      pages_processed INTEGER NOT NULL DEFAULT 0, users_received INTEGER NOT NULL DEFAULT 0,
      profiles_created INTEGER NOT NULL DEFAULT 0, profiles_linked INTEGER NOT NULL DEFAULT 0,
      identities_updated INTEGER NOT NULL DEFAULT 0, disabled_accounts INTEGER NOT NULL DEFAULT 0,
      guest_accounts INTEGER NOT NULL DEFAULT 0, deleted_accounts INTEGER NOT NULL DEFAULT 0,
      error_code TEXT, error_message TEXT, summary_json TEXT NOT NULL DEFAULT '{}'
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_staff_directory_identity_object ON staff_directory_identities(tenant_id,object_id)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_staff_directory_identity_status ON staff_directory_identities(directory_status,user_type,last_synced_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_staff_directory_identity_mail ON staff_directory_identities(mail,user_principal_name)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_staff_directory_sync_runs ON staff_directory_sync_runs(started_at DESC,status)")
  ]);

  const config = connectorConfig(env);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO staff_directory_connectors
    (id,provider,tenant_id,display_name,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id,display_name=excluded.display_name,
      status=CASE WHEN staff_directory_connectors.status IN ('connected','syncing','degraded','suspended')
        THEN staff_directory_connectors.status ELSE excluded.status END,updated_at=excluded.updated_at`)
    .bind(STAFF_DIRECTORY_CONNECTOR_ID, STAFF_DIRECTORY_PROVIDER, config.tenantId,
      "JA Group Services Microsoft tenant", staffTenantDirectoryConfigured(env) ? "configured" : "not_configured", now, now).run();
}

export async function ensureStaffTenantDirectorySchema(env) {
  if (!schemaReadyPromise) {
    schemaReadyPromise = initialiseSyncSchema(env).catch(cause => {
      schemaReadyPromise = null;
      throw cause;
    });
  }
  return schemaReadyPromise;
}

export async function acquireStaffGraphToken(env) {
  const config = connectorConfig(env);
  if (!staffTenantDirectoryConfigured(env)) {
    throw graphError("STAFF_ENTRA_NOT_CONFIGURED", "The existing Microsoft staff application secret is not configured.", 503);
  }
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials"
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw graphError("STAFF_ENTRA_TOKEN_FAILED", "Microsoft rejected the Staff Directory connection.", response.status || 502, {
      microsoftCode: cleanText(data.error, 100),
      microsoftMessage: cleanText(data.error_description, 500)
    });
  }
  return data.access_token;
}

function permittedGraphUrl(pathOrUrl) {
  const url = String(pathOrUrl || "").startsWith("http") ? new URL(pathOrUrl) : new URL(pathOrUrl, GRAPH_ROOT);
  if (url.origin !== GRAPH_ROOT) throw graphError("INVALID_STAFF_GRAPH_URL", "The Microsoft Graph continuation URL was rejected.", 500);
  return url.toString();
}

export async function staffGraphRequest(env, pathOrUrl, options = {}) {
  const token = options.token || await acquireStaffGraphToken(env);
  const url = permittedGraphUrl(pathOrUrl);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      const retryAfter = Math.min(Number(response.headers.get("Retry-After") || 1), 5);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      continue;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw graphError("STAFF_ENTRA_GRAPH_FAILED", cleanText(data.error?.message, 500) || "Microsoft Graph rejected the Staff Directory request.", response.status || 502, {
        microsoftCode: cleanText(data.error?.code, 120)
      });
    }
    return data;
  }
  throw graphError("STAFF_ENTRA_GRAPH_UNAVAILABLE", "Microsoft Graph did not respond after retrying.", 503);
}

function sourceEmail(user, objectId) {
  const otherMails = Array.isArray(user.otherMails) ? user.otherMails : [];
  const candidates = [user.mail, ...otherMails, user.userPrincipalName]
    .map(value => cleanText(value, 254).toLowerCase())
    .filter(Boolean);
  return candidates.find(validEmail) || `entra-${objectId.toLowerCase()}@directory.invalid`;
}

function employmentTypeFor(user) {
  if (String(user.userType || "").toLowerCase() === "guest") return "other";
  const source = String(user.employeeType || "").toLowerCase();
  if (source.includes("director")) return "director";
  if (["contractor", "consultant", "vendor", "freelance"].some(value => source.includes(value))) return "contractor";
  if (["agency", "temporary", "temp"].some(value => source.includes(value))) return "agency";
  if (source.includes("volunteer")) return "volunteer";
  return "employee";
}

function directoryStatusFor(user) {
  if (user["@removed"]) return "deleted";
  if (user.accountEnabled === false) return "disabled";
  if (String(user.userType || "").toLowerCase() === "guest") return "guest";
  return "active";
}

function profileStatusFor(directoryStatus) {
  return ["disabled", "deleted"].includes(directoryStatus) ? "suspended" : "active";
}

function telephoneFor(user) {
  const phones = Array.isArray(user.businessPhones) ? user.businessPhones : [];
  return cleanText(user.mobilePhone, 60) || cleanText(phones[0], 60) || null;
}

function snapshot(user, objectId) {
  const email = sourceEmail(user, objectId);
  return {
    objectId,
    displayName: cleanText(user.displayName, 160) || email,
    givenName: cleanText(user.givenName, 100) || null,
    surname: cleanText(user.surname, 100) || null,
    email,
    userPrincipalName: cleanText(user.userPrincipalName, 254) || null,
    userType: cleanText(user.userType, 40) || null,
    accountEnabled: user.accountEnabled === false ? 0 : 1,
    directoryStatus: directoryStatusFor(user),
    employeeId: cleanText(user.employeeId, 80) || null,
    employeeType: cleanText(user.employeeType, 80) || null,
    jobTitle: cleanText(user.jobTitle, 160) || null,
    department: cleanText(user.department, 160) || null,
    officeLocation: cleanText(user.officeLocation, 160) || null,
    companyName: cleanText(user.companyName, 160) || null,
    mobilePhone: cleanText(user.mobilePhone, 60) || null,
    businessPhonesJson: JSON.stringify((Array.isArray(user.businessPhones) ? user.businessPhones : []).map(value => cleanText(value, 60)).filter(Boolean).slice(0, 5)),
    creationType: cleanText(user.creationType, 80) || null,
    externalUserState: cleanText(user.externalUserState, 80) || null,
    sourceCreatedAt: cleanText(user.createdDateTime, 60) || null
  };
}

async function portalIdentityFor(env, objectId) {
  return env.DB.prepare("SELECT id,display_name,email,status FROM staff_members WHERE external_identity_id=? LIMIT 1")
    .bind(objectId).first();
}

async function availableProfileByEmail(env, email) {
  if (!email || email.endsWith("@directory.invalid")) return null;
  const result = await env.DB.prepare(`SELECT p.* FROM staff_directory_profiles p
    LEFT JOIN staff_directory_identities i ON i.staff_profile_id=p.id
    WHERE lower(p.email)=lower(?) AND i.id IS NULL LIMIT 2`).bind(email).all();
  return result.results.length === 1 ? result.results[0] : null;
}

async function createSyncedProfile(env, source, portalIdentity, now) {
  const id = crypto.randomUUID();
  const staffNumber = await allocateStaffNumber(env);
  await env.DB.prepare(`INSERT INTO staff_directory_profiles
    (id,staff_number,linked_staff_member_id,display_name,email,job_title,employment_type,organisation_unit_id,
     division_code,department,telephone,internal_extension,start_date,end_date,directory_notes,status,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,NULL,NULL,?,?,NULL,NULL,NULL,NULL,?,?,?)`)
    .bind(id, staffNumber, portalIdentity?.id || null, source.displayName, source.email, source.jobTitle,
      employmentTypeFor({ employeeType: source.employeeType, userType: source.userType }), source.department,
      telephoneFor({ mobilePhone: source.mobilePhone, businessPhones: JSON.parse(source.businessPhonesJson) }),
      profileStatusFor(source.directoryStatus), now, now).run();
  return { id, staff_number: staffNumber };
}

async function attachPortalIdentity(env, profileId, portalIdentity, now) {
  if (!portalIdentity) return;
  const existing = await env.DB.prepare("SELECT id FROM staff_directory_profiles WHERE linked_staff_member_id=? AND id<>? LIMIT 1")
    .bind(portalIdentity.id, profileId).first();
  if (existing) return;
  await env.DB.prepare("UPDATE staff_directory_profiles SET linked_staff_member_id=COALESCE(linked_staff_member_id,?),updated_at=? WHERE id=?")
    .bind(portalIdentity.id, now, profileId).run();
}

async function upsertTenantUser(env, user, tenantId, now) {
  const objectId = cleanText(user.id, 100);
  if (!objectId) return { received: 1 };
  const existing = await env.DB.prepare(`SELECT * FROM staff_directory_identities
    WHERE provider=? AND tenant_id=? AND object_id=? LIMIT 1`)
    .bind(STAFF_DIRECTORY_PROVIDER, tenantId, objectId).first();

  if (user["@removed"]) {
    if (!existing) return { received: 1, deleted: 1 };
    await env.DB.prepare(`UPDATE staff_directory_identities SET account_enabled=0,directory_status='deleted',deleted_at=?,last_synced_at=?,updated_at=? WHERE id=?`)
      .bind(now, now, now, existing.id).run();
    if (Number(existing.profile_created_by_sync) === 1) {
      await env.DB.prepare(`UPDATE staff_directory_profiles SET status=CASE WHEN status IN ('left','archived') THEN status ELSE 'suspended' END,updated_at=? WHERE id=?`)
        .bind(now, existing.staff_profile_id).run();
    }
    return { received: 1, deleted: 1, updated: 1 };
  }

  const source = snapshot(user, objectId);
  const portalIdentity = await portalIdentityFor(env, objectId);

  if (existing) {
    await env.DB.prepare(`UPDATE staff_directory_identities SET display_name=?,given_name=?,surname=?,mail=?,user_principal_name=?,
      user_type=?,account_enabled=?,directory_status=?,employee_id=?,employee_type=?,job_title=?,department=?,office_location=?,
      company_name=?,mobile_phone=?,business_phones_json=?,creation_type=?,external_user_state=?,source_created_at=?,
      last_synced_at=?,deleted_at=NULL,updated_at=? WHERE id=?`)
      .bind(source.displayName, source.givenName, source.surname, source.email, source.userPrincipalName,
        source.userType, source.accountEnabled, source.directoryStatus, source.employeeId, source.employeeType,
        source.jobTitle, source.department, source.officeLocation, source.companyName, source.mobilePhone,
        source.businessPhonesJson, source.creationType, source.externalUserState, source.sourceCreatedAt, now, now, existing.id).run();

    if (Number(existing.profile_created_by_sync) === 1) {
      await env.DB.prepare(`UPDATE staff_directory_profiles SET display_name=?,email=?,job_title=?,department=?,telephone=?,
        status=CASE WHEN status IN ('left','archived') THEN status ELSE ? END,updated_at=? WHERE id=?`)
        .bind(source.displayName, source.email, source.jobTitle, source.department,
          telephoneFor({ mobilePhone: source.mobilePhone, businessPhones: JSON.parse(source.businessPhonesJson) }),
          profileStatusFor(source.directoryStatus), now, existing.staff_profile_id).run();
    }
    await attachPortalIdentity(env, existing.staff_profile_id, portalIdentity, now);
    return {
      received: 1,
      updated: 1,
      disabled: source.directoryStatus === "disabled" ? 1 : 0,
      guest: source.directoryStatus === "guest" ? 1 : 0
    };
  }

  let profile = portalIdentity
    ? await env.DB.prepare("SELECT * FROM staff_directory_profiles WHERE linked_staff_member_id=? LIMIT 1").bind(portalIdentity.id).first()
    : null;
  if (!profile) profile = await availableProfileByEmail(env, source.email);
  let profileCreatedBySync = 0;
  let created = 0;
  let linked = 0;
  if (!profile) {
    profile = await createSyncedProfile(env, source, portalIdentity, now);
    profileCreatedBySync = 1;
    created = 1;
  } else {
    linked = 1;
    await attachPortalIdentity(env, profile.id, portalIdentity, now);
  }

  await env.DB.prepare(`INSERT INTO staff_directory_identities
    (id,staff_profile_id,connector_id,provider,tenant_id,object_id,display_name,given_name,surname,mail,user_principal_name,
     user_type,account_enabled,directory_status,employee_id,employee_type,job_title,department,office_location,company_name,
     mobile_phone,business_phones_json,creation_type,external_user_state,profile_created_by_sync,source_created_at,
     first_seen_at,last_synced_at,deleted_at,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)`)
    .bind(crypto.randomUUID(), profile.id, STAFF_DIRECTORY_CONNECTOR_ID, STAFF_DIRECTORY_PROVIDER, tenantId, objectId,
      source.displayName, source.givenName, source.surname, source.email, source.userPrincipalName, source.userType,
      source.accountEnabled, source.directoryStatus, source.employeeId, source.employeeType, source.jobTitle,
      source.department, source.officeLocation, source.companyName, source.mobilePhone, source.businessPhonesJson,
      source.creationType, source.externalUserState, profileCreatedBySync, source.sourceCreatedAt, now, now, now, now).run();

  return {
    received: 1,
    created,
    linked,
    disabled: source.directoryStatus === "disabled" ? 1 : 0,
    guest: source.directoryStatus === "guest" ? 1 : 0
  };
}

function emptyStats() {
  return { pages: 0, received: 0, created: 0, linked: 0, updated: 0, disabled: 0, guest: 0, deleted: 0 };
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
  await env.DB.prepare(`INSERT INTO staff_directory_sync_checkpoints
    (connector_id,mode,next_link,stats_json,started_by,started_at,last_chunk_at,completed_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(connector_id) DO UPDATE SET mode=excluded.mode,next_link=excluded.next_link,stats_json=excluded.stats_json,
      started_by=COALESCE(staff_directory_sync_checkpoints.started_by,excluded.started_by),
      started_at=COALESCE(staff_directory_sync_checkpoints.started_at,excluded.started_at),
      last_chunk_at=excluded.last_chunk_at,completed_at=excluded.completed_at,updated_at=excluded.updated_at`)
    .bind(STAFF_DIRECTORY_CONNECTOR_ID, nextLink ? mode : null, nextLink || null, JSON.stringify(stats),
      startedBy || null, startedAt || now, now, completedAt, now).run();
}

function initialDeltaUrl() {
  return `${GRAPH_ROOT}/v1.0/users/delta?$top=${USERS_PER_PAGE}&$select=${encodeURIComponent(USER_SELECT)}`;
}

async function tenantTotals(env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) discovered,
    SUM(CASE WHEN directory_status='active' THEN 1 ELSE 0 END) active,
    SUM(CASE WHEN directory_status='disabled' THEN 1 ELSE 0 END) disabled,
    SUM(CASE WHEN directory_status='guest' THEN 1 ELSE 0 END) guests,
    SUM(CASE WHEN directory_status='deleted' THEN 1 ELSE 0 END) deleted
    FROM staff_directory_identities WHERE connector_id=?`).bind(STAFF_DIRECTORY_CONNECTOR_ID).first();
  return {
    discovered: Number(row?.discovered || 0),
    active: Number(row?.active || 0),
    disabled: Number(row?.disabled || 0),
    guests: Number(row?.guests || 0),
    deleted: Number(row?.deleted || 0)
  };
}

export async function syncStaffTenantDirectory(env, requestedMode = "delta", startedBy = null) {
  await ensureStaffTenantDirectorySchema(env);
  const config = connectorConfig(env);
  const [connector, checkpoint] = await Promise.all([
    env.DB.prepare("SELECT * FROM staff_directory_connectors WHERE id=?").bind(STAFF_DIRECTORY_CONNECTOR_ID).first(),
    env.DB.prepare("SELECT * FROM staff_directory_sync_checkpoints WHERE connector_id=?").bind(STAFF_DIRECTORY_CONNECTOR_ID).first()
  ]);
  if (!connector) throw graphError("STAFF_DIRECTORY_CONNECTOR_NOT_FOUND", "The Staff Directory connector is unavailable.", 503);

  const pending = Boolean(checkpoint?.next_link);
  const mode = pending ? checkpoint.mode : requestedMode === "full" ? "full" : connector.delta_link ? "delta" : "initial";
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const chunkStats = emptyStats();
  const cumulativeStats = pending ? parseStats(checkpoint.stats_json) : emptyStats();

  await env.DB.prepare(`INSERT INTO staff_directory_sync_runs
    (id,connector_id,mode,status,started_by,started_at) VALUES (?,?,?,'running',?,?)`)
    .bind(runId, STAFF_DIRECTORY_CONNECTOR_ID, mode, startedBy, startedAt).run();
  await env.DB.prepare(`UPDATE staff_directory_connectors SET status='syncing',last_sync_started_at=?,
    last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?`)
    .bind(startedAt, startedAt, STAFF_DIRECTORY_CONNECTOR_ID).run();

  try {
    const token = await acquireStaffGraphToken(env);
    let nextUrl = pending ? checkpoint.next_link : mode === "delta" && connector.delta_link ? connector.delta_link : initialDeltaUrl();
    let deltaLink = null;

    while (nextUrl && chunkStats.pages < PAGES_PER_INVOCATION) {
      const page = await staffGraphRequest(env, nextUrl, {
        token,
        headers: { Prefer: `odata.maxpagesize=${USERS_PER_PAGE}` }
      });
      const pageStats = emptyStats();
      pageStats.pages = 1;
      for (const user of Array.isArray(page.value) ? page.value : []) {
        const result = await upsertTenantUser(env, user, config.tenantId, new Date().toISOString());
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
    const totals = await tenantTotals(env);
    const summary = { chunk: chunkStats, cumulative: cumulativeStats, partial, continuationPending: partial };

    await env.DB.prepare(`UPDATE staff_directory_sync_runs SET status='completed',completed_at=?,pages_processed=?,users_received=?,
      profiles_created=?,profiles_linked=?,identities_updated=?,disabled_accounts=?,guest_accounts=?,deleted_accounts=?,summary_json=? WHERE id=?`)
      .bind(completedAt, chunkStats.pages, chunkStats.received, chunkStats.created, chunkStats.linked, chunkStats.updated,
        chunkStats.disabled, chunkStats.guest, chunkStats.deleted, JSON.stringify(summary), runId).run();

    if (partial) {
      await env.DB.prepare(`UPDATE staff_directory_connectors SET status='syncing',last_sync_completed_at=?,users_discovered=?,
        active_users=?,disabled_users=?,guest_users=?,deleted_users=?,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?`)
        .bind(completedAt, totals.discovered, totals.active, totals.disabled, totals.guests, totals.deleted,
          completedAt, STAFF_DIRECTORY_CONNECTOR_ID).run();
    } else {
      await saveCheckpoint(env, mode, null, cumulativeStats, startedBy, checkpoint?.started_at || startedAt, completedAt);
      await env.DB.prepare(`UPDATE staff_directory_connectors SET status='connected',delta_link=COALESCE(?,delta_link),
        last_sync_completed_at=?,last_success_at=?,users_discovered=?,active_users=?,disabled_users=?,guest_users=?,
        deleted_users=?,last_error_code=NULL,last_error_message=NULL,updated_at=? WHERE id=?`)
        .bind(deltaLink, completedAt, completedAt, totals.discovered, totals.active, totals.disabled, totals.guests,
          totals.deleted, completedAt, STAFF_DIRECTORY_CONNECTOR_ID).run();
    }

    return {
      runId,
      mode,
      partial,
      continuationPending: partial,
      stats: chunkStats,
      cumulativeStats,
      totals,
      limits: { usersPerPage: USERS_PER_PAGE, pagesPerInvocation: PAGES_PER_INVOCATION }
    };
  } catch (cause) {
    const failedAt = new Date().toISOString();
    await env.DB.prepare(`UPDATE staff_directory_sync_runs SET status='failed',completed_at=?,pages_processed=?,users_received=?,
      profiles_created=?,profiles_linked=?,identities_updated=?,disabled_accounts=?,guest_accounts=?,deleted_accounts=?,
      error_code=?,error_message=?,summary_json=? WHERE id=?`)
      .bind(failedAt, chunkStats.pages, chunkStats.received, chunkStats.created, chunkStats.linked, chunkStats.updated,
        chunkStats.disabled, chunkStats.guest, chunkStats.deleted, cause.code || "SYNC_FAILED", cleanText(cause.message, 500),
        JSON.stringify({ chunk: chunkStats, cumulative: cumulativeStats }), runId).run();
    await env.DB.prepare(`UPDATE staff_directory_connectors SET status='degraded',last_sync_completed_at=?,last_error_code=?,
      last_error_message=?,updated_at=? WHERE id=?`)
      .bind(failedAt, cause.code || "SYNC_FAILED", cleanText(cause.message, 500), failedAt, STAFF_DIRECTORY_CONNECTOR_ID).run();
    throw cause;
  }
}

export async function staffTenantDirectoryStatus(env) {
  await ensureStaffTenantDirectorySchema(env);
  const [connector, checkpoint, recentRuns, totals] = await Promise.all([
    env.DB.prepare("SELECT * FROM staff_directory_connectors WHERE id=?").bind(STAFF_DIRECTORY_CONNECTOR_ID).first(),
    env.DB.prepare("SELECT mode,next_link,stats_json,started_at,last_chunk_at FROM staff_directory_sync_checkpoints WHERE connector_id=?")
      .bind(STAFF_DIRECTORY_CONNECTOR_ID).first(),
    env.DB.prepare(`SELECT id,mode,status,started_by,started_at,completed_at,pages_processed,users_received,
      profiles_created,profiles_linked,identities_updated,disabled_accounts,guest_accounts,deleted_accounts,error_code,error_message
      FROM staff_directory_sync_runs WHERE connector_id=? ORDER BY started_at DESC LIMIT 10`)
      .bind(STAFF_DIRECTORY_CONNECTOR_ID).all(),
    tenantTotals(env)
  ]);
  return {
    configured: staffTenantDirectoryConfigured(env),
    reusesHeadOfficeLoginApp: true,
    connector: connector || null,
    continuationPending: Boolean(checkpoint?.next_link),
    checkpoint: checkpoint ? { ...checkpoint, stats: parseStats(checkpoint.stats_json) } : null,
    totals,
    recentRuns: recentRuns.results,
    requiredBindings: ["ADMIN_OIDC_TENANT_ID", "ADMIN_OIDC_CLIENT_ID", "AZURE_AD_CLIENT_SECRET"],
    requiredGraphApplicationPermission: "User.Read.All"
  };
}
