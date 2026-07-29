import { cleanText, validEmail } from "./_shared.js";
import { acquireCustomerGraphToken, customerDirectoryConfigured, customerGraphRequest } from "./_customer-entra.js";
import { acquireStaffGraphToken, staffGraphRequest, staffTenantDirectoryConfigured } from "./_staff-entra-sync.js";
import { resolveStripeConnector } from "./_stripe-control.js";
import { ensureSystemSettingsReady, getSystemSettings } from "./_system-settings.js";

const DIDIT_BASE_URL = "https://verification.didit.me";
const RESEND_BASE_URL = "https://api.resend.com";

export const SYSTEM_SERVICE_CATALOG = Object.freeze([
  { code: "core_database", label: "Core database & schema", category: "Core", settingKey: null, description: "D1 connectivity and required Head Office tables." },
  { code: "staff_authentication", label: "Microsoft staff authentication", category: "Microsoft", settingKey: null, description: "The existing Head Office Microsoft Entra sign-in authority." },
  { code: "customer_directory", label: "JA Group Services ID", category: "Microsoft", settingKey: "integrations.customer_directory_enabled", description: "Customer Entra External ID token and directory read access." },
  { code: "staff_directory", label: "Staff tenant directory", category: "Microsoft", settingKey: "integrations.staff_directory_enabled", description: "JA Group Services tenant token and directory read access." },
  { code: "stripe_planyx", label: "Stripe — Planyx", category: "Payments", settingKey: "integrations.stripe_planyx_enabled", description: "Planyx Stripe account API connection." },
  { code: "stripe_profile_centre", label: "Stripe — Profile Centre", category: "Payments", settingKey: "integrations.stripe_profile_centre_enabled", description: "Profile Centre Stripe account API connection." },
  { code: "didit", label: "Didit identity verification", category: "Identity", settingKey: "integrations.didit_enabled", description: "Didit API key and configured identity workflow." },
  { code: "resend", label: "Resend customer email", category: "Communications", settingKey: "integrations.resend_enabled", description: "Customer notification provider and verified sender configuration." },
  { code: "webhooks", label: "Webhook processing", category: "Integrations", settingKey: null, description: "Stripe and Didit signing configuration and failed-event queues." },
  { code: "automation", label: "Scheduled automation", category: "Automation", settingKey: null, description: "Hourly customer, staff and Stripe reconciliation readiness." },
  { code: "connected_systems", label: "Connected websites & services", category: "Integrations", settingKey: "integrations.connected_systems_enabled", description: "Registered platforms, scoped credentials and recent contact." },
  { code: "security_controls", label: "Security control plane", category: "Security", settingKey: null, description: "Marker catalogue, restrictions and manual-only critical lockdown controls." }
]);

function serviceFor(code) {
  return SYSTEM_SERVICE_CATALOG.find(item => item.code === code) || null;
}

function outcome(status, summary, details = {}) {
  return { status, summary, details };
}

function timeoutSeconds(values) {
  const value = Number(values["tests.timeout_seconds"] || 12);
  return Math.max(5, Math.min(value, 30));
}

async function fetchJson(url, options, seconds) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), seconds * 1000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  } catch (cause) {
    if (cause?.name === "AbortError") throw Object.assign(new Error("The provider did not respond within the governed timeout."), { code: "TEST_TIMEOUT" });
    throw cause;
  } finally {
    clearTimeout(timer);
  }
}

