/* Customer Protection Operations
   Evidence-led view of identity, device, payment, fraud, intervention and recovery controls. */

function protectionCount(rows, predicate) {
  return (rows || []).filter(predicate).length;
}

function protectionState(stateName, detail, tone = "neutral") {
  return `<span class="protection-state" data-tone="${escapeHtml(tone)}"><strong>${escapeHtml(stateName)}</strong><small>${escapeHtml(detail)}</small></span>`;
}

function protectionCapability({ code, title, purpose, stateName, detail, tone = "neutral", route = "", action = "" }) {
  const control = route
    ? `<button class="button secondary small" data-route="${escapeHtml(route)}">Open control</button>`
    : action
      ? `<button class="button secondary small" data-action="${escapeHtml(action)}">Open control</button>`
      : "";
  return `<article class="protection-capability" data-tone="${escapeHtml(tone)}">
    <div class="protection-capability-code">${escapeHtml(code)}</div>
    <div class="protection-capability-copy"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(purpose)}</p></div>
    ${protectionState(stateName, detail, tone)}
    ${control}
  </article>`;
}

function protectionMetric(labelText, value, detail, tone = "neutral") {
  return `<article class="protection-metric" data-tone="${escapeHtml(tone)}"><span>${escapeHtml(labelText)}</span><strong>${Number(value || 0).toLocaleString("en-GB")}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function protectionEventRows(events) {
  return events.length ? events.slice(0, 40).map(item => `<tr>
    <td>${formatDate(item.received_at)}</td>
    <td class="mono">${escapeHtml(item.event_reference)}</td>
    <td><strong class="mono">${escapeHtml(item.event_type)}</strong><br><small>${escapeHtml(label(item.category || item.source_type || "event"))}</small></td>
    <td>${escapeHtml(item.customer_name || item.customer_number || item.platform_name || "System")}</td>
    <td>${riskScore(item.risk_score)}</td>
    <td>${levelChip(item.risk_level)} ${levelChip(item.enforcement_level)}</td>
    <td>${tag(item.processing_status || "processed")}</td>
  </tr>`).join("") : `<tr><td colspan="7">${emptyState("No protection telemetry", "Connect approved identity, website, payment and security sources before relying on automated detection.")}</td></tr>`;
}

window.renderCustomerProtectionWorkspace = async function renderCustomerProtectionWorkspace() {
  const [overview, eventData, alertData, incidentData, health] = await Promise.all([
    api("/api/v7/overview").catch(() => ({ metrics: {} })),
    api("/api/v7/events").catch(() => ({ events: [] })),
    api("/api/v7/alerts").catch(() => ({ alerts: [] })),
    api("/api/v7/incidents").catch(() => ({ incidents: [] })),
    api("/api/health").catch(() => ({ status: "degraded", database: "unknown", version7Schema: "unknown" }))
  ]);

  const events = eventData.events || [];
  const alerts = alertData.alerts || [];
  const incidents = incidentData.incidents || [];
  const metrics = overview.metrics || {};

  const authEvents = events.filter(item => ["authentication", "identity", "account"].includes(item.category) || /auth|login|identity|session|account/i.test(item.event_type || ""));
  const deviceEvents = events.filter(item => /device|browser|ip|location/i.test(item.event_type || "") || item.device_hash || item.ip_hash);
  const paymentEvents = events.filter(item => ["payment", "refund", "dispute"].includes(item.category) || /payment|refund|chargeback|dispute/i.test(item.event_type || ""));
  const scamEvents = events.filter(item => /scam|phish|social_engineering|suspicious_message|impersonation/i.test(item.event_type || ""));
  const criticalAlerts = alerts.filter(item => item.risk_level === "R4" || item.severity === "SEV-1");
  const unassignedAlerts = alerts.filter(item => !item.assigned_staff_id);
  const breachAssessments = incidents.filter(item => ["assessment_required", "reportable"].includes(item.data_breach_status));
  const serviceHealthy = health.status === "operational" && health.database === "connected";

  const accountControlConnected = Boolean(state.reference?.permissions?.length);
  const paymentConnected = paymentEvents.length > 0;
  const deviceConnected = deviceEvents.length > 0;
  const scamConnected = scamEvents.length > 0;
  const authConnected = authEvents.length > 0;

  $("#viewRoot").innerHTML = `
    <div class="page-heading protection-heading">
      <div><p class="eyebrow">Security Operations Centre · Customer Protection</p><h1>Customer protection operations</h1><p>Identity assurance, device and session trust, payment protection, fraud reporting, protective intervention and customer recovery. Controls are shown as active only where the Centre has evidence or a connected enforcement route.</p></div>
      <div class="heading-actions">${hasPermission("risk:write") ? '<button class="button primary" data-action="new-security-event">Record security report</button>' : ""}<button class="button secondary" data-route="risk-intelligence">Open intelligence queue</button></div>
    </div>

    <div class="protection-readiness" data-state="${serviceHealthy ? "operational" : "degraded"}">
      <div><span>Protection service</span><strong>${serviceHealthy ? "Operational" : "Degraded"}</strong><small>Database ${escapeHtml(label(health.database || "unknown"))} · risk engine ${escapeHtml(label(health.version7Schema || "unknown"))}</small></div>
      <div><span>Evidence received</span><strong>${events.length.toLocaleString("en-GB")} events</strong><small>${alerts.length} active alert records</small></div>
      <div><span>Human review</span><strong>${unassignedAlerts.length} unassigned</strong><small>${criticalAlerts.length} critical alert${criticalAlerts.length === 1 ? "" : "s"}</small></div>
      <div><span>Incident escalation</span><strong>${incidents.length} open</strong><small>${breachAssessments.length} breach assessment${breachAssessments.length === 1 ? "" : "s"}</small></div>
    </div>

    <section class="protection-section">
      <header><div><span class="section-number">01</span><div><h2>Prevent, verify and control</h2><p>Controls that establish identity confidence and stop sensitive activity before harm occurs.</p></div></div></header>
      <div class="protection-capability-list">
        ${protectionCapability({ code: "IAM", title: "Identity and authentication assurance", purpose: "Verified External ID identity, account state, step-up decisions and protected recovery.", stateName: authConnected ? "Telemetry received" : "Awaiting website telemetry", detail: authConnected ? `${authEvents.length} identity or authentication events retained` : "External ID directory is connected; sign-in and recovery events must be sent by each website", tone: authConnected ? "success" : "warning", route: "customer-directory" })}
        ${protectionCapability({ code: "DVT", title: "Device and session trust", purpose: "Known/new device signals, unusual location indicators, session revocation and compromised-device response.", stateName: deviceConnected ? "Signals received" : "Not yet connected", detail: deviceConnected ? `${deviceEvents.length} device, browser, IP or location signals retained` : "Planyx and other websites must send trusted-device and session events", tone: deviceConnected ? "success" : "warning", route: "risk-intelligence" })}
        ${protectionCapability({ code: "PAY", title: "Payment and refund protection", purpose: "Risk-based checks before payment, refund, dispute or sensitive financial action.", stateName: paymentConnected ? "Payment telemetry received" : "Awaiting Stripe and website events", detail: paymentConnected ? `${paymentEvents.length} payment, refund or dispute signals retained` : "Stripe webhook and Head Office customer metadata must be active", tone: paymentConnected ? "success" : "warning", route: "payments" })}
        ${protectionCapability({ code: "ACT", title: "Protective account intervention", purpose: "Targeted restriction, step-up verification, session revocation, suspension and controlled reactivation.", stateName: accountControlConnected ? "Head Office controls available" : "Authority unavailable", detail: accountControlConnected ? "Actions remain permission-gated and auditable" : "Staff authority catalogue did not load", tone: accountControlConnected ? "success" : "critical", route: "security" })}
      </div>
    </section>

    <section class="protection-section">
      <header><div><span class="section-number">02</span><div><h2>Detect, report and investigate</h2><p>Signals and reports that enter the Security Operations Centre for correlation and human review.</p></div></div></header>
      <div class="protection-metrics">
        ${protectionMetric("Authentication signals", authEvents.length, "Sign-in, recovery, identity and account activity", authConnected ? "success" : "warning")}
        ${protectionMetric("Device signals", deviceEvents.length, "Device, browser, IP and location evidence", deviceConnected ? "success" : "warning")}
        ${protectionMetric("Payment signals", paymentEvents.length, "Payments, refunds, disputes and chargebacks", paymentConnected ? "success" : "warning")}
        ${protectionMetric("Scam reports", scamEvents.length, "Phishing, impersonation and suspicious contact", scamConnected ? "success" : "warning")}
        ${protectionMetric("Critical alerts", criticalAlerts.length, "R4 or SEV-1 requiring urgent review", criticalAlerts.length ? "critical" : "success")}
        ${protectionMetric("Open incidents", incidents.length, "Containment, investigation and recovery", incidents.length ? "warning" : "success")}
      </div>
      <div class="protection-grid">
        <article class="enterprise-panel">
          <div class="enterprise-panel-header"><div><h2>Protection telemetry ledger</h2><p>Latest identity, account, device, payment and fraud evidence received by Head Office.</p></div><button class="button secondary small" data-route="risk-intelligence">Open full evidence</button></div>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Received</th><th>Reference</th><th>Event</th><th>Subject</th><th>Score</th><th>Control</th><th>Processing</th></tr></thead><tbody>${protectionEventRows(events)}</tbody></table></div>
        </article>
        <aside class="protection-side-register">
          <article><span>Customer fraud reporting</span><strong>${scamConnected ? "Receiving reports" : "Channel not connected"}</strong><p>Suspicious messages, impersonation, scam concerns and account-access reports should create security events and cases automatically.</p><button class="button secondary small" data-action="new-security-event">Record report</button></article>
          <article><span>Human decision queue</span><strong>${alerts.length} alert${alerts.length === 1 ? "" : "s"}</strong><p>Automated scores support triage. They do not establish fraud or justify adverse action without a recorded authorised decision.</p><button class="button secondary small" data-route="risk-intelligence">Review alerts</button></article>
          <article><span>Incident and breach response</span><strong>${incidents.length} open incident${incidents.length === 1 ? "" : "s"}</strong><p>Containment, evidence, recovery and data-breach reportability remain in Incident Command.</p><button class="button secondary small" data-route="incidents-v7">Open command</button></article>
        </aside>
      </div>
    </section>

    <section class="protection-section">
      <header><div><span class="section-number">03</span><div><h2>Recover and support</h2><p>Controlled restoration of customer access and support after fraud, compromise or a security concern.</p></div></div></header>
      <div class="protection-capability-list compact">
        ${protectionCapability({ code: "REC", title: "Account recovery review", purpose: "Confirm identity, revoke unsafe sessions, restore access and record the basis for the decision.", stateName: "Human review required", detail: "Password and sign-in recovery remain within Microsoft External ID", tone: "neutral", route: "cases" })}
        ${protectionCapability({ code: "VIC", title: "Customer support after fraud", purpose: "Link fraud reports, complaints, reimbursement decisions, vulnerability needs and communications.", stateName: "Operational casework", detail: "Support is managed through customer cases and communications", tone: "neutral", route: "central-operations" })}
        ${protectionCapability({ code: "EVD", title: "Evidence and decision record", purpose: "Preserve telemetry, staff actions, customer contact and final rationale for audit or legal review.", stateName: "Audit controlled", detail: "Every protected action must retain actor, time, reason and affected record", tone: "success", route: "audit" })}
      </div>
    </section>`;
};
