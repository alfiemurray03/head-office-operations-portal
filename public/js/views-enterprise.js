/* Enterprise presentation layer for Version 7.
   Uses the existing controlled APIs and permissions; changes presentation, not authority. */

function enterpriseRelativeTime(value) {
  if (!value) return 'Not recorded';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return 'Not recorded';
  const seconds = Math.round((Date.now() - then) / 1000);
  if (Math.abs(seconds) < 60) return `${Math.abs(seconds)}s ${seconds >= 0 ? 'ago' : 'from now'}`;
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return `${Math.abs(minutes)}m ${minutes >= 0 ? 'ago' : 'from now'}`;
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return `${Math.abs(hours)}h ${hours >= 0 ? 'ago' : 'from now'}`;
  const days = Math.round(hours / 24);
  return `${Math.abs(days)}d ${days >= 0 ? 'ago' : 'from now'}`;
}

function enterpriseMetric(labelText, value, detail, tone = 'neutral') {
  return `<article class="enterprise-metric" data-tone="${escapeHtml(tone)}"><span>${escapeHtml(labelText)}</span><strong>${Number(value || 0).toLocaleString('en-GB')}</strong><small>${escapeHtml(detail)}</small></article>`;
}

function enterpriseStatus(labelText, value, detail = '') {
  return `<div class="enterprise-status-cell"><span>${escapeHtml(labelText)}</span><strong>${escapeHtml(value)}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`;
}

function enterpriseCommandBar(section, descriptor, right = '') {
  const userName = state.session?.user?.displayName || 'Authorised staff member';
  return `<div class="enterprise-command-bar"><div class="enterprise-command-title"><strong>${escapeHtml(section)}</strong><span>${escapeHtml(descriptor)}</span></div><div class="enterprise-command-meta"><span class="enterprise-live-indicator">Live production view</span><span>Authority: JA Group Services Ltd — Head Office</span><span>Operator: ${escapeHtml(userName)}</span>${right}</div></div>`;
}

function enterpriseAlertRows(rows) {
  return rows.length ? rows.map(item => `<tr>
    <td class="mono">${escapeHtml(item.alert_reference)}</td>
    <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.customer_name || item.customer_number || 'System or unlinked subject')}</small></td>
    <td>${riskScore(item.risk_score)}</td>
    <td>${levelChip(item.risk_level)} ${levelChip(item.enforcement_level)}</td>
    <td>${levelChip(item.severity)}</td>
    <td>${tag(item.status)}</td>
    <td>${formatDate(item.last_detected_at)}</td>
  </tr>`).join('') : `<tr><td colspan="7">${emptyState('No active risk alerts', 'No scored event currently requires Head Office review.')}</td></tr>`;
}

function enterpriseIncidentRows(rows, actions = false) {
  return rows.length ? rows.map(item => `<tr>
    <td class="mono">${escapeHtml(item.incident_reference)}</td>
    <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.customer_name || item.customer_number || label(item.category))}</small></td>
    <td>${levelChip(item.severity)} ${item.data_classification ? levelChip(item.data_classification) : ''} ${item.confidentiality_level ? levelChip(item.confidentiality_level) : ''}</td>
    <td>${tag(item.status)}</td>
    <td>${tag(item.data_breach_status)}</td>
    <td class="${item.ico_deadline_at && new Date(item.ico_deadline_at) < new Date() && !['reported','not_reportable','not_a_breach'].includes(item.data_breach_status) ? 'overdue-text' : ''}">${formatDate(item.ico_deadline_at)}</td>
    ${actions ? `<td>${hasPermission('incidents:write') ? `<button class="button secondary small" data-action="update-v7-incident" data-id="${escapeHtml(item.id)}" data-reference="${escapeHtml(item.incident_reference)}" data-status="${escapeHtml(item.status)}" data-severity="${escapeHtml(item.severity)}" data-breach="${escapeHtml(item.data_breach_status)}">Open record</button>` : ''}</td>` : ''}
  </tr>`).join('') : `<tr><td colspan="${actions ? 7 : 6}">${emptyState('No open incidents', 'No cyber, fraud, security or personal-data incident currently requires response.')}</td></tr>`;
}

