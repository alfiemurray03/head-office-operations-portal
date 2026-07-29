import { cleanText } from "./_shared.js";
import { calculateAccessDecision } from "./_central-access.js";

const CONTROL_PLANE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS security_marker_definitions (
    marker_type TEXT PRIMARY KEY, marker_code TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
    crm_display_label TEXT NOT NULL, branch_instruction TEXT NOT NULL,
    customer_visible INTEGER NOT NULL DEFAULT 0, site_enforcement TEXT NOT NULL DEFAULT 'display_only',
    status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS security_marker_references (
    marker_id TEXT PRIMARY KEY, marker_reference TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS platform_lockdowns (
    id TEXT PRIMARY KEY, platform_id TEXT NOT NULL, incident_reference TEXT NOT NULL, reason TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'critical', status TEXT NOT NULL DEFAULT 'active',
    manual_initiation INTEGER NOT NULL DEFAULT 1, initiated_by TEXT NOT NULL, initiated_at TEXT NOT NULL,
    lifted_by TEXT, lifted_at TEXT, lift_reason TEXT, review_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS platform_security_commands (
    id TEXT PRIMARY KEY, platform_id TEXT NOT NULL, lockdown_id TEXT, command TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL, delivered_at TEXT, acknowledged_at TEXT, result_json TEXT NOT NULL DEFAULT '{}'
  )`
];

export async function ensureSecurityControlPlane(env) {
  for (const statement of CONTROL_PLANE_STATEMENTS) await env.DB.prepare(statement).run();
}

function markerReferenceCandidate(markerType) {
  const year = new Date().getUTCFullYear();
  const compactType = String(markerType || "GEN").split("_").map(part => part[0]).join("").slice(0,4).toUpperCase() || "GEN";
  const random = crypto.randomUUID().replaceAll("-", "").slice(0,8).toUpperCase();
  return `SMR-${compactType}-${year}-${random}`;
}

export async function ensureMarkerReference(env, markerId, markerType) {
  await ensureSecurityControlPlane(env);
  const existing = await env.DB.prepare("SELECT marker_reference FROM security_marker_references WHERE marker_id=?").bind(markerId).first();
  if (existing?.marker_reference) return existing.marker_reference;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const markerReference = markerReferenceCandidate(markerType);
    try {
      await env.DB.prepare(`INSERT INTO security_marker_references(marker_id,marker_reference,created_at)
        VALUES (?,?,?)`).bind(markerId, markerReference, new Date().toISOString()).run();
      return markerReference;
    } catch (cause) {
      if (!String(cause).includes("marker_reference")) throw cause;
    }
  }
  throw Object.assign(new Error("A unique security marker reference could not be allocated."), { code: "MARKER_REFERENCE_ALLOCATION_FAILED", status: 503 });
}

export async function listCustomerSecurityMarkers(env, customerId) {
  await ensureSecurityControlPlane(env);
  const result = await env.DB.prepare(`SELECT m.id,m.marker_type,m.risk_level,m.visibility,m.status,m.review_at,m.expires_at,m.created_at,
      d.marker_code,d.category,d.crm_display_label,d.branch_instruction,d.site_enforcement,
      r.marker_reference
    FROM security_markers m
    LEFT JOIN security_marker_definitions d ON d.marker_type=m.marker_type AND d.status='active'
    LEFT JOIN security_marker_references r ON r.marker_id=m.id
    WHERE m.customer_id=? AND m.status IN ('active','under_review')
      AND (m.expires_at IS NULL OR m.expires_at>?)
    ORDER BY CASE m.risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END,m.created_at DESC`)
    .bind(customerId, new Date().toISOString()).all();

  const markers = [];
  for (const row of result.results || []) {
    const markerReference = row.marker_reference || await ensureMarkerReference(env, row.id, row.marker_type);
    markers.push({
      id: row.id,
      markerReference,
      markerCode: row.marker_code || row.marker_type,
      markerType: row.marker_type,
      category: row.category || "security",
      label: row.crm_display_label || row.marker_type,
      riskLevel: row.risk_level,
      status: row.status,
      visibility: row.visibility,
      instruction: row.branch_instruction || "Contact Head Office for the current customer-security instruction.",
      enforcement: row.site_enforcement || "display_only",
      reviewAt: row.review_at,
      expiresAt: row.expires_at,
      confidentialReasonWithheld: true
    });
  }
  return markers;
}

export async function listPlatformLockdowns(env) {
  await ensureSecurityControlPlane(env);
  const rows = await env.DB.prepare(`SELECT l.*,p.name platform_name,p.code platform_code,p.status platform_status,
      p.public_url
    FROM platform_lockdowns l JOIN platforms p ON p.id=l.platform_id
    ORDER BY CASE l.status WHEN 'active' THEN 1 ELSE 2 END,l.initiated_at DESC LIMIT 250`).all();
  return rows.results || [];
}

export async function activePlatformLockdown(env, platformId) {
  await ensureSecurityControlPlane(env);
  return env.DB.prepare(`SELECT l.*,p.code platform_code,p.name platform_name
    FROM platform_lockdowns l JOIN platforms p ON p.id=l.platform_id
    WHERE l.platform_id=? AND l.status='active' ORDER BY l.initiated_at DESC LIMIT 1`).bind(platformId).first();
}

async function queuePlatformSecurityCommand(env, platformId, lockdownId, command, payload) {
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO platform_security_commands
    (id,platform_id,lockdown_id,command,payload_json,status,created_at)
    VALUES (?,?,?,?,?,'pending',?)`).bind(id, platformId, lockdownId || null, command, JSON.stringify(payload || {}), new Date().toISOString()).run();
  return id;
}

export async function initiateManualPlatformLockdown(env, platform, input, actorId) {
  await ensureSecurityControlPlane(env);
  const incidentReference = cleanText(input.incidentReference, 120);
  const reason = cleanText(input.reason, 3000);
  const confirmation = cleanText(input.confirmation, 180).toUpperCase();
  const expected = `LOCKDOWN ${String(platform.code || "").toUpperCase()}`;
  if (incidentReference.length < 5) throw Object.assign(new Error("Enter the critical security incident or breach reference."), { code: "INCIDENT_REFERENCE_REQUIRED", status: 400 });
  if (reason.length < 20) throw Object.assign(new Error("Record a detailed reason of at least 20 characters."), { code: "LOCKDOWN_REASON_REQUIRED", status: 400 });
  if (confirmation !== expected) throw Object.assign(new Error(`Type ${expected} exactly to confirm this Head Office lockdown.`), { code: "LOCKDOWN_CONFIRMATION_FAILED", status: 400 });
  const existing = await activePlatformLockdown(env, platform.id);
  if (existing) throw Object.assign(new Error("This website or service is already under an active Head Office security lockdown."), { code: "LOCKDOWN_ALREADY_ACTIVE", status: 409, details: { lockdown: existing } });

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const reviewAt = input.reviewAt ? new Date(input.reviewAt).toISOString() : new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(`INSERT INTO platform_lockdowns
    (id,platform_id,incident_reference,reason,severity,status,manual_initiation,initiated_by,initiated_at,review_at)
    VALUES (?,?,?,?,'critical','active',1,?,?,?)`)
    .bind(id, platform.id, incidentReference, reason, actorId, now, reviewAt).run();
  const commandId = await queuePlatformSecurityCommand(env, platform.id, id, "ENTER_SECURITY_LOCKDOWN", {
    lockdownId: id,
    incidentReference,
    reason: "Critical Head Office security lockdown is active.",
    localMaintenanceAndLaunchGatesRemainConfiguredByTheSite: true,
    precedence: "head_office_lockdown_first",
    initiatedAt: now,
    reviewAt
  });
  return { id, commandId, status: "active", initiatedAt: now, reviewAt };
}

export async function liftManualPlatformLockdown(env, lockdown, input, actorId) {
  await ensureSecurityControlPlane(env);
  const reason = cleanText(input.reason, 2000);
  const confirmation = cleanText(input.confirmation, 180).toUpperCase();
  const expected = `LIFT ${String(lockdown.platform_code || "LOCKDOWN").toUpperCase()}`;
  if (reason.length < 10) throw Object.assign(new Error("Record why Head Office is lifting the security lockdown."), { code: "LIFT_REASON_REQUIRED", status: 400 });
  if (confirmation !== expected) throw Object.assign(new Error(`Type ${expected} exactly to lift this lockdown.`), { code: "LIFT_CONFIRMATION_FAILED", status: 400 });
  if (lockdown.status !== "active") throw Object.assign(new Error("The lockdown is no longer active."), { code: "LOCKDOWN_NOT_ACTIVE", status: 409 });
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE platform_lockdowns SET status='lifted',lifted_by=?,lifted_at=?,lift_reason=? WHERE id=? AND status='active'`)
    .bind(actorId, now, reason, lockdown.id).run();
  const commandId = await queuePlatformSecurityCommand(env, lockdown.platform_id, lockdown.id, "EXIT_SECURITY_LOCKDOWN", {
    lockdownId: lockdown.id,
    liftReason: reason,
    liftedAt: now,
    instruction: "Resume the website's own maintenance and launch-gate state. Head Office does not change those local settings."
  });
  return { id: lockdown.id, commandId, status: "lifted", liftedAt: now };
}

export async function platformSecurityState(env, platform, customer = null) {
  await ensureSecurityControlPlane(env);
  const lockdown = await activePlatformLockdown(env, platform.id);
  const result = {
    platform: { id: platform.id, code: platform.code, name: platform.name },
    lockdown: lockdown ? {
      active: true,
      lockdownId: lockdown.id,
      incidentReference: lockdown.incident_reference,
      severity: lockdown.severity,
      initiatedAt: lockdown.initiated_at,
      reviewAt: lockdown.review_at,
      instruction: "Deny normal customer access and display the site's security-lockdown experience."
    } : { active: false },
    governance: {
      lockdownMayOnlyBeInitiatedByHeadOffice: true,
      automatedLockdownDisabled: true,
      siteMaintenanceAndLaunchGatesRemainLocallyControlled: true,
      precedence: ["head_office_security_lockdown", "site_maintenance_or_launch_gate", "customer_access_decision"]
    }
  };
  if (customer) {
    result.customerNumber = customer.customer_number;
    result.markers = await listCustomerSecurityMarkers(env, customer.id);
    result.access = await calculateAccessDecision(env, customer, platform, true);
  }
  return result;
}
