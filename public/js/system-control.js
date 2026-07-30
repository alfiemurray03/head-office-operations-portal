/* Governed System Test Centre and whole-portal Settings workspace. */
(() => {
  const previousRenderRoute = renderRoute;
  const previousHandleClick = handleClick;
  const previousHandleForm = handleForm;

  const parseSettings = rows => Object.fromEntries((rows || []).map(row => {
    try { return [row.setting_key, JSON.parse(row.value_json)]; }
    catch { return [row.setting_key, row.value_json]; }
  }));

  const checked = value => value === true ? 'checked' : '';
  const disabled = editable => editable ? '' : 'disabled';

  function setRouteChrome(labelText) {
    const target = document.querySelector('#currentRouteLabel');
    if (target) target.textContent = labelText;
    document.title = `${labelText} · Head Office Operations & Security Centre`;
  }

  function toggleSetting(key, title, copy, value, editable) {
    return `<div class="system-toggle-row"><div class="system-toggle-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></div><label class="system-switch"><input type="checkbox" data-setting-key="${escapeHtml(key)}" ${checked(value)} ${disabled(editable)}><span aria-hidden="true"></span></label></div>`;
  }

  function numberSetting(key, title, copy, value, minimum, maximum, editable) {
    return `<label class="field"><span>${escapeHtml(title)}</span><input type="number" data-setting-key="${escapeHtml(key)}" value="${Number(value)}" min="${minimum}" max="${maximum}" ${disabled(editable)}><small>${escapeHtml(copy)}</small></label>`;
  }

  function selectSetting(key, title, copy, value, options, editable) {
    return `<label class="field"><span>${escapeHtml(title)}</span><select data-setting-key="${escapeHtml(key)}" ${disabled(editable)}>${options.map(option => `<option value="${escapeHtml(option.value)}" ${value === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select><small>${escapeHtml(copy)}</small></label>`;
  }

  function policyItem(icon, title, copy) {
    return `<div class="system-policy-item"><span class="system-policy-icon" aria-hidden="true">${escapeHtml(icon)}</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></div></div>`;
  }

  function changeValue(value) {
    if (value == null) return 'Not recorded';
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'boolean') return parsed ? 'Enabled' : 'Disabled';
      return String(parsed);
    } catch { return String(value); }
  }

  renderSettings = async function renderWholeSystemSettings() {
    const data = await api('/api/configuration');
    const values = parseSettings(data.settings);
    const editable = hasPermission('configuration:write');
    const mode = values['system.portal_mode'] || 'normal';
    const changes = (data.changes || []).slice(0, 20);
    const ageMasterEnabled = values['age_assurance.enforcement_master_enabled'] === true;
    const deploymentOptions = [
      { value: 'disabled', label: 'Disabled — no age requirement' },
      { value: 'paused', label: 'Paused — keep requirement, stop new sessions' },
      { value: 'enabled', label: 'Enabled — enforce customer threshold' }
    ];

    $('#viewRoot').innerHTML = `<div class="system-control-page">
      <div class="page-heading"><div><p class="eyebrow">Head Office system authority</p><h1>System Settings</h1><p>Control the complete Head Office portal, its integrations, scheduled reconciliation, notifications and operational defaults from one governed workspace.</p></div><div class="heading-actions"><button class="button secondary" data-route="test-centre">Open System Test Centre</button></div></div>

      <div class="system-mode-banner" data-mode="${escapeHtml(mode)}"><div><strong>Current operating mode: ${escapeHtml(label(mode))}</strong><p>${mode === 'normal' ? 'Normal authorised operations are available.' : mode === 'read_only' ? 'Normal records can be viewed, but ordinary changes are blocked.' : 'Only diagnostics, configuration and emergency security actions remain available.'}</p></div>${tag(mode === 'normal' ? 'operational' : mode)}</div>

      <form data-form="system-settings">
        <div class="system-control-grid">
          <section class="system-setting-section"><header><div><h2>Portal control</h2><p>Company-wide Head Office operating state and diagnostic authority.</p></div></header><div class="system-setting-body">
            <label class="field"><span>Portal operating mode</span><select data-setting-key="system.portal_mode" ${disabled(editable)}><option value="normal" ${mode === 'normal' ? 'selected' : ''}>Normal operations</option><option value="read_only" ${mode === 'read_only' ? 'selected' : ''}>Read-only mode</option><option value="maintenance" ${mode === 'maintenance' ? 'selected' : ''}>Maintenance mode</option></select><small>Emergency incident, diagnostics, configuration and manual critical-lockdown actions remain available.</small></label>
            ${toggleSetting('system.test_centre_enabled', 'System Test Centre', 'Allow authorised administrators to run retained service diagnostics.', values['system.test_centre_enabled'] !== false, editable)}
            ${toggleSetting('system.external_test_actions_enabled', 'Controlled external tests', 'Allow explicitly confirmed tests that send an email or create an external provider action.', values['system.external_test_actions_enabled'] === true, editable)}
          </div></section>

          <section class="system-setting-section"><header><div><h2>Microsoft directories</h2><p>Control synchronisation without changing either Entra application.</p></div></header><div class="system-setting-body">
            ${toggleSetting('integrations.customer_directory_enabled', 'JA Group Services ID', 'Customer Entra External ID connection and manual synchronisation.', values['integrations.customer_directory_enabled'] !== false, editable)}
            ${toggleSetting('automation.customer_directory_enabled', 'Automatic customer reconciliation', 'Allow the scheduled Worker to continue customer directory delta sync.', values['automation.customer_directory_enabled'] !== false, editable)}
            ${toggleSetting('integrations.staff_directory_enabled', 'Staff tenant directory', 'JA Group Services Microsoft tenant connection and manual synchronisation.', values['integrations.staff_directory_enabled'] !== false, editable)}
            ${toggleSetting('automation.staff_directory_enabled', 'Automatic staff reconciliation', 'Allow the scheduled Worker to continue staff tenant delta sync.', values['automation.staff_directory_enabled'] !== false, editable)}
          </div></section>

          <section class="system-setting-section"><header><div><h2>Payments and verification</h2><p>Separate service controls for each provider and division.</p></div></header><div class="system-setting-body">
            ${toggleSetting('integrations.stripe_planyx_enabled', 'Planyx Stripe', 'API, reconciliation and webhook operations for the Planyx Stripe account.', values['integrations.stripe_planyx_enabled'] !== false, editable)}
            ${toggleSetting('integrations.stripe_profile_centre_enabled', 'Profile Centre Stripe', 'API, reconciliation and webhook operations for the Profile Centre Stripe account.', values['integrations.stripe_profile_centre_enabled'] !== false, editable)}
            ${toggleSetting('automation.stripe_reconciliation_enabled', 'Automatic Stripe reconciliation', 'Allow the scheduled Worker to reconcile whichever Stripe divisions are enabled.', values['automation.stripe_reconciliation_enabled'] !== false, editable)}
            ${toggleSetting('integrations.didit_enabled', 'Didit verification requests', 'Allow Head Office to create new customer identity-verification sessions.', values['integrations.didit_enabled'] !== false, editable)}
          </div></section>

          <section class="system-setting-section"><header><div><h2>Communications and connected systems</h2><p>Customer messaging and system-to-system operations.</p></div></header><div class="system-setting-body">
            ${toggleSetting('integrations.resend_enabled', 'Resend email provider', 'Allow the portal to use the configured Resend account.', values['integrations.resend_enabled'] !== false, editable)}
            ${toggleSetting('notifications.customer_welcome_enabled', 'UCN welcome emails', 'Send a welcome email when a customer is first recognised in JA Group Services ID.', values['notifications.customer_welcome_enabled'] !== false, editable)}
            ${toggleSetting('notifications.critical_case_alerts', 'Critical case alerts', 'Enable governed notifications for critical operational cases.', values['notifications.critical_case_alerts'] === true, editable)}
            ${toggleSetting('notifications.system_test_failure_alerts', 'Failed test attention', 'Retain failed service tests as items requiring technical review.', values['notifications.system_test_failure_alerts'] !== false, editable)}
            ${toggleSetting('integrations.connected_systems_enabled', 'Connected websites and services', 'Allow approved platforms to exchange operational data with Head Office.', values['integrations.connected_systems_enabled'] !== false, editable)}
          </div></section>
        </div>

        <section class="system-setting-section" style="margin-top:16px"><header><div><h2>Customer Age Assurance Deployments</h2><p>Deploy Didit age assurance centrally to connected customer services. These controls never apply to staff accounts or Microsoft staff sign-in.</p></div>${tag(ageMasterEnabled ? 'enabled' : 'not enforcing')}</header><div class="system-setting-body">
          <div class="notice"><span>🔒</span><div><strong>Enforcement is off by default</strong><br>The master switch and a platform deployment must both be enabled before any customer access decision changes. Staff Directory profiles, staff numbers and staff Microsoft accounts are permanently excluded.</div></div>
          ${toggleSetting('age_assurance.enforcement_master_enabled', 'Start group age-assurance enforcement', 'Master customer-only switch. Leave this off while configuring and testing the deployments.', ageMasterEnabled, editable)}
          <div class="system-control-grid">
            <div class="system-setting-section"><header><div><h3>Planyx</h3><p>Customer platform threshold: 16+</p></div></header><div class="system-setting-body">
              ${selectSetting('age_assurance.planyx_status', 'Deployment state', 'Enable, pause or disable the Planyx customer deployment independently.', values['age_assurance.planyx_status'] || 'disabled', deploymentOptions, editable)}
              ${numberSetting('age_assurance.planyx_minimum_age', 'Minimum customer age', 'Configured as 16+ for Planyx.', Number(values['age_assurance.planyx_minimum_age'] || 16), 13, 25, editable)}
              ${toggleSetting('age_assurance.planyx_threshold_validated', '16+ workflow threshold validated', 'Mark only after the Didit Age Gate workflow has been tested and confirmed to enforce the 16+ threshold correctly.', values['age_assurance.planyx_threshold_validated'] === true, editable)}
            </div></div>
            <div class="system-setting-section"><header><div><h3>Profile Centre</h3><p>Customer platform threshold: 18+</p></div></header><div class="system-setting-body">
              ${selectSetting('age_assurance.profile_centre_status', 'Deployment state', 'Enable, pause or disable the Profile Centre customer deployment independently.', values['age_assurance.profile_centre_status'] || 'disabled', deploymentOptions, editable)}
              ${numberSetting('age_assurance.profile_centre_minimum_age', 'Minimum customer age', 'Configured as 18+ for Profile Centre.', Number(values['age_assurance.profile_centre_minimum_age'] || 18), 13, 25, editable)}
              ${toggleSetting('age_assurance.profile_centre_threshold_validated', '18+ workflow threshold validated', 'Mark only after the Didit Age Gate workflow has been tested and confirmed to enforce the 18+ threshold correctly.', values['age_assurance.profile_centre_threshold_validated'] === true, editable)}
            </div></div>
          </div>
          <div class="system-field-grid">${numberSetting('age_assurance.result_validity_days', 'Age-assurance validity', 'Days an approved customer threshold result remains reusable across eligible services.', Number(values['age_assurance.result_validity_days'] || 365), 30, 1095, editable)}</div>
        </div></section>

        <section class="system-setting-section" style="margin-top:16px"><header><div><h2>Operational limits and defaults</h2><p>Validated values used by case, security, approval and diagnostic processes.</p></div></header><div class="system-setting-body"><div class="system-field-grid">
          ${numberSetting('operations.default_case_due_hours', 'Default normal-case due time', 'Hours before a normal-priority case becomes due.', Number(values['operations.default_case_due_hours'] || 72), 1, 720, editable)}
          ${numberSetting('security.default_marker_review_days', 'Default marker review interval', 'Days until a security marker normally requires review.', Number(values['security.default_marker_review_days'] || 14), 1, 365, editable)}
          ${numberSetting('security.session_hours', 'Maximum staff session', 'Maximum authenticated staff session duration in hours.', Number(values['security.session_hours'] || 8), 1, 24, editable)}
          ${numberSetting('security.failed_login_threshold', 'Failed sign-in threshold', 'Failed staff sign-in attempts before escalation.', Number(values['security.failed_login_threshold'] || 5), 3, 20, editable)}
          ${numberSetting('payments.refund_approval_threshold_minor', 'Refund approval threshold (pence)', 'Refund value requiring Head Office approval, stored in minor GBP units.', Number(values['payments.refund_approval_threshold_minor'] || 5000), 0, 10000000, editable)}
          ${numberSetting('tests.result_retention_days', 'Test evidence retention', 'Days before old System Test Centre results are removed.', Number(values['tests.result_retention_days'] || 90), 7, 365, editable)}
          ${numberSetting('tests.timeout_seconds', 'Provider test timeout', 'Maximum seconds a safe external provider check may wait.', Number(values['tests.timeout_seconds'] || 12), 5, 30, editable)}
          <label class="field"><span>Case reference prefix</span><input data-setting-key="operations.case_reference_prefix" value="${escapeHtml(values['operations.case_reference_prefix'] || 'HOC')}" maxlength="8" pattern="[A-Z0-9]{2,8}" ${disabled(editable)}><small>Two to eight uppercase letters or numbers.</small></label>
        </div></div></section>

        ${editable ? '<p class="form-status" data-form-status></p><div class="form-actions"><button type="submit" class="button primary">Save complete system configuration</button></div>' : '<p class="help-text">You have read-only access to System Settings.</p>'}
      </form>

      <div class="system-control-grid">
        <section class="system-setting-section"><header><div><h2>Fixed safety policies</h2><p>These controls cannot be disabled from a settings screen.</p></div></header><div class="system-setting-body system-policy-list">
          ${policyItem('!', 'Critical security lockdown is manual only', 'The system may surface a Critical Security Breach notification, but an authorised Head Office user must initiate or lift a lockdown.')}
          ${policyItem('↔', 'Staff and customer records never merge', 'A matching email is allowed in both directories. Staff numbers and UCNs remain separate identities.')}
          ${policyItem('👤', 'Staff accounts are excluded from age assurance', 'Age assurance reads only the Unique Customer Register. It never checks, blocks or changes Staff Directory profiles or Microsoft staff sign-in.')}
          ${policyItem('⌂', 'Website maintenance remains local', 'Normal maintenance and launch gates remain controlled by each connected website. Head Office security lockdown is separate.')}
          ${policyItem('✉', 'Didit invitations go to the customer', 'Every new verification request instructs Didit to send the secure invitation directly to the customer automatically.')}
        </div></section>
        <section class="system-setting-section"><header><div><h2>Recent configuration changes</h2><p>Latest retained changes from the governed configuration ledger.</p></div></header><div class="system-setting-body system-change-list">${changes.length ? changes.map(item => `<div class="system-change-row"><strong>${escapeHtml(item.setting_key)}</strong><span>${escapeHtml(changeValue(item.before_json))} → ${escapeHtml(changeValue(item.after_json))}</span><time>${escapeHtml(formatDate(item.changed_at))}</time></div>`).join('') : '<p class="help-text">No configuration changes are recorded yet.</p>'}</div></section>
      </div>
    </div>`;
    setRouteChrome('System Settings');
  };

  function latestStatus(service) {
    const latest = service.latest;
    return latest?.status || 'not-run';
  }

  function resultLabel(service) {
    const latest = service.latest;
    if (!latest) return '<strong>Not tested yet</strong><span>Run a safe test to establish the current service state.</span>';
    return `<strong>${escapeHtml(label(latest.status))}</strong><span>${escapeHtml(latest.summary || 'No summary recorded.')}</span>`;
  }

  async function renderSystemTestCentre() {
    const data = await api('/api/system-tests');
    const services = data.services || [];
    const counts = services.reduce((total, service) => {
      const status = latestStatus(service);
      total[status] = Number(total[status] || 0) + 1;
      return total;
    }, {});
    const canRun = hasPermission('configuration:write') && data.settings.testCentreEnabled;
    const recentRows = (data.recentRuns || []).slice(0, 30);

    $('#viewRoot').innerHTML = `<div class="system-control-page">
      <div class="page-heading"><div><p class="eyebrow">Controlled diagnostics</p><h1>System Test Centre</h1><p>Run retained, non-destructive checks against every core Head Office service. Safe tests never create customers, refunds, verification sessions or security controls.</p></div><div class="heading-actions"><button class="button secondary" data-route="settings">System Settings</button>${canRun ? '<button class="button primary" data-action="run-all-system-tests">Run all safe tests</button>' : ''}</div></div>
      <div class="system-mode-banner" data-mode="${escapeHtml(data.settings.portalMode)}"><div><strong>Diagnostic policy</strong><p>Portal mode: ${escapeHtml(label(data.settings.portalMode))} · Controlled external tests: ${data.settings.externalTestsEnabled ? 'enabled' : 'disabled'}.</p></div>${data.settings.testCentreEnabled ? tag('operational') : tag('disabled')}</div>
      <div class="metrics">
        <article class="metric-card"><span>Registered services</span><strong>${services.length}</strong><small>Core, Microsoft, payment, identity and automation checks</small></article>
        <article class="metric-card"><span>Passed</span><strong>${Number(counts.passed || 0)}</strong><small>Latest retained result passed</small></article>
        <article class="metric-card"><span>Warnings</span><strong>${Number(counts.warning || 0)}</strong><small>Connected but attention may be required</small></article>
        <article class="metric-card"><span>Failed</span><strong>${Number(counts.failed || 0)}</strong><small>Latest retained result failed</small></article>
      </div>
      <section class="service-test-grid">${services.map(service => {
        const status = latestStatus(service);
        const latest = service.latest;
        const controlled = service.code === 'resend' && data.settings.externalTestsEnabled && canRun;
        return `<article class="service-test-card" data-status="${escapeHtml(status)}"><div class="service-test-heading"><div><h3>${escapeHtml(service.label)}</h3><span class="service-test-category">${escapeHtml(service.category)}</span></div>${service.enabled ? tag('enabled') : tag('disabled')}</div><p class="service-test-description">${escapeHtml(service.description)}</p><div class="service-test-result">${resultLabel(service)}</div><div class="service-test-actions">${canRun ? `<button class="button secondary small" data-action="run-system-test" data-service="${escapeHtml(service.code)}">Run safe test</button>${controlled ? `<button class="button secondary small" data-action="controlled-resend-test">Send test email</button>` : ''}` : ''}<span class="service-test-meta">${latest ? `${escapeHtml(formatDate(latest.started_at))}<br>${Number(latest.duration_ms || 0)} ms` : 'No result'}</span></div></article>`;
      }).join('')}</section>
      <section class="panel"><div class="panel-header"><div><h2>Recent diagnostic evidence</h2><p>Latest retained safe and controlled service-test results.</p></div><button class="button secondary small" data-action="refresh-system-tests">Refresh</button></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Completed</th><th>Service</th><th>Mode</th><th>Result</th><th>Summary</th><th>Duration</th></tr></thead><tbody>${recentRows.length ? recentRows.map(run => `<tr><td>${escapeHtml(formatDate(run.completed_at))}</td><td><strong>${escapeHtml(run.service_label)}</strong><br><small class="mono">${escapeHtml(run.service_code)}</small></td><td>${tag(run.test_mode)}</td><td>${tag(run.status)}</td><td>${escapeHtml(run.summary)}</td><td>${Number(run.duration_ms || 0)} ms</td></tr>`).join('') : `<tr><td colspan="6">${emptyState('No service tests recorded', 'Run all safe tests to create the first retained diagnostic snapshot.')}</td></tr>`}</tbody></table></div></section>
    </div>`;
    setRouteChrome('System Test Centre');
  }

  function controlledResendModal() {
    openModal('Send controlled test email', 'This creates a real email through Resend and sends it only to the signed-in staff account.', `<form data-form="controlled-resend-test"><div class="notice"><span>✉</span><div><strong>External provider action</strong><br>No customer will be contacted. The test email is sent to your authenticated staff email address and retained in the System Test Centre evidence.</div></div><label class="field"><span>Confirmation</span><input name="confirmation" autocomplete="off" placeholder="SEND TEST EMAIL" required><small>Enter SEND TEST EMAIL exactly.</small></label><p class="form-error"></p><div class="form-actions"><button type="button" class="button secondary" data-close-modal>Cancel</button><button type="submit" class="button primary">Send controlled test</button></div></form>`, 'System Test Centre');
  }

  async function runTests(serviceCode = 'all', mode = 'safe', confirmation = '') {
    const labelText = serviceCode === 'all' ? 'all safe services' : serviceCode.replaceAll('_', ' ');
    toast('System test started', `Checking ${labelText}…`);
    const result = await api('/api/system-tests', { method: 'POST', body: JSON.stringify({ serviceCode, mode, confirmation }) });
    const failed = Number(result.counts?.failed || 0);
    const warnings = Number(result.counts?.warning || 0);
    toast(failed ? 'System tests completed with failures' : warnings ? 'System tests completed with warnings' : 'System tests passed', `${Number(result.counts?.passed || 0)} passed · ${warnings} warnings · ${failed} failed`, failed ? 'error' : 'success');
    return renderSystemTestCentre();
  }

  renderRoute = async function renderSystemControlRoute(route = routeFromHash()) {
    if (route === 'test-centre') {
      state.route = route;
      document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
      document.querySelector('#sidebar')?.classList.remove('open');
      setLoading('Opening the System Test Centre…');
      try { return await renderSystemTestCentre(); }
      catch (error) {
        $('#viewRoot').innerHTML = `<div class="panel"><div class="empty-state"><strong>The System Test Centre could not be opened</strong><span>${escapeHtml(error.message || 'The diagnostic service is temporarily unavailable.')}</span></div></div>`;
        toast('System Test Centre unavailable', error.message || 'The service could not be opened.', 'error');
        return;
      }
    }
    const result = await previousRenderRoute(route);
    if (route === 'settings') setRouteChrome('System Settings');
    return result;
  };

  handleClick = async function handleSystemControlClick(target) {
    const element = target.closest?.('[data-action]');
    const action = element?.dataset.action;
    if (action === 'run-all-system-tests') return runTests('all');
    if (action === 'run-system-test') return runTests(element.dataset.service || '');
    if (action === 'controlled-resend-test') return controlledResendModal();
    if (action === 'refresh-system-tests') return renderSystemTestCentre();
    return previousHandleClick(target);
  };

  handleForm = async function handleSystemControlForm(form) {
    const formName = form.dataset.form;
    if (formName === 'system-settings') {
      const submit = form.querySelector('button[type="submit"]');
      const status = form.querySelector('[data-form-status]');
      if (submit) submit.disabled = true;
      if (status) status.textContent = 'Validating and saving the complete system configuration…';
      try {
        const settings = {};
        form.querySelectorAll('[data-setting-key]').forEach(control => {
          const key = control.dataset.settingKey;
          settings[key] = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value;
        });
        await api('/api/configuration', { method: 'PUT', body: JSON.stringify({ settings }) });
        if (status) status.textContent = 'System configuration saved and recorded in the audit history.';
        toast('System Settings saved', settings['age_assurance.enforcement_master_enabled'] === true
          ? 'The governed controls were saved. Active age-assurance deployments now affect customer access decisions only.'
          : 'The governed controls were saved. Customer age-assurance enforcement remains off.');
        state.reference = await api('/api/reference');
        return renderSettings();
      } catch (error) {
        if (status) status.textContent = error.message;
        toast('System Settings were not saved', error.message, 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
      return;
    }
    if (formName === 'controlled-resend-test') {
      const submit = form.querySelector('button[type="submit"]');
      const errorElement = form.querySelector('.form-error');
      if (submit) submit.disabled = true;
      try {
        const confirmation = new FormData(form).get('confirmation');
        closeModal();
        return await runTests('resend', 'controlled', confirmation);
      } catch (error) {
        if (errorElement) errorElement.textContent = error.message;
        else toast('Controlled test failed', error.message, 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
      return;
    }
    return previousHandleForm(form);
  };
})();
