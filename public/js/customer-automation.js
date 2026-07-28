function customerLookupField({ customerNumber = '', required = false, full = false, labelText = 'Customer', helpText = 'Search by name, email, universal customer number or Microsoft identity.' } = {}) {
  const selected = String(customerNumber || '').trim();
  return `<label class="field customer-lookup ${full ? 'full' : ''}" data-customer-lookup>
    <span>${escapeHtml(labelText)}${required ? ' *' : ''}</span>
    <div class="customer-lookup-control">
      <input type="search" data-customer-search value="${escapeHtml(selected)}" autocomplete="off" placeholder="Search customer…" aria-autocomplete="list" ${required ? 'required' : ''}>
      <input type="hidden" name="customerNumber" value="${escapeHtml(selected)}">
      <button type="button" class="customer-lookup-clear" data-customer-clear aria-label="Clear selected customer" ${selected ? '' : 'hidden'}>×</button>
    </div>
    <small>${escapeHtml(helpText)}</small>
    <div class="customer-lookup-results" data-customer-results role="listbox" hidden></div>
  </label>`;
}

function customerLookupResult(customer) {
  return `<button type="button" class="customer-lookup-result" role="option"
    data-customer-select
    data-customer-number="${escapeHtml(customer.customer_number)}"
    data-customer-label="${escapeHtml(`${customer.display_name} — ${customer.customer_number}`)}">
    <strong>${escapeHtml(customer.display_name)}</strong>
    <span>${escapeHtml(customer.verified_email)}</span>
    <small>${escapeHtml(customer.customer_number)} · ${escapeHtml(label(customer.account_status))} · ${escapeHtml(label(customer.security_status))}</small>
  </button>`;
}

const customerLookupTimers = new WeakMap();

async function searchCustomerLookup(input) {
  const field = input.closest('[data-customer-lookup]');
  const results = $('[data-customer-results]', field);
  const query = input.value.trim();
  const hidden = $('[name="customerNumber"]', field);
  if (query !== hidden.value && !/^\d{10}$/.test(query)) hidden.value = '';
  $('[data-customer-clear]', field).hidden = !query;
  if (query.length < 2) {
    results.hidden = true;
    results.innerHTML = '';
    return;
  }
  results.hidden = false;
  results.innerHTML = '<div class="customer-lookup-status">Searching the universal customer register…</div>';
  try {
    const data = await api(`/api/customers?q=${encodeURIComponent(query)}&limit=8`);
    results.innerHTML = data.customers.length
      ? data.customers.map(customerLookupResult).join('')
      : '<div class="customer-lookup-status">No matching customer. Check the External ID review queue instead of creating a duplicate.</div>';
  } catch (error) {
    results.innerHTML = `<div class="customer-lookup-status error">${escapeHtml(error.message)}</div>`;
  }
}

document.addEventListener('input', event => {
  const input = event.target.closest('[data-customer-search]');
  if (!input) return;
  clearTimeout(customerLookupTimers.get(input));
  customerLookupTimers.set(input, setTimeout(() => searchCustomerLookup(input), 220));
});

document.addEventListener('focusin', event => {
  const input = event.target.closest('[data-customer-search]');
  if (input && input.value.trim().length >= 2) searchCustomerLookup(input);
});

document.addEventListener('click', event => {
  const selection = event.target.closest('[data-customer-select]');
  if (selection) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const field = selection.closest('[data-customer-lookup]');
    $('[data-customer-search]', field).value = selection.dataset.customerLabel;
    $('[name="customerNumber"]', field).value = selection.dataset.customerNumber;
    $('[data-customer-results]', field).hidden = true;
    $('[data-customer-clear]', field).hidden = false;
    field.classList.add('customer-selected');
    return;
  }
  const clear = event.target.closest('[data-customer-clear]');
  if (clear) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const field = clear.closest('[data-customer-lookup]');
    $('[data-customer-search]', field).value = '';
    $('[name="customerNumber"]', field).value = '';
    $('[data-customer-results]', field).hidden = true;
    clear.hidden = true;
    field.classList.remove('customer-selected');
    $('[data-customer-search]', field).focus();
  }
}, true);