function enterpriseTaskRows(rows, limit = 200) {
  const selected = rows.slice(0, limit);
  return selected.length ? selected.map(item => `<tr>
    <td class="mono">${escapeHtml(item.task_reference)}</td>
    <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(label(item.service_area))} · ${escapeHtml(label(item.task_type))}</small></td>
    <td>${escapeHtml(item.customer_name || item.customer_number || 'Not linked')}</td>
    <td>${tag(item.priority)}</td>
    <td>${tag(item.status)}</td>
    <td>${escapeHtml(item.assigned_staff_name || 'Unassigned')}</td>
    <td class="${item.due_at && new Date(item.due_at) < new Date() ? 'overdue-text' : ''}">${formatDate(item.due_at)}</td>
    <td>${hasPermission('operations:write') ? `<button class="button secondary small" data-action="update-v7-task" data-id="${escapeHtml(item.id)}" data-reference="${escapeHtml(item.task_reference)}" data-status="${escapeHtml(item.status)}">Update</button>` : ''}</td>
  </tr>`).join('') : `<tr><td colspan="8">${emptyState('No outstanding Head Office work', 'The central queue contains no open task at present.')}</td></tr>`;
}

// Retain the previous enterprise register as an explicitly callable fallback,
// but do not replace the live Control Centre renderer registered by views-v7.
window.renderEnterpriseControlRoomV7 = async function renderEnterpriseControlRoom() {
  const operationsRequest = hasPermission('operations:read') ? api('/api/v7/operations') : Promise.resolve({ tasks: [], complaints: [], financial: [] });
  const [data, health, operations] = await Promise.all([
    api('/api/v7/overview'),
    api('/api/health').catch(() => ({ status: 'degraded', database: 'unknown', operationsSchema: 'unknown', version7Schema: 'unknown' })),
    operationsRequest
  ]);
  const m = data.metrics || {};
  const tasks = operations.tasks || [];
  const overdueTasks = tasks.filter(item => item.due_at && new Date(item.due_at) < new Date()).length;
  const unassignedTasks = tasks.filter(item => !item.assigned_staff_id).length;
  const operational = health.status === 'operational';
  const eventRows = data.events.length ? data.events.map(item => `<tr>
    <td>${formatDate(item.received_at)}</td>
    <td class="mono">${escapeHtml(item.event_reference)}</td>
    <td><strong class="mono">${escapeHtml(item.event_type)}</strong><br><small>${escapeHtml(label(item.category))}</small></td>
    <td>${escapeHtml(item.customer_name || item.customer_number || item.platform_name || 'System')}</td>
    <td>${riskScore(item.risk_score)}</td>
    <td>${levelChip(item.risk_level)} ${levelChip(item.enforcement_level)}</td>
  </tr>`).join('') : `<tr><td colspan="6">${emptyState('No security telemetry received', 'Connect an approved source or record a controlled event.')}</td></tr>`;

  $('#viewRoot').innerHTML = `
    ${enterpriseCommandBar('Head Office Control Room', 'Central customer operations, fraud, security, incidents and regulatory response.', `<span>Updated ${escapeHtml(new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium' }).format(new Date()))}</span>`)}
    <div class="enterprise-status-strip">
      ${enterpriseStatus('Service state', operational ? 'Operational' : 'Degraded', 'Cloudflare Pages Functions')}
      ${enterpriseStatus('Database', label(health.database || 'unknown'), 'Head Office operational data')}
      ${enterpriseStatus('Operations schema', label(health.operationsSchema || 'unknown'), 'Customer and case controls')}
      ${enterpriseStatus('Risk engine', label(health.version7Schema || 'unknown'), 'Versioned rule catalogue')}
      ${enterpriseStatus('Staff session', state.session?.authenticated ? 'Authenticated' : 'Not authenticated', 'Microsoft Entra')}
    </div>
    <div class="enterprise-metrics">
      ${enterpriseMetric('Critical alerts', m.criticalAlerts, 'R4 or SEV-1 requiring immediate review', Number(m.criticalAlerts) ? 'critical' : 'success')}
      ${enterpriseMetric('Open alerts', m.openAlerts, 'Fraud and security intelligence queue', Number(m.openAlerts) ? 'warning' : 'success')}
      ${enterpriseMetric('Open incidents', m.openIncidents, 'Containment, investigation and recovery', Number(m.openIncidents) ? 'critical' : 'success')}
      ${enterpriseMetric('Breach assessments', m.breachAssessments, 'Open personal-data reportability decisions', Number(m.breachAssessments) ? 'warning' : 'success')}
      ${enterpriseMetric('Head Office tasks', m.openTasks, `${overdueTasks} overdue · ${unassignedTasks} unassigned`, overdueTasks ? 'critical' : 'neutral')}
      ${enterpriseMetric('Customer redress', Number(m.openComplaints || 0) + Number(m.openFinancialCases || 0), `${Number(m.openComplaints || 0)} complaints · ${Number(m.openFinancialCases || 0)} refund/dispute`, 'neutral')}
    </div>
    <div class="enterprise-grid">
      <section class="enterprise-panel">
        <div class="enterprise-panel-header"><div><h2>Priority risk and fraud queue</h2><p>Explainable alerts ordered by risk score and latest detection.</p></div><div class="enterprise-panel-tools"><button class="button secondary small" data-route="risk-intelligence">Open intelligence register</button>${hasPermission('risk:write') ? '<button class="button primary small" data-action="new-security-event">Record event</button>' : ''}</div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Alert reference</th><th>Detection and subject</th><th>Score</th><th>Control</th><th>Severity</th><th>State</th><th>Last detected</th></tr></thead><tbody>${enterpriseAlertRows(data.alerts || [])}</tbody></table></div>
        <div class="enterprise-panel-caption">Scores support triage. They do not establish fraud, guilt or legal reportability without an authorised recorded decision.</div>
      </section>
      <section class="enterprise-panel">
        <div class="enterprise-panel-header"><div><h2>Immediate Head Office actions</h2><p>Current operational work requiring ownership or a deadline decision.</p></div><button class="button secondary small" data-route="central-operations">Open work queue</button></div>
        <div class="enterprise-summary-list">${tasks.slice(0, 8).map(item => `<div class="enterprise-summary-row"><time>${formatDate(item.due_at)}</time><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.task_reference)} · ${escapeHtml(label(item.service_area))} · ${escapeHtml(item.assigned_staff_name || 'Unassigned')}</small></div>${tag(item.priority)}</div>`).join('') || emptyState('No immediate actions', 'There are no open Head Office tasks in the current queue.')}</div>
      </section>
    </div>
    <div class="enterprise-grid">
      <section class="enterprise-panel">
        <div class="enterprise-panel-header"><div><h2>Incident command register</h2><p>Open incidents, containment status and personal-data breach deadlines.</p></div><button class="button secondary small" data-route="incidents-v7">Open incident register</button></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Incident reference</th><th>Incident</th><th>Classification</th><th>Response state</th><th>Breach position</th><th>ICO decision deadline</th></tr></thead><tbody>${enterpriseIncidentRows(data.incidents || [])}</tbody></table></div>
      </section>
      <section class="enterprise-panel">
        <div class="enterprise-panel-header"><div><h2>Control interpretation</h2><p>Operational meaning of the incident severity scale.</p></div><button class="button secondary small" data-route="security-levels">Open control catalogue</button></div>
        <div class="enterprise-severity-key"><div><strong>SEV-1 Critical</strong><span>Immediate executive command and containment.</span></div><div><strong>SEV-2 High</strong><span>Urgent coordinated investigation and controls.</span></div><div><strong>SEV-3 Medium</strong><span>Tracked investigation and remediation.</span></div><div><strong>SEV-4 Low</strong><span>Recorded review and proportionate action.</span></div></div>
      </section>
    </div>
    <section class="enterprise-panel">
      <div class="enterprise-panel-header"><div><h2>Security event ledger</h2><p>Latest normalised events and the resulting controlled decision.</p></div><span class="enterprise-live-indicator">Receiving enabled telemetry</span></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Received</th><th>Event reference</th><th>Event type</th><th>Subject</th><th>Score</th><th>Resulting control</th></tr></thead><tbody>${eventRows}</tbody></table></div>
    </section>`;
};

renderRiskIntelligenceV7 = async function renderEnterpriseRiskIntelligence() {
  const [eventData, alertData] = await Promise.all([api('/api/v7/events'), api('/api/v7/alerts')]);
  const alertsData = alertData.alerts || [];
  const eventsData = eventData.events || [];
  const critical = alertsData.filter(item => item.risk_level === 'R4' || item.severity === 'SEV-1').length;
  const paymentEvents = eventsData.filter(item => ['payment', 'refund', 'dispute'].includes(item.category)).length;
  const dataEvents = eventsData.filter(item => item.category === 'data').length;
  const unassigned = alertsData.filter(item => !item.assigned_staff_id).length;
  const alertRows = alertsData.length ? alertsData.map(item => `<tr>
    <td class="mono">${escapeHtml(item.alert_reference)}</td>
    <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.summary)}</small></td>
    <td>${escapeHtml(item.customer_name || item.customer_number || item.platform_name || 'System')}</td>
    <td>${riskScore(item.risk_score)}</td>
    <td>${levelChip(item.risk_level)} ${levelChip(item.enforcement_level)} ${levelChip(item.severity)}</td>
    <td>${tag(item.status)}</td>
    <td>${escapeHtml(item.assigned_staff_name || 'Unassigned')}</td>
    <td>${hasPermission('risk:write') ? `<button class="button secondary small" data-action="review-v7-alert" data-id="${escapeHtml(item.id)}" data-reference="${escapeHtml(item.alert_reference)}" data-status="${escapeHtml(item.status)}">Review decision</button>` : ''}</td>
  </tr>`).join('') : `<tr><td colspan="8">${emptyState('No active alerts', 'No event has exceeded the governed review threshold.')}</td></tr>`;
  const eventRows = eventsData.length ? eventsData.map(item => `<tr>
    <td>${formatDate(item.received_at)}</td><td class="mono">${escapeHtml(item.event_reference)}</td>
    <td><strong class="mono">${escapeHtml(item.event_type)}</strong><br><small>${escapeHtml(label(item.category))}</small></td>
    <td>${escapeHtml(item.customer_name || item.customer_number || item.platform_name || item.source_type)}</td>
    <td>${item.amount_minor == null ? '—' : formatMoney(item.amount_minor, item.currency || 'GBP')}</td>
    <td>${riskScore(item.risk_score)}</td><td>${levelChip(item.risk_level)} ${levelChip(item.enforcement_level)}</td><td>${escapeHtml(label(item.processing_status || 'processed'))}</td>
  </tr>`).join('') : `<tr><td colspan="8">${emptyState('No event evidence', 'No approved source has submitted telemetry to the ledger.')}</td></tr>`;

  $('#viewRoot').innerHTML = `
    ${enterpriseCommandBar('Fraud and Risk Intelligence', 'Explainable detection, evidence correlation and controlled human decisions.')}
    <div class="enterprise-metrics">
      ${enterpriseMetric('Active alerts', alertsData.length, 'All open intelligence requiring review', alertsData.length ? 'warning' : 'success')}
      ${enterpriseMetric('Critical alerts', critical, 'R4 or SEV-1', critical ? 'critical' : 'success')}
      ${enterpriseMetric('Unassigned alerts', unassigned, 'Ownership required', unassigned ? 'warning' : 'success')}
      ${enterpriseMetric('Events retained', eventsData.length, 'Current register view', 'neutral')}
      ${enterpriseMetric('Payment signals', paymentEvents, 'Payment, refund and dispute activity', 'neutral')}
      ${enterpriseMetric('Data security signals', dataEvents, 'Access, loss and disclosure indicators', dataEvents ? 'warning' : 'neutral')}
    </div>
    <section class="enterprise-panel">
      <div class="enterprise-panel-header"><div><h2>Active intelligence queue</h2><p>Each alert retains the rule rationale, score, subject, recommended control and final decision.</p></div>${hasPermission('risk:write') ? '<button class="button primary small" data-action="new-security-event">Record controlled event</button>' : ''}</div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Alert</th><th>Detection basis</th><th>Subject</th><th>Score</th><th>Control levels</th><th>State</th><th>Owner</th><th>Decision</th></tr></thead><tbody>${alertRows}</tbody></table></div>
    </section>
    <section class="enterprise-panel">
      <div class="enterprise-panel-header"><div><h2>Security event evidence ledger</h2><p>Normalised source events retained with processing outcome and resulting risk control.</p></div><button class="button secondary small" data-route="security-levels">Rule catalogue</button></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Received</th><th>Reference</th><th>Event</th><th>Subject</th><th>Amount</th><th>Score</th><th>Decision</th><th>Processing</th></tr></thead><tbody>${eventRows}</tbody></table></div>
    </section>`;
};

renderIncidentsV7 = async function renderEnterpriseIncidents() {
  const data = await api('/api/v7/incidents');
  const incidents = data.incidents || [];
  const sev1 = incidents.filter(item => item.severity === 'SEV-1').length;
  const sev2 = incidents.filter(item => item.severity === 'SEV-2').length;
  const assessments = incidents.filter(item => ['assessment_required', 'reportable'].includes(item.data_breach_status)).length;
  const overdue = incidents.filter(item => item.ico_deadline_at && new Date(item.ico_deadline_at) < new Date() && !['reported','not_reportable','not_a_breach'].includes(item.data_breach_status)).length;
  const unowned = incidents.filter(item => !item.owner_staff_id).length;

  $('#viewRoot').innerHTML = `
    ${enterpriseCommandBar('Incident Command and Data Breach Response', 'Discovery, containment, investigation, remediation, recovery and regulatory decisions.')}
    <div class="enterprise-metrics">
      ${enterpriseMetric('Open incidents', incidents.length, 'All current response records', incidents.length ? 'warning' : 'success')}
      ${enterpriseMetric('SEV-1 critical', sev1, 'Immediate executive response', sev1 ? 'critical' : 'success')}
      ${enterpriseMetric('SEV-2 high', sev2, 'Urgent coordinated response', sev2 ? 'warning' : 'success')}
      ${enterpriseMetric('Breach assessments', assessments, 'Reportability decision outstanding', assessments ? 'warning' : 'success')}
      ${enterpriseMetric('Overdue decisions', overdue, 'Deadline exceeded', overdue ? 'critical' : 'success')}
      ${enterpriseMetric('Unassigned incidents', unowned, 'Incident owner required', unowned ? 'warning' : 'success')}
    </div>
    <div class="enterprise-status-strip">
      ${enterpriseStatus('Lifecycle', 'Detect → Respond → Recover', 'Controlled state transitions')}
      ${enterpriseStatus('Evidence', 'Timeline required', 'Every material response action')}
      ${enterpriseStatus('Personal data', 'DPO decision', 'Reportability is not automated')}
      ${enterpriseStatus('Regulatory clock', '72-hour support', 'Calculated from recorded awareness')}
      ${enterpriseStatus('Closure control', 'Lessons and rationale', 'Required before record closure')}
    </div>
    <section class="enterprise-panel">
      <div class="enterprise-panel-header"><div><h2>Incident command register</h2><p>Open incidents ordered by severity with containment status and breach position.</p></div>${hasPermission('incidents:write') ? '<button class="button danger small" data-action="new-v7-incident">Open incident</button>' : ''}</div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Reference</th><th>Incident and subject</th><th>Classification</th><th>Response state</th><th>Breach position</th><th>ICO decision deadline</th><th>Record</th></tr></thead><tbody>${enterpriseIncidentRows(incidents, true)}</tbody></table></div>
      <div class="enterprise-panel-caption">The system supports incident and breach governance. The DPO or authorised incident owner remains accountable for the recorded decision.</div>
    </section>`;
};

renderCentralOperationsV7 = async function renderEnterpriseCentralOperations() {
  const data = await api('/api/v7/operations');
  const tasks = data.tasks || [];
  const complaints = data.complaints || [];
  const financial = data.financial || [];
  const overdue = tasks.filter(item => item.due_at && new Date(item.due_at) < new Date()).length;
  const critical = tasks.filter(item => item.priority === 'critical').length;
  const approval = tasks.filter(item => item.status === 'approval_required').length;
  const unassigned = tasks.filter(item => !item.assigned_staff_id).length;
  const complaintRows = complaints.length ? complaints.map(item => `<tr data-open="case" data-id="${escapeHtml(item.id)}"><td class="mono">${escapeHtml(item.case_reference)}</td><td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.customer_name || item.customer_number || 'No linked customer')}</small></td><td>${escapeHtml(label(item.complaint_stage || 'received'))}</td><td>${tag(item.priority)}</td><td>${tag(item.status)}</td><td>${formatDate(item.acknowledgement_due_at)}</td><td>${formatDate(item.final_response_due_at || item.due_at)}</td></tr>`).join('') : `<tr><td colspan="7">${emptyState('No active complaints', 'No complaint is currently open in the central redress queue.')}</td></tr>`;
  const financialRows = financial.length ? financial.map(item => `<tr data-open="case" data-id="${escapeHtml(item.id)}"><td class="mono">${escapeHtml(item.case_reference)}</td><td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.customer_name || item.customer_number || 'No linked customer')}</small></td><td>${escapeHtml(label(item.operation_type || item.case_type))}</td><td>${escapeHtml(item.provider || 'Not recorded')}</td><td class="mono">${escapeHtml(item.transaction_reference || '—')}</td><td>${item.amount_minor == null ? '—' : formatMoney(item.amount_minor, item.currency || 'GBP')}</td><td>${item.fraud_suspected ? levelChip('R3') : levelChip('R0')}</td><td>${tag(item.approval_status || item.status)}</td><td>${formatDate(item.due_at)}</td></tr>`).join('') : `<tr><td colspan="9">${emptyState('No active refunds or disputes', 'No financial redress case is currently open.')}</td></tr>`;

  $('#viewRoot').innerHTML = `
    ${enterpriseCommandBar('Central Head Office Operations', 'Single controlled queue for customer actions, complaints, refunds, disputes and cross-division work.')}
    <div class="enterprise-metrics">
      ${enterpriseMetric('Open tasks', tasks.length, 'All active Head Office actions', tasks.length ? 'neutral' : 'success')}
      ${enterpriseMetric('Critical tasks', critical, 'Immediate operational attention', critical ? 'critical' : 'success')}
      ${enterpriseMetric('Overdue tasks', overdue, 'Due date passed', overdue ? 'critical' : 'success')}
      ${enterpriseMetric('Approval required', approval, 'Formal authorised decision needed', approval ? 'warning' : 'success')}
      ${enterpriseMetric('Unassigned work', unassigned, 'Named ownership required', unassigned ? 'warning' : 'success')}
      ${enterpriseMetric('Customer redress', complaints.length + financial.length, `${complaints.length} complaints · ${financial.length} financial`, 'neutral')}
    </div>
    <section class="enterprise-panel">
      <div class="enterprise-panel-header"><div><h2>Head Office work queue</h2><p>Controlled tasks, priority, ownership and service deadlines.</p></div><div class="enterprise-panel-tools">${hasPermission('cases:create') ? '<button class="button secondary small" data-action="new-case" data-case-type="complaint">New complaint</button><button class="button secondary small" data-action="new-case" data-case-type="refund">New refund</button><button class="button secondary small" data-action="new-case" data-case-type="payment_dispute">New dispute</button>' : ''}${hasPermission('operations:write') ? '<button class="button primary small" data-action="new-v7-task">New Head Office task</button>' : ''}</div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Task</th><th>Required action</th><th>Customer</th><th>Priority</th><th>State</th><th>Owner</th><th>Due</th><th>Control</th></tr></thead><tbody>${enterpriseTaskRows(tasks)}</tbody></table></div>
    </section>
    <div class="enterprise-grid">
      <section class="enterprise-panel"><div class="enterprise-panel-header"><div><h2>Complaint and redress register</h2><p>Acknowledgement, investigation, remedy and final-response control.</p></div><button class="button secondary small" data-route="complaints">Open case register</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Case</th><th>Complaint</th><th>Stage</th><th>Priority</th><th>State</th><th>Acknowledge by</th><th>Final response by</th></tr></thead><tbody>${complaintRows}</tbody></table></div></section>
      <section class="enterprise-panel"><div class="enterprise-panel-header"><div><h2>Refund, dispute and chargeback register</h2><p>Transaction evidence, fraud indicators and approval position.</p></div><button class="button secondary small" data-route="payments">Open payment controls</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Case</th><th>Customer issue</th><th>Operation</th><th>Provider</th><th>Transaction</th><th>Amount</th><th>Risk</th><th>Approval</th><th>Due</th></tr></thead><tbody>${financialRows}</tbody></table></div></section>
    </div>`;
};

renderSecurityLevelsV7 = async function renderEnterpriseSecurityLevels() {
  const data = await api('/api/v7/security-levels');
  const dimensions = ['risk', 'enforcement', 'data', 'authority', 'confidentiality', 'severity'];
  const levelRows = dimensions.flatMap(dimension => data.levels.filter(item => item.dimension === dimension).map(item => `<tr><td>${escapeHtml(label(dimension))}</td><td>${levelChip(item.code)}</td><td><strong>${escapeHtml(item.label)}</strong></td><td>${escapeHtml(item.description)}</td><td>${escapeHtml(item.default_action || '—')}</td><td>${tag(item.status || 'active')}</td></tr>`)).join('');
  const rules = data.rules.map(rule => `<tr><td class="mono">${escapeHtml(rule.code)}</td><td><strong>${escapeHtml(rule.name)}</strong><br><small>${escapeHtml(rule.description)}</small></td><td class="mono">${escapeHtml(rule.event_type)}</td><td>${Number(rule.base_score)}</td><td>${Number(rule.threshold_count) > 1 ? `${Number(rule.threshold_count)} events / ${Number(rule.threshold_window_minutes)} min` : 'Single event'}</td><td>${levelChip(rule.risk_floor)} ${levelChip(rule.recommended_enforcement)} ${levelChip(rule.alert_severity)}</td><td>${tag(rule.enabled ? 'active' : 'disabled')}</td></tr>`).join('');

  $('#viewRoot').innerHTML = `
    ${enterpriseCommandBar('Security Control Taxonomy', 'Governed definitions for risk, enforcement, data sensitivity, authority, confidentiality and incident severity.')}
    <div class="enterprise-status-strip">
      ${enterpriseStatus('Risk', 'R0–R4', 'Likelihood and potential harm')}
      ${enterpriseStatus('Enforcement', 'A0–A5', 'Permitted protective action')}
      ${enterpriseStatus('Data', 'D0–D4', 'Sensitivity and handling')}
      ${enterpriseStatus('Authority', 'P0–P5', 'Staff decision powers')}
      ${enterpriseStatus('Confidentiality / severity', 'K0–K3 · SEV-1–4', 'Need-to-know and response urgency')}
    </div>
    <section class="enterprise-panel"><div class="enterprise-panel-header"><div><h2>Security level register</h2><p>Independent dimensions prevent a risk score from being confused with authority, secrecy or enforcement.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Dimension</th><th>Code</th><th>Name</th><th>Controlled meaning</th><th>Default relationship</th><th>State</th></tr></thead><tbody>${levelRows}</tbody></table></div></section>
    <section class="enterprise-panel"><div class="enterprise-panel-header"><div><h2>Detection rule register</h2><p>Versioned and explainable controls used by the Head Office risk engine.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Rule</th><th>Detection basis</th><th>Event contract</th><th>Score</th><th>Threshold</th><th>Minimum control</th><th>State</th></tr></thead><tbody>${rules}</tbody></table></div></section>`;
};
