(() => {
  const socState = { platforms: [], lockdowns: [], stripe: null, stripeRecords: null, stripeTab: 'payments' };

  function loadSocStyle() {
    if (document.querySelector('link[data-security-operations-centre]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/security-operations-centre.css?v=20260729-soc-1';
    link.dataset.securityOperationsCentre = 'true';
    document.head.append(link);
  }

  function replaceTerminology() {
    const substitutions = [
      ['Universal Customer Register', 'Unique Customer Register'],
      ['Universal Customer Number', 'Unique Customer Number'],
      ['universal customer', 'unique customer'],
      ['Universal customer', 'Unique customer']
    ];
    document.querySelectorAll('button,span,strong,p,h1,h2,h3,label,option').forEach(element => {
      if (element.children.length) return;
      let text = element.textContent;
      for (const [from, to] of substitutions) text = text.replaceAll(from, to);
      if (text !== element.textContent) element.textContent = text;
    });
    const search = document.querySelector('#globalSearch');
    if (search) search.placeholder = 'Search UCN, customer, marker code, case, payment or incident…';
  }

  function ensureSocNavigation() {
    if (!document.querySelector('[data-route="security-operations"]')) {
      const firstControl = document.querySelector('#mainNavigation [data-route="control-room"]');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.route = 'security-operations';
      button.dataset.permission = 'risk:read';
      button.textContent = 'Security Operations Centre';
      firstControl?.parentElement?.insertBefore(button, firstControl);
    }
    if (!document.querySelector('[data-route="stripe-control"]')) {
      const payments = document.querySelector('#mainNavigation [data-route="payments"]');
      const button = document.createElement('button');
      button.className = 'nav-item';
      button.dataset.route = 'stripe-control';
      button.dataset.permission = 'payments:read';
      button.textContent = 'Stripe control & webhooks';
      payments?.parentElement?.insertBefore(button, payments.nextSibling);
    }
    replaceTerminology();
  }

  async function safeApi(path, fallback) {
    try { return await api(path); }
    catch (error) {
      console.warn('Security Operations Centre data unavailable', path, error);
      return fallback;
    }
  }

  const count = value => Number(value || 0).toLocaleString('en-GB');
  const statusDot = (ok, critical = false) => `<span class="soc-status-dot ${critical ? 'critical' : ok ? '' : 'warn'}"></span>`;
  const configLabel = configured => configured ? tag('configured') : tag('action_required');
  const markerLabel = marker => marker.crm_display_label || marker.marker_label || label(marker.marker_type);

  function markerRows(markers) {
    if (!markers?.length) return '<tr><td colspan="7"><div class="soc-empty">No active security markers.</div></td></tr>';
    return markers.slice(0, 60).map(marker => `<tr>
      <td><strong>${escapeHtml(marker.customer_name || 'Customer')}</strong><br><span class="soc-code">UCN ${escapeHtml(marker.customer_number || '—')}</span></td>
      <td><span class="soc-code">${escapeHtml(marker.marker_code || marker.marker_type)}</span><br><small>${escapeHtml(marker.marker_reference || '')}</small></td>
      <td><strong>${escapeHtml(markerLabel(marker))}</strong></td>
      <td>${tag(marker.risk_level)}</td>
      <td>${tag(marker.status)}</td>
      <td>${escapeHtml(label(marker.visibility))}</td>
      <td>${formatDate(marker.review_at, 'No review')}</td>
    </tr>`).join('');
  }

  function lockdownRows(lockdowns) {
    if (!lockdowns?.length) return '<div class="soc-empty">No platform lockdown history has been recorded.</div>';
    return lockdowns.slice(0, 30).map(lockdown => `<div class="soc-lockdown-row">
      <div><strong>${escapeHtml(lockdown.platform_name)}</strong><small><span class="soc-code">${escapeHtml(lockdown.platform_code)}</span> · ${escapeHtml(lockdown.incident_reference)}</small></div>
      <div>${tag(lockdown.status)}<small>Initiated ${formatDate(lockdown.initiated_at)}</small></div>
      <div>${lockdown.status === 'active' && hasPermission('security:write') ? `<button class="button danger small" data-soc-action="lift-lockdown" data-id="${escapeHtml(lockdown.id)}" data-code="${escapeHtml(lockdown.platform_code)}" data-name="${escapeHtml(lockdown.platform_name)}">Lift lockdown</button>` : ''}</div>
    </div>`).join('');
  }

  function platformRows(platforms) {
    if (!platforms?.length) return '<tr><td colspan="6"><div class="soc-empty">No connected systems are registered.</div></td></tr>';
    return platforms.map(platform => {
      const health = platform.health_status || platform.status || 'unknown';
      const lastContact = platform.last_heartbeat_at || platform.last_api_activity_at || platform.last_health_check_at;
      return `<tr>
        <td><strong>${escapeHtml(platform.name)}</strong><br><span class="soc-code">${escapeHtml(platform.code)}</span></td>
        <td>${tag(health)}</td>
        <td>${count(platform.customer_count)}</td>
        <td>${count(platform.active_session_count)}</td>
        <td>${count(platform.open_error_count)}</td>
        <td>${formatDate(lastContact, 'No contact')}</td>
      </tr>`;
    }).join('');
  }

  async function renderSecurityOperationsCentre() {
    $('#currentRouteLabel').textContent = 'Security Operations Centre';
    document.title = 'Security Operations Centre · JA Group Services Ltd';
    const [security, lockdownData, platformData, stripe, notifications] = await Promise.all([
      safeApi('/api/security', { markers: [], restrictions: [], metrics: {} }),
      safeApi('/api/security/lockdowns', { lockdowns: [], policy: {} }),
      safeApi('/api/platforms', { platforms: [] }),
      safeApi('/api/integrations/stripe/status', { configuration: {}, counts: {}, recentEvents: [] }),
      safeApi('/api/customer-directory/notifications', { configured: false, counts: {} })
    ]);
    const platforms = platformData.platforms || [];
    const lockdowns = lockdownData.lockdowns || [];
    socState.platforms = platforms;
    socState.lockdowns = lockdowns;
    socState.stripe = stripe;
    const activeLockdowns = lockdowns.filter(item => item.status === 'active');
    const operationalPlatforms = platforms.filter(item => ['operational','active'].includes(item.health_status || item.status));
    const stripeConfigured = Boolean(stripe.configuration?.apiKeyConfigured && stripe.configuration?.webhookSecretConfigured);
    const criticalMarkers = Number(security.metrics?.critical_markers || 0);

    $('#viewRoot').innerHTML = `<div class="soc-page">
      <section class="soc-command-header">
        <div><p class="eyebrow">JA Group Services Ltd · Head Office control plane</p><h1>Security Operations Centre</h1><p>Central command for customer identity, access management, security markers, fraud controls, connected websites, critical incidents and payment intelligence. Website maintenance and launch gates remain locally controlled; Head Office security lockdown is a separate manual emergency control.</p></div>
        <div class="soc-command-actions">
          ${hasPermission('security:write') ? '<button class="button danger" data-soc-action="new-lockdown">Initiate critical lockdown</button>' : ''}
          <button class="button secondary" data-soc-action="open-stripe">Stripe control</button>
          <button class="button secondary" data-route="customers">Unique Customer Register</button>
        </div>
      </section>

      <section class="soc-status-strip" aria-label="Control-plane status">
        <div class="soc-status-item">${statusDot(operationalPlatforms.length === platforms.length && platforms.length > 0)}<div><strong>Connected systems</strong><span>${operationalPlatforms.length}/${platforms.length} reporting operational</span></div></div>
        <div class="soc-status-item">${statusDot(activeLockdowns.length === 0, activeLockdowns.length > 0)}<div><strong>Head Office lockdown</strong><span>${activeLockdowns.length ? `${activeLockdowns.length} active critical lockdown` : 'No active lockdowns'}</span></div></div>
        <div class="soc-status-item">${statusDot(Boolean(notifications.configured))}<div><strong>Resend customer notices</strong><span>${notifications.configured ? `${count(notifications.counts?.sent)} welcome messages sent` : 'Configuration required'}</span></div></div>
        <div class="soc-status-item">${statusDot(stripeConfigured, Number(stripe.counts?.failed_events || 0) > 0)}<div><strong>Stripe intelligence</strong><span>${stripeConfigured ? `${count(stripe.counts?.failed_events)} failed webhook events` : 'API or webhook secret missing'}</span></div></div>
      </section>

      <section class="soc-metric-grid" aria-label="Security operations metrics">
        <article class="soc-metric ${criticalMarkers ? 'critical' : ''}"><span>Critical markers</span><strong>${count(criticalMarkers)}</strong><small>Immediate Head Office attention</small></article>
        <article class="soc-metric"><span>Active markers</span><strong>${count(security.metrics?.active_markers)}</strong><small>Coded customer security records</small></article>
        <article class="soc-metric"><span>Restrictions</span><strong>${count(security.metrics?.active_restrictions)}</strong><small>Enforced customer controls</small></article>
        <article class="soc-metric ${activeLockdowns.length ? 'critical' : ''}"><span>Site lockdowns</span><strong>${count(activeLockdowns.length)}</strong><small>Manual critical controls only</small></article>
        <article class="soc-metric"><span>Stripe records</span><strong>${count(Number(stripe.counts?.payments || 0) + Number(stripe.counts?.orders || 0))}</strong><small>Payments and checkout orders</small></article>
        <article class="soc-metric"><span>Overdue reviews</span><strong>${count(security.metrics?.overdue_reviews)}</strong><small>Marker reviews requiring action</small></article>
      </section>

      <div class="soc-grid">
        <div class="soc-stack">
          <section class="soc-panel">
            <header class="soc-panel-header"><div><h2>Live customer security markers</h2><p>Real marker codes delivered to connected-site customer CRMs without confidential Head Office reasoning.</p></div><button class="button secondary small" data-route="security">Open full security register</button></header>
            <div class="soc-scroll"><table class="soc-compact-table"><thead><tr><th>Customer</th><th>Marker code</th><th>CRM label</th><th>Risk</th><th>Status</th><th>Visibility</th><th>Review</th></tr></thead><tbody>${markerRows(security.markers)}</tbody></table></div>
          </section>
          <section class="soc-panel">
            <header class="soc-panel-header"><div><h2>Connected website estate</h2><p>Operational status reported by each customer-facing system.</p></div><button class="button secondary small" data-route="platforms">Manage systems</button></header>
            <div class="soc-scroll"><table class="soc-compact-table"><thead><tr><th>System</th><th>Health</th><th>Customers</th><th>Sessions</th><th>Errors</th><th>Last contact</th></tr></thead><tbody>${platformRows(platforms)}</tbody></table></div>
          </section>
        </div>

        <div class="soc-stack">
          <section class="soc-panel">
            <header class="soc-panel-header"><div><h2>Critical website lockdown control</h2><p>Never automated. Head Office must act after a critical breach notification.</p></div>${hasPermission('security:write') ? '<button class="button danger small" data-soc-action="new-lockdown">New lockdown</button>' : ''}</header>
            <div>${lockdownRows(lockdowns)}</div>
          </section>
          <section class="soc-panel">
            <header class="soc-panel-header"><div><h2>Identity and integration readiness</h2><p>Configuration state only; secrets are never displayed.</p></div></header>
            <div class="soc-panel-body soc-config-list">
              <div class="soc-config-item"><div><strong>JA Group Services ID</strong><span>Automatic 10-digit UCN allocation from Entra External ID synchronisation</span></div>${tag('operational')}</div>
              <div class="soc-config-item"><div><strong>Resend welcome notification</strong><span>Sends the UCN after a new tenant identity is recognised</span></div>${configLabel(notifications.configured)}</div>
              <div class="soc-config-item"><div><strong>Stripe API</strong><span>Secret-key connection for governed account checks and reconciliation</span></div>${configLabel(stripe.configuration?.apiKeyConfigured)}</div>
              <div class="soc-config-item"><div><strong>Stripe webhook</strong><span>${escapeHtml(stripe.webhookEndpoint || '/api/webhooks/stripe')}</span></div>${configLabel(stripe.configuration?.webhookSecretConfigured)}</div>
            </div>
          </section>
        </div>
      </div>
    </div>`;
  }

  function stripePaymentRows(rows) {
    if (!rows?.length) return '<tr><td colspan="7"><div class="soc-empty">No Stripe payment records received yet.</div></td></tr>';
    return rows.map(row => `<tr><td>${formatDate(row.occurred_at)}</td><td><strong>${escapeHtml(row.customer_name || row.receipt_email || 'Unlinked')}</strong><br><span class="soc-code">${escapeHtml(row.customer_number || 'No UCN')}</span></td><td><span class="soc-code">${escapeHtml(row.stripe_object_id)}</span></td><td>${escapeHtml(label(row.object_type))}</td><td>${row.amount_minor == null ? '—' : formatMoney(row.amount_minor, row.currency)}</td><td>${tag(row.status || 'unknown')}</td><td>${escapeHtml(row.platform_code || 'Unassigned')}</td></tr>`).join('');
  }

  function stripeOrderRows(rows) {
    if (!rows?.length) return '<tr><td colspan="7"><div class="soc-empty">No Stripe checkout orders received yet.</div></td></tr>';
    return rows.map(row => `<tr><td>${formatDate(row.occurred_at)}</td><td><strong>${escapeHtml(row.customer_name || row.customer_email || 'Unlinked')}</strong><br><span class="soc-code">${escapeHtml(row.customer_number || 'No UCN')}</span></td><td><span class="soc-code">${escapeHtml(row.stripe_object_id)}</span></td><td>${row.amount_total_minor == null ? '—' : formatMoney(row.amount_total_minor, row.currency)}</td><td>${tag(row.status || 'unknown')}</td><td>${tag(row.payment_status || 'unknown')}</td><td>${escapeHtml(row.platform_code || 'Unassigned')}</td></tr>`).join('');
  }

  function stripeSubscriptionRows(rows) {
    if (!rows?.length) return '<tr><td colspan="8"><div class="soc-empty">No Stripe subscriptions received yet.</div></td></tr>';
    return rows.map(row => `<tr><td>${formatDate(row.updated_at)}</td><td><strong>${escapeHtml(row.customer_name || row.customer_email || 'Unlinked')}</strong><br><span class="soc-code">${escapeHtml(row.customer_number || 'No UCN')}</span></td><td><span class="soc-code">${escapeHtml(row.stripe_subscription_id)}</span></td><td>${escapeHtml(row.price_id || '—')}</td><td>${tag(row.status)}</td><td>${formatDate(row.current_period_end, '—')}</td><td>${row.cancel_at_period_end ? 'Yes' : 'No'}</td><td>${escapeHtml(row.platform_code || 'Unassigned')}</td></tr>`).join('');
  }

  function stripeTable(records, tab) {
    if (tab === 'orders') return `<table class="soc-compact-table"><thead><tr><th>Date</th><th>Customer</th><th>Checkout session</th><th>Total</th><th>Status</th><th>Payment</th><th>System</th></tr></thead><tbody>${stripeOrderRows(records.orders)}</tbody></table>`;
    if (tab === 'subscriptions') return `<table class="soc-compact-table"><thead><tr><th>Updated</th><th>Customer</th><th>Subscription</th><th>Price</th><th>Status</th><th>Period ends</th><th>Cancel at end</th><th>System</th></tr></thead><tbody>${stripeSubscriptionRows(records.subscriptions)}</tbody></table>`;
    return `<table class="soc-compact-table"><thead><tr><th>Date</th><th>Customer</th><th>Stripe object</th><th>Type</th><th>Amount</th><th>Status</th><th>System</th></tr></thead><tbody>${stripePaymentRows(records.payments)}</tbody></table>`;
  }

  async function renderStripeControl() {
    $('#currentRouteLabel').textContent = 'Stripe Control & Webhooks';
    document.title = 'Stripe Control & Webhooks · CustomerOps';
    const [status, records] = await Promise.all([
      safeApi('/api/integrations/stripe/status', { configuration: {}, counts: {}, requiredEvents: [], recentEvents: [] }),
      safeApi('/api/integrations/stripe/records', { payments: [], orders: [], subscriptions: [] })
    ]);
    socState.stripe = status;
    socState.stripeRecords = records;
    const tab = socState.stripeTab;
    $('#viewRoot').innerHTML = `<div class="soc-page">
      <section class="soc-command-header"><div><p class="eyebrow">Payments intelligence · Stripe</p><h1>Stripe Control & Webhooks</h1><p>Read payments, checkout orders and subscriptions through a signed webhook intake. The portal stores normalised operational records and continues feeding payment risk events into Head Office security monitoring.</p></div><div class="soc-command-actions"><button class="button secondary" data-soc-action="stripe-test">Test Stripe API</button><button class="button secondary" data-route="payments">Open approvals</button></div></section>
      <section class="soc-status-strip">
        <div class="soc-status-item">${statusDot(status.configuration?.apiKeyConfigured)}<div><strong>Secret API key</strong><span>${status.configuration?.apiKeyConfigured ? `${label(status.configuration.mode)} mode configured` : 'Add STRIPE_SECRET_KEY'}</span></div></div>
        <div class="soc-status-item">${statusDot(status.configuration?.webhookSecretConfigured)}<div><strong>Signing secret</strong><span>${status.configuration?.webhookSecretConfigured ? 'Signature verification active' : 'Add STRIPE_WEBHOOK_SECRET'}</span></div></div>
        <div class="soc-status-item">${statusDot(Number(status.counts?.failed_events || 0) === 0, Number(status.counts?.failed_events || 0) > 0)}<div><strong>Webhook processing</strong><span>${count(status.counts?.failed_events)} failed events</span></div></div>
        <div class="soc-status-item">${statusDot(true)}<div><strong>Webhook endpoint</strong><span>${escapeHtml(status.webhookEndpoint || '/api/webhooks/stripe')}</span></div></div>
      </section>
      <section class="soc-metric-grid">
        <article class="soc-metric"><span>Payments</span><strong>${count(status.counts?.payments)}</strong><small>PaymentIntent, Charge and Invoice objects</small></article>
        <article class="soc-metric"><span>Orders</span><strong>${count(status.counts?.orders)}</strong><small>Completed Checkout Sessions</small></article>
        <article class="soc-metric"><span>Subscriptions</span><strong>${count(status.counts?.subscriptions)}</strong><small>Current subscription records</small></article>
        <article class="soc-metric"><span>Failed events</span><strong>${count(status.counts?.failed_events)}</strong><small>Require operational investigation</small></article>
        <article class="soc-metric"><span>Mode</span><strong style="font-size:16px">${escapeHtml(label(status.configuration?.mode || 'unknown'))}</strong><small>Never mix test and live secrets</small></article>
        <article class="soc-metric"><span>UCN linking</span><strong style="font-size:16px">Metadata</strong><small>Pass metadata.ucn on Stripe objects</small></article>
      </section>
      <div class="soc-grid">
        <section class="soc-panel">
          <header class="soc-panel-header"><div><h2>Stripe operational records</h2><p>Searchable central records linked to the customer's UCN wherever available.</p></div></header>
          <div class="soc-integration-tabs"><button class="${tab === 'payments' ? 'active' : ''}" data-soc-action="stripe-tab" data-tab="payments">Payments</button><button class="${tab === 'orders' ? 'active' : ''}" data-soc-action="stripe-tab" data-tab="orders">Orders</button><button class="${tab === 'subscriptions' ? 'active' : ''}" data-soc-action="stripe-tab" data-tab="subscriptions">Subscriptions</button></div>
          <div class="soc-scroll" id="stripeRecordTable">${stripeTable(records, tab)}</div>
        </section>
        <div class="soc-stack">
          <section class="soc-panel"><header class="soc-panel-header"><div><h2>Connection settings</h2><p>Configure these as encrypted Cloudflare environment secrets.</p></div></header><div class="soc-panel-body soc-config-list">
            <div class="soc-config-item"><div><strong>STRIPE_SECRET_KEY</strong><span>Restricted server-side key. Never place it in public JavaScript.</span></div>${configLabel(status.configuration?.apiKeyConfigured)}</div>
            <div class="soc-config-item"><div><strong>STRIPE_WEBHOOK_SECRET</strong><span>The whsec_ signing secret for this exact endpoint.</span></div>${configLabel(status.configuration?.webhookSecretConfigured)}</div>
            <div class="soc-config-item"><div><strong>STRIPE_PUBLISHABLE_KEY</strong><span>Optional here; customer sites may use their own public checkout configuration.</span></div>${configLabel(status.configuration?.publishableKeyConfigured)}</div>
          </div></section>
          <section class="soc-panel"><header class="soc-panel-header"><div><h2>Required webhook events</h2><p>Select these in Stripe Workbench for the endpoint.</p></div></header><div class="soc-panel-body"><div class="soc-config-list">${(status.requiredEvents || []).map(eventName => `<div class="soc-config-item"><div><strong>${escapeHtml(eventName)}</strong></div><span class="soc-code">EVENT</span></div>`).join('')}</div></div></section>
        </div>
      </div>
    </div>`;
  }

  function openLockdownModal() {
    const options = (socState.platforms || []).filter(platform => platform.status !== 'disabled').map(platform => `<option value="${escapeHtml(platform.id)}" data-code="${escapeHtml(platform.code)}">${escapeHtml(platform.name)} · ${escapeHtml(platform.code)}</option>`).join('');
    modalForm('Initiate critical website security lockdown', 'This is a manual Head Office emergency action. It is not triggered automatically and it does not replace the website’s normal maintenance or launch-gate controls.', {
      form: 'soc-lockdown',
      html: `<div class="notice danger"><span>!</span><div><strong>Critical security breach only</strong><br>Select the affected website, record the incident reference and type the exact confirmation shown after selecting the system.</div></div>
        <div class="form-grid">
          <label class="field"><span>Connected website or service</span><select name="platformId" data-soc-lockdown-platform required><option value="">Select system</option>${options}</select></label>
          <label class="field"><span>Critical incident or breach reference</span><input name="incidentReference" maxlength="120" placeholder="SEC-2026-000001" required></label>
          <label class="field full"><span>Reason and operational instruction</span><textarea name="reason" minlength="20" maxlength="3000" required></textarea></label>
          <label class="field"><span>Review time</span><input name="reviewAt" type="datetime-local"></label>
          <label class="field"><span>Confirmation</span><input name="confirmation" data-soc-lockdown-confirmation autocomplete="off" placeholder="Select a system first" required></label>
        </div>`
    }, 'Initiate lockdown', 'Head Office manual security authority', 'danger');
  }

  function openLiftModal(button) {
    modalForm('Lift website security lockdown', `Release the Head Office security lockdown for ${button.dataset.name}. The website then returns to its own maintenance and launch-gate state.`, {
      form: 'soc-lift-lockdown',
      attributes: `data-id="${escapeHtml(button.dataset.id)}"`,
      html: `<div class="notice"><span>i</span><div><strong>Local site controls are not changed</strong><br>Lifting this control does not launch the website or disable its maintenance gate.</div></div><label class="field"><span>Reason for lifting</span><textarea name="reason" minlength="10" required></textarea></label><label class="field"><span>Confirmation</span><input name="confirmation" autocomplete="off" placeholder="Type LIFT ${escapeHtml(button.dataset.code)}" required></label>`
    }, 'Lift lockdown', 'Head Office manual security authority', 'danger');
  }

  document.addEventListener('change', event => {
    const select = event.target.closest('[data-soc-lockdown-platform]');
    if (!select) return;
    const option = select.selectedOptions[0];
    const input = select.form?.querySelector('[data-soc-lockdown-confirmation]');
    if (input) input.placeholder = option?.dataset.code ? `Type LOCKDOWN ${option.dataset.code}` : 'Select a system first';
  }, true);

  document.addEventListener('click', async event => {
    const element = event.target.closest('[data-soc-action]');
    if (!element) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const action = element.dataset.socAction;
    if (action === 'new-lockdown') return openLockdownModal();
    if (action === 'lift-lockdown') return openLiftModal(element);
    if (action === 'open-stripe') return navigate('stripe-control');
    if (action === 'stripe-tab') {
      socState.stripeTab = element.dataset.tab || 'payments';
      document.querySelectorAll('[data-soc-action="stripe-tab"]').forEach(button => button.classList.toggle('active', button === element));
      const target = document.querySelector('#stripeRecordTable');
      if (target && socState.stripeRecords) target.innerHTML = stripeTable(socState.stripeRecords, socState.stripeTab);
      return;
    }
    if (action === 'stripe-test') {
      element.disabled = true;
      try {
        const result = await api('/api/integrations/stripe/test', { method: 'POST', body: '{}' });
        toast('Stripe API connected', `${result.businessName || result.accountId} · charges ${result.chargesEnabled ? 'enabled' : 'not enabled'}`, 'success');
        return renderStripeControl();
      } catch (error) { toast('Stripe connection failed', error.message, 'error'); }
      finally { element.disabled = false; }
    }
  }, true);

  document.addEventListener('submit', async event => {
    const form = event.target;
    if (!['soc-lockdown','soc-lift-lockdown'].includes(form.dataset.form)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const data = Object.fromEntries(new FormData(form));
    const submit = form.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      if (form.dataset.form === 'soc-lockdown') {
        await api('/api/security/lockdowns', { method: 'POST', body: JSON.stringify(data) });
        closeModal();
        toast('Critical security lockdown active', 'The connected system can now retrieve the Head Office lockdown command.', 'success');
        return renderSecurityOperationsCentre();
      }
      await api(`/api/security/lockdowns/${encodeURIComponent(form.dataset.id)}`, { method: 'POST', body: JSON.stringify(data) });
      closeModal();
      toast('Security lockdown lifted', 'The system will return to its own local maintenance and launch-gate state.', 'success');
      return renderSecurityOperationsCentre();
    } catch (error) {
      toast('Controlled action failed', error.message, 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  }, true);

  const previousRenderRoute = renderRoute;
  renderRoute = async function renderSocRoute(route = routeFromHash()) {
    if (route === 'security-operations') {
      state.route = route;
      document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
      document.querySelector('#sidebar')?.classList.remove('open');
      setLoading('Opening the Security Operations Centre…');
      return renderSecurityOperationsCentre();
    }
    if (route === 'stripe-control') {
      state.route = route;
      document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
      document.querySelector('#sidebar')?.classList.remove('open');
      setLoading('Opening Stripe control and webhook intelligence…');
      return renderStripeControl();
    }
    return previousRenderRoute(route);
  };

  loadSocStyle();
  ensureSocNavigation();
  window.ensureSecurityOperationsNavigation = ensureSocNavigation;
  window.renderSecurityOperationsCentre = renderSecurityOperationsCentre;
  window.renderStripeControl = renderStripeControl;
})();
