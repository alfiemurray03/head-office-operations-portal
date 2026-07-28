const ROLES = [
  ["SYSTEM_ADMINISTRATOR","System Administrator","Full technical, operational and configuration authority.",["*"]],
  ["HEAD_OFFICE_OPERATIONS","Head Office Operations","Company-wide customer operations, communications, payments, complaints and cases.",["dashboard:read","customers:*","cases:*","communications:*","payments:*","approvals:*","complaints:*","security:read","audit:read","platforms:read"]],
  ["SECURITY_OFFICER","Security Officer","Security markers, restrictions, account recovery and controlled investigations.",["dashboard:read","customers:read","cases:*","communications:read","security:*","audit:read","platforms:read"]],
  ["BRANCH_OPERATOR","Branch Operator","Customer operations limited to a connected division.",["dashboard:read","customers:read","cases:read","cases:create","communications:*"]],
  ["DPO_RESTRICTED","Data Protection Officer","Restricted data protection case and audit authority.",["dashboard:read","customers:read","cases:read","cases:create","data_protection:*","communications:read","audit:read"]],
  ["SAFEGUARDING_RESTRICTED","Designated Safeguarding Officer","Restricted safeguarding concern authority.",["dashboard:read","customers:read","cases:read","cases:create","safeguarding:*","communications:read","audit:read"]]
];

const MARKERS = [
  ["IDENTITY_CONCERN","Identity concern","high","head_office_only",1,7],
  ["ACCOUNT_TAKEOVER_RISK","Account takeover risk","critical","system_enforced",1,1],
  ["PAYMENT_RISK","Payment or refund risk","high","branch_instruction",1,14],
  ["SAFEGUARDING_ALERT","Safeguarding alert","critical","head_office_only",1,1],
  ["ENHANCED_VERIFICATION","Enhanced verification required","moderate","approved_branch_summary",1,30],
  ["UNUSUAL_ACCOUNT_ACTIVITY","Unusual account activity","moderate","branch_instruction",1,14],
  ["CUSTOMER_VULNERABILITY","Customer vulnerability","moderate","head_office_only",1,30]
];

const RESTRICTIONS = [
  ["BLOCK_SIGN_IN","Block customer sign-in","deny_authentication","SECURITY_OFFICER"],
  ["BLOCK_PROFILE_CHANGES","Block security-sensitive profile changes","deny_sensitive_update","HEAD_OFFICE_OPERATIONS"],
  ["BLOCK_PAYMENTS","Block new payments","deny_payment","SECURITY_OFFICER"],
  ["BLOCK_REFUNDS","Block automatic refunds","require_manual_approval","HEAD_OFFICE_OPERATIONS"],
  ["FORCE_REAUTHENTICATION","Force reauthentication","revoke_sessions","SECURITY_OFFICER"],
  ["REQUIRE_ENHANCED_VERIFICATION","Require enhanced identity verification","require_enhanced_verification","SECURITY_OFFICER"],
  ["BLOCK_EMAIL_CHANGE","Block email address changes","deny_email_change","SECURITY_OFFICER"],
  ["BLOCK_ACCOUNT_CLOSURE","Block automatic account closure","require_manual_approval","HEAD_OFFICE_OPERATIONS"]
];

export async function ensureProductionCatalogues(env) {
  const now = new Date().toISOString();

  for (const [code,name,description,permissions] of ROLES) {
    await env.DB.prepare(`INSERT INTO role_definitions
      (code,name,description,permissions_json,is_system_role,status,created_at,updated_at)
      VALUES (?,?,?,?,1,'active',?,?)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name,description=excluded.description,
        permissions_json=excluded.permissions_json,status='active',updated_at=excluded.updated_at`)
      .bind(code,name,description,JSON.stringify(permissions),now,now).run();
  }

  for (const [code,label,risk,visibility,requiresCase,reviewDays] of MARKERS) {
    await env.DB.prepare(`INSERT INTO security_marker_types
      (code,label,default_risk_level,default_visibility,requires_case,review_days,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'active',?,?)
      ON CONFLICT(code) DO UPDATE SET label=excluded.label,default_risk_level=excluded.default_risk_level,
        default_visibility=excluded.default_visibility,requires_case=excluded.requires_case,
        review_days=excluded.review_days,status='active',updated_at=excluded.updated_at`)
      .bind(code,label,risk,visibility,requiresCase,reviewDays,now,now).run();
  }

  for (const [code,label,action,approvalRole] of RESTRICTIONS) {
    await env.DB.prepare(`INSERT INTO restriction_types
      (code,label,enforcement_action,approval_role_code,status,created_at,updated_at)
      VALUES (?,?,?,?,'active',?,?)
      ON CONFLICT(code) DO UPDATE SET label=excluded.label,enforcement_action=excluded.enforcement_action,
        approval_role_code=excluded.approval_role_code,status='active',updated_at=excluded.updated_at`)
      .bind(code,label,action,approvalRole,now,now).run();
  }
}