async function testCoreDatabase(env) {
  const required = [
    "customers", "cases", "system_settings", "audit_events", "platforms",
    "staff_directory_profiles", "customer_directory_connectors",
    "stripe_division_webhook_events", "identity_verification_sessions"
  ];
  const [ping, tables] = await env.DB.batch([
    env.DB.prepare("SELECT 1 ok"),
    env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${required.map(() => "?").join(",")})`).bind(...required)
  ]);
  const names = new Set((tables.results || []).map(row => row.name));
  const missing = required.filter(name => !names.has(name));
  if (Number(ping.results?.[0]?.ok || 0) !== 1) return outcome("failed", "D1 did not return a valid connectivity response.");
  if (missing.length) return outcome("failed", "The database is connected but required Head Office tables are missing.", { missingTables: missing });
  return outcome("passed", "D1 is connected and the required operational schema is available.", { checkedTables: required.length });
}

async function testStaffAuthentication(env, values, actor) {
  const tenantId = cleanText(env.ADMIN_OIDC_TENANT_ID, 100);
  const clientId = cleanText(env.ADMIN_OIDC_CLIENT_ID, 100);
  const clientSecretConfigured = Boolean(String(env.ADMIN_OIDC_CLIENT_SECRET || env.AZURE_AD_CLIENT_SECRET || "").trim());
  if (!tenantId || !clientId || !clientSecretConfigured) return outcome("failed", "The existing Microsoft staff sign-in application is not fully configured.", { tenantIdConfigured: Boolean(tenantId), clientIdConfigured: Boolean(clientId), clientSecretConfigured });
  const { response, payload } = await fetchJson(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/v2.0/.well-known/openid-configuration`, { headers: { Accept: "application/json" } }, timeoutSeconds(values));
  if (!response.ok || !payload.authorization_endpoint || !payload.token_endpoint) return outcome("failed", "Microsoft did not return a valid OpenID Connect configuration.", { providerStatus: response.status });
  return outcome("passed", "Microsoft staff authentication discovery is reachable and the current staff session is valid.", { tenantId, clientId, signedInAs: actor?.displayName || "Authorised staff" });
}

async function testCustomerDirectory(env) {
  if (!customerDirectoryConfigured(env)) return outcome("failed", "JA Group Services ID is not fully configured in Cloudflare.");
  const token = await acquireCustomerGraphToken(env);
  const payload = await customerGraphRequest(env, "/v1.0/users?$top=1&$select=id,displayName", { token });
  return outcome("passed", "JA Group Services ID accepted the app-only token and directory read request.", { sampleUsersReturned: Array.isArray(payload.value) ? payload.value.length : 0 });
}

async function testStaffDirectory(env) {
  if (!staffTenantDirectoryConfigured(env)) return outcome("failed", "The existing Head Office Microsoft application is not fully configured for staff-directory access.");
  const token = await acquireStaffGraphToken(env);
  const payload = await staffGraphRequest(env, "/v1.0/users?$top=1&$select=id,displayName", { token });
  return outcome("passed", "The JA Group Services tenant accepted the app-only token and directory read request.", { sampleUsersReturned: Array.isArray(payload.value) ? payload.value.length : 0 });
}

async function testStripe(env, values, division) {
  const connector = resolveStripeConnector(env, division);
  if (!connector.secretKey) return outcome("failed", `${connector.secretKeyBinding} is not configured.`);
  const { response, payload } = await fetchJson("https://api.stripe.com/v1/account", {
    headers: { Authorization: `Bearer ${connector.secretKey}`, Accept: "application/json" }
  }, timeoutSeconds(values));
  if (!response.ok || !payload.id) return outcome("failed", `${connector.name} Stripe rejected the API connection.`, { providerStatus: response.status, providerType: cleanText(payload.error?.type, 100), providerCode: cleanText(payload.error?.code, 100) });
  return outcome("passed", `${connector.name} Stripe is connected.`, { accountId: payload.id, businessName: cleanText(payload.business_profile?.name || payload.settings?.dashboard?.display_name, 160), chargesEnabled: Boolean(payload.charges_enabled), payoutsEnabled: Boolean(payload.payouts_enabled) });
}

async function testDidit(env, values) {
  const apiKey = String(env.DIDIT_API_KEY || "").trim();
  const workflowId = cleanText(env.DIDIT_WORKFLOW_ID, 180);
  if (!apiKey || !workflowId) return outcome("failed", "The Didit API key or identity workflow is not configured.", { apiKeyConfigured: Boolean(apiKey), workflowConfigured: Boolean(workflowId) });
  const { response, payload } = await fetchJson(`${DIDIT_BASE_URL}/v3/workflows/${encodeURIComponent(workflowId)}/`, {
    headers: { "x-api-key": apiKey, Accept: "application/json" }
  }, timeoutSeconds(values));
  if (!response.ok) return outcome("failed", "Didit rejected the API key or configured workflow.", { providerStatus: response.status, providerMessage: cleanText(payload.detail || payload.message, 300) });
  return outcome("passed", "Didit accepted the API key and returned the configured identity workflow.", { workflowId: cleanText(payload.uuid || workflowId, 180), workflowLabel: cleanText(payload.workflow_label, 160), workflowType: cleanText(payload.workflow_type, 80), archived: Boolean(payload.is_archived) });
}

