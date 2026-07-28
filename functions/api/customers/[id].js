import { audit, cleanText, error, json, readJson, validEmail } from "../../_shared.js";
import { caseAccessFlags, findCustomer, hasPermission, requirePermission } from "../../_operations.js";
import { ensureCentralPlatformSchema } from "../../_central-schema.js";

const ACCOUNT_STATUSES = new Set(["pending", "active", "restricted", "suspended", "closed", "archived"]);
const SECURITY_STATUSES = new Set(["clear", "monitor", "review", "high", "critical"]);

export const onRequestGet = async context => {
  await ensureCentralPlatformSchema(context.env);
  const auth = await requirePermission(context, "customers:read");
  if (auth.response) return auth.response;
  const customer = await findCustomer(context.env, context.params.id);
  if (!customer) return error("CUSTOMER_NOT_FOUND", "The universal customer record was not found.", 404);
  const flags = caseAccessFlags(auth.authorisation);
  const includeSecurity = hasPermission(auth.authorisation, "security:read");
  const includeCommunications = hasPermission(auth.authorisation, "communications:read");
  const includePayments = hasPermission(auth.authorisation, "payments:read");
  const statements = [
    context.env.DB.prepare("SELECT id,contact_type,contact_value,is_primary,verification_status,verified_at FROM customer_contact_points WHERE customer_id=? ORDER BY is_primary DESC,contact_type").bind(customer.id),
    context.env.DB.prepare(`SELECT a.id,a.external_account_id,a.status,a.linked_at,a.last_synced_at,p.id platform_id,p.code,p.name,
      s.account_status snapshot_account_status,s.plan_code,s.subscription_status,s.last_sign_in_at,s.last_activity_at,s.entitlement_json,
      o.health_status platform_health,o.public_url,o.hosting_provider,o.release_version,o.release_commit,o.last_heartbeat_at
      FROM customer_platform_accounts a JOIN platforms p ON p.id=a.platform_id
      LEFT JOIN customer_platform_snapshots s ON s.customer_id=a.customer_id AND s.platform_id=a.platform_id
      LEFT JOIN platform_operational_profiles o ON o.platform_id=a.platform_id
      WHERE a.customer_id=? ORDER BY p.name`).bind(customer.id),
    context.env.DB.prepare(`SELECT c.id,c.case_reference,c.case_type,c.title,c.priority,c.status,c.due_at,c.created_at
      FROM cases c WHERE c.customer_id=? AND (?=1 OR c.case_type!='data_protection') AND (?=1 OR c.case_type!='safeguarding')
      ORDER BY c.created_at DESC LIMIT 100`).bind(customer.id, flags.dataProtection ? 1 : 0, flags.safeguarding ? 1 : 0)
  ];
  if (includeSecurity) {
    statements.push(context.env.DB.prepare(`SELECT m.*,t.label marker_label FROM security_markers m
      LEFT JOIN security_marker_types t ON t.code=m.marker_type WHERE m.customer_id=? ORDER BY m.created_at DESC`).bind(customer.id));
    statements.push(context.env.DB.prepare(`SELECT r.*,t.label restriction_label,t.enforcement_action FROM restrictions r
      LEFT JOIN restriction_types t ON t.code=r.restriction_type WHERE r.customer_id=? ORDER BY r.applied_at DESC`).bind(customer.id));
    statements.push(context.env.DB.prepare(`SELECT s.*,p.code platform_code,p.name platform_name FROM customer_sessions s
      JOIN platforms p ON p.id=s.platform_id WHERE s.customer_id=? ORDER BY s.last_seen_at DESC LIMIT 200`).bind(customer.id));
    statements.push(context.env.DB.prepare(`SELECT e.*,p.code platform_code,p.name platform_name FROM customer_security_events e
      JOIN platforms p ON p.id=e.platform_id WHERE e.customer_id=? ORDER BY e.occurred_at DESC LIMIT 200`).bind(customer.id));
    statements.push(context.env.DB.prepare(`SELECT f.*,p.code platform_code,p.name platform_name FROM fraud_signals f
      LEFT JOIN platforms p ON p.id=f.platform_id WHERE f.customer_id=? ORDER BY f.created_at DESC LIMIT 200`).bind(customer.id));
    statements.push(context.env.DB.prepare(`SELECT d.*,p.code platform_code,p.name platform_name FROM customer_access_decisions d
      JOIN platforms p ON p.id=d.platform_id WHERE d.customer_id=? ORDER BY d.created_at DESC LIMIT 100`).bind(customer.id));
  }
  if (includeCommunications) statements.push(context.env.DB.prepare("SELECT * FROM communications WHERE customer_id=? ORDER BY occurred_at DESC LIMIT 100").bind(customer.id));
  if (includePayments) {
    statements.push(context.env.DB.prepare("SELECT * FROM payment_references WHERE customer_id=? ORDER BY occurred_at DESC LIMIT 100").bind(customer.id));
    statements.push(context.env.DB.prepare(`SELECT s.*,p.code platform_code,p.name platform_name FROM customer_subscriptions s
      JOIN platforms p ON p.id=s.platform_id WHERE s.customer_id=? ORDER BY s.updated_at DESC LIMIT 100`).bind(customer.id));
    statements.push(context.env.DB.prepare(`SELECT o.*,p.code platform_code,p.name platform_name FROM customer_orders o
      JOIN platforms p ON p.id=o.platform_id WHERE o.customer_id=? ORDER BY o.created_at DESC LIMIT 100`).bind(customer.id));
  }
  statements.push(context.env.DB.prepare(`SELECT t.*,p.code platform_code,p.name platform_name FROM customer_timeline_events t
    LEFT JOIN platforms p ON p.id=t.platform_id WHERE t.customer_id=?
      AND (?=1 OR t.event_category!='security')
      AND (?=1 OR t.event_category NOT IN ('payment','subscription','order'))
    ORDER BY t.occurred_at DESC LIMIT 250`).bind(customer.id, includeSecurity?1:0, includePayments?1:0));
  const results = await context.env.DB.batch(statements);
  let index = 0;
  const contacts = results[index++].results;
  const platformAccounts = results[index++].results.map(row => ({
    ...row,
    entitlements: (()=>{try{return JSON.parse(row.entitlement_json||"{}");}catch{return{};}})()
  }));
  const cases = results[index++].results;
  const markers = includeSecurity ? results[index++].results : [];
  const restrictions = includeSecurity ? results[index++].results : [];
  const sessions = includeSecurity ? results[index++].results : [];
  const securityEvents = includeSecurity ? results[index++].results : [];
  const fraudSignals = includeSecurity ? results[index++].results : [];
  const accessDecisions = includeSecurity ? results[index++].results : [];
  const communications = includeCommunications ? results[index++].results : [];
  const payments = includePayments ? results[index++].results : [];
  const subscriptions = includePayments ? results[index++].results : [];
  const orders = includePayments ? results[index++].results : [];
  const timeline = results[index++].results;
  return json({ customer, contacts, platformAccounts, cases, markers, restrictions, sessions, securityEvents,
    fraudSignals, accessDecisions, communications, payments, subscriptions, orders, timeline });
};

