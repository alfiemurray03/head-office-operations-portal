/* Governed Automation and Scheduling Centre. */
(() => {
  const previousRenderRoute = renderRoute;
  const previousHandleClick = handleClick;
  const previousHandleForm = handleForm;
  let snapshot = null;

  const scheduleById = id => snapshot?.schedules?.find(schedule => schedule.id === id) || null;
  const jobByCode = code => snapshot?.jobs?.find(job => job.code === code) || null;

  function setRouteChrome() {
    const target = document.querySelector('#currentRouteLabel');
    if (target) target.textContent = 'Automation & Scheduling Centre';
    document.title = 'Automation & Scheduling Centre · Head Office Operations & Security Centre';
  }

  function localDateTimeValue(value) {
    const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000);
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function scheduleDescription(schedule) {
    const definition = schedule.schedule || {};
    if (schedule.schedule_kind === 'once') return `Once · ${formatDate(definition.runAt || schedule.next_run_at)}`;
    if (schedule.schedule_kind === 'interval') {
      const minutes = Number(definition.intervalMinutes || 0);
      if (minutes % 1440 === 0) return `Every ${minutes / 1440} day${minutes === 1440 ? '' : 's'}`;
      if (minutes % 60 === 0) return `Every ${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
      return `Every ${minutes} minutes`;
    }
    if (schedule.schedule_kind === 'daily') return `Daily at ${definition.time || '—'}`;
    if (schedule.schedule_kind === 'weekly') {
      const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const days = (definition.weekdays || []).map(day => names[Number(day)]).filter(Boolean).join(', ');
      return `${days || 'Weekly'} at ${definition.time || '—'}`;
    }
    if (schedule.schedule_kind === 'monthly') return `Monthly on day ${definition.dayOfMonth || '—'} at ${definition.time || '—'}`;
    return label(schedule.schedule_kind);
  }

  function nextRunCopy(schedule) {
    if (schedule.status === 'paused') return '<strong>Paused</strong><span>No run will start until resumed.</span>';
    if (schedule.status === 'disabled') return '<strong>Disabled</strong><span>This schedule cannot run.</span>';
    if (schedule.status === 'completed') return '<strong>Completed</strong><span>The one-off schedule has finished.</span>';
    return `<strong>${schedule.next_run_at ? escapeHtml(formatDate(schedule.next_run_at)) : 'Not scheduled'}</strong><span>${escapeHtml(schedule.timezone || 'Europe/London')}</span>`;
  }

  function scheduleActions(schedule, editable) {
    if (!editable) return '<span class="help-text">Read only</span>';
    const statusAction = schedule.status === 'enabled'
      ? '<button class="button secondary small" data-action="pause-automation" data-id="' + escapeHtml(schedule.id) + '">Pause</button>'
      : schedule.status === 'paused' || schedule.status === 'disabled'
        ? '<button class="button secondary small" data-action="enable-automation" data-id="' + escapeHtml(schedule.id) + '">Enable</button>'
        : '';
    return `<div class="automation-row-actions">
      <button class="button secondary small" data-action="test-automation" data-id="${escapeHtml(schedule.id)}">Test</button>
      <button class="button secondary small" data-action="run-automation" data-id="${escapeHtml(schedule.id)}">Run now</button>
      <button class="button secondary small" data-action="edit-automation" data-id="${escapeHtml(schedule.id)}">Edit</button>
      ${statusAction}
      <button class="button danger small" data-action="delete-automation" data-id="${escapeHtml(schedule.id)}">Delete</button>
    </div>`;
  }

  function metrics(schedules) {
    const enabled = schedules.filter(schedule => schedule.status === 'enabled').length;
    const paused = schedules.filter(schedule => schedule.status === 'paused').length;
    const failed = schedules.filter(schedule => schedule.last_run_status === 'failed').length;
    const dueSoon = schedules.filter(schedule => schedule.status === 'enabled' && schedule.next_run_at && Date.parse(schedule.next_run_at) <= Date.now() + 60 * 60 * 1000).length;
    return { enabled, paused, failed, dueSoon };
  }

  async function renderAutomationCentre() {
    snapshot = await api('/api/automation-schedules');
    const schedules = snapshot.schedules || [];
    const runs = (snapshot.recentRuns || []).slice(0, 50);
    const editable = hasPermission('configuration:write');
    const counts = metrics(schedules);

    $('#viewRoot').innerHTML = `<div class="automation-centre-page">
      <div class="page-heading"><div><p class="eyebrow">Governed Head Office automation</p><h1>Automation &amp; Scheduling Centre</h1><p>Create, test and supervise approved one-off and recurring jobs. Every run is retained as operational evidence, while critical lockdowns and arbitrary scripts remain manual and prohibited.</p></div><div class="heading-actions"><button class="button secondary" data-route="test-centre">System Test Centre</button><button class="button secondary" data-route="settings">System Settings</button>${editable ? '<button class="button primary" data-action="new-automation">Create schedule</button>' : ''}</div></div>

      <div class="automation-policy-banner" data-enabled="${snapshot.settings.schedulerEnabled ? 'true' : 'false'}"><div><strong>${snapshot.settings.schedulerEnabled ? 'Scheduler operational' : 'Scheduler paused globally'}</strong><p>One-minute scheduler cycle · Default time zone ${escapeHtml(snapshot.settings.defaultTimezone)} · Maximum ${Number(snapshot.settings.maxJobsPerTick || 3)} due jobs per cycle.</p></div>${snapshot.settings.schedulerEnabled ? tag('operational') : tag('disabled')}</div>

      <div class="metrics">
        <article class="metric-card"><span>Enabled schedules</span><strong>${counts.enabled}</strong><small>Eligible for automatic execution</small></article>
        <article class="metric-card"><span>Due within one hour</span><strong>${counts.dueSoon}</strong><small>Upcoming governed jobs</small></article>
        <article class="metric-card"><span>Paused</span><strong>${counts.paused}</strong><small>Retained but not running</small></article>
        <article class="metric-card"><span>Latest failures</span><strong>${counts.failed}</strong><small>Schedules requiring review</small></article>
      </div>

      <section class="panel automation-schedule-panel"><div class="panel-header"><div><h2>Schedules</h2><p>Approved automation only. Each schedule uses a registered Head Office job rather than arbitrary code or external URLs.</p></div><button class="button secondary small" data-action="refresh-automation">Refresh</button></div>
        <div class="automation-schedule-list">${schedules.length ? schedules.map(schedule => {
          const job = jobByCode(schedule.job_code);
          return `<article class="automation-schedule-row" data-status="${escapeHtml(schedule.status)}">
            <div class="automation-schedule-identity"><div class="automation-job-icon" aria-hidden="true">↻</div><div><strong>${escapeHtml(schedule.name)}</strong><span>${escapeHtml(schedule.description || job?.description || 'Governed Head Office automation')}</span><small class="mono">${escapeHtml(schedule.id)}</small></div></div>
            <div class="automation-schedule-job"><span>Automation</span><strong>${escapeHtml(job?.label || schedule.job_code)}</strong><small>${escapeHtml(job?.category || 'Head Office')}</small></div>
            <div class="automation-schedule-cadence"><span>Schedule</span><strong>${escapeHtml(scheduleDescription(schedule))}</strong><small>${escapeHtml(schedule.timezone || 'Europe/London')}</small></div>
            <div class="automation-schedule-next"><span>Next run</span>${nextRunCopy(schedule)}<small>Last: ${schedule.last_run_at ? `${escapeHtml(formatDate(schedule.last_run_at))} · ${escapeHtml(label(schedule.last_run_status || 'unknown'))}` : 'Never run'}</small></div>
            <div class="automation-schedule-state"><span>Status</span>${tag(schedule.status)}${schedule.last_error ? `<small class="automation-error">${escapeHtml(schedule.last_error)}</small>` : `<small>${Number(schedule.run_count || 0)} runs · ${Number(schedule.failure_count || 0)} failures</small>`}</div>
            <div class="automation-schedule-actions">${scheduleActions(schedule, editable)}</div>
          </article>`;
        }).join('') : emptyState('No schedules configured', 'Create a one-off or recurring Head Office automation schedule.')}</div>
      </section>

      <section class="panel"><div class="panel-header"><div><h2>Execution history</h2><p>Scheduled, manual, retry and configuration-test runs retained for investigation and assurance.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Started</th><th>Schedule</th><th>Automation</th><th>Trigger</th><th>Result</th><th>Duration</th></tr></thead><tbody>${runs.length ? runs.map(run => `<tr><td>${escapeHtml(formatDate(run.started_at))}</td><td><strong>${escapeHtml(run.schedule_name || 'Deleted schedule')}</strong><br><small class="mono">${escapeHtml(run.schedule_id || 'manual')}</small></td><td>${escapeHtml(run.job_label || run.job_code)}</td><td>${tag(run.trigger_kind)}</td><td>${tag(run.status)}${run.error_text ? `<br><small class="automation-error">${escapeHtml(run.error_text)}</small>` : ''}</td><td>${Number(run.duration_ms || 0)} ms</td></tr>`).join('') : `<tr><td colspan="6">${emptyState('No automation runs recorded', 'Run or test a schedule to create the first execution record.')}</td></tr>`}</tbody></table></div></section>

      <section class="automation-safety-grid">
        <article class="system-setting-section"><header><div><h2>Permitted automation</h2><p>Only registered jobs can be scheduled.</p></div></header><div class="system-setting-body system-policy-list">${(snapshot.jobs || []).map(job => `<div class="system-policy-item"><span class="system-policy-icon" aria-hidden="true">✓</span><div><strong>${escapeHtml(job.label)}</strong><small>${escapeHtml(job.description)}</small></div></div>`).join('')}</div></article>
        <article class="system-setting-section"><header><div><h2>Permanent controls</h2><p>These actions cannot be scheduled.</p></div></header><div class="system-setting-body system-policy-list"><div class="system-policy-item"><span class="system-policy-icon" aria-hidden="true">!</span><div><strong>Critical lockdown remains manual</strong><small>No schedule can initiate, extend or lift a critical website lockdown.</small></div></div><div class="system-policy-item"><span class="system-policy-icon" aria-hidden="true">×</span><div><strong>No arbitrary scripts or URLs</strong><small>Schedules can only call approved internal Head Office jobs.</small></div></div><div class="system-policy-item"><span class="system-policy-icon" aria-hidden="true">⌂</span><div><strong>Website maintenance remains local</strong><small>Connected websites retain their own normal maintenance and launch controls.</small></div></div></div></article>
      </section>
    </div>`;
    setRouteChrome();
  }

  function weekdayInputs(selected = []) {
    const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const values = new Set((selected || []).map(Number));
    return labels.map((day, index) => `<label class="automation-weekday"><input type="checkbox" name="weekday" value="${index}" ${values.has(index) ? 'checked' : ''}><span>${day}</span></label>`).join('');
  }

  function scheduleModal(schedule = null) {
    const editing = Boolean(schedule);
    const definition = schedule?.schedule || {};
    const parameters = schedule?.parameters || {};
    const kind = schedule?.schedule_kind || 'interval';
    const defaultTimezone = schedule?.timezone || snapshot?.settings?.defaultTimezone || 'Europe/London';
    const jobs = snapshot?.jobs || [];
    const serviceTests = snapshot?.serviceTests || [];
    openModal(editing ? 'Edit automation schedule' : 'Create automation schedule', 'Configure an approved Head Office job, its recurrence and retry policy.', `<form data-form="automation-schedule">
      ${editing ? `<input type="hidden" name="id" value="${escapeHtml(schedule.id)}">` : ''}
      <div class="automation-form-grid">
        <label class="field full"><span>Schedule name</span><input name="name" maxlength="120" value="${escapeHtml(schedule?.name || '')}" placeholder="Example: Nightly Stripe reconciliation" required><small>Use a clear operational name that will make sense in the audit history.</small></label>
        <label class="field full"><span>Description</span><textarea name="description" maxlength="500" rows="2" placeholder="What this schedule does and why it exists">${escapeHtml(schedule?.description || '')}</textarea></label>
        <label class="field"><span>Automation</span><select name="jobCode" required>${jobs.map(job => `<option value="${escapeHtml(job.code)}" ${schedule?.job_code === job.code ? 'selected' : ''}>${escapeHtml(job.label)}</option>`).join('')}</select><small>Only registered non-arbitrary Head Office jobs are available.</small></label>
        <label class="field"><span>Schedule type</span><select name="scheduleKind" required><option value="once" ${kind === 'once' ? 'selected' : ''}>One-off</option><option value="interval" ${kind === 'interval' ? 'selected' : ''}>Repeating interval</option><option value="daily" ${kind === 'daily' ? 'selected' : ''}>Daily</option><option value="weekly" ${kind === 'weekly' ? 'selected' : ''}>Weekly</option><option value="monthly" ${kind === 'monthly' ? 'selected' : ''}>Monthly</option></select></label>
        <label class="field"><span>Time zone</span><select name="timezone"><option value="Europe/London" ${defaultTimezone === 'Europe/London' ? 'selected' : ''}>Europe/London</option><option value="UTC" ${defaultTimezone === 'UTC' ? 'selected' : ''}>UTC</option></select><small>Europe/London follows UK daylight-saving changes.</small></label>
        <label class="field"><span>Maximum attempts</span><input type="number" name="maxAttempts" min="1" max="5" value="${Number(schedule?.max_attempts || 2)}" required><small>Includes the original attempt.</small></label>
        <label class="field"><span>Retry delay</span><input type="number" name="retryDelayMinutes" min="1" max="1440" value="${Number(schedule?.retry_delay_minutes || snapshot?.settings?.defaultRetryDelayMinutes || 15)}" required><small>Minutes before a failed scheduled run is retried.</small></label>

        <div class="automation-schedule-fields full" data-schedule-panel="once"><label class="field"><span>Run date and time</span><input type="datetime-local" name="runAt" value="${escapeHtml(localDateTimeValue(definition.runAt || schedule?.next_run_at))}"></label></div>
        <div class="automation-schedule-fields full" data-schedule-panel="interval"><label class="field"><span>Repeat every</span><div class="automation-inline-field"><input type="number" name="intervalMinutes" min="5" max="43200" value="${Number(definition.intervalMinutes || 60)}"><span>minutes</span></div><small>Minimum 5 minutes; maximum 30 days.</small></label></div>
        <div class="automation-schedule-fields full" data-schedule-panel="daily"><label class="field"><span>Time of day</span><input type="time" name="dailyTime" value="${escapeHtml(definition.time || '09:00')}"></label></div>
        <div class="automation-schedule-fields full" data-schedule-panel="weekly"><label class="field"><span>Time of day</span><input type="time" name="weeklyTime" value="${escapeHtml(definition.time || '09:00')}"></label><div class="field"><span>Days</span><div class="automation-weekdays">${weekdayInputs(definition.weekdays || [1])}</div></div></div>
        <div class="automation-schedule-fields full" data-schedule-panel="monthly"><label class="field"><span>Day of month</span><input type="number" name="dayOfMonth" min="1" max="31" value="${Number(definition.dayOfMonth || 1)}"><small>For shorter months, the last calendar day is used.</small></label><label class="field"><span>Time of day</span><input type="time" name="monthlyTime" value="${escapeHtml(definition.time || '09:00')}"></label></div>

        <div class="automation-parameter-panel full" data-parameter-panel="stripe_reconciliation"><label class="field"><span>Stripe division</span><select name="division"><option value="all" ${parameters.division === 'all' || !parameters.division ? 'selected' : ''}>Both divisions</option><option value="planyx" ${parameters.division === 'planyx' ? 'selected' : ''}>Planyx only</option><option value="profile-centre" ${parameters.division === 'profile-centre' ? 'selected' : ''}>Profile Centre only</option></select></label></div>
        <div class="automation-parameter-panel full" data-parameter-panel="service_health_test"><label class="field"><span>Service test</span><select name="serviceCode">${serviceTests.map(service => `<option value="${escapeHtml(service.code)}" ${parameters.serviceCode === service.code ? 'selected' : ''}>${escapeHtml(service.label)}</option>`).join('')}</select><small>Controlled email delivery is never available to scheduled jobs.</small></label></div>
      </div>
      <div class="notice automation-modal-notice"><span>i</span><div><strong>Safe scheduler boundary</strong><br>This form cannot schedule critical lockdowns, refunds, arbitrary scripts, external URLs or customer communications.</div></div>
      <p class="form-error"></p><div class="form-actions"><button type="button" class="button secondary" data-close-modal>Cancel</button><button type="submit" class="button primary">${editing ? 'Save schedule' : 'Create schedule'}</button></div>
    </form>`, 'Automation & Scheduling Centre');
    syncAutomationForm(document.querySelector('form[data-form="automation-schedule"]'));
  }

  function syncAutomationForm(form) {
    if (!form) return;
    const scheduleKind = form.elements.scheduleKind?.value || 'interval';
    form.querySelectorAll('[data-schedule-panel]').forEach(panel => { panel.hidden = panel.dataset.schedulePanel !== scheduleKind; });
    const jobCode = form.elements.jobCode?.value || '';
    form.querySelectorAll('[data-parameter-panel]').forEach(panel => { panel.hidden = panel.dataset.parameterPanel !== jobCode; });
  }

  function schedulePayload(form) {
    const data = new FormData(form);
    const kind = String(data.get('scheduleKind') || 'interval');
    let schedule;
    if (kind === 'once') schedule = { runAt: new Date(String(data.get('runAt'))).toISOString() };
    else if (kind === 'interval') schedule = { intervalMinutes: Number(data.get('intervalMinutes')) };
    else if (kind === 'daily') schedule = { time: String(data.get('dailyTime') || '') };
    else if (kind === 'weekly') schedule = { time: String(data.get('weeklyTime') || ''), weekdays: data.getAll('weekday').map(Number) };
    else schedule = { time: String(data.get('monthlyTime') || ''), dayOfMonth: Number(data.get('dayOfMonth')) };
    const jobCode = String(data.get('jobCode') || '');
    const parameters = jobCode === 'stripe_reconciliation'
      ? { division: String(data.get('division') || 'all') }
      : jobCode === 'service_health_test'
        ? { serviceCode: String(data.get('serviceCode') || '') }
        : {};
    return {
      name: String(data.get('name') || ''),
      description: String(data.get('description') || ''),
      jobCode,
      scheduleKind: kind,
      timezone: String(data.get('timezone') || 'Europe/London'),
      schedule,
      parameters,
      maxAttempts: Number(data.get('maxAttempts')),
      retryDelayMinutes: Number(data.get('retryDelayMinutes'))
    };
  }

  function confirmationModal(schedule, action) {
    const isDelete = action === 'delete';
    const isTest = action === 'test';
    const title = isDelete ? 'Delete automation schedule' : isTest ? 'Test automation configuration' : 'Run automation now';
    const copy = isDelete
      ? 'The schedule will be removed. Existing execution evidence will remain in the history.'
      : isTest
        ? 'This runs the matching non-destructive service check. It will not perform the scheduled reconciliation or cleanup action.'
        : 'This performs the real registered automation immediately and records the result.';
    openModal(title, copy, `<form data-form="automation-confirm"><input type="hidden" name="id" value="${escapeHtml(schedule.id)}"><input type="hidden" name="automationAction" value="${escapeHtml(action)}"><div class="notice ${isDelete ? 'danger' : ''}"><span>${isDelete ? '!' : isTest ? '✓' : '↻'}</span><div><strong>${escapeHtml(schedule.name)}</strong><br>${escapeHtml(jobByCode(schedule.job_code)?.label || schedule.job_code)}</div></div><p class="form-error"></p><div class="form-actions"><button type="button" class="button secondary" data-close-modal>Cancel</button><button type="submit" class="button ${isDelete ? 'danger' : 'primary'}">${isDelete ? 'Delete schedule' : isTest ? 'Run safe test' : 'Run now'}</button></div></form>`, 'Automation & Scheduling Centre');
  }

  async function scheduleAction(action, id) {
    const response = await api('/api/automation-schedules', { method: 'POST', body: JSON.stringify({ action, id }) });
    toast(action === 'pause' ? 'Schedule paused' : action === 'enable' ? 'Schedule enabled' : 'Automation completed', action === 'test' ? 'The safe configuration test has been recorded.' : action === 'run' ? 'The manual automation run has been recorded.' : 'The schedule status has been updated.');
    await renderAutomationCentre();
    return response;
  }

  renderRoute = async function renderAutomationRoute(route = routeFromHash()) {
    if (route === 'automation-centre') {
      state.route = route;
      document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
      document.querySelector('#sidebar')?.classList.remove('open');
      setLoading('Opening the Automation & Scheduling Centre…');
      try { return await renderAutomationCentre(); }
      catch (error) {
        $('#viewRoot').innerHTML = `<div class="panel"><div class="empty-state"><strong>The Automation & Scheduling Centre could not be opened</strong><span>${escapeHtml(error.message || 'The automation service is temporarily unavailable.')}</span></div></div>`;
        toast('Automation Centre unavailable', error.message || 'The service could not be opened.', 'error');
        return;
      }
    }
    return previousRenderRoute(route);
  };

  handleClick = async function handleAutomationClick(target) {
    const element = target.closest?.('[data-action]');
    const action = element?.dataset.action;
    if (action === 'new-automation') return scheduleModal();
    if (action === 'edit-automation') return scheduleModal(scheduleById(element.dataset.id));
    if (action === 'pause-automation') return scheduleAction('pause', element.dataset.id);
    if (action === 'enable-automation') return scheduleAction('enable', element.dataset.id);
    if (action === 'run-automation') return confirmationModal(scheduleById(element.dataset.id), 'run');
    if (action === 'test-automation') return confirmationModal(scheduleById(element.dataset.id), 'test');
    if (action === 'delete-automation') return confirmationModal(scheduleById(element.dataset.id), 'delete');
    if (action === 'refresh-automation') return renderAutomationCentre();
    return previousHandleClick(target);
  };

  handleForm = async function handleAutomationForm(form) {
    const formName = form.dataset.form;
    if (formName === 'automation-schedule') {
      const submit = form.querySelector('button[type="submit"]');
      const errorElement = form.querySelector('.form-error');
      if (submit) submit.disabled = true;
      try {
        const id = new FormData(form).get('id');
        const schedule = schedulePayload(form);
        await api('/api/automation-schedules', { method: id ? 'PUT' : 'POST', body: JSON.stringify(id ? { id, schedule } : { action: 'create', schedule }) });
        closeModal();
        toast(id ? 'Schedule updated' : 'Schedule created', `${schedule.name} is now governed by the Automation & Scheduling Centre.`);
        return renderAutomationCentre();
      } catch (error) {
        if (errorElement) errorElement.textContent = error.message;
      } finally {
        if (submit) submit.disabled = false;
      }
      return;
    }
    if (formName === 'automation-confirm') {
      const data = new FormData(form);
      const id = String(data.get('id') || '');
      const action = String(data.get('automationAction') || '');
      const submit = form.querySelector('button[type="submit"]');
      const errorElement = form.querySelector('.form-error');
      if (submit) submit.disabled = true;
      try {
        if (action === 'delete') {
          await api(`/api/automation-schedules?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
          closeModal();
          toast('Schedule deleted', 'The schedule was removed; previous execution evidence remains available.');
          return renderAutomationCentre();
        }
        closeModal();
        return scheduleAction(action, id);
      } catch (error) {
        if (errorElement) errorElement.textContent = error.message;
        else toast('Automation action failed', error.message, 'error');
      } finally {
        if (submit) submit.disabled = false;
      }
      return;
    }
    return previousHandleForm(form);
  };

  document.addEventListener('change', event => {
    const form = event.target.closest?.('form[data-form="automation-schedule"]');
    if (form && (event.target.name === 'scheduleKind' || event.target.name === 'jobCode')) syncAutomationForm(form);
  });
})();