async function controlledResendDelivery(env, actor, values, confirmation) {
  if (confirmation !== "SEND TEST EMAIL") return outcome("failed", "Enter SEND TEST EMAIL to authorise the controlled delivery test.");
  if (values["system.external_test_actions_enabled"] !== true) return outcome("failed", "Controlled external test actions are disabled in System Settings.");
  const recipient = cleanText(actor?.email, 254).toLowerCase();
  if (!validEmail(recipient)) return outcome("failed", "The signed-in staff account does not have a usable email address for the test.");
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = cleanText(env.RESEND_FROM_EMAIL, 254);
  if (!apiKey || !validEmail(from)) return outcome("failed", "Resend is not fully configured.");
  const { response, payload } = await fetchJson(`${RESEND_BASE_URL}/emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "User-Agent": "JA-Head-Office-System-Test/1.0", "Idempotency-Key": `head-office-test-${crypto.randomUUID()}` },
    body: JSON.stringify({ from, to: [recipient], subject: "JA Group Services Head Office system test", text: `This controlled test confirms that the Head Office Operations Centre can send customer-service email through Resend.\n\nTested by: ${actor?.displayName || "Authorised staff"}\nTime: ${new Date().toISOString()}` })
  }, timeoutSeconds(values));
  if (!response.ok || !payload.id) return outcome("failed", "Resend rejected the controlled test email.", { providerStatus: response.status, providerMessage: cleanText(payload.message || payload.error, 300) });
  return outcome("passed", `Resend accepted a controlled test email to ${recipient}.`, { messageId: payload.id, recipient });
}

async function testResend(env, actor, values, mode, confirmation) {
  if (mode === "controlled") return controlledResendDelivery(env, actor, values, confirmation);
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = cleanText(env.RESEND_FROM_EMAIL, 254);
  if (!apiKey || !validEmail(from)) return outcome("failed", "Resend is not fully configured.", { apiKeyConfigured: Boolean(apiKey), senderConfigured: validEmail(from) });
  const { response, payload } = await fetchJson(`${RESEND_BASE_URL}/domains`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "User-Agent": "JA-Head-Office-System-Test/1.0" }
  }, timeoutSeconds(values));
  if (response.ok) {
    const senderDomain = from.split("@")[1];
    const domains = Array.isArray(payload.data) ? payload.data : [];
    const domain = domains.find(item => String(item.name || "").toLowerCase() === senderDomain);
    if (!domain) return outcome("warning", "Resend accepted the API key, but the configured sender domain was not returned by the account.", { senderDomain, visibleDomains: domains.length });
    if (domain.status !== "verified") return outcome("warning", "Resend accepted the API key, but the sender domain is not fully verified.", { senderDomain, domainStatus: domain.status });
    return outcome("passed", "Resend accepted the API key and the sender domain is verified.", { senderDomain, domainStatus: domain.status });
  }
  if (response.status === 403) return outcome("warning", "The Resend key is configured but cannot read domain metadata. It may be a sending-only key; use the controlled email test for end-to-end confirmation.", { providerStatus: response.status, sender: from });
  return outcome("failed", "Resend rejected the API connection.", { providerStatus: response.status, providerMessage: cleanText(payload.message || payload.error, 300) });
}

async function testWebhooks(env) {
  const [stripe, didit] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN processing_status='failed' THEN 1 ELSE 0 END) failed FROM stripe_division_webhook_events"),
    env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN processing_status='failed' THEN 1 ELSE 0 END) failed FROM identity_verification_webhook_events")
  ]);
  const stripeFailed = Number(stripe.results?.[0]?.failed || 0);
  const diditFailed = Number(didit.results?.[0]?.failed || 0);
  const configuration = {
    stripePlanyxSecret: Boolean(String(env.STRIPE_PLANYX_WEBHOOK_SECRET || "").trim()),
    stripeProfileCentreSecret: Boolean(String(env.STRIPE_PROFILE_CENTRE_WEBHOOK_SECRET || "").trim()),
    diditSecret: Boolean(String(env.DIDIT_WEBHOOK_SECRET || "").trim())
  };
  if (!Object.values(configuration).every(Boolean)) return outcome("failed", "One or more webhook signing secrets are missing.", configuration);
  if (stripeFailed + diditFailed > 0) return outcome("warning", "Webhook signing is configured, but failed events require review.", { stripeFailed, diditFailed, stripeReceived: Number(stripe.results?.[0]?.total || 0), diditReceived: Number(didit.results?.[0]?.total || 0) });
  return outcome("passed", "Stripe and Didit webhook signing is configured with no failed events recorded.", { stripeReceived: Number(stripe.results?.[0]?.total || 0), diditReceived: Number(didit.results?.[0]?.total || 0) });
}

async function testAutomation(env, values) {
  const [customer, staff, stripe] = await env.DB.batch([
    env.DB.prepare("SELECT status,started_at,completed_at FROM customer_directory_sync_runs ORDER BY started_at DESC LIMIT 1"),
    env.DB.prepare("SELECT status,started_at,completed_at FROM staff_directory_sync_runs ORDER BY started_at DESC LIMIT 1"),
    env.DB.prepare("SELECT status,started_at,completed_at FROM stripe_division_sync_runs ORDER BY started_at DESC LIMIT 1")
  ]);
  const automationSecretConfigured = Boolean(String(env.AUTOMATION_SECRET || "").trim());
  const enabled = {
    customerDirectory: values["automation.customer_directory_enabled"] !== false,
    staffDirectory: values["automation.staff_directory_enabled"] !== false,
    stripe: values["automation.stripe_reconciliation_enabled"] !== false
  };
  if (!automationSecretConfigured) return outcome("failed", "The scheduled automation credential is not configured.", { enabled });
  const latest = { customerDirectory: customer.results?.[0] || null, staffDirectory: staff.results?.[0] || null, stripe: stripe.results?.[0] || null };
  const failures = Object.entries(latest).filter(([, value]) => value?.status === "failed").map(([key]) => key);
  if (failures.length) return outcome("warning", "Scheduled automation is configured, but a recent reconciliation run failed.", { enabled, failures, latest });
  return outcome("passed", "Scheduled automation is configured and no latest reconciliation run is failed.", { enabled, latest });
}

async function testConnectedSystems(env) {
  const [platforms, credentials, stale] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) count FROM platforms WHERE status!='disabled'"),
    env.DB.prepare("SELECT COUNT(*) count FROM platform_api_credentials WHERE status='active'"),
    env.DB.prepare("SELECT COUNT(*) count FROM platform_operational_profiles WHERE health_status IN ('degraded','offline','unknown')")
  ]);
  const counts = { platforms: Number(platforms.results?.[0]?.count || 0), activeCredentials: Number(credentials.results?.[0]?.count || 0), attentionRequired: Number(stale.results?.[0]?.count || 0) };
  if (!counts.platforms) return outcome("warning", "No connected website or service is currently registered.", counts);
  if (counts.attentionRequired) return outcome("warning", "Connected systems are registered, but one or more operational profiles require attention.", counts);
  return outcome("passed", "Connected systems are registered and no operational profile is reporting an attention state.", counts);
}

async function testSecurityControls(env) {
  const [markers, restrictions, lockdowns] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) count FROM security_marker_definitions WHERE status='active' AND marker_code LIKE 'SMC-%'"),
    env.DB.prepare("SELECT COUNT(*) count FROM restriction_types WHERE status='active'"),
    env.DB.prepare("SELECT COUNT(*) count FROM platform_lockdowns WHERE status='active'")
  ]);
  const details = { activeMarkerDefinitions: Number(markers.results?.[0]?.count || 0), activeRestrictionTypes: Number(restrictions.results?.[0]?.count || 0), activeCriticalLockdowns: Number(lockdowns.results?.[0]?.count || 0), criticalLockdownPolicy: "manual_only" };
  if (details.activeMarkerDefinitions < 7 || details.activeRestrictionTypes < 1) return outcome("failed", "The governed security control catalogue is incomplete.", details);
  return outcome("passed", "Security markers, restrictions and manual-only critical lockdown controls are ready.", details);
}

async function execute(env, service, actor, values, mode, confirmation) {
  if (service.code === "core_database") return testCoreDatabase(env);
  if (service.code === "staff_authentication") return testStaffAuthentication(env, values, actor);
  if (service.code === "customer_directory") return testCustomerDirectory(env);
  if (service.code === "staff_directory") return testStaffDirectory(env);
  if (service.code === "stripe_planyx") return testStripe(env, values, "planyx");
  if (service.code === "stripe_profile_centre") return testStripe(env, values, "profile-centre");
  if (service.code === "didit") return testDidit(env, values);
  if (service.code === "resend") return testResend(env, actor, values, mode, confirmation);
  if (service.code === "webhooks") return testWebhooks(env);
  if (service.code === "automation") return testAutomation(env, values);
  if (service.code === "connected_systems") return testConnectedSystems(env);
  if (service.code === "security_controls") return testSecurityControls(env);
  return outcome("failed", "The requested service test is not registered.");
}

async function recordResult(env, service, actor, requestId, mode, result, startedAt, completedAt, durationMs) {
  await env.DB.prepare(`INSERT INTO service_test_runs
    (id,service_code,service_label,test_mode,status,summary,details_json,started_by,request_id,started_at,completed_at,duration_ms)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), service.code, service.label, mode, result.status, cleanText(result.summary, 1000), JSON.stringify(result.details || {}), actor?.sub || null, requestId || null, startedAt, completedAt, durationMs).run();
}