export const onRequestPut = async context => {
  const auth = await requirePermission(context, "customers:write");
  if (auth.response) return auth.response;
  const customer = await findCustomer(context.env, context.params.id);
  if (!customer) return error("CUSTOMER_NOT_FOUND", "The universal customer record was not found.", 404);
  let body;
  try { body = await readJson(context.request); }
  catch (cause) { return error(cause.code || "INVALID_REQUEST", cause.message, cause.status || 400); }
  const displayName = cleanText(body.displayName ?? customer.display_name, 160);
  const verifiedEmail = cleanText(body.verifiedEmail ?? customer.verified_email, 254).toLowerCase();
  const accountStatus = cleanText(body.accountStatus ?? customer.account_status, 30);
  const securityStatus = cleanText(body.securityStatus ?? customer.security_status, 30);
  if (displayName.length < 2 || !validEmail(verifiedEmail)) return error("INVALID_CUSTOMER", "Enter a valid customer name and verified email address.");
  if (!ACCOUNT_STATUSES.has(accountStatus)) return error("INVALID_ACCOUNT_STATUS", "The selected account status is invalid.");
  if (!SECURITY_STATUSES.has(securityStatus)) return error("INVALID_SECURITY_STATUS", "The selected security status is invalid.");
  if (securityStatus !== customer.security_status && !hasPermission(auth.authorisation, "security:write")) {
    return error("SECURITY_PERMISSION_REQUIRED", "Only authorised security staff may change a customer's security status.", 403);
  }
  const now = new Date().toISOString();
  try {
    await context.env.DB.prepare(`UPDATE customers SET display_name=?,verified_email=?,account_status=?,security_status=?,updated_at=? WHERE id=?`)
      .bind(displayName, verifiedEmail, accountStatus, securityStatus, now, customer.id).run();
  } catch (cause) {
    if (String(cause).includes("verified_email")) return error("DUPLICATE_EMAIL", "A customer record already uses this verified email address.", 409);
    throw cause;
  }
  const updated = await findCustomer(context.env, customer.id);
  await audit(context.env, auth.session, "customer.update", "customer", customer.id, {
    label: "Universal customer record updated",
    reference: customer.customer_number,
    customerId: customer.id,
    requestId: context.data.requestId,
    before: customer,
    after: updated
  });
  return json({ updated: true, customer: updated });
};
