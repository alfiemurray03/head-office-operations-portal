(() => {
  let directorySnapshot = null;
  let enhancementQueued = false;

  async function directoryData() {
    directorySnapshot = await api('/api/staff-directory');
    return directorySnapshot;
  }

  function roleOptions(profile) {
    const selected = new Set(String(profile.role_codes || '').split(',').map(value => value.trim().toUpperCase()).filter(Boolean));
    return (directorySnapshot?.roles || []).filter(role => role.status === 'active').map(role => {
      const code = String(role.code || '').toUpperCase();
      const warning = code === 'SYSTEM_ADMINISTRATOR' ? '<small class="overdue-text">Full technical and configuration authority</small>' : `<small>${escapeHtml(role.description || '')}</small>`;
      return `<label class="field" style="border:1px solid var(--border);border-radius:10px;padding:12px;display:flex;gap:10px;align-items:flex-start"><input type="checkbox" name="roleCodes" value="${escapeHtml(code)}" ${selected.has(code) ? 'checked' : ''}><span><strong>${escapeHtml(role.name || label(code))}</strong>${warning}</span></label>`;
    }).join('');
  }

  async function authorityModal(profileId) {
    const data = await directoryData();
    const profile = (data.staff || []).find(item => item.id === profileId);
    if (!profile) throw new Error('The Staff Directory profile could not be loaded.');
    const linked = Boolean(profile.linked_staff_member_id);
    const identityReady = Boolean(profile.entra_object_id && Number(profile.account_enabled || 0) === 1 && !['disabled','deleted'].includes(String(profile.directory_status || '').toLowerCase()));
    const roles = roleOptions(profile);
    return modalForm(linked ? 'Manage portal roles and access' : 'Grant Head Office portal access', `${profile.staff_number} · ${profile.display_name}`, {
      form: 'staff-authority-save',
      attributes: `data-profile-id="${escapeHtml(profile.id)}" data-linked="${linked ? 'true' : 'false'}"`,
      html: `<div class="notice"><div><strong>Microsoft staff identity only</strong><br>This creates or updates a staff portal identity and role permissions. It never creates, links or changes a customer account or UCN.</div></div>
        ${identityReady ? '' : '<div class="notice danger"><div><strong>Microsoft identity not ready</strong><br>Synchronise the tenant and ensure this staff account is active before granting access.</div></div>'}
        <fieldset class="field full"><legend>Head Office roles and security permissions</legend><div class="form-grid" style="margin-top:10px">${roles || '<p>No active role definitions are available.</p>'}</div></fieldset>
        ${linked ? '<div class="notice danger"><div><strong>Suspension control</strong><br>Suspending portal access revokes the staff member’s active Head Office sessions but keeps their Staff Directory record.</div></div><button type="button" class="button danger" data-action="staff-authority-suspend" data-id="' + escapeHtml(profile.id) + '">Suspend portal access</button>' : ''}`
    }, linked ? 'Save portal roles' : 'Grant portal access', 'Staff access authority');
  }

  async function enhanceStaffWorkspace() {
    enhancementQueued = false;
    if (!document.querySelector('.staff-directory-workspace') || !hasPermission('administration:write')) return;
    const data = await directoryData().catch(() => null);
    if (!data) return;
    for (const profile of data.staff || []) {
      const detail = document.querySelector(`#staff-detail-${CSS.escape(profile.id)} .staff-directory-detail-actions`);
      if (!detail || detail.querySelector('[data-action="staff-authority-manage"]')) continue;
      const legacyLink = detail.querySelector('[data-action="staff-directory-link"]');
      if (legacyLink) legacyLink.hidden = true;
      const legacyRoles = detail.querySelector('[data-action="edit-roles"]');
      if (legacyRoles) legacyRoles.hidden = true;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button primary small';
      button.dataset.action = 'staff-authority-manage';
      button.dataset.id = profile.id;
      button.textContent = profile.linked_staff_member_id ? 'Portal roles & access' : 'Grant portal access';
      detail.prepend(button);
    }
  }

  function queueEnhancement() {
    if (enhancementQueued) return;
    enhancementQueued = true;
    setTimeout(() => enhanceStaffWorkspace().catch(() => {}), 40);
  }

  const previousHandleClick = handleClick;
  handleClick = async function staffAuthorityClick(target) {
    const element = target.closest?.('[data-action]');
    const action = element?.dataset.action;
    if (action === 'staff-authority-manage') return authorityModal(element.dataset.id);
    if (action === 'staff-authority-suspend') {
      const profileId = element.dataset.id;
      if (!confirm('Suspend this staff member’s Head Office portal access and revoke active sessions?')) return;
      await api('/api/staff-directory/portal-access', { method: 'POST', body: JSON.stringify({ action: 'suspend', profileId }) });
      closeModal();
      toast('Staff portal access suspended', 'Active Head Office sessions were revoked.');
      directorySnapshot = null;
      await window.renderStaffDirectory?.();
      queueEnhancement();
      return;
    }
    return previousHandleClick(target);
  };

  const previousHandleForm = handleForm;
  handleForm = async function staffAuthorityForm(form) {
    if (form.dataset.form !== 'staff-authority-save') return previousHandleForm(form);
    const submit = form.querySelector('button[type="submit"],button:not([type])');
    const errorElement = form.querySelector('.form-error');
    if (submit) submit.disabled = true;
    if (errorElement) errorElement.textContent = '';
    try {
      const roleCodes = [...form.querySelectorAll('input[name="roleCodes"]:checked')].map(input => input.value);
      if (!roleCodes.length) throw new Error('Select at least one Head Office portal role.');
      await api('/api/staff-directory/portal-access', {
        method: 'POST',
        body: JSON.stringify({ action: form.dataset.linked === 'true' ? 'update_roles' : 'grant', profileId: form.dataset.profileId, roleCodes })
      });
      closeModal();
      toast(form.dataset.linked === 'true' ? 'Staff portal roles updated' : 'Head Office portal access granted', 'The Microsoft staff identity and permissions are now linked.');
      directorySnapshot = null;
      await window.renderStaffDirectory?.();
      queueEnhancement();
    } catch (error) {
      if (errorElement) errorElement.textContent = error.message;
      else toast('Staff portal access could not be changed', error.message, 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  };

  new MutationObserver(queueEnhancement).observe(document.getElementById('viewRoot') || document.body, { childList: true, subtree: true });
  queueEnhancement();
})();
