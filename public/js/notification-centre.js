(() => {
  const ROUTE = 'notifications';

  function metric(labelText, value, detail) {
    return `<article class="metric-card"><div><span>${escapeHtml(labelText)}</span><strong>${Number(value || 0).toLocaleString('en-GB')}</strong><small>${escapeHtml(detail)}</small></div></article>`;
  }

  function platformOptions() {
    return `<option value="">All websites linked to this customer</option>${(state.reference.platforms || [])
      .filter(platform => platform.status !== 'disabled')
      .map(platform => `<option value="${escapeHtml(platform.code)}">${escapeHtml(platform.name)} · ${escapeHtml(platform.code)}</option>`)
      .join('')}`;
  }

  function noticeMetrics(notices = []) {
    return {
      published: notices.filter(item => item.status === 'published').length,
      drafts: notices.filter(item => item.status === 'draft').length,
      priority: notices.filter(item => item.status === 'published' && ['urgent', 'critical'].includes(item.severity)).length,
      dismissals: notices.reduce((total, item) => total + Number(item.dismissal_count || 0), 0)
    };
  }

  function noticeRows(rows = []) {
    if (!rows.length) return `<tr><td colspan="9">${emptyState('No customer notices', 'Create the first governed on-screen notice for a customer account.')}</td></tr>`;
    return rows.map(item => {
      const actions = hasPermission('communications:write')
        ? `<div class="notification-status-actions">${item.status === 'draft' ? `<button class="button primary small" data-notice-action="publish" data-id="${escapeHtml(item.id)}">Publish</button>` : ''}${item.status === 'published' ? `<button class="button danger small" data-notice-action="withdraw" data-id="${escapeHtml(item.id)}">Withdraw</button>` : ''}</div>`
        : '';
      return `<tr>
        <td class="mono">${escapeHtml(item.notice_reference)}</td>
        <td><strong>${escapeHtml(item.title)}</strong><br><small>${escapeHtml(item.message)}</small></td>
        <td><span class="notification-severity ${escapeHtml(item.severity)}">${escapeHtml(label(item.severity))}</span><br><small>${escapeHtml(label(item.category))}</small></td>
        <td><strong>UCN ${escapeHtml(item.customer_number)}</strong><br><small>${escapeHtml(item.customer_name || 'Customer')}</small></td>
        <td>${escapeHtml(item.platform_name || 'All linked websites')}</td>
        <td>${tag(item.status)}</td>
        <td>${formatDate(item.published_at || item.created_at)}<br><small>${item.expires_at ? `Ends ${formatDate(item.expires_at)}` : 'Until dismissed or withdrawn'}</small></td>
        <td>${Number(item.dismissal_count || 0).toLocaleString('en-GB')} / ${Number(item.receipt_count || 0).toLocaleString('en-GB')}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
  }

  async function renderNotificationCentre() {
    const data = await api('/api/customer-notices');
    const notices = data.notices || [];
    const metrics = noticeMetrics(notices);
    const editable = hasPermission('communications:write');
    $('#viewRoot').innerHTML = `<div class="page-heading"><div><p class="eyebrow">Customer-screen communications</p><h1>Customer notification panel</h1><p>Publish a governed notice to a real Universal Customer Record. Connected websites keep it visible after sign-in until the customer dismisses it, Head Office withdraws it or the optional expiry passes.</p></div></div>
      <div class="notice"><span>i</span><div><strong>Authenticated delivery only</strong><br>Websites retrieve notices with their existing scoped server credential and resolve the signed-in customer through the linked platform account. Credentials never enter this browser.</div></div>
      <div class="metrics notification-metrics">
        ${metric('Published notices', metrics.published, 'Currently eligible for delivery')}
        ${metric('Draft notices', metrics.drafts, 'Awaiting a deliberate publish action')}
        ${metric('Urgent or critical', metrics.priority, 'Published priority notices')}
        ${metric('Dismissals', metrics.dismissals, 'Customer acknowledgements recorded')}
      </div>
      <div class="notification-compose-grid">
        <section class="panel form-surface"><div class="panel-header"><div><h2>Compose customer notice</h2><p>Target one genuine customer, with optional website scope and expiry.</p></div></div><div class="panel-body">
          ${editable ? `<form data-form="customer-notice-create">
            <div class="form-grid">
              <label class="field"><span>Universal Customer Number</span><input name="customerNumber" inputmode="numeric" maxlength="40" required placeholder="Required UCN"></label>
              <label class="field"><span>Website scope</span><select name="platformCode">${platformOptions()}</select></label>
              <label class="field"><span>Category</span><select name="category"><option value="service">Service</option><option value="account">Account</option><option value="security">Security</option><option value="billing">Billing</option><option value="complaint">Complaint</option><option value="data_protection">Data protection</option><option value="safeguarding">Safeguarding</option><option value="general">General</option></select></label>
              <label class="field"><span>Severity</span><select name="severity"><option value="information">Information</option><option value="important">Important</option><option value="urgent">Urgent</option><option value="critical">Critical</option></select></label>
            </div>
            <label class="field"><span>Title</span><input name="title" maxlength="180" required placeholder="Short, clear notice title"></label>
            <label class="field"><span>Customer-visible message</span><textarea name="message" maxlength="4000" required placeholder="Explain what changed, what the customer should do and where to get help."></textarea></label>
            <div class="form-grid">
              <label class="field"><span>Optional action label</span><input name="actionLabel" maxlength="100" placeholder="For example: Review security"></label>
              <label class="field"><span>Optional secure action URL</span><input name="actionHref" maxlength="500" placeholder="https:// or same-site path"></label>
              <label class="field"><span>Optional expiry</span><input name="expiresAt" type="datetime-local"></label>
            </div>
            <label class="check-row"><input name="publishNow" type="checkbox" checked> Publish immediately after validation</label>
            <p class="form-error"></p><div class="form-actions"><button class="button primary" type="submit">Create customer notice</button></div>
          </form>` : '<p class="help-text">You have read-only access to customer notices.</p>'}
        </div></section>
        <section class="panel queue-surface"><div class="panel-header"><div><h2>Customer notice register</h2><p>Delivery scope, status and customer dismissal evidence.</p></div><button class="button secondary small" data-notice-action="refresh">Refresh</button></div>
          <div class="table-wrap live-table-wrap"><table class="data-table"><thead><tr><th>Reference</th><th>Notice</th><th>Priority</th><th>Customer</th><th>Website</th><th>Status</th><th>Window</th><th>Dismissed / delivered</th><th></th></tr></thead><tbody>${noticeRows(notices)}</tbody></table></div>
        </section>
      </div>`;
  }

  const previousRenderRoute = renderRoute;
  renderRoute = async function notificationCentreRoute(route = routeFromHash()) {
    if (route !== ROUTE) return previousRenderRoute(route);
    state.route = route;
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
    $('#sidebar')?.classList.remove('open');
    setLoading('Opening the customer notification panel…');
    try { return await renderNotificationCentre(); }
    catch (error) {
      $('#viewRoot').innerHTML = `<section class="panel"><div class="empty-state"><strong>The notification panel could not be opened</strong><span>${escapeHtml(error.message)}</span></div></section>`;
      toast('Notification panel unavailable', error.message, 'error');
    }
  };

  const previousHandleForm = handleForm;
  handleForm = async function notificationCentreForm(form) {
    if (form.dataset.form !== 'customer-notice-create') return previousHandleForm(form);
    const submit = form.querySelector('button[type="submit"]');
    const errorElement = form.querySelector('.form-error');
    if (submit) submit.disabled = true;
    if (errorElement) errorElement.textContent = '';
    try {
      const formData = new FormData(form);
      const body = Object.fromEntries(formData);
      body.status = formData.has('publishNow') ? 'published' : 'draft';
      delete body.publishNow;
      for (const key of ['platformCode', 'actionLabel', 'actionHref', 'expiresAt']) if (!body[key]) delete body[key];
      const result = await api('/api/customer-notices', { method: 'POST', body: JSON.stringify(body) });
      toast(body.status === 'published' ? 'Customer notice published' : 'Customer notice drafted', result.notice.reference);
      return renderNotificationCentre();
    } catch (error) {
      if (errorElement) errorElement.textContent = error.message;
      else toast('Customer notice not created', error.message, 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  };

  const previousHandleClick = handleClick;
  handleClick = async function notificationCentreClick(target) {
    const element = target.closest?.('[data-notice-action]');
    if (!element) return previousHandleClick(target);
    const action = element.dataset.noticeAction;
    if (action === 'refresh') return renderNotificationCentre();
    try {
      await api('/api/customer-notices', { method: 'PUT', body: JSON.stringify({ id: element.dataset.id, action }) });
      toast(action === 'publish' ? 'Customer notice published' : 'Customer notice withdrawn');
      return renderNotificationCentre();
    } catch (error) {
      return toast('Customer notice not updated', error.message, 'error');
    }
  };

  window.renderNotificationCentre = renderNotificationCentre;
})();