export async function runSystemServiceTest(env, code, actor, requestId, options = {}) {
  await ensureSystemSettingsReady(env);
  const settings = await getSystemSettings(env);
  if (settings.values["system.test_centre_enabled"] === false) {
    throw Object.assign(new Error("The System Test Centre is disabled in System Settings."), { code: "TEST_CENTRE_DISABLED", status: 503 });
  }
  const service = serviceFor(code);
  if (!service) throw Object.assign(new Error("Select a registered Head Office service test."), { code: "SERVICE_TEST_NOT_FOUND", status: 404 });
  const mode = options.mode === "controlled" ? "controlled" : "safe";
  if (mode === "controlled" && code !== "resend") throw Object.assign(new Error("That service does not expose a controlled external test."), { code: "CONTROLLED_TEST_NOT_SUPPORTED", status: 400 });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  let result;
  try {
    result = await execute(env, service, actor, settings.values, mode, cleanText(options.confirmation, 100));
  } catch (cause) {
    result = outcome("failed", cause?.message || "The service test could not be completed.", { code: cleanText(cause?.code, 120), providerStatus: Number(cause?.status || cause?.providerStatus || 0) || undefined });
  }
  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - started;
  await recordResult(env, service, actor, requestId, mode, result, startedAt, completedAt, durationMs);
  const retentionDays = Math.max(7, Math.min(Number(settings.values["tests.result_retention_days"] || 90), 365));
  await env.DB.prepare("DELETE FROM service_test_runs WHERE started_at < datetime('now', ?)").bind(`-${retentionDays} days`).run();
  return { service: { ...service, enabled: service.settingKey ? settings.values[service.settingKey] !== false : true }, mode, ...result, startedAt, completedAt, durationMs };
}

export async function runAllSafeSystemTests(env, actor, requestId) {
  const results = [];
  for (const service of SYSTEM_SERVICE_CATALOG) results.push(await runSystemServiceTest(env, service.code, actor, requestId, { mode: "safe" }));
  return results;
}

export async function systemTestCentreSnapshot(env) {
  await ensureSystemSettingsReady(env);
  const settings = await getSystemSettings(env);
  const runs = await env.DB.prepare("SELECT * FROM service_test_runs ORDER BY started_at DESC LIMIT 150").all();
  const latest = new Map();
  for (const row of runs.results || []) if (!latest.has(row.service_code)) latest.set(row.service_code, row);
  return {
    settings: {
      testCentreEnabled: settings.values["system.test_centre_enabled"] !== false,
      externalTestsEnabled: settings.values["system.external_test_actions_enabled"] === true,
      portalMode: settings.values["system.portal_mode"] || "normal"
    },
    services: SYSTEM_SERVICE_CATALOG.map(service => ({
      ...service,
      enabled: service.settingKey ? settings.values[service.settingKey] !== false : true,
      latest: latest.get(service.code) || null
    })),
    recentRuns: (runs.results || []).slice(0, 50)
  };
}
