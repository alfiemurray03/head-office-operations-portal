/* Adds separate Didit workflow mappings to the central age-assurance deployment controls. */
(() => {
  const previousRenderSettings = renderSettings;

  function parseSettings(rows) {
    return Object.fromEntries((rows || []).map(row => {
      try { return [row.setting_key, JSON.parse(row.value_json)]; }
      catch { return [row.setting_key, row.value_json]; }
    }));
  }

  function workflowField(key, value, threshold, editable) {
    return `<label class="field" data-age-workflow-field><span>Didit ${threshold}+ workflow ID</span><input data-setting-key="${escapeHtml(key)}" value="${escapeHtml(value || '')}" placeholder="00000000-0000-0000-0000-000000000000" autocomplete="off" spellcheck="false" ${editable ? '' : 'disabled'}><small>Use only a workflow tested specifically for the ${threshold}+ threshold. A shared unqualified workflow cannot authorise both 16+ and 18+.</small></label>`;
  }

  function deploymentPanel(title) {
    return [...document.querySelectorAll('.system-setting-section')].find(section => section.querySelector('h3')?.textContent?.trim() === title) || null;
  }

  renderSettings = async function renderSettingsWithAgeWorkflowMappings() {
    await previousRenderSettings();
    const data = await api('/api/configuration');
    const values = parseSettings(data.settings);
    const editable = hasPermission('configuration:write');
    const planyx = deploymentPanel('Planyx')?.querySelector('.system-setting-body');
    const profile = deploymentPanel('Profile Centre')?.querySelector('.system-setting-body');
    if (planyx && !planyx.querySelector('[data-age-workflow-field]')) {
      planyx.querySelector('.system-toggle-row')?.insertAdjacentHTML('beforebegin', workflowField(
        'age_assurance.planyx_workflow_id', values['age_assurance.planyx_workflow_id'], 16, editable
      ));
    }
    if (profile && !profile.querySelector('[data-age-workflow-field]')) {
      profile.querySelector('.system-toggle-row')?.insertAdjacentHTML('beforebegin', workflowField(
        'age_assurance.profile_centre_workflow_id', values['age_assurance.profile_centre_workflow_id'], 18, editable
      ));
    }
  };
})();
