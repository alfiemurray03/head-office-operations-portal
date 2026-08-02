(() => {
  const ROUTE = 'customer-service-centre';
  const STATUS_OPTIONS = [
    'ai_handling',
    'awaiting_customer',
    'human_assistance_requested',
    'assigned',
    'under_investigation',
    'resolved',
    'closed',
    'escalated',
    'security_review_required'
  ];
  const HANDLING_OPTIONS = ['ai', 'human_pending', 'human', 'hybrid', 'paused'];
  const centre = {
    view: 'queue',
    filters: { q: '', status: '', platformId: '' },
    conversations: [],
    branches: [],
    selectedId: null,
    refreshTimer: null,
    busy: false
  };

  const originalRenderRoute = window.renderRoute;
  if (typeof originalRenderRoute !== 'function') return;

  function currentRoute() {
    return String(location.hash || '').replace(/^#\/?/, '').split(/[/?]/)[0] || 'dashboard';
  }

  function conversationRoute(id) {
    return `${ROUTE}/${encodeURIComponent(id)}`;
  }

  function conversationIdFromRoute(route = String(location.hash || '').replace(/^#\/?/, '').split('?')[0]) {
    const [root, encodedId] = String(route || '').split('/');
    if (root !== ROUTE || !encodedId) return null;
    try { return decodeURIComponent(encodedId); }
    catch { return encodedId; }
  }

  function optionRows(values, selected, blank = '') {
    const prefix = blank ? `<option value="">${escapeHtml(blank)}</option>` : '';
    return prefix + values.map(value => `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label(value))}</option>`).join('');
  }

  function supportTag(value, extra = '') {
    const normalised = String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    return `<span class="support-tag ${escapeHtml(normalised)} ${escapeHtml(extra)}">${escapeHtml(label(value || 'unknown'))}</span>`;
  }

  function conversationName(record) {
    return record.customerName || record.customerNumber || 'Anonymous visitor';
  }

  function conversationSearchText(record) {
    return [
      record.reference,
      record.platformName,
      record.customerName,
      record.customerNumber,
      record.verifiedEmail,
      record.category,
      record.currentPage,
      record.caseReference
    ].filter(Boolean).join(' ').toLowerCase();
  }

  function queueMetrics(records) {
    return {
      open: records.filter(record => !['resolved', 'closed'].includes(record.status)).length,
      human: records.filter(record => ['human_assistance_requested', 'assigned', 'under_investigation'].includes(record.status)).length,
      security: records.filter(record => record.status === 'security_review_required' || record.category === 'security').length,
      ai: records.filter(record => record.handlingMode === 'ai' || record.handlingMode === 'hybrid').length
    };
  }

  async function loadBranches() {
    const data = await api('/api/support-centre/branches', { timeoutMs: 12_000 });
    centre.branches = data.branches || [];
    return centre.branches;
  }

  async function loadConversations() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(centre.filters)) if (value) params.set(key, value);
    const data = await api(`/api/support-centre/conversations?${params}`, { timeoutMs: 12_000 });
    centre.conversations = data.conversations || [];
    return centre.conversations;
  }

  function renderWorkspaceTabs() {
    return `<div class="support-workspace-tabs" role="tablist" aria-label="AI Customer Service Centre views">
      <button type="button" role="tab" aria-selected="${centre.view === 'queue'}" class="${centre.view === 'queue' ? 'active' : ''}" data-support-view="queue">Live conversations</button>
      <button type="button" role="tab" aria-selected="${centre.view === 'branches'}" class="${centre.view === 'branches' ? 'active' : ''}" data-support-view="branches">Website controls</button>
    </div>`;
  }

  function renderQueue(records) {
    const metrics = queueMetrics(records);
    const platformOptions = centre.branches.map(branch => `<option value="${escapeHtml(branch.platformId)}" ${branch.platformId === centre.filters.platformId ? 'selected' : ''}>${escapeHtml(branch.platformName)}</option>`).join('');
    const rows = records.length ? records.map(record => `<tr data-support-open="${escapeHtml(record.id)}" tabindex="0">
      <td><div class="support-customer-cell"><span class="support-presence ${record.handlingMode === 'ai' ? 'ai' : record.handlingMode === 'human' ? 'human' : 'pending'}"></span><div><strong>${escapeHtml(conversationName(record))}</strong><small>${escapeHtml(record.customerNumber || record.verifiedEmail || record.identityStatus || 'Anonymous')}</small></div></div></td>
      <td><strong>${escapeHtml(record.platformName || record.platformCode || 'Connected website')}</strong><small class="support-cell-subline">${escapeHtml(record.currentPage || 'Page not supplied')}</small></td>
      <td>${supportTag(record.status)}</td>
      <td>${supportTag(record.handlingMode)}</td>
      <td>${supportTag(record.category)}</td>
      <td>${supportTag(record.priority)}</td>
      <td><span>${escapeHtml(record.assignedStaffName || 'Unassigned')}</span>${record.caseReference ? `<small class="support-cell-subline mono">${escapeHtml(record.caseReference)}</small>` : ''}</td>
      <td>${formatDate(record.lastActivityAt)}</td>
    </tr>`).join('') : `<tr><td colspan="8">${emptyState('No conversations in this queue', 'The current filters do not match any authorised customer conversations.')}</td></tr>`;

    return `<div class="support-metrics">
      <article><span>Open conversations</span><strong>${metrics.open}</strong><small>Across authorised branches</small></article>
      <article><span>Human assistance</span><strong>${metrics.human}</strong><small>Waiting or actively assigned</small></article>
      <article><span>Security review</span><strong>${metrics.security}</strong><small>Restricted handling required</small></article>
      <article><span>AI handling</span><strong>${metrics.ai}</strong><small>Subject to branch policy</small></article>
    </div>
    <section class="panel support-queue-panel">
      <div class="panel-header"><div><h2>Live conversation queue</h2><p>One controlled queue across every connected JA Group Services website.</p></div><button type="button" class="button secondary" data-support-refresh>Refresh</button></div>
      <div class="panel-body">
        <form class="toolbar support-filter-form" data-support-form="filters">
          <label class="search-field"><span>Search</span><input name="q" value="${escapeHtml(centre.filters.q)}" placeholder="Customer, UCN, reference, page or case"></label>
          <select name="status"><option value="">All conversation statuses</option>${optionRows(STATUS_OPTIONS, centre.filters.status)}</select>
          <select name="platformId"><option value="">All authorised websites</option>${platformOptions}</select>
          <button class="button secondary">Apply filters</button>
        </form>
      </div>
      <div class="table-wrap"><table class="data-table support-conversation-table"><thead><tr><th>Customer</th><th>Website and page</th><th>Status</th><th>Handling</th><th>Category</th><th>Priority</th><th>Owner / case</th><th>Last activity</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
  }

  function branchStatusCopy(branch) {
    if (!branch.assistantEnabled) return 'Not available to customers';
    if (branch.maintenanceEnabled) return 'Maintenance message active';
    if (branch.aiEnabled) return 'AI and human support enabled';
    return 'Human support only';
  }

  function renderBranches() {
    const cards = centre.branches.length ? centre.branches.map(branch => `<article class="support-branch-card">
      <header><div><span class="eyebrow">${escapeHtml(branch.platformCode || 'Connected branch')}</span><h2>${escapeHtml(branch.platformName)}</h2><p>${escapeHtml(branch.assistantName)}</p></div>${supportTag(branch.assistantEnabled ? 'enabled' : 'disabled')}</header>
      <dl>
        <div><dt>Customer availability</dt><dd>${escapeHtml(branchStatusCopy(branch))}</dd></div>
        <div><dt>Human takeover</dt><dd>${branch.humanTakeoverEnabled ? 'Enabled' : 'Disabled'}</dd></div>
        <div><dt>Anonymous enquiries</dt><dd>${branch.anonymousEnabled ? 'Allowed' : 'Verification required'}</dd></div>
        <div><dt>Retention setting</dt><dd>${Number(branch.retentionDays || 365)} days</dd></div>
      </dl>
      ${branch.emergencyNotice ? `<div class="support-branch-notice"><strong>Emergency notice</strong><span>${escapeHtml(branch.emergencyNotice)}</span></div>` : ''}
      <footer><button type="button" class="button secondary" data-support-configure="${escapeHtml(branch.platformId)}" ${branch.permissions?.can_configure ? '' : 'disabled'}>Configure branch</button></footer>
    </article>`).join('') : emptyState('No support branches available', 'No connected website is available within your authorised scope.');

    return `<section class="panel"><div class="panel-header"><div><h2>Website and branch controls</h2><p>Head Office configuration for branding, availability, AI, human takeover, maintenance and retention.</p></div><button type="button" class="button secondary" data-support-refresh>Refresh</button></div><div class="panel-body"><div class="support-branch-grid">${cards}</div></div></section>`;
  }

  async function renderCustomerServiceCentre() {
    const routedConversationId = conversationIdFromRoute();
    if (routedConversationId) return openConversation(routedConversationId);
    centre.selectedId = null;
    state.route = ROUTE;
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === ROUTE));
    $('#sidebar')?.classList.remove('open');
    setLoading('Opening the AI Customer Service Centre…');
    try {
      await Promise.all([loadBranches(), loadConversations()]);
      if (currentRoute() !== ROUTE) return;
      $('#viewRoot').innerHTML = `<div class="page-heading support-page-heading"><div><p class="eyebrow">JA Group Services Ltd · Central customer operations</p><h1>AI Customer Service Centre</h1><p>Live conversations, human takeover, case escalation and website controls across every connected platform.</p></div><div class="heading-actions"><button type="button" class="button secondary" data-route="cases">Open cases</button></div></div>
        ${renderWorkspaceTabs()}
        ${centre.view === 'branches' ? renderBranches() : renderQueue(centre.conversations)}`;
      scheduleRefresh();
    } catch (error) {
      $('#viewRoot').innerHTML = `<div class="panel"><div class="empty-state"><strong>The AI Customer Service Centre could not be opened</strong><span>${escapeHtml(error.message)}</span></div></div>`;
      toast('Customer Service Centre unavailable', error.message, 'error');
    }
  }

  function transcriptMessage(message) {
    const internal = message.visibility !== 'customer';
    const senderClass = internal ? 'internal' : message.senderType === 'customer' ? 'customer' : message.senderType === 'staff' ? 'staff' : message.senderType === 'ai' ? 'ai' : 'system';
    const visibility = message.visibility === 'head_office' ? 'Head Office only' : message.visibility === 'branch_internal' ? 'Branch internal' : '';
    return `<article class="support-message ${senderClass}">
      <header><strong>${escapeHtml(message.senderName || label(message.senderType))}</strong><span>${visibility ? `${escapeHtml(visibility)} · ` : ''}${formatDate(message.createdAt)}</span></header>
      <p>${escapeHtml(message.body).replace(/\n/g, '<br>')}</p>
    </article>`;
  }

  function eventRows(events) {
    return events.slice(0, 25).map(event => `<li><strong>${escapeHtml(label(String(event.eventType || '').replace(/^conversation\./, '')))}</strong><span>${formatDate(event.occurredAt)}</span></li>`).join('') || '<li><span>No conversation events recorded.</span></li>';
  }

  async function openConversation(id, { background = false } = {}) {
    clearTimeout(centre.refreshTimer);
    centre.selectedId = id;
    state.route = ROUTE;
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === ROUTE));
    $('#sidebar')?.classList.remove('open');
    const pagePosition = background ? { x: window.scrollX, y: window.scrollY } : null;
    if (!background) setLoading('Opening the customer conversation…');
    try {
      const data = await api(`/api/support-centre/conversations/${encodeURIComponent(id)}`, { timeoutMs: 12_000 });
      if (currentRoute() !== ROUTE || conversationIdFromRoute() !== String(id)) return;
      const record = data.conversation;
      const messages = data.messages || [];
      const permissions = data.permissions || {};
      const statusOptions = optionRows(STATUS_OPTIONS, record.status);
      const handlingOptions = optionRows(HANDLING_OPTIONS, record.handlingMode);
      const customerIdentity = [record.customerNumber, record.verifiedEmail, record.identityStatus].filter(Boolean).join(' · ');
      const serviceContext = Object.entries(data.serviceContext || {}).map(([key, value]) => `<div><dt>${escapeHtml(label(key))}</dt><dd>${escapeHtml(Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : value)}</dd></div>`).join('');
      const providerEscalations = (data.providerEscalations || []).map(item => `<div class="summary-item"><span>${escapeHtml(item.provider_name)}</span><strong>${escapeHtml(item.provider_reference || 'Reference pending')} ${supportTag(item.status)}</strong><small>${escapeHtml(item.summary)}</small></div>`).join('');

      $('#viewRoot').innerHTML = `<div class="page-heading"><div><button type="button" class="support-back-link" data-support-back>← Live conversations</button><p class="eyebrow">${escapeHtml(record.platformName)} · ${escapeHtml(record.reference)}</p><h1>${escapeHtml(conversationName(record))}</h1><p>${escapeHtml(customerIdentity || 'Anonymous customer')} · ${escapeHtml(record.currentPage || 'Page not supplied')}</p></div><div class="heading-actions">${record.caseReference ? `<button type="button" class="button secondary" data-route="cases">Case ${escapeHtml(record.caseReference)}</button>` : ''}${permissions.can_takeover ? `<button type="button" class="button primary" data-support-takeover="${escapeHtml(record.id)}">Take over conversation</button>` : ''}</div></div>
      <div class="support-conversation-layout">
        <section class="panel support-transcript-panel">
          <div class="panel-header"><div><h2>Conversation transcript</h2><p>${supportTag(record.status)} ${supportTag(record.handlingMode)} ${supportTag(record.category)} ${supportTag(record.priority)}</p></div><button type="button" class="button ghost small" data-support-open="${escapeHtml(record.id)}">Refresh</button></div>
          <div class="support-transcript" id="supportTranscript">${messages.length ? messages.map(transcriptMessage).join('') : emptyState('No messages yet', 'The conversation has been created but no message has been recorded.')}</div>
          ${permissions.can_reply ? `<div class="support-compose-stack">
            <form data-support-form="reply" data-conversation-id="${escapeHtml(record.id)}" class="support-compose"><label><span>Reply to customer</span><textarea name="body" rows="3" maxlength="8000" placeholder="Write a customer-visible response…" required></textarea></label><button type="submit" class="button primary">Send reply</button></form>
            <form data-support-form="note" data-conversation-id="${escapeHtml(record.id)}" class="support-compose internal"><label><span>Internal note</span><textarea name="body" rows="2" maxlength="8000" placeholder="Add an internal operational note…" required></textarea></label><select name="visibility"><option value="branch_internal">Branch internal</option>${permissions.elevated ? '<option value="head_office">Head Office only</option>' : ''}</select><button type="submit" class="button secondary">Add note</button></form>
          </div>` : ''}
        </section>
        <aside class="support-conversation-sidebar">
          <section class="panel"><div class="panel-header"><div><h2>Handling controls</h2><p>AI standby and staff workflow state.</p></div></div><div class="panel-body"><form data-support-form="status" data-conversation-id="${escapeHtml(record.id)}" class="support-status-form"><label class="field"><span>Status</span><select name="status">${statusOptions}</select></label><label class="field"><span>Handling mode</span><select name="handlingMode">${handlingOptions}</select></label><button class="button secondary">Update handling</button></form></div></section>
          <section class="panel"><div class="panel-header"><div><h2>Customer context</h2><p>Verified and branch-supplied support information.</p></div></div><div class="panel-body"><dl class="support-context-list"><div><dt>Customer</dt><dd>${escapeHtml(conversationName(record))}</dd></div><div><dt>UCN</dt><dd class="mono">${escapeHtml(record.customerNumber || 'Not linked')}</dd></div><div><dt>Authentication</dt><dd>${escapeHtml(record.authenticated ? 'Authenticated' : 'Anonymous')}</dd></div><div><dt>Assigned to</dt><dd>${escapeHtml(record.assignedStaffName || 'Unassigned')}</dd></div>${serviceContext}</dl></div></section>
          ${providerEscalations ? `<section class="panel"><div class="panel-header"><div><h2>Provider escalations</h2><p>Underlying provider activity and follow-up.</p></div></div><div class="panel-body summary-list">${providerEscalations}</div></section>` : ''}
          <section class="panel"><div class="panel-header"><div><h2>Activity history</h2><p>Recent controlled conversation events.</p></div></div><div class="panel-body"><ul class="support-event-list">${eventRows(data.events || [])}</ul></div></section>
        </aside>
      </div>`;
      const transcript = $('#supportTranscript');
      if (transcript) transcript.scrollTop = transcript.scrollHeight;
      if (pagePosition) window.requestAnimationFrame(() => window.scrollTo(pagePosition.x, pagePosition.y));
      scheduleRefresh(true);
    } catch (error) {
      toast('Conversation unavailable', error.message, 'error');
      if (currentRoute() === ROUTE) navigate(ROUTE, true);
    }
  }

  function branchForm(branch) {
    const contacts = branch.contactOptions || {};
    return `<form data-support-form="branch" data-platform-id="${escapeHtml(branch.platformId)}">
      <div class="form-grid">
        <label class="field"><span>Assistant name</span><input name="assistantName" maxlength="120" value="${escapeHtml(branch.assistantName || '')}" required></label>
        <label class="field"><span>Retention days</span><input name="retentionDays" type="number" min="30" max="2555" value="${Number(branch.retentionDays || 365)}" required></label>
      </div>
      <div class="support-toggle-grid">
        <label><input type="checkbox" name="assistantEnabled" ${branch.assistantEnabled ? 'checked' : ''}> Customer assistant enabled</label>
        <label><input type="checkbox" name="aiEnabled" ${branch.aiEnabled ? 'checked' : ''}> AI responses enabled</label>
        <label><input type="checkbox" name="humanTakeoverEnabled" ${branch.humanTakeoverEnabled ? 'checked' : ''}> Human takeover enabled</label>
        <label><input type="checkbox" name="anonymousEnabled" ${branch.anonymousEnabled ? 'checked' : ''}> Anonymous enquiries allowed</label>
        <label><input type="checkbox" name="maintenanceEnabled" ${branch.maintenanceEnabled ? 'checked' : ''}> Support maintenance active</label>
      </div>
      <label class="field"><span>Greeting</span><textarea name="greeting" rows="2" maxlength="1000">${escapeHtml(branch.greeting || '')}</textarea></label>
      <label class="field"><span>Away message</span><textarea name="awayMessage" rows="2" maxlength="1000">${escapeHtml(branch.awayMessage || '')}</textarea></label>
      <label class="field"><span>Maintenance message</span><textarea name="maintenanceMessage" rows="2" maxlength="1000">${escapeHtml(branch.maintenanceMessage || '')}</textarea></label>
      <label class="field"><span>Emergency notice</span><textarea name="emergencyNotice" rows="2" maxlength="1000">${escapeHtml(branch.emergencyNotice || '')}</textarea></label>
      <div class="form-grid"><label class="field"><span>Public contact email</span><input name="contactEmail" type="email" value="${escapeHtml(contacts.email || '')}"></label><label class="field"><span>Public contact telephone</span><input name="contactPhone" value="${escapeHtml(contacts.phone || '')}"></label></div>
      <p class="form-error"></p><div class="form-actions"><button type="button" class="button secondary" data-close-modal>Cancel</button><button class="button primary">Save branch controls</button></div>
    </form>`;
  }

  async function configureBranch(platformId) {
    const branch = centre.branches.find(item => item.platformId === platformId);
    if (!branch) return toast('Branch unavailable', 'The selected support branch could not be found.', 'error');
    openModal('Configure customer support branch', `${branch.platformName} · controls are audited by Head Office.`, branchForm(branch), 'AI Customer Service Centre');
  }

  async function submitSupportForm(form) {
    if (centre.busy) return;
    centre.busy = true;
    const submit = form.querySelector('button[type="submit"],button:not([type])');
    if (submit) submit.disabled = true;
    const data = Object.fromEntries(new FormData(form));
    try {
      const type = form.dataset.supportForm;
      if (type === 'filters') {
        centre.filters = { q: data.q || '', status: data.status || '', platformId: data.platformId || '' };
        return await renderCustomerServiceCentre();
      }
      if (type === 'reply' || type === 'note') {
        const visibility = type === 'reply' ? 'customer' : data.visibility || 'branch_internal';
        await api(`/api/support-centre/conversations/${encodeURIComponent(form.dataset.conversationId)}/messages`, {
          method: 'POST',
          body: JSON.stringify({ body: data.body, visibility })
        });
        toast(type === 'reply' ? 'Reply sent' : 'Internal note added');
        return await openConversation(form.dataset.conversationId, { background: true });
      }
      if (type === 'status') {
        await api(`/api/support-centre/conversations/${encodeURIComponent(form.dataset.conversationId)}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: data.status, handlingMode: data.handlingMode })
        });
        toast('Conversation handling updated');
        return await openConversation(form.dataset.conversationId, { background: true });
      }
      if (type === 'branch') {
        const payload = {
          assistantName: data.assistantName,
          retentionDays: Number(data.retentionDays),
          assistantEnabled: Boolean(form.elements.assistantEnabled?.checked),
          aiEnabled: Boolean(form.elements.aiEnabled?.checked),
          humanTakeoverEnabled: Boolean(form.elements.humanTakeoverEnabled?.checked),
          anonymousEnabled: Boolean(form.elements.anonymousEnabled?.checked),
          maintenanceEnabled: Boolean(form.elements.maintenanceEnabled?.checked),
          greeting: data.greeting,
          awayMessage: data.awayMessage,
          maintenanceMessage: data.maintenanceMessage,
          emergencyNotice: data.emergencyNotice,
          contactOptions: { email: data.contactEmail || '', phone: data.contactPhone || '' }
        };
        await api(`/api/support-centre/branches/${encodeURIComponent(form.dataset.platformId)}`, { method: 'PUT', body: JSON.stringify(payload) });
        closeModal();
        toast('Branch controls saved', 'The change was recorded in the Head Office audit history.');
        await loadBranches();
        return await renderCustomerServiceCentre();
      }
    } catch (error) {
      const formError = form.querySelector('.form-error');
      if (formError) formError.textContent = error.message;
      else toast('Action could not be completed', error.message, 'error');
    } finally {
      centre.busy = false;
      if (submit) submit.disabled = false;
    }
  }

  async function takeOver(id) {
    if (centre.busy) return;
    centre.busy = true;
    try {
      await api(`/api/support-centre/conversations/${encodeURIComponent(id)}/takeover`, { method: 'POST', body: '{}' });
      toast('Conversation assigned to you', 'AI replies are now in standby.');
      await openConversation(id, { background: true });
    } catch (error) {
      toast('Takeover could not be completed', error.message, 'error');
    } finally {
      centre.busy = false;
    }
  }

  function scheduleRefresh(detail = false) {
    clearTimeout(centre.refreshTimer);
    if (currentRoute() !== ROUTE) return;
    centre.refreshTimer = setTimeout(() => {
      if (currentRoute() !== ROUTE || document.hidden || centre.busy) return scheduleRefresh(detail);
      const activeSupportForm = document.activeElement?.closest?.('[data-support-form]');
      const unsentDraft = $$('[data-support-form="reply"] textarea, [data-support-form="note"] textarea')
        .some(control => control.value.trim().length > 0);
      if (detail && (activeSupportForm || unsentDraft)) return scheduleRefresh(true);
      if (detail && centre.selectedId) openConversation(centre.selectedId, { background: true });
      else renderCustomerServiceCentre();
    }, detail ? 8_000 : 15_000);
  }

  document.addEventListener('click', event => {
    const target = event.target;
    const view = target.closest?.('[data-support-view]');
    if (view) {
      event.preventDefault();
      centre.view = view.dataset.supportView;
      centre.selectedId = null;
      return renderCustomerServiceCentre();
    }
    const open = target.closest?.('[data-support-open]');
    if (open) {
      event.preventDefault();
      return navigate(conversationRoute(open.dataset.supportOpen));
    }
    const back = target.closest?.('[data-support-back]');
    if (back) {
      event.preventDefault();
      centre.selectedId = null;
      return navigate(ROUTE);
    }
    const takeover = target.closest?.('[data-support-takeover]');
    if (takeover) {
      event.preventDefault();
      return takeOver(takeover.dataset.supportTakeover);
    }
    const configure = target.closest?.('[data-support-configure]');
    if (configure) {
      event.preventDefault();
      return configureBranch(configure.dataset.supportConfigure);
    }
    if (target.closest?.('[data-support-refresh]')) {
      event.preventDefault();
      return centre.selectedId ? openConversation(centre.selectedId, { background: true }) : renderCustomerServiceCentre();
    }
  }, true);

  document.addEventListener('keydown', event => {
    const row = event.target.closest?.('[data-support-open]');
    if (row && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      navigate(conversationRoute(row.dataset.supportOpen));
    }
  });

  document.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-support-form]');
    if (!form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    submitSupportForm(form);
  }, true);

  window.renderCustomerServiceCentre = renderCustomerServiceCentre;
  window.renderRoute = async function governedRoute(route = window.routeFromHash?.() || currentRoute()) {
    if (String(route).split('/')[0] === ROUTE) {
      const conversationId = conversationIdFromRoute(route);
      return conversationId ? openConversation(conversationId) : renderCustomerServiceCentre();
    }
    clearTimeout(centre.refreshTimer);
    return originalRenderRoute(route);
  };
})();
