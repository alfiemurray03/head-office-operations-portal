function customerRecordEmpty(title, copy) {
  return `<div class="customer-record-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
}

function customerRecordListItem({ title, copy = '', detail = '', meta = '', actions = '', openType = '', openId = '' }) {
  return `<article class="customer-record-list-item"${openType ? ` data-open="${escapeHtml(openType)}" data-id="${escapeHtml(openId)}"` : ''}>
    <div><strong>${escapeHtml(title)}</strong>${copy ? `<span>${escapeHtml(copy)}</span>` : ''}${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>
    ${(meta || actions) ? `<div class="customer-record-list-meta">${meta}${actions}</div>` : ''}
  </article>`;
}

function customerRecordServiceRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No connected services', 'No website or service account has been linked to this customer yet.');
  return rows.map(item => customerRecordListItem({
    title: item.name || item.code || 'Connected service',
    copy: [item.plan_code ? `Plan ${item.plan_code}` : '', item.subscription_status ? label(item.subscription_status) : '', item.external_account_id ? `Account ${item.external_account_id}` : ''].filter(Boolean).join(' · '),
    detail: `Last activity ${formatDate(item.last_activity_at || item.last_synced_at, 'not yet reported')} · ${item.hosting_provider || 'Hosting not reported'}${item.release_version ? ` · ${item.release_version}` : ''}`,
    meta: `${tag(item.snapshot_account_status || item.status || 'active')}${tag(item.platform_health || 'awaiting_connection')}`
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

function customerRecordMarkerRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No security markers', 'No confidential risk or verification marker is recorded.');
  return rows.map(item => customerRecordListItem({
    title: item.marker_label || label(item.marker_type),
    copy: item.reason || 'Confidential security rationale recorded.',
    detail: `Recorded ${formatDate(item.created_at)}${item.review_at ? ` · Review ${formatDate(item.review_at)}` : ''}`,
    meta: `${tag(item.risk_level)}${tag(item.status || 'active')}`
  })).join('');
}

function customerRecordRestrictionRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No restrictions', 'The customer is not currently subject to a service or company-wide restriction.');
  return rows.map(item => {
    const active = String(item.status || '').toLowerCase() === 'active';
    const actions = active && hasPermission('security:write')
      ? `<button class="button secondary small" data-action="restriction-lift" data-id="${escapeHtml(item.id)}">Lift restriction</button>` : '';
    return customerRecordListItem({
      title: item.restriction_label || label(item.restriction_type),
      copy: `${label(item.scope || 'company_wide')} · ${label(item.enforcement_action || item.restriction_type)}`,
      detail: `${item.reason || 'Protective control applied.'} · Applied ${formatDate(item.applied_at)}${item.review_at ? ` · Review ${formatDate(item.review_at)}` : ''}`,
      meta: tag(item.status || 'active'),
      actions
    });
  }).join('');
}

function customerRecordCommunicationRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No communications recorded', 'Customer contact will appear here automatically or when staff log a contact.');
  return rows.slice(0, 30).map(item => customerRecordListItem({
    title: item.subject || `${label(item.direction)} ${label(item.channel)}`,
    copy: item.summary || 'Communication recorded.',
    detail: `${label(item.direction)} · ${label(item.channel)} · ${formatDate(item.occurred_at)}`
  })).join('');
}

function customerRecordPaymentRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No payment records', 'Stripe payments, refunds and disputes linked to this UCN will appear here.');
  return rows.slice(0, 30).map(item => customerRecordListItem({
    title: `${formatMoney(item.amount_minor, item.currency || 'GBP')} · ${label(item.status)}`,
    copy: item.provider_payment_reference || item.provider_customer_reference || item.provider || 'Payment reference',
    detail: `${item.provider || 'Provider'} · ${formatDate(item.occurred_at)}`,
    meta: tag(item.status)
  })).join('');
}

function customerRecordSubscriptionRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No subscriptions', 'Website subscription and entitlement records will appear here automatically.');
  return rows.map(item => customerRecordListItem({
    title: item.plan_name || item.plan_code || 'Subscription',
    copy: `${item.provider || 'Provider'} · ${item.provider_subscription_reference}`,
    detail: `${item.amount_minor == null ? 'Amount not reported' : formatMoney(item.amount_minor, item.currency || 'GBP')}${item.current_period_end ? ` · Current period ends ${formatDate(item.current_period_end)}` : ''}${item.cancel_at_period_end ? ' · Cancels at period end' : ''}`,
    meta: `${tag(item.status)}${item.platform_name ? `<span class="tag information">${escapeHtml(item.platform_name)}</span>` : ''}`
  })).join('');
}

function customerRecordOrderRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No orders', 'Subscription checkouts and future service orders will appear here automatically.');
  return rows.map(item => customerRecordListItem({
    title: `${label(item.order_type)} · ${item.provider_order_reference}`,
    copy: item.amount_minor == null ? (item.provider || 'Order') : `${formatMoney(item.amount_minor, item.currency || 'GBP')} · ${item.provider || item.platform_name || 'Order'}`,
    detail: `Created ${formatDate(item.created_at)}${item.completed_at ? ` · Completed ${formatDate(item.completed_at)}` : ''}`,
    meta: tag(item.status)
  })).join('');
}

function customerRecordSessionRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No sessions reported', 'Connected websites have not reported an active or historical customer session.');
  return rows.slice(0, 50).map(item => customerRecordListItem({
    title: `${item.platform_name || item.platform_code || 'Website'} session`,
    copy: item.device_summary || item.external_session_id,
    detail: `Started ${formatDate(item.started_at)} · Last seen ${formatDate(item.last_seen_at)}${item.ip_country ? ` · ${item.ip_country}` : ''}${item.revocation_reason ? ` · ${item.revocation_reason}` : ''}`,
    meta: tag(item.status)
  })).join('');
}

function customerRecordFraudRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No fraud signals', 'No website, identity or payment fraud signal is open for this customer.');
  return rows.map(item => customerRecordListItem({
    title: label(item.signal_type),
    copy: item.reason || 'Automated risk signal.',
    detail: `${item.platform_name || 'Head Office'} · Risk score ${Number(item.risk_score || 0)}/100 · ${formatDate(item.created_at)}`,
    meta: `${tag(item.severity)}${tag(item.status)}`
  })).join('');
}

function customerRecordSecurityEventRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No security events', 'Authentication, session and website security events will appear here.');
  return rows.slice(0, 50).map(item => customerRecordListItem({
    title: label(item.event_type),
    copy: `${item.platform_name || item.platform_code || 'Connected website'}${item.outcome ? ` · ${label(item.outcome)}` : ''}`,
    detail: `${formatDate(item.occurred_at)}${item.device_summary ? ` · ${item.device_summary}` : ''}${item.ip_country ? ` · ${item.ip_country}` : ''}`,
    meta: tag(item.severity)
  })).join('');
}

function customerRecordAccessRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No access decisions', 'The first website sign-in or session check will create an access decision.');
  return rows.slice(0, 30).map(item => customerRecordListItem({
    title: `${item.platform_name || item.platform_code} · ${label(item.decision)}`,
    copy: item.reason,
    detail: `${formatDate(item.created_at)}${item.revoke_sessions ? ' · Session revocation required' : ''}`,
    meta: tag(item.decision)
  })).join('');
}

function customerRecordTimelineRows(rows = []) {
  if (!rows.length) return customerRecordEmpty('No timeline activity', 'Automatic website, payment, security and customer-relations activity will appear here.');
  return rows.slice(0, 100).map(item => customerRecordListItem({
    title: item.title || label(item.event_type),
    copy: item.summary || `${label(item.event_category)} activity`,
    detail: `${item.platform_name || 'Head Office'} · ${formatDate(item.occurred_at)}`,
    meta: `<span class="tag information">${escapeHtml(label(item.event_category))}</span>`
  })).join('');
}

function customerRecordEditor(customer) {
  if (!hasPermission('customers:write')) return '';
  const securityField = hasPermission('security:write') ? `<label class="field"><span>Security status</span><select name="securityStatus">${['clear','monitor','review','high','critical'].map(value => `<option value="${value}" ${customer.security_status === value ? 'selected' : ''}>${label(value)}</option>`).join('')}</select></label>` : '';
  return `<section class="customer-record-panel customer-record-editor"><header><div><h2>Authoritative customer details</h2><p>Only Head Office can change the central account and security position.</p></div></header><div class="customer-record-panel-body">
    <form data-form="update-customer" data-id="${escapeHtml(customer.id)}" class="form-grid">
      <label class="field"><span>Customer name</span><input name="displayName" value="${escapeHtml(customer.display_name)}" required></label>
      <label class="field"><span>Verified email</span><input name="verifiedEmail" type="email" value="${escapeHtml(customer.verified_email)}" required></label>
      <label class="field"><span>Account status</span><select name="accountStatus">${['pending','active','restricted','suspended','closed','archived'].map(value => `<option value="${value}" ${customer.account_status === value ? 'selected' : ''}>${label(value)}</option>`).join('')}</select></label>
      ${securityField}<p class="form-error full"></p><div class="form-actions full"><button class="button primary">Save Head Office record</button></div>
    </form></div></section>`;
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
  const subscriptions = data.subscriptions || [];
  const orders = data.orders || [];
  const sessions = data.sessions || [];
  const securityEvents = data.securityEvents || [];
  const fraudSignals = data.fraudSignals || [];
  const accessDecisions = data.accessDecisions || [];
  const timeline = data.timeline || [];
  const openCases = cases.filter(item => !['resolved','closed','cancelled'].includes(String(item.status || '').toLowerCase())).length;
  const activeRestrictions = restrictions.filter(item => String(item.status || '').toLowerCase() === 'active').length;
  const activeSubscriptions = subscriptions.filter(item => ['active','trialing','past_due'].includes(String(item.status || '').toLowerCase())).length;
  const activeSessions = sessions.filter(item => String(item.status || '').toLowerCase() === 'active').length;
  const openFraud = fraudSignals.filter(item => ['open','under_review','confirmed'].includes(String(item.status || '').toLowerCase())).length;

  $('#currentRouteLabel').textContent = 'Universal customer record';
  document.title = `${customer.display_name} · Central Customer Record`;
  const actions = [
    hasPermission('cases:create') ? `<button class="button primary" data-customer-record-action="case" data-customer="${escapeHtml(customer.customer_number)}">Open case</button>` : '',
    hasPermission('communications:write') ? `<button class="button secondary" data-customer-record-action="communication" data-customer="${escapeHtml(customer.customer_number)}">Log contact</button>` : '',
    hasPermission('security:write') ? `<button class="button secondary" data-customer-record-action="marker" data-customer="${escapeHtml(customer.customer_number)}">Add marker</button>` : '',
    hasPermission('security:write') ? `<button class="button danger" data-customer-record-action="restriction" data-customer="${escapeHtml(customer.customer_number)}">Apply restriction</button>` : ''
  ].filter(Boolean).join('');

  $('#viewRoot').innerHTML = `<div class="customer-record-page">
    <button class="customer-record-back" type="button" data-route="customers">← Back to Universal Customer Register</button>
    <header class="customer-record-header"><div class="customer-record-header-main"><p class="eyebrow">Central customer relationship, security &amp; operations record</p><h1>${escapeHtml(customer.display_name)}</h1><div class="customer-record-identity"><span class="customer-record-ucn">${escapeHtml(customer.customer_number)}</span><span>${escapeHtml(customer.verified_email)}</span>${tag(customer.account_status)}${tag(customer.security_status)}</div></div><div class="customer-record-actions">${actions}</div></header>
    <section class="customer-record-status-grid" aria-label="Customer record summary">
      <article class="customer-record-status"><span>Connected services</span><strong>${services.length}</strong><small>Website accounts sharing this UCN</small></article>
      <article class="customer-record-status"><span>Active subscriptions</span><strong>${activeSubscriptions}</strong><small>${orders.length} order records</small></article>
      <article class="customer-record-status"><span>Open cases</span><strong>${openCases}</strong><small>${cases.length} cases in total</small></article>
      <article class="customer-record-status"><span>Active restrictions</span><strong>${activeRestrictions}</strong><small>${markers.length} security markers</small></article>
      <article class="customer-record-status"><span>Live sessions</span><strong>${activeSessions}</strong><small>${sessions.length} session records</small></article>
      <article class="customer-record-status"><span>Fraud signals</span><strong>${openFraud}</strong><small>${securityEvents.length} security events</small></article>
    </section>
    <div class="customer-record-layout">
      <aside class="customer-record-column">
        <section class="customer-record-panel"><header><div><h2>Universal identity</h2><p>Permanent company-wide customer references.</p></div></header><div class="customer-record-panel-body"><dl class="customer-record-facts">
          <div class="customer-record-fact"><dt>Universal Customer Number</dt><dd class="customer-record-ucn">${escapeHtml(customer.customer_number)}</dd></div>
          <div class="customer-record-fact"><dt>Verified email</dt><dd>${escapeHtml(customer.verified_email)}</dd></div>
          <div class="customer-record-fact"><dt>Account status</dt><dd>${tag(customer.account_status)}</dd></div>
          <div class="customer-record-fact"><dt>Security status</dt><dd>${tag(customer.security_status)}</dd></div>
          <div class="customer-record-fact"><dt>First registered</dt><dd>${formatDate(customer.first_registered_at)}</dd></div>
          <div class="customer-record-fact"><dt>Last activity</dt><dd>${formatDate(customer.last_activity_at,'No activity')}</dd></div>
        </dl></div></section>
        <section class="customer-record-panel"><header><div><h2>Connected services</h2><p>All accounts linked to this UCN.</p></div></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordServiceRows(services)}</div></div></section>
        <section class="customer-record-panel"><header><div><h2>Contact points</h2><p>Verified and operational contact records.</p></div></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordContactRows(contacts)}</div></div></section>
      </aside>
      <main class="customer-record-main">
        ${customerRecordEditor(customer)}
        <section class="customer-record-panel"><header><div><h2>Cases, complaints &amp; investigations</h2><p>Formal Head Office customer-relations and security workflows.</p></div><span class="tag information">${cases.length} total</span></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordCaseRows(cases)}</div></div></section>
        ${hasPermission('security:read') ? `<div class="customer-record-security-grid">
          <section class="customer-record-panel"><header><div><h2>Security markers</h2><p>Confidential risk and verification information.</p></div></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordMarkerRows(markers)}</div></div></section>
          <section class="customer-record-panel"><header><div><h2>Restrictions &amp; access controls</h2><p>Enforced company-wide and website-specific instructions.</p></div></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordRestrictionRows(restrictions)}</div></div></section>
        </div>` : ''}
        ${hasPermission('payments:read') ? `<div class="customer-record-history-grid">
          <section class="customer-record-panel"><header><div><h2>Subscriptions &amp; entitlements</h2><p>Stripe and website plan status.</p></div><span class="tag information">${subscriptions.length}</span></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordSubscriptionRows(subscriptions)}</div></div></section>
          <section class="customer-record-panel"><header><div><h2>Orders</h2><p>Subscription checkouts and service order history.</p></div><span class="tag information">${orders.length}</span></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordOrderRows(orders)}</div></div></section>
          <section class="customer-record-panel"><header><div><h2>Payments, refunds &amp; disputes</h2><p>Provider references and outcomes.</p></div><span class="tag information">${payments.length}</span></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordPaymentRows(payments)}</div></div></section>
        </div>` : ''}
        ${hasPermission('security:read') ? `<div class="customer-record-history-grid">
          <section class="customer-record-panel"><header><div><h2>Sessions &amp; devices</h2><p>Active, revoked and historical website sessions.</p></div><span class="tag information">${sessions.length}</span></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordSessionRows(sessions)}</div></div></section>
          <section class="customer-record-panel"><header><div><h2>Fraud signals</h2><p>Identity, account and payment risk intelligence.</p></div><span class="tag information">${fraudSignals.length}</span></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordFraudRows(fraudSignals)}</div></div></section>
          <section class="customer-record-panel"><header><div><h2>Security activity</h2><p>Authentication, session and protection events.</p></div><span class="tag information">${securityEvents.length}</span></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordSecurityEventRows(securityEvents)}</div></div></section>
          <section class="customer-record-panel"><header><div><h2>Access decisions</h2><p>Allow, deny, step-up and revocation decisions returned to websites.</p></div><span class="tag information">${accessDecisions.length}</span></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordAccessRows(accessDecisions)}</div></div></section>
        </div>` : ''}
        ${hasPermission('communications:read') ? `<section class="customer-record-panel"><header><div><h2>Customer communications</h2><p>Email, phone, WhatsApp, web-form and internal contact history.</p></div><span class="tag information">${communications.length}</span></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordCommunicationRows(communications)}</div></div></section>` : ''}
        <section class="customer-record-panel"><header><div><h2>Complete customer timeline</h2><p>Company-wide website, subscription, payment, support and security history.</p></div><span class="tag information">${timeline.length}</span></header><div class="customer-record-panel-body flush"><div class="customer-record-list">${customerRecordTimelineRows(timeline)}</div></div></section>
      </main>
    </div>
  </div>`;
  window.scrollTo({top:0,behavior:'instant'});
};

document.addEventListener('click', event => {
  const button = event.target.closest('[data-customer-record-action]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const customerNumber = button.dataset.customer || '';
  const action = button.dataset.customerRecordAction;
  if (action === 'case') return newCaseModal('',customerNumber);
  if (action === 'communication') return newCommunicationModal(customerNumber,'');
  if (action === 'marker') return newMarkerModal(customerNumber,'');
  if (action === 'restriction') return newRestrictionModal(customerNumber,'');
},true);
