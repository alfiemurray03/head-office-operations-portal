/* Workspace-specific operating views.
   Keeps general customer work separate from complaints, refunds and disputes. */

function workspaceTaskRows(rows, limit = 250) {
  const selected = rows.slice(0, limit);
  return selected.length ? selected.map(item => `<tr>
    <td class="mono">${escapeHtml(item.task_reference)}</td>
    <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(label(item.service_area))} · ${escapeHtml(label(item.task_type))}</small></td>
    <td>${escapeHtml(item.customer_name || item.customer_number || "Not linked")}</td>
    <td>${tag(item.priority)}</td>
    <td>${tag(item.status)}</td>
    <td>${escapeHtml(item.assigned_staff_name || "Unassigned")}</td>
    <td class="${item.due_at && new Date(item.due_at) < new Date() ? "overdue-text" : ""}">${formatDate(item.due_at)}</td>
    <td>${hasPermission("operations:write") ? `<button class="button secondary small" data-action="update-v7-task" data-id="${escapeHtml(item.id)}" data-reference="${escapeHtml(item.task_reference)}" data-status="${escapeHtml(item.status)}">Update task</button>` : ""}</td>
  </tr>`).join("") : `<tr><td colspan="8">${emptyState("No outstanding customer operations work", "The central customer queue contains no open task at present.")}</td></tr>`;
}

function workspaceComplaintRows(rows) {
  return rows.length ? rows.map(item => `<tr data-open="case" data-id="${escapeHtml(item.id)}">
    <td class="mono">${escapeHtml(item.case_reference)}</td>
    <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.customer_name || item.customer_number || "No linked customer")}</small></td>
    <td>${escapeHtml(label(item.complaint_stage || "received"))}</td>
    <td>${tag(item.priority)}</td>
    <td>${tag(item.status)}</td>
    <td>${formatDate(item.acknowledgement_due_at)}</td>
    <td class="${item.final_response_due_at && new Date(item.final_response_due_at) < new Date() ? "overdue-text" : ""}">${formatDate(item.final_response_due_at || item.due_at)}</td>
  </tr>`).join("") : `<tr><td colspan="7">${emptyState("No active complaints", "No complaint is currently open in the central redress queue.")}</td></tr>`;
}

function workspaceFinancialRows(rows) {
  return rows.length ? rows.map(item => `<tr data-open="case" data-id="${escapeHtml(item.id)}">
    <td class="mono">${escapeHtml(item.case_reference)}</td>
    <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.customer_name || item.customer_number || "No linked customer")}</small></td>
    <td>${escapeHtml(label(item.operation_type || item.case_type))}</td>
    <td>${escapeHtml(item.provider || "Not recorded")}</td>
    <td class="mono">${escapeHtml(item.transaction_reference || "—")}</td>
    <td>${item.amount_minor == null ? "—" : formatMoney(item.amount_minor, item.currency || "GBP")}</td>
    <td>${item.fraud_suspected ? levelChip("R3") : levelChip("R0")}</td>
    <td>${tag(item.approval_status || item.status)}</td>
    <td class="${item.due_at && new Date(item.due_at) < new Date() ? "overdue-text" : ""}">${formatDate(item.due_at)}</td>
  </tr>`).join("") : `<tr><td colspan="9">${emptyState("No active refunds or disputes", "No financial redress case is currently open.")}</td></tr>`;
}

function workloadCell(labelText, value, detail, tone = "neutral") {
  return `<div class="workload-cell" data-tone="${escapeHtml(tone)}"><span>${escapeHtml(labelText)}</span><strong>${Number(value || 0).toLocaleString("en-GB")}</strong><small>${escapeHtml(detail)}</small></div>`;
}

