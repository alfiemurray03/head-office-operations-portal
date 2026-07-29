/* Extends the governed System Settings page with scheduler controls. */
(() => {
  if (typeof renderSettings !== 'function') return;
  const previousRenderSettings = renderSettings;

  const parseRows = rows => Object.fromEntries((rows || []).map(row => {
    try { return [row.setting_key, JSON.parse(row.value_json)]; }
    catch { return [row.setting_key, row.value_json]; }
  }));

  function toggleRow(key, title, copy, value, editable) {
    return `<div class="system-toggle-row"><div class="system-toggle-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></div><label class="system-switch"><input type="checkbox" data-setting-key="${escapeHtml(key)}" ${value ? 'checked' : ''} ${editable ? '' : 'disabled'}><span aria-hidden="true"></span></label></div>`;
  }

  renderSettings = async function renderSettingsWithAutomation() {
    await previousRenderSettings();
    const form = document.querySelector('form[data-form="system-settings"]');
    if (!form || form.querySelector('[data-automation-settings-section]')) return;
    const data = await api('/api/configuration');
    const values = parseRows(data.settings);
    const editable = hasPermission('configuration:write');
    const section = document.createElement('section');
    section.className = 'system-setting-section';
    section.dataset.automationSettingsSection = 'true';
    section.style.marginTop = '16px';
    section.innerHTML = `<header><div><h2>Automation &amp; scheduling</h2><p>Company-wide scheduler authority, time zone, execution limits, retries and retained evidence.</p></div><button type="button" class="button secondary small" data-route="automation-centre">Open Automation Centre</button></header><div class="system-setting-body">
      ${toggleRow('automation.scheduler_enabled', 'Automation scheduler', 'Allow due approved schedules to execute through the Head Office Worker.', values['automation.scheduler_enabled'] !== false, editable)}
      <div class="system-field-grid" style="margin-top:15px">
        <label class="field"><span>Default schedule time zone</span><select data-setting-key="automation.default_timezone" ${editable ? '' : 'disabled'}><option value="Europe/London" ${values['automation.default_timezone'] === 'UTC' ? '' : 'selected'}>Europe/London</option><option value="UTC" ${values['automation.default_timezone'] === 'UTC' ? 'selected' : ''}>UTC</option></select><small>Europe/London follows UK daylight-saving changes automatically.</small></label>
        <label class="field"><span>Maximum jobs per scheduler cycle</span><input type="number" data-setting-key="automation.max_jobs_per_tick" value="${Number(values['automation.max_jobs_per_tick'] || 3)}" min="1" max="10" ${editable ? '' : 'disabled'}><small>Bounds Cloudflare work and prevents one cycle from becoming overloaded.</small></label>
        <label class="field"><span>Default retry delay</span><input type="number" data-setting-key="automation.default_retry_delay_minutes" value="${Number(values['automation.default_retry_delay_minutes'] || 15)}" min="1" max="1440" ${editable ? '' : 'disabled'}><small>Minutes before a failed scheduled run is attempted again.</small></label>
        <label class="field"><span>Automation evidence retention</span><input type="number" data-setting-key="automation.run_retention_days" value="${Number(values['automation.run_retention_days'] || 180)}" min="30" max="730" ${editable ? '' : 'disabled'}><small>Days completed automation-run evidence is retained.</small></label>
      </div>
    </div>`;
    const operationalLimits = [...form.querySelectorAll('.system-setting-section')].find(item => item.textContent.includes('Operational limits and defaults'));
    if (operationalLimits) form.insertBefore(section, operationalLimits);
    else form.querySelector('.form-actions')?.before(section);
  };
})();