document.addEventListener('submit', event => {
  const requiredLookup = event.target.querySelector('[data-customer-lookup] [data-customer-search][required]');
  if (!requiredLookup) return;
  const field = requiredLookup.closest('[data-customer-lookup]');
  if ($('[name="customerNumber"]', field).value) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const errorElement = $('.form-error', event.target);
  if (errorElement) errorElement.textContent = 'Search for and select the customer from the universal register.';
  requiredLookup.focus();
}, true);

function newCustomerModal() {
  openModal('Customer records are created automatically', 'Head Office does not require routine manual customer entry.', `<div class="notice"><div><strong>Automated customer identity</strong><br>Customers are created or linked from Microsoft External ID and connected websites. Use the directory review queue only where the system cannot safely match an identity.</div></div><div class="form-actions"><button type="button" class="button secondary" data-close-modal>Close</button><button type="button" class="button primary" data-route="customer-directory">Open directory review</button></div>`, 'Universal Customer Register');
}

function newCaseModal(forcedType = '', customerNumber = '') {
  const caseTypes = ['general','security','complaint','refund','payment_dispute','account_recovery',...(hasPermission('data_protection:*') ? ['data_protection'] : []),...(hasPermission('safeguarding:*') ? ['safeguarding'] : [])];
  modalForm('Create Head Office case', 'Select the existing customer record. Identity, services and security history remain linked automatically.', { form: 'new-case', html: `<div class="form-grid"><label class="field"><span>Case type</span><select name="caseType" required>${caseTypes.map(value => `<option value="${value}" ${forcedType === value ? 'selected' : ''}>${label(value)}</option>`).join('')}</select></label><label class="field"><span>Priority</span><select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select></label>${customerLookupField({ customerNumber, labelText: 'Customer', helpText: 'Optional for a genuinely non-customer operational case.' })}<label class="field"><span>Originating service (optional)</span><select name="platformId">${options(state.reference.platforms, 'id', 'name', '', 'Head Office / none')}</select></label><label class="field full"><span>Case title</span><input name="title" maxlength="160" required></label><label class="field full"><span>Summary and reason</span><textarea name="description" maxlength="4000" required></textarea></label><label class="field"><span>Due date (optional)</span><input name="dueAt" type="datetime-local"></label></div>` }, 'Create case', 'Head Office workflow');
}

function newMarkerModal(customerNumber = '', caseReference = '') {
  modalForm('Apply security marker', 'Select the customer from the authoritative register and record the confidential security rationale.', { form: 'new-marker', html: `<div class="form-grid">${customerLookupField({ customerNumber, required: true, labelText: 'Customer' })}<label class="field"><span>Linked case reference</span><input name="caseReference" value="${escapeHtml(caseReference)}" maxlength="30" required></label><label class="field"><span>Marker type</span><select name="markerType" required>${options(state.reference.markerTypes, 'code', 'label')}</select></label><label class="field"><span>Risk level override</span><select name="riskLevel"><option value="">Use catalogue default</option>${['low','moderate','high','critical'].map(value => `<option value="${value}">${label(value)}</option>`).join('')}</select></label><label class="field"><span>Visibility override</span><select name="visibility"><option value="">Use catalogue default</option>${['head_office_only','branch_instruction','approved_branch_summary','system_enforced'].map(value => `<option value="${value}">${label(value)}</option>`).join('')}</select></label><label class="field"><span>Review date (optional)</span><input name="reviewAt" type="datetime-local"></label><label class="field full"><span>Confidential reason</span><textarea name="reason" maxlength="2000" required></textarea></label></div>` }, 'Apply marker', 'Security Control Centre');
}