window.renderCustomerOperationsWorkspace = async function renderCustomerOperationsWorkspace() {
  const data = await api("/api/v7/operations");
  const tasks = data.tasks || [];
  const overdue = tasks.filter(item => item.due_at && new Date(item.due_at) < new Date()).length;
  const critical = tasks.filter(item => item.priority === "critical").length;
  const unassigned = tasks.filter(item => !item.assigned_staff_id).length;
  const awaitingCustomer = tasks.filter(item => item.status === "awaiting_customer").length;
  const awaitingInternal = tasks.filter(item => item.status === "awaiting_internal").length;
  const approval = tasks.filter(item => item.status === "approval_required").length;
  const serviceAreas = new Map();
  for (const item of tasks) serviceAreas.set(item.service_area || "general", (serviceAreas.get(item.service_area || "general") || 0) + 1);
  const serviceAreaRows = [...serviceAreas.entries()].sort((a, b) => b[1] - a[1]);

  $("#viewRoot").innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">Customer Operations Centre</p><h1>Central customer operations</h1><p>One queue for general customer actions, cross-service ownership, communications and operational deadlines. Complaints, refunds and disputes are handled in their own controlled workspace.</p></div><div class="heading-actions">${hasPermission("cases:create") ? '<button class="button secondary" data-action="new-case">Open case</button>' : ""}${hasPermission("operations:write") ? '<button class="button primary" data-action="new-v7-task">Create Head Office task</button>' : ""}</div></div>

    <div class="workload-strip">
      ${workloadCell("Open work", tasks.length, "All current customer operations tasks", tasks.length ? "neutral" : "success")}
      ${workloadCell("Critical", critical, "Immediate operational attention", critical ? "critical" : "success")}
      ${workloadCell("Overdue", overdue, "Due date has passed", overdue ? "critical" : "success")}
      ${workloadCell("Unassigned", unassigned, "Named owner required", unassigned ? "warning" : "success")}
      ${workloadCell("Awaiting customer", awaitingCustomer, "Customer response required", "neutral")}
      ${workloadCell("Awaiting internal", awaitingInternal, "Another team or service must act", "neutral")}
    </div>

    <section class="enterprise-panel workspace-primary-register">
      <div class="enterprise-panel-header"><div><h2>Customer operations work queue</h2><p>Priority, ownership, customer linkage and deadline status without complaint or financial registers mixed into the same screen.</p></div><div class="enterprise-panel-tools"><button class="button secondary small" data-route="customers">Customer register</button><button class="button secondary small" data-route="communications">Communications</button></div></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Task</th><th>Required action</th><th>Customer</th><th>Priority</th><th>State</th><th>Owner</th><th>Due</th><th>Control</th></tr></thead><tbody>${workspaceTaskRows(tasks)}</tbody></table></div>
    </section>

    <div class="workspace-lower-grid">
      <section class="enterprise-panel">
        <div class="enterprise-panel-header"><div><h2>Demand by service area</h2><p>Where current customer operations work is entering Head Office.</p></div></div>
        <div class="workspace-register-list">${serviceAreaRows.length ? serviceAreaRows.map(([area, count]) => `<div><span>${escapeHtml(label(area))}</span><strong>${Number(count).toLocaleString("en-GB")}</strong></div>`).join("") : emptyState("No service demand", "No active operational tasks are recorded.")}</div>
      </section>
      <section class="enterprise-panel">
        <div class="enterprise-panel-header"><div><h2>Decision hand-offs</h2><p>Work that belongs in a specialist controlled workspace.</p></div></div>
        <div class="workspace-action-list">
          <button data-route="redress-centre"><span>Complaints, refunds & disputes</span><strong>${Number((data.complaints || []).length + (data.financial || []).length)}</strong><small>Formal redress and financial decisions</small></button>
          <button data-route="customer-protection"><span>Customer protection</span><strong>${critical}</strong><small>Fraud, security and protective controls</small></button>
          <button data-route="incidents-v7"><span>Incident command</span><strong>${approval}</strong><small>Escalated response and breach decisions</small></button>
        </div>
      </section>
    </div>`;
};

window.renderRedressWorkspace = async function renderRedressWorkspace() {
  const data = await api("/api/v7/operations");
  const complaints = data.complaints || [];
  const financial = data.financial || [];
  const complaintOverdue = complaints.filter(item => (item.final_response_due_at || item.due_at) && new Date(item.final_response_due_at || item.due_at) < new Date()).length;
  const acknowledgementDue = complaints.filter(item => item.acknowledgement_due_at && new Date(item.acknowledgement_due_at) < new Date()).length;
  const approvalRequired = financial.filter(item => ["approval_required", "pending"].includes(item.approval_status || item.status)).length;
  const fraudFlagged = financial.filter(item => item.fraud_suspected).length;

  $("#viewRoot").innerHTML = `
    <div class="page-heading"><div><p class="eyebrow">Complaints, Refunds & Disputes Centre</p><h1>Customer redress and financial decisions</h1><p>Formal complaint handling, acknowledgement and final-response control, refund decisions, payment disputes, chargebacks and linked fraud indicators.</p></div><div class="heading-actions">${hasPermission("cases:create") ? '<button class="button secondary" data-action="new-case" data-case-type="complaint">New complaint</button><button class="button secondary" data-action="new-case" data-case-type="refund">New refund</button><button class="button primary" data-action="new-case" data-case-type="payment_dispute">New dispute</button>' : ""}</div></div>

    <div class="workload-strip redress-workload">
      ${workloadCell("Open complaints", complaints.length, "All active complaint records", complaints.length ? "neutral" : "success")}
      ${workloadCell("Acknowledgement overdue", acknowledgementDue, "Initial response deadline passed", acknowledgementDue ? "critical" : "success")}
      ${workloadCell("Final response overdue", complaintOverdue, "Complaint outcome deadline passed", complaintOverdue ? "critical" : "success")}
      ${workloadCell("Financial cases", financial.length, "Refund, dispute and chargeback work", financial.length ? "neutral" : "success")}
      ${workloadCell("Approval required", approvalRequired, "Authorised financial decision needed", approvalRequired ? "warning" : "success")}
      ${workloadCell("Fraud flagged", fraudFlagged, "Financial cases linked to suspected fraud", fraudFlagged ? "critical" : "success")}
    </div>

    <section class="enterprise-panel workspace-primary-register">
      <div class="enterprise-panel-header"><div><h2>Complaint and redress register</h2><p>Receipt, acknowledgement, investigation, remedy and final-response deadlines.</p></div><button class="button secondary small" data-route="complaints">Open complaint case register</button></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Case</th><th>Complaint</th><th>Stage</th><th>Priority</th><th>State</th><th>Acknowledge by</th><th>Final response by</th></tr></thead><tbody>${workspaceComplaintRows(complaints)}</tbody></table></div>
    </section>

    <section class="enterprise-panel workspace-primary-register">
      <div class="enterprise-panel-header"><div><h2>Refund, dispute and chargeback register</h2><p>Transaction evidence, customer impact, fraud indicators and approval position.</p></div><button class="button secondary small" data-route="payments">Open payment controls</button></div>
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Case</th><th>Customer issue</th><th>Operation</th><th>Provider</th><th>Transaction</th><th>Amount</th><th>Risk</th><th>Approval</th><th>Due</th></tr></thead><tbody>${workspaceFinancialRows(financial)}</tbody></table></div>
    </section>`;
};
