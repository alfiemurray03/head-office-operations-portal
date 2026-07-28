import { assertSameOrigin, error, requireSession } from "./_shared.js";

export const CASE_TYPES = new Set(["security", "complaint", "refund", "payment_dispute", "account_recovery", "data_protection", "safeguarding", "general"]);
export const CASE_STATUSES = new Set(["draft", "open", "triage", "investigating", "awaiting_customer", "awaiting_internal", "approval_required", "resolved", "closed", "cancelled"]);
export const CASE_PRIORITIES = new Set(["low", "normal", "high", "critical"]);

const ROLE_BLUEPRINTS = [
  ["SYSTEM_ADMINISTRATOR", "System Administrator", "Full technical, operational and configuration authority.", ["*"]],
  ["HEAD_OFFICE_OPERATIONS", "Head Office Operations", "Company-wide customer operations, communications, payments, complaints and cases.", ["dashboard:read", "customers:*", "cases:*", "communications:*", "payments:*", "approvals:*", "complaints:*", "security:read", "audit:read", "platforms:read"]],
  ["SECURITY_OFFICER", "Security Officer", "Security markers, restrictions, account recovery and controlled investigations.", ["dashboard:read", "customers:read", "cases:*", "communications:read", "security:*", "audit:read", "platforms:read"]],
  ["BRANCH_OPERATOR", "Branch Operator", "Customer operations limited to a connected division.", ["dashboard:read", "customers:read", "cases:read", "cases:create", "communications:*"]],
  ["DPO_RESTRICTED", "Data Protection Officer", "Restricted data protection case and audit authority.", ["dashboard:read", "customers:read", "cases:read", "cases:create", "data_protection:*", "communications:read", "audit:read"]],
  ["SAFEGUARDING_RESTRICTED", "Designated Safeguarding Officer", "Restricted safeguarding concern authority.", ["dashboard:read", "customers:read", "cases:read", "cases:create", "safeguarding:*", "communications:read", "audit:read"]]
];

const MARKER_BLUEPRINTS = [
  ["IDENTITY_CONCERN", "Identity concern", "high", "head_office_only", 1, 7],
  ["ACCOUNT_TAKEOVER_RISK", "Account takeover risk", "critical", "system_enforced", 1, 1],
  ["PAYMENT_RISK", "Payment or refund risk", "high", "branch_instruction", 1, 14],
  ["SAFEGUARDING_ALERT", "Safeguarding alert", "critical", "head_office_only", 1, 1],
  ["ENHANCED_VERIFICATION", "Enhanced verification required", "moderate", "approved_branch_summary", 1, 30],
  ["UNUSUAL_ACCOUNT_ACTIVITY", "Unusual account activity", "moderate", "branch_instruction", 1, 14],
  ["CUSTOMER_VULNERABILITY", "Customer vulnerability", "moderate", "head_office_only", 1, 30]
];

const RESTRICTION_BLUEPRINTS = [
  ["BLOCK_SIGN_IN", "Block customer sign-in", "deny_authentication", "SECURITY_OFFICER"],
  ["BLOCK_PROFILE_CHANGES", "Block security-sensitive profile changes", "deny_sensitive_update", "HEAD_OFFICE_OPERATIONS"],
  ["BLOCK_PAYMENTS", "Block new payments", "deny_payment", "SECURITY_OFFICER"],
  ["BLOCK_REFUNDS", "Block automatic refunds", "require_manual_approval", "HEAD_OFFICE_OPERATIONS"],
  ["FORCE_REAUTHENTICATION", "Force reauthentication", "revoke_sessions", "SECURITY_OFFICER"],
  ["REQUIRE_ENHANCED_VERIFICATION", "Require enhanced identity verification", "require_enhanced_verification", "SECURITY_OFFICER"],
  ["BLOCK_EMAIL_CHANGE", "Block email address changes", "deny_email_change", "SECURITY_OFFICER"],
  ["BLOCK_ACCOUNT_CLOSURE", "Block automatic account closure", "require_manual_approval", "HEAD_OFFICE_OPERATIONS"]
];

