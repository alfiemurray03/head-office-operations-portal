function customerRecordEmpty(title, copy) {
  return `<div class="customer-record-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
}

function customerRecordListItem({ title, copy = '', detail = '', meta = '', openType = '', openId = '' }) {
  return `<article class="customer-record-list-item"${openType ? ` data-open="${escapeHtml(openType)}" data-id="${escapeHtml(openId)}"` : ''}>
    <div><strong>${escapeHtml(title)}</strong>${copy ? `<span>${escapeHtml(copy)}</span>` : ''}${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>
    ${meta ? `<div class="customer-record-list-meta">${meta}</div>` : ''}
  </article>`;
}

function customerRecordServiceRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No connected services', 'No website or service account has been linked to this customer yet.');
  return rows.map(item => customerRecordListItem({
    title: item.name || item.code || 'Connected service',
    copy: item.external_account_id ? `Service account ${item.external_account_id}` : 'Connected customer account',
    detail: `Linked ${formatDate(item.linked_at)} · Last synchronised ${formatDate(item.last_synced_at, 'not yet synchronised')}`,
    meta: tag(item.status || 'active')
  })).join('');
}

function customerRecordContactRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No additional contact points', 'The verified email remains the primary customer contact.');
  return rows.map(item => customerRecordListItem({
    title: label(item.contact_type || 'contact'),
    copy: item.contact_value || 'No value recorded',
    detail: item.verified_at ? `Verified ${formatDate(item.verified_at)}` : label(item.verification_status || 'unverified'),
    meta: item.is_primary ? '<span class="tag active">Primary</span>' : ''
  })).join('');
}

function customerRecordCaseRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No linked cases', 'No Head Office case or investigation is linked to this customer.');
  return rows.map(item => customerRecordListItem({
    title: item.title || item.case_reference,
    copy: `${item.case_reference} · ${label(item.case_type)} · ${label(item.priority)} priority`,
    detail: `Opened ${formatDate(item.created_at)}${item.due_at ? ` · Due ${formatDate(item.due_at)}` : ''}`,
    meta: tag(item.status),
    openType: 'case',
    openId: item.id
  })).join('');
}

function customerRecordSecurityRows(rows = [], type = 'marker') {
  if (!rows.length) {
    return customerRecordEmpty(
      type === 'marker' ? 'No active security markers' : 'No active restrictions',
      type === 'marker' ? 'No security intelligence is currently recorded for this customer.' : 'No service or company-wide restriction is currently recorded.'
    );
  }
  return rows.map(item => {
    const title = type === 'marker'
      ? (item.marker_label || label(item.marker_type))
      : (item.restriction_label || label(item.restriction_type));
    const copy = type === 'marker'
      ? (item.reason || 'Confidential security rationale recorded.')
      : `${label(item.scope || 'company_wide')} · ${label(item.enforcement_action || item.restriction_type)}`;
    const detail = type === 'marker'
      ? `Recorded ${formatDate(item.created_at)}${item.review_at ? ` · Review ${formatDate(item.review_at)}` : ''}`
      : `Applied ${formatDate(item.applied_at)}${item.review_at ? ` · Review ${formatDate(item.review_at)}` : ''}`;
    return customerRecordListItem({
      title,
      copy,
      detail,
      meta: `${type === 'marker' && item.risk_level ? tag(item.risk_level) : ''}${tag(item.status || 'active')}`
    });
  }).join('');
}

function customerRecordCommunicationRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No communications recorded', 'Customer contact will appear here automatically or when staff log a contact.');
  return rows.slice(0, 12).map(item => customerRecordListItem({
    title: item.subject || `${label(item.direction)} ${label(item.channel)}`,
    copy: item.summary || 'Communication recorded.',
    detail: `${label(item.direction)} · ${label(item.channel)} · ${formatDate(item.occurred_at)}`
  })).join('');
}

function customerRecordPaymentRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No payment records', 'Payments, refunds and disputes linked to this customer will appear here.');
  return rows.slice(0, 12).map(item => customerRecordListItem({
    title: `${formatMoney(item.amount_minor, item.currency || 'GBP')} · ${label(item.status)}`,
    copy: item.provider_payment_reference || item.provider_customer_reference || item.provider || 'Payment reference',
    detail: `${item.provider || 'Provider'} · ${formatDate(item.occurred_at)}`,
    meta: tag(item.status)
  })).join('');
}

function customerRecordEditor(customer) {
  if (!hasPermission('customers:write')) return '';
  const securityField = hasPermission('security:write') ? `<label class="field"><span>Security status</span><select name="securityStatus">${['clear','monitor','review','high','critical'].map(value => `<option value="${value}" ${customer.security_status === value ? 'selected' : ''}>${label(value)}</option>`).join('')}</select></label>` : '';
  return `<section class="customer-record-panel customer-record-editor">
    <header><div><h2>Customer record details</h2><p>Authoritative identity and account position used across connected services.</p></div></header>
    <div class="customer-record-panel-body">
      <form data-form="update-customer" data-id="${escapeHtml(customer.id)}" class="form-grid">
        <label class="field"><span>Customer name</span><input name="displayName" value="${escapeHtml(customer.display_name)}" required></label>
        <label class="field"><span>Verified email</span><input name="verifiedEmail" type="email" value="${escapeHtml(customer.verified_email)}" required></label>
        <label class="field"><span>Account status</span><select name="accountStatus">${['pending','active','restricted','suspended','closed','archived'].map(value => `<option value="${value}" ${customer.account_status === value ? 'selected' : ''}>${label(value)}</option>`).join('')}</select></label>
        ${securityField}
        <p class="form-error full"></p>
        <div class="form-actions"><button class="button primary">Save customer record</button></div>
      </form>
    </div>
  </section>`;
}

window.renderCustomerRecordWorkspace = async function renderCustomerRecordWorkspace(id) {
  const data = await api(`/api/customers/${encodeURIComponent(id)}`);
  const customer = data.customer;
  const contacts = data.contacts || [];
  const services = data.platformAccounts || [];
  const cases = data.cases || [];
  const markers = data.markers || [];
  const restrictions = data.restrictions || [];
  const communications = data.communications || [];
  const payments = data.payments || [];
  const openCases = cases.filter(item => !['resolved','closed','cancelled'].includes(String(item.status || '').toLowerCase())).length;
  const activeRestrictions = restrictions.filter(item => !['lifted','expired','cancelled'].includes(String(item.status || '').toLowerCase())).length;

  $('#currentRouteLabel').textContent = 'Customer record';
  document.title = `${customer.display_name} · Head Office Customer Record`;

  const actions = [
    hasPermission('cases:create') ? `<button class="button primary" data-customer-record-action="case" data-customer="${escapeHtml(customer.customer_number)}">Open case</button>` : '',
    hasPermission('communications:write') ? `<button class="button secondary" data-customer-record-action="communication" data-customer="${escapeHtml(customer.customer_number)}">Log contact</button>` : '',
    hasPermission('security:write') ? `<button class="button secondary" data-customer-record-action="marker" data-customer="${escapeHtml(customer.customer_number)}">Add marker</button>` : '',
    hasPermission('security:write') ? `<button class="button danger" data-customer-record-action="restriction" data-customer="${escapeHtml(customer.customer_number)}">Apply restriction</button>` : ''
  ].filter(Boolean).join('');

  $('#viewRoot').innerHTML = `<div class="customer-record-page">
    <button class="customer-record-back" type="button" data-route="customers">← Back to customer register</button>

    <header class="customer-record-header">
      <div class="customer-record-header-main">
        <p class="eyebrow">Universal Customer Register</p>
        <h1>${escapeHtml(customer.display_name)}</h1>
        <div class="customer-record-identity">
          <span class="customer-record-ucn">${escapeHtml(customer.customer_number)}</span>
          <span>${escapeHtml(customer.verified_email)}</span>
          ${tag(customer.account_status)}
          ${tag(customer.security_status)}
        </div>
      </div>
      <div class="customer-record-actions">${actions}</div>
    </header>

    <section class="customer-record-status-grid" aria-label="Customer record summary">
      <article class="customer-record-status"><span>Connected services</span><strong>${services.length}</strong><small>Linked website and service accounts</small></article>
      <article class="customer-record-status"><span>Open cases</span><strong>${openCases}</strong><small>${cases.length} case${cases.length === 1 ? '' : 's'} in total</small></article>
      <article class="customer-record-status"><span>Active restrictions</span><strong>${activeRestrictions}</strong><small>${markers.length} security marker${markers.length === 1 ? '' : 's'}</small></article>
      <article class="customer-record-status"><span>Last activity</span><strong>${formatDate(customer.last_activity_at, 'No activity')}</strong><small>First registered ${formatDate(customer.first_registered_at)}</small></article>
    </section>

    <div class="customer-record-layout">
      <aside class="customer-record-column">
        <section class="customer-record-panel">
          <header><div><h2>Customer identity</h2><p>Permanent Head Office identity references.</p></div></header>
          <div class="customer-record-panel-body">
            <dl class="customer-record-facts">
              <div class="customer-record-fact"><dt>Universal Customer Number</dt><dd class="customer-record-ucn">${escapeHtml(customer.customer_number)}</dd></div>
              <div class="customer-record-fact"><dt>Verified email</dt><dd>${escapeHtml(customer.verified_email)}</dd></div>
              <div class="customer-record-fact"><dt>Account status</dt><dd>${tag(customer.account_status)}</dd></div>
              <div class="customer-record-fact"><dt>Security status</dt><dd>${tag(customer.security_status)}</dd></div>
              <div class="customer-record-fact"><dt>First registered</dt><dd>${formatDate(customer.first_registered_at)}</dd></div>
              <div class="customer-record-fact"><dt>Record last updated</dt><dd>${formatDate(customer.updated_at)}</dd></div>
            </dl>
          </div>
        </section>

        <section class="customer-record-panel">
          <header><div><h2>Connected services</h2><p>Accounts linked to this same UCN.</p></div></header>
          <div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordServiceRows(services)}</div></div>
        </section>

        <section class="customer-record-panel">
          <header><div><h2>Contact points</h2><p>Verified and operational contact records.</p></div></header>
          <div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordContactRows(contacts)}</div></div>
        </section>
      </aside>

      <main class="customer-record-main">
        ${customerRecordEditor(customer)}

        <section class="customer-record-panel">
          <header><div><h2>Cases and investigations</h2><p>Head Office workflows linked to this customer.</p></div><span class="tag">${cases.length} total</span></header>
          <div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordCaseRows(cases)}</div></div>
        </section>

        ${hasPermission('security:read') ? `<div class="customer-record-security-grid">
          <section class="customer-record-panel">
            <header><div><h2>Security markers</h2><p>Confidential risk and verification information.</p></div></header>
            <div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordSecurityRows(markers, 'marker')}</div></div>
          </section>
          <section class="customer-record-panel">
            <header><div><h2>Restrictions</h2><p>Current protective and service instructions.</p></div></header>
            <div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordSecurityRows(restrictions, 'restriction')}</div></div>
          </section>
        </div>` : ''}

        <div class="customer-record-history-grid">
          ${hasPermission('communications:read') ? `<section class="customer-record-panel">
            <header><div><h2>Communications</h2><p>Latest customer contact and internal records.</p></div><span class="tag">${communications.length}</span></header>
            <div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordCommunicationRows(communications)}</div></div>
          </section>` : ''}
          ${hasPermission('payments:read') ? `<section class="customer-record-panel">
            <header><div><h2>Payments and refunds</h2><p>Linked provider references and outcomes.</p></div><span class="tag">${payments.length}</span></header>
            <div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordPaymentRows(payments)}</div></div>
          </section>` : ''}
        </div>
      </main>
    </div>
  </div>`;

  window.scrollTo({ top: 0, behavior: 'instant' });
};

document.addEventListener('click', event => {
  const button = event.target.closest('[data-customer-record-action]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const customerNumber = button.dataset.customer || '';
  const action = button.dataset.customerRecordAction;
  if (action === 'case') return newCaseModal('', customerNumber);
  if (action === 'communication') return newCommunicationModal(customerNumber, '');
  if (action === 'marker') return newMarkerModal(customerNumber, '');
  if (action === 'restriction') return newRestrictionModal(customerNumber, '');
}, true);
