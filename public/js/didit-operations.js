(() => {
  const diditState = { sessions: [], configuration: {}, filters: { q: '', status: '', purpose: '' }, customerId: '' };
  const activeStatuses = new Set(['Not Started','Awaiting User','In Progress','In Review','Resubmitted']);
  const completeStatuses = new Set(['Approved','Declined','Expired','Abandoned','Kyc Expired','Cancelled']);

  function ensureDiditStyle() {
    if (document.querySelector('link[data-didit-operations]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/didit-operations.css?v=20260729-didit-1';
    link.dataset.diditOperations = 'true';
    document.head.append(link);
  }

  function ensureDiditNavigation() {
    if (document.querySelector('[data-route="identity-verifications"]')) return;
    const security = document.querySelector('[data-route="security"]');
    const button = document.createElement('button');
    button.className = 'nav-item';
    button.dataset.route = 'identity-verifications';
    button.dataset.permission = 'security:read';
    button.textContent = 'Identity verification';
    if (security?.parentElement) security.parentElement.insertBefore(button, security);
  }

  const purposeLabel = value => ({
    identity_security: 'Identity & security',
    fraud_investigation: 'Fraud investigation',
    account_recovery: 'Account recovery',
    random_selection: 'Random selection',
    age_verification: 'Age verification'
  })[value] || label(value || 'identity_security');

  const accessModeLabel = value => value === 'require_before_access' ? 'Required before access' : 'Request only';

  function configurationCard(title, configured, description) {
    return `<article class="didit-config-card ${configured ? 'ok' : 'warn'}"><span>${escapeHtml(title)}</span><strong>${configured ? 'Configured' : 'Action required'}</strong><small>${escapeHtml(description)}</small></article>`;
  }

  function sessionMetadata(row) {
    const metadata = row.metadata || {};
    return {
      purpose: metadata.purpose || 'identity_security',
      accessMode: metadata.accessMode || 'request_only',
      source: metadata.source || 'manual',
      reason: metadata.reason || '',
      scope: metadata.scope || row.restriction_scope || (row.platform_name ? row.platform_name : 'company_wide')
    };
  }

  function sessionRow(row, customerContext = false) {
    const metadata = sessionMetadata(row);
    const isActive = activeStatuses.has(row.status);
    const canWrite = hasPermission('security:write');
    const actions = [
      !customerContext ? `<button class="button secondary small" data-didit-action="view-customer" data-customer-id="${escapeHtml(row.customer_id)}">View customer</button>` : '',
      canWrite && isActive ? `<button class="button secondary small" data-didit-action="resume" data-id="${escapeHtml(row.id)}">Resume / get link</button>` : '',
      canWrite && !['Cancelled'].includes(row.status) ? `<button class="button secondary small" data-didit-action="refresh" data-id="${escapeHtml(row.id)}">Refresh status</button>` : '',
      canWrite && isActive ? `<button class="button danger small" data-didit-action="cancel" data-id="${escapeHtml(row.id)}" data-customer="${escapeHtml(row.customer_name || '')}">Cancel</button>` : ''
    ].filter(Boolean).join('');
    return `<article class="didit-session">
      <div><h3>${escapeHtml(row.customer_name || 'Customer')} <span class="mono">${escapeHtml(row.customer_number || '')}</span></h3><p>${escapeHtml(purposeLabel(metadata.purpose))} · ${escapeHtml(accessModeLabel(metadata.accessMode))}</p><small>${escapeHtml(metadata.reason || 'No staff rationale recorded.')}</small></div>
      <div class="didit-session-meta"><span>${tag(row.status || 'Unknown')}</span><small>Started ${formatDate(row.created_at)}</small><small>Updated ${formatDate(row.updated_at)}</small></div>
      <div class="didit-session-meta"><strong>${escapeHtml(row.platform_name || label(metadata.scope || 'company_wide'))}</strong><small>Didit session</small><small class="mono">${escapeHtml(row.provider_session_id)}</small>${row.restriction_status ? `<small>Access control: ${escapeHtml(label(row.restriction_status))}</small>` : ''}</div>
      <div class="didit-session-actions">${actions}</div>
    </article>`;
  }

  function webhookRow(row) {
    return `<article class="didit-webhook"><div><strong>${escapeHtml(row.webhook_type || 'Didit event')}</strong><small class="mono">${escapeHtml(row.provider_session_id || 'No session')}</small></div><div>${tag(row.processing_status || 'unknown')} ${row.status ? tag(row.status) : ''}</div><div><span>${formatDate(row.received_at)}</span>${row.error_message ? `<small>${escapeHtml(row.error_message)}</small>` : ''}</div></article>`;
  }

  function metricCount(counts, statuses) {
    return statuses.reduce((total, status) => total + Number(counts?.[status] || 0), 0);
  }

  function diditQuery(filters = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value);
    return query.toString() ? `?${query}` : '';
  }

  async function loadDiditData(filters = diditState.filters) {
    const data = await api(`/api/identity-verifications${diditQuery(filters)}`);
    diditState.sessions = data.sessions || [];
    diditState.configuration = data.configuration || {};
    diditState.webhookEvents = data.webhookEvents || [];
    diditState.counts = data.counts || {};
    return data;
  }

  function startVerificationForm(customerNumber = '') {
    const ageConfigured = Boolean(diditState.configuration.ageWorkflowConfigured);
    return `<div class="notice"><span>🔐</span><div><strong>Head Office initiated only</strong><br>This does not run during ordinary sign-in. Choose “Request only” unless the customer must be blocked until the check is completed.</div></div>
      <div class="form-grid">
        <label class="field"><span>Universal Customer Number</span><input name="customerNumber" value="${escapeHtml(customerNumber)}" maxlength="10" inputmode="numeric" required></label>
        <label class="field"><span>Purpose</span><select name="purpose" required>
          <option value="identity_security">Identity &amp; security check</option>
          <option value="fraud_investigation">Fraud investigation</option>
          <option value="account_recovery">Account recovery</option>
          <option value="random_selection">Controlled random selection</option>
          <option value="age_verification" ${ageConfigured ? '' : 'disabled'}>Age verification${ageConfigured ? '' : ' — age workflow not configured'}</option>
        </select></label>
        <label class="field"><span>Access handling</span><select name="accessMode"><option value="request_only">Request only — do not block login</option><option value="require_before_access">Require completion before access</option></select></label>
        <label class="field"><span>Scope</span><select name="scope"><option value="company_wide">Company wide</option>${(state.reference.platforms || []).map(platform => `<option value="${escapeHtml(platform.id)}">${escapeHtml(platform.name)}</option>`).join('')}</select></label>
        <label class="field full"><span>Reason and operational rationale</span><textarea name="reason" maxlength="2000" required placeholder="Explain why Head Office is requesting this check."></textarea></label>
        <label class="field full"><span><input type="checkbox" name="sendNotificationEmails" value="true"> Ask Didit to send its verification email to the customer</span><small>The secure hosted link will also be shown once to authorised staff.</small></label>
      </div>`;
  }

  function openStartModal(customerNumber = '') {
    modalForm('Start identity verification', 'Create a controlled Didit request linked to the Universal Customer Record.', {
      form: 'didit-start',
      html: startVerificationForm(customerNumber)
    }, 'Create verification request', 'Identity Verification Centre');
  }

  function openRandomPreviewModal() {
    modalForm('Select customers at random', 'Preview a small controlled selection before any paid Didit sessions are created.', {
      form: 'didit-random-preview',
      html: `<div class="notice"><span>⚖</span><div><strong>Controlled selection</strong><br>This only prepares a preview. No customer is contacted and no login is blocked until you confirm the selected records.</div></div><label class="field"><span>Number of customers</span><input name="count" type="number" min="1" max="25" value="5" required></label>`
    }, 'Generate preview', 'Random identity confirmation');
  }

  function openRandomCommitModal(candidates) {
    const rows = candidates.map(item => `<label class="didit-random-candidate"><input type="checkbox" name="customerIds" value="${escapeHtml(item.id)}" checked><div><strong>${escapeHtml(item.display_name)} · <span class="mono">${escapeHtml(item.customer_number)}</span></strong><span>${escapeHtml(item.verified_email)}</span></div>${tag(item.security_status || 'clear')}</label>`).join('');
    modalForm('Confirm random identity checks', 'Review the selected customers carefully before creating Didit sessions.', {
      form: 'didit-random-commit',
      html: `<div class="didit-random-list">${rows || '<div class="didit-empty">No eligible customers were found.</div>'}</div>
        <div class="form-grid">
          <label class="field"><span>Access handling</span><select name="accessMode"><option value="request_only">Request only — do not block login</option><option value="require_before_access">Require completion before access</option></select></label>
          <label class="field"><span>Scope</span><select name="scope"><option value="company_wide">Company wide</option>${(state.reference.platforms || []).map(platform => `<option value="${escapeHtml(platform.id)}">${escapeHtml(platform.name)}</option>`).join('')}</select></label>
          <label class="field full"><span>Reason</span><textarea name="reason" maxlength="2000" required>Selected through the controlled random customer identity-confirmation programme.</textarea></label>
          <label class="field full"><span><input type="checkbox" name="sendNotificationEmails" value="true"> Ask Didit to send verification emails</span></label>
          <label class="field full"><span>Confirmation</span><input name="confirmation" autocomplete="off" placeholder="Type START RANDOM CHECKS" required></label>
        </div>`
    }, 'Start selected checks', 'Controlled random selection', 'danger');
  }

  function showHostedLink(result, title = 'Didit verification link created') {
    const url = result.verificationUrl;
    openModal(title, 'This secure hosted link is shown to authorised staff for operational use. It is not stored in CustomerOps as readable text.', `<div class="didit-secure-link"><div class="notice"><span>!</span><div><strong>Customer identity journey</strong><br>Only share this link with the customer connected to the displayed UCN. Do not paste it into cases, emails to unrelated people or public messages.</div></div><code>${escapeHtml(url)}</code><div class="form-actions"><button class="button secondary" data-didit-action="copy-link" data-url="${escapeHtml(url)}">Copy secure link</button><a class="button primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open Didit</a><button class="button secondary" data-close-modal>Close</button></div></div>`, 'Identity Verification Centre');
  }

  function openCancelModal(row) {
    modalForm('Cancel identity-verification request', `Cancel the active request for ${row?.customer_name || 'this customer'} and remove its linked access requirement where applicable.`, {
      form: 'didit-cancel',
      attributes: `data-id="${escapeHtml(row?.id || '')}"`,
      html: `<div class="notice danger"><span>!</span><div><strong>Controlled cancellation</strong><br>The audit and verification history will remain. The request will no longer be treated as active.</div></div><label class="field"><span>Cancellation reason</span><textarea name="reason" maxlength="1000" required></textarea></label>`
    }, 'Cancel request', 'Identity Verification Centre', 'danger');
  }

  window.renderIdentityVerifications = async function renderIdentityVerifications() {
    const data = await loadDiditData();
    const counts = data.counts || {};
    const waiting = metricCount(counts, ['Not Started','Awaiting User']);
    const progressing = metricCount(counts, ['In Progress','Resubmitted']);
    const review = metricCount(counts, ['In Review']);
    const approved = metricCount(counts, ['Approved']);
    const declined = metricCount(counts, ['Declined']);
    const config = data.configuration || {};
    $('#currentRouteLabel').textContent = 'Identity verification';
    document.title = 'Identity Verification Centre · CustomerOps';
    $('#viewRoot').innerHTML = `<div class="didit-page">
      <div class="page-heading didit-toolbar"><div><p class="eyebrow">Didit · Head Office controlled verification</p><h1>Identity Verification Centre</h1><p>Start, monitor, review and cancel identity or age-verification requests linked to the Universal Customer Register. Ordinary customer sign-in does not automatically trigger an ID check.</p></div><div class="didit-toolbar-actions">${hasPermission('security:write') ? '<button class="button secondary" data-didit-action="random-preview">Random selection</button><button class="button primary" data-didit-action="start">Start verification</button>' : ''}</div></div>
      <section class="didit-configuration" aria-label="Didit configuration health">
        ${configurationCard('Didit API', config.apiKeyConfigured, 'Creates and refreshes hosted verification sessions from CustomerOps.')}
        ${configurationCard('Signed webhook', config.webhookSecretConfigured, 'Authenticates status.updated events returned by Didit.')}
        ${configurationCard('Identity workflow', config.identityWorkflowConfigured, 'Used for Head Office identity, fraud and recovery checks.')}
        ${configurationCard('Age workflow', config.ageWorkflowConfigured, config.ageWorkflowConfigured ? 'Separate workflow available for age-verification requests.' : 'Optional: add DIDIT_AGE_WORKFLOW_ID before using age verification.')}
      </section>
      <section class="didit-metrics"><article class="didit-metric"><span>Awaiting customer</span><strong>${waiting}</strong></article><article class="didit-metric"><span>In progress</span><strong>${progressing}</strong></article><article class="didit-metric"><span>In review</span><strong>${review}</strong></article><article class="didit-metric"><span>Approved</span><strong>${approved}</strong></article><article class="didit-metric"><span>Declined</span><strong>${declined}</strong></article></section>
      <section class="didit-panel"><form class="didit-filters" data-form="didit-filter"><input name="q" type="search" placeholder="Search UCN, customer or Didit session…" value="${escapeHtml(diditState.filters.q)}"><select name="status"><option value="">All statuses</option>${['Not Started','Awaiting User','In Progress','In Review','Resubmitted','Approved','Declined','Expired','Abandoned','Cancelled'].map(value => `<option value="${value}" ${diditState.filters.status === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select><select name="purpose"><option value="">All purposes</option>${['identity_security','fraud_investigation','account_recovery','random_selection','age_verification'].map(value => `<option value="${value}" ${diditState.filters.purpose === value ? 'selected' : ''}>${escapeHtml(purposeLabel(value))}</option>`).join('')}</select><button class="button secondary">Filter</button></form></section>
      <section class="didit-panel"><header><div><h2>Verification requests</h2><p>${data.sessions.length} records match the current view.</p></div><span class="tag information">Didit v3</span></header><div class="didit-session-list">${data.sessions.length ? data.sessions.map(row => sessionRow(row)).join('') : '<div class="didit-empty">No identity-verification requests match this view.</div>'}</div></section>
      <section class="didit-panel"><header><div><h2>Webhook and decision history</h2><p>Signed Didit status deliveries received by CustomerOps.</p></div>${data.latestWebhook ? tag(data.latestWebhook.processing_status || 'unknown') : '<span class="tag awaiting_connection">No events</span>'}</header><div class="didit-webhooks">${data.webhookEvents.length ? data.webhookEvents.map(webhookRow).join('') : '<div class="didit-empty">No Didit webhook events have been stored yet.</div>'}</div></section>
    </div>`;
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  async function injectCustomerVerificationPanel(id) {
    const main = document.querySelector('.customer-record-main');
    const actions = document.querySelector('.customer-record-actions');
    if (!main || document.querySelector('[data-didit-customer-panel]')) return;
    const data = await api(`/api/identity-verifications${diditQuery({ customerId: id })}`);
    diditState.configuration = data.configuration || diditState.configuration;
    const customer = document.querySelector('.customer-record-ucn')?.textContent?.trim() || '';
    if (hasPermission('security:write') && actions && !actions.querySelector('[data-didit-action="start-customer"]')) {
      actions.insertAdjacentHTML('beforeend', `<button class="button secondary" data-didit-action="start-customer" data-customer="${escapeHtml(customer)}">Start ID verification</button>`);
    }
    const panel = document.createElement('section');
    panel.className = 'customer-record-panel didit-customer-panel-highlight';
    panel.dataset.diditCustomerPanel = 'true';
    panel.innerHTML = `<header><div><h2>Identity verification · Didit</h2><p>Head Office initiated identity, fraud, recovery, random-selection and age-verification requests.</p></div><span class="tag information">${data.sessions.length} records</span></header><div class="customer-record-panel-body flush"><div class="didit-session-list">${data.sessions.length ? data.sessions.map(row => sessionRow(row, true)).join('') : '<div class="didit-empty">No Didit identity-verification request has been created for this UCN.</div>'}</div></div>`;
    const timeline = [...main.querySelectorAll('.customer-record-panel')].find(item => item.querySelector('h2')?.textContent?.includes('Complete customer timeline'));
    if (timeline) main.insertBefore(panel, timeline); else main.append(panel);
  }

  const previousCustomerWorkspace = window.renderCustomerRecordWorkspace;
  if (typeof previousCustomerWorkspace === 'function') {
    window.renderCustomerRecordWorkspace = async function renderCustomerWithDidit(id) {
      await previousCustomerWorkspace(id);
      try { await injectCustomerVerificationPanel(id); }
      catch (error) { toast('Didit records unavailable', error.message || 'Identity-verification records could not be loaded.', 'error'); }
    };
  }

  const previousRenderRoute = renderRoute;
  renderRoute = async function renderRouteWithDidit(route = routeFromHash()) {
    if (route === 'identity-verifications') {
      state.route = route;
      $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
      $('#sidebar')?.classList.remove('open');
      setLoading('Opening the Identity Verification Centre…');
      try { return await window.renderIdentityVerifications(); }
      catch (error) {
        $('#viewRoot').innerHTML = `<div class="panel"><div class="empty-state"><strong>The Identity Verification Centre could not be opened</strong><span>${escapeHtml(error.message || 'The service is temporarily unavailable.')}</span></div></div>`;
        return toast('Identity verification unavailable', error.message || 'The section could not be opened.', 'error');
      }
    }
    return previousRenderRoute(route);
  };

  document.addEventListener('click', async event => {
    const element = event.target.closest('[data-didit-action]');
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = element.dataset.diditAction;
    try {
      if (action === 'start') return openStartModal();
      if (action === 'start-customer') return openStartModal(element.dataset.customer || '');
      if (action === 'random-preview') return openRandomPreviewModal();
      if (action === 'view-customer') return navigate(`customers/${encodeURIComponent(element.dataset.customerId)}`);
      if (action === 'copy-link') { await navigator.clipboard.writeText(element.dataset.url || ''); return toast('Secure Didit link copied'); }
      const row = diditState.sessions.find(item => item.id === element.dataset.id);
      if (action === 'cancel') return openCancelModal(row || { id: element.dataset.id, customer_name: element.dataset.customer });
      if (action === 'refresh') {
        const result = await api(`/api/identity-verifications/${encodeURIComponent(element.dataset.id)}`, { method: 'PUT', body: JSON.stringify({ action: 'refresh' }) });
        toast('Verification status refreshed', `Current Didit status: ${result.status}`);
        if (state.route === 'identity-verifications') return window.renderIdentityVerifications();
        return window.renderCustomerRecordWorkspace(state.route.split('/')[1]);
      }
      if (action === 'resume') {
        const result = await api(`/api/identity-verifications/${encodeURIComponent(element.dataset.id)}`, { method: 'PUT', body: JSON.stringify({ action: 'resume' }) });
        return showHostedLink(result, 'Didit verification link ready');
      }
    } catch (error) { toast('Didit action failed', error.message || 'The action could not be completed.', 'error'); }
  }, true);

  document.addEventListener('submit', async event => {
    const form = event.target.closest('form[data-form^="didit-"]');
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const name = form.dataset.form;
    const errorElement = form.querySelector('.form-error');
    const submit = form.querySelector('button:not([type="button"])');
    if (errorElement) errorElement.textContent = '';
    if (submit) submit.disabled = true;
    try {
      const formData = new FormData(form);
      if (name === 'didit-filter') {
        diditState.filters = { q: String(formData.get('q') || '').trim(), status: String(formData.get('status') || ''), purpose: String(formData.get('purpose') || '') };
        return window.renderIdentityVerifications();
      }
      if (name === 'didit-start') {
        const body = Object.fromEntries(formData);
        body.action = 'start';
        body.sendNotificationEmails = formData.has('sendNotificationEmails');
        const result = await api('/api/identity-verifications', { method: 'POST', body: JSON.stringify(body) });
        closeModal();
        showHostedLink(result);
        return;
      }
      if (name === 'didit-random-preview') {
        const result = await api('/api/identity-verifications', { method: 'POST', body: JSON.stringify({ action: 'random_preview', count: Number(formData.get('count') || 5) }) });
        closeModal();
        return openRandomCommitModal(result.candidates || []);
      }
      if (name === 'didit-random-commit') {
        const body = Object.fromEntries(formData);
        body.action = 'random_commit';
        body.customerIds = formData.getAll('customerIds');
        body.sendNotificationEmails = formData.has('sendNotificationEmails');
        const result = await api('/api/identity-verifications', { method: 'POST', body: JSON.stringify(body) });
        closeModal();
        toast('Random verification requests processed', `${result.started} started${result.failed ? ` · ${result.failed} failed` : ''}.`);
        return window.renderIdentityVerifications();
      }
      if (name === 'didit-cancel') {
        const result = await api(`/api/identity-verifications/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body: JSON.stringify({ action: 'cancel', reason: formData.get('reason') }) });
        closeModal();
        toast('Verification request cancelled', result.restrictionOutcome?.lifted ? 'The linked access requirement was also removed.' : 'The request is no longer active.');
        if (state.route === 'identity-verifications') return window.renderIdentityVerifications();
        return window.renderCustomerRecordWorkspace(state.route.split('/')[1]);
      }
    } catch (error) {
      if (errorElement) errorElement.textContent = error.message || 'The Didit action could not be completed.';
      else toast('Didit action failed', error.message || 'The action could not be completed.', 'error');
    } finally { if (submit) submit.disabled = false; }
  }, true);

  ensureDiditStyle();
  ensureDiditNavigation();
  window.ensureDiditNavigation = ensureDiditNavigation;
})();