export async function ensureOperationsReady(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS operational_schema_state (
    schema_key TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    applied_at TEXT NOT NULL
  )`).run();

  const state = await env.DB.prepare("SELECT version FROM operational_schema_state WHERE schema_key='production_system'").first();
  if (Number(state?.version || 0) >= 1) return;

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS case_reference_sequences (
      sequence_key TEXT PRIMARY KEY,
      next_value INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cases_type_status ON cases(case_type,status,created_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_cases_assigned ON cases(assigned_staff_id,status,due_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_markers_review ON security_markers(status,review_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_restrictions_review ON restrictions(status,review_at)"),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_payments_reference ON payment_references(provider,provider_payment_reference)"),
    env.DB.prepare(`INSERT INTO system_settings(setting_key,setting_group,value_json,description,updated_by,updated_at)
      VALUES ('payments.refund_approval_threshold_minor','payments','5000','Refund amount in minor currency units requiring approval.','system',?)
      ON CONFLICT(setting_key) DO NOTHING`).bind(now),
    env.DB.prepare(`INSERT INTO system_settings(setting_key,setting_group,value_json,description,updated_by,updated_at)
      VALUES ('operations.default_case_due_hours','operations','72','Default due time for normal-priority cases.','system',?)
      ON CONFLICT(setting_key) DO NOTHING`).bind(now)
  ];

  for (const [code, name, description, permissions] of ROLE_BLUEPRINTS) {
    statements.push(env.DB.prepare(`INSERT INTO role_definitions
      (code,name,description,permissions_json,is_system_role,status,created_at,updated_at)
      VALUES (?,?,?,?,1,'active',?,?)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name,description=excluded.description,
        permissions_json=excluded.permissions_json,status='active',updated_at=excluded.updated_at`)
      .bind(code, name, description, JSON.stringify(permissions), now, now));
  }

  for (const [code, label, risk, visibility, requiresCase, reviewDays] of MARKER_BLUEPRINTS) {
    statements.push(env.DB.prepare(`INSERT INTO security_marker_types
      (code,label,default_risk_level,default_visibility,requires_case,review_days,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'active',?,?)
      ON CONFLICT(code) DO UPDATE SET label=excluded.label,default_risk_level=excluded.default_risk_level,
        default_visibility=excluded.default_visibility,requires_case=excluded.requires_case,
        review_days=excluded.review_days,status='active',updated_at=excluded.updated_at`)
      .bind(code, label, risk, visibility, requiresCase, reviewDays, now, now));
  }

  for (const [code, label, action, approvalRole] of RESTRICTION_BLUEPRINTS) {
    statements.push(env.DB.prepare(`INSERT INTO restriction_types
      (code,label,enforcement_action,approval_role_code,status,created_at,updated_at)
      VALUES (?,?,?,?,'active',?,?)
      ON CONFLICT(code) DO UPDATE SET label=excluded.label,enforcement_action=excluded.enforcement_action,
        approval_role_code=excluded.approval_role_code,status='active',updated_at=excluded.updated_at`)
      .bind(code, label, action, approvalRole, now, now));
  }

  statements.push(env.DB.prepare(`INSERT INTO operational_schema_state(schema_key,version,applied_at)
    VALUES ('production_system',1,?)
    ON CONFLICT(schema_key) DO UPDATE SET version=excluded.version,applied_at=excluded.applied_at`).bind(now));
  await env.DB.batch(statements);
}

function normaliseRole(value) {
  return String(value || "").trim().replaceAll("-", "_").replaceAll(" ", "_").toUpperCase();
}

export async function getAuthorisation(env, session) {
  const result = await env.DB.prepare(`SELECT r.role_code,d.permissions_json
    FROM staff_role_assignments r
    LEFT JOIN role_definitions d ON upper(d.code)=upper(r.role_code)
    WHERE r.staff_id=? AND (r.expires_at IS NULL OR r.expires_at>?)`)
    .bind(session.sub, new Date().toISOString()).all();

  const roles = new Set(result.results.map(row => normaliseRole(row.role_code)));
  const sessionRoles = String(session.roleName || "").split(",").map(normaliseRole).filter(Boolean);
  for (const role of sessionRoles) roles.add(role);
  const permissions = new Set();
  for (const row of result.results) {
    try {
      for (const permission of JSON.parse(row.permissions_json || "[]")) permissions.add(permission);
    } catch {}
  }
  if (roles.has("SYSTEM_ADMINISTRATOR") || sessionRoles.includes("SYSTEM_ADMINISTRATOR")) permissions.add("*");
  return { roles: [...roles], permissions: [...permissions] };
}

export function hasPermission(authorisation, required) {
  const permissions = authorisation?.permissions || [];
  if (permissions.includes("*")) return true;
  if (permissions.includes(required)) return true;
  const [area] = required.split(":");
  return permissions.includes(`${area}:*`);
}

export async function requirePermission(context, required) {
  await ensureOperationsReady(context.env);
  const auth = await requireSession(context);
  if (auth.response) return auth;
  if (!["GET", "HEAD", "OPTIONS"].includes(context.request.method)) {
    const blocked = assertSameOrigin(context.request);
    if (blocked) return { response: blocked };
  }
  const authorisation = await getAuthorisation(context.env, auth.session);
  if (!hasPermission(authorisation, required)) {
    return { response: error("PERMISSION_DENIED", "You are not authorised to perform this Head Office action.", 403) };
  }
  return { session: auth.session, authorisation };
}

export function canAccessCaseType(authorisation, caseType, write = false) {
  if (caseType === "data_protection") return hasPermission(authorisation, "data_protection:*");
  if (caseType === "safeguarding") return hasPermission(authorisation, "safeguarding:*");
  if (caseType === "complaint" && write) return hasPermission(authorisation, "complaints:*") || hasPermission(authorisation, "cases:write");
  return hasPermission(authorisation, write ? "cases:write" : "cases:read") || (write && hasPermission(authorisation, "cases:create"));
}

export function caseAccessFlags(authorisation) {
  return {
    dataProtection: hasPermission(authorisation, "data_protection:*"),
    safeguarding: hasPermission(authorisation, "safeguarding:*")
  };
}

export async function allocateCaseReference(env, caseType) {
  const year = new Date().getUTCFullYear();
  const sequenceKey = `${year}:${caseType}`;
  const now = new Date().toISOString();
  const row = await env.DB.prepare(`INSERT INTO case_reference_sequences(sequence_key,next_value,updated_at)
    VALUES (?,1,?)
    ON CONFLICT(sequence_key) DO UPDATE SET next_value=next_value+1,updated_at=excluded.updated_at
    RETURNING next_value`).bind(sequenceKey, now).first();
  const prefix = ({ security: "SEC", complaint: "COM", refund: "REF", payment_dispute: "PAY", account_recovery: "ACR", data_protection: "DPR", safeguarding: "SAF", general: "OPS" })[caseType] || "HOC";
  return `${prefix}-${year}-${String(Number(row?.next_value || 1)).padStart(6, "0")}`;
}

export async function defaultDueDate(env, priority) {
  let hours = ({ critical: 4, high: 24, low: 168 })[priority];
  if (!hours) {
    const setting = await env.DB.prepare("SELECT value_json FROM system_settings WHERE setting_key='operations.default_case_due_hours'").first();
    try { hours = Number(JSON.parse(setting?.value_json || "72")); }
    catch { hours = 72; }
  }
  if (!Number.isFinite(hours) || hours < 1 || hours > 720) hours = 72;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export async function findCustomer(env, reference) {
  if (!reference) return null;
  return env.DB.prepare(`SELECT * FROM customers WHERE id=? OR customer_number=? LIMIT 1`).bind(reference, reference).first();
}

export async function findCase(env, reference) {
  if (!reference) return null;
  return env.DB.prepare(`SELECT c.*,u.customer_number,u.display_name customer_name,u.verified_email customer_email
    FROM cases c LEFT JOIN customers u ON u.id=c.customer_id
    WHERE c.id=? OR c.case_reference=? LIMIT 1`).bind(reference, reference).first();
}

export async function recalculateCustomerSecurity(env, customerId) {
  const [marker, restriction] = await env.DB.batch([
    env.DB.prepare(`SELECT risk_level FROM security_markers WHERE customer_id=? AND status IN ('active','under_review')
      ORDER BY CASE risk_level WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END LIMIT 1`).bind(customerId),
    env.DB.prepare("SELECT COUNT(*) count FROM restrictions WHERE customer_id=? AND status='active'").bind(customerId)
  ]);
  const risk = marker.results[0]?.risk_level;
  const status = risk === "critical" ? "critical" : risk === "high" ? "high" : risk === "moderate" ? "review" : risk === "low" ? "monitor" : "clear";
  const activeRestrictions = Number(restriction.results[0]?.count || 0);
  await env.DB.prepare(`UPDATE customers SET security_status=?,
      account_status=CASE WHEN ? > 0 AND account_status='active' THEN 'restricted'
        WHEN ? = 0 AND account_status='restricted' THEN 'active' ELSE account_status END,
      updated_at=? WHERE id=?`)
    .bind(status, activeRestrictions, activeRestrictions, new Date().toISOString(), customerId).run();
}