function newRestrictionModal(customerNumber = '', caseReference = '') {
  modalForm('Apply customer restriction', 'Select the customer and issue a controlled, auditable enforcement instruction.', { form: 'new-restriction', html: `<div class="form-grid">${customerLookupField({ customerNumber, required: true, labelText: 'Customer' })}<label class="field"><span>Linked case reference</span><input name="caseReference" value="${escapeHtml(caseReference)}" maxlength="30"></label><label class="field"><span>Restriction type</span><select name="restrictionType" required>${options(state.reference.restrictionTypes, 'code', 'label')}</select></label><label class="field"><span>Scope</span><select name="scope"><option value="company_wide">Company wide</option>${state.reference.platforms.map(platform => `<option value="${escapeHtml(platform.id)}">${escapeHtml(platform.name)}</option>`).join('')}</select></label><label class="field"><span>Review date</span><input name="reviewAt" type="datetime-local"></label><label class="field"><span>Expiry date (optional)</span><input name="expiresAt" type="datetime-local"></label><label class="field full"><span>Confidential reason</span><textarea name="reason" maxlength="2000" required></textarea></label></div>` }, 'Apply restriction', 'Security Control Centre', 'danger');
}

function newCommunicationModal(customerNumber = '', caseReference = '') {
  modalForm('Log communication', 'Select the customer so the communication is attached to the complete company-wide history.', { form: 'new-communication', html: `<div class="form-grid">${customerLookupField({ customerNumber, labelText: 'Customer', helpText: 'Optional only for internal communications not involving a customer.' })}<label class="field"><span>Case reference (optional)</span><input name="caseReference" value="${escapeHtml(caseReference)}" maxlength="30"></label><label class="field"><span>Direction</span><select name="direction"><option value="inbound">Inbound</option><option value="outbound">Outbound</option><option value="internal">Internal</option></select></label><label class="field"><span>Channel</span><select name="channel"><option value="email">Email</option><option value="telephone">Telephone</option><option value="whatsapp">WhatsApp</option><option value="letter">Letter</option><option value="web_form">Web form</option><option value="system">System</option></select></label><label class="field full"><span>Subject (optional)</span><input name="subject" maxlength="200"></label><label class="field full"><span>Contact summary</span><textarea name="summary" maxlength="4000" required></textarea></label><label class="field"><span>Date and time</span><input name="occurredAt" type="datetime-local" value="${formatDateInput(new Date())}"></label></div>` }, 'Record communication', 'Customer communications');
}

function newPaymentModal() {
  modalForm('Record payment, refund or dispute', 'Search the customer record; payment and risk history will remain linked automatically.', { form: 'new-payment', html: `<div class="form-grid">${customerLookupField({ labelText: 'Customer', helpText: 'Search rather than copying customer details from another system.' })}<label class="field"><span>Linked case reference</span><input name="caseReference" maxlength="30"></label><label class="field"><span>Provider</span><input name="provider" value="Stripe" maxlength="80" required></label><label class="field"><span>Provider payment reference</span><input name="providerPaymentReference" maxlength="200" required></label><label class="field"><span>Provider customer reference</span><input name="providerCustomerReference" maxlength="200"></label><label class="field"><span>Service</span><select name="platformId">${options(state.reference.platforms, 'id', 'name', '', 'Head Office / none')}</select></label><label class="field"><span>Amount</span><input name="amount" type="number" min="0" step="0.01" required></label><label class="field"><span>Currency</span><input name="currency" value="GBP" maxlength="3" required></label><label class="field"><span>Status</span><select name="status"><option value="captured">Captured</option><option value="pending">Pending</option><option value="authorised">Authorised</option><option value="failed">Failed</option><option value="refund_requested">Refund requested</option><option value="refunded">Refunded</option><option value="disputed">Disputed</option><option value="cancelled">Cancelled</option></select></label><label class="field"><span>Date and time</span><input name="occurredAt" type="datetime-local" value="${formatDateInput(new Date())}"></label></div>` }, 'Record reference', 'Payments & approvals');
}
