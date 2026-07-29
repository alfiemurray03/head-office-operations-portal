(() => {
  let directoryData = null;
  let directoryFilters = { q: '', status: '', division: '' };
  let directoryPage = 1;
  const DIRECTORY_PAGE_SIZE = 12;

  const employmentTypes = ['director','employee','contractor','agency','volunteer','other'];
  const staffStatuses = ['active','suspended','left','archived'];
  const reviewTypes = ['identity','security','safeguarding','conduct','right_to_work','other'];

  function ensureStaffDirectoryStyles() {
    if (document.querySelector('link[data-staff-directory-style]')) return;
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = '/staff-directory.css?v=20260729-staff-directory-2';
    style.dataset.staffDirectoryStyle = 'true';
    document.head.append(style);
  }

  function option(value, selected, text = label(value)) {
    return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(text)}</option>`;
  }

  function unitOptions(selected = '') {
    return `<option value="">No organisation unit selected</option>${(directoryData?.units || []).map(unit => option(unit.id, selected, `${unit.name} · ${unit.code}`)).join('')}`;
  }

  function profileFields(profile = {}) {
    return `<div class="form-grid">
      <label class="field"><span>Full name</span><input name="displayName" maxlength="160" value="${escapeHtml(profile.display_name || '')}" required></label>
      <label class="field"><span>Staff email</span><input name="email" type="email" maxlength="254" value="${escapeHtml(profile.email || '')}" required></label>
      <label class="field"><span>Job title</span><input name="jobTitle" maxlength="160" value="${escapeHtml(profile.job_title || '')}"></label>
      <label class="field"><span>Employment type</span><select name="employmentType">${employmentTypes.map(value => option(value, profile.employment_type || 'employee')).join('')}</select></label>
      <label class="field"><span>Organisation unit</span><select name="organisationUnitId">${unitOptions(profile.organisation_unit_id || '')}</select></label>
      <label class="field"><span>Division code</span><input name="divisionCode" maxlength="80" value="${escapeHtml(profile.division_code || '')}" placeholder="HEAD_OFFICE, PLANYX or PROFILE_CENTRE"></label>
      <label class="field"><span>Department</span><input name="department" maxlength="160" value="${escapeHtml(profile.department || '')}"></label>
      <label class="field"><span>Status</span><select name="status">${staffStatuses.map(value => option(value, profile.status || 'active')).join('')}</select></label>
      <label class="field"><span>Telephone</span><input name="telephone" maxlength="60" value="${escapeHtml(profile.telephone || '')}"></label>
      <label class="field"><span>Internal extension</span><input name="internalExtension" maxlength="30" value="${escapeHtml(profile.internal_extension || '')}"></label>
      <label class="field"><span>Start date</span><input name="startDate" type="date" value="${escapeHtml(profile.start_date || '')}"></label>
      <label class="field"><span>End date</span><input name="endDate" type="date" value="${escapeHtml(profile.end_date || '')}"></label>
      <label class="field full"><span>Directory notes</span><textarea name="notes" maxlength="2000">${escapeHtml(profile.directory_notes || '')}</textarea></label>
    </div>`;
  }

  function profileModal(profile = null) {
    const editing = Boolean(profile);
    return modalForm(editing ? 'Edit Staff Directory profile' : 'Add Staff Directory profile',
      editing
        ? `${profile.staff_number} is an operational staff record. Editing it does not alter any customer record with the same email.`
        : 'Create an operational staff record. This does not create a customer, UCN, identity check or portal login.',
      {
        form: editing ? 'staff-directory-update' : 'staff-directory-create',
        attributes: editing ? `data-profile-id="${escapeHtml(profile.id)}"` : '',
        html: `<div class="notice"><div><strong>Separate staff record</strong><br>A matching customer email is allowed. Staff and customer records are never merged.</div></div>${profileFields(profile || {})}`
      },
      editing ? 'Save Staff Directory profile' : 'Create staff profile',
      'Staff Directory');
  }

  function reviewModal(profile) {
    return modalForm('Open manual staff review', `${profile.staff_number} · ${profile.display_name}. No check is started automatically.`, {
      form: 'staff-directory-review-open',
      attributes: `data-profile-id="${escapeHtml(profile.id)}"`,
      html: `<div class="notice danger"><div><strong>Manual decision required</strong><br>This creates an audited staff-only review. It does not apply a customer marker, customer restriction or customer identity check.</div></div>
        <label class="field"><span>Review type</span><select name="reviewType">${reviewTypes.map(value => option(value, '')).join('')}</select></label>
        <label class="field"><span>Reason and authority</span><textarea name="reason" maxlength="2000" required></textarea></label>`
    }, 'Open manual review', 'Staff assurance');
  }

  function closeReviewModal(review) {
    return modalForm('Close manual staff review', `${review.staff_number} · ${review.display_name}`, {
      form: 'staff-directory-review-close',
      attributes: `data-profile-id="${escapeHtml(review.staff_profile_id)}" data-review-id="${escapeHtml(review.id)}"`,
      html: `<label class="field"><span>Outcome status</span><select name="status"><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
        <label class="field"><span>Outcome and evidence</span><textarea name="outcome" maxlength="2000" required></textarea></label>`
    }, 'Close review', 'Staff assurance');
  }

  function linkPortalModal(profile) {
    const available = directoryData?.unlinkedPortalIdentities || [];
    return modalForm('Link Microsoft staff access identity', `${profile.staff_number} · ${profile.display_name}`, {
      form: 'staff-directory-link-portal',
      attributes: `data-profile-id="${escapeHtml(profile.id)}"`,
      html: available.length
        ? `<div class="notice"><div><strong>Staff-only connection</strong><br>This links the directory profile to a Microsoft staff access identity. It has no effect on any customer account using the same email.</div></div><label class="field"><span>Microsoft staff identity</span><select name="portalStaffId">${available.map(item => option(item.id, '', `${item.display_name} · ${item.email}`)).join('')}</select></label>`
        : `<div class="notice"><div><strong>No unlinked portal identities</strong><br>Every Microsoft staff identity is already linked to a Staff Directory profile.</div></div>`
    }, available.length ? 'Link portal identity' : 'Close', 'Staff access authority');
  }

  function metric(labelText, value, detail) {
    return `<article class="metric-card"><div><span>${escapeHtml(labelText)}</span><strong>${Number(value || 0).toLocaleString('en-GB')}</strong><small>${escapeHtml(detail)}</small></div></article>`;
  }

  function connectorPanel() {
    const status = directoryData?.directoryConnector || {};
    const connector = status.connector || {};
    const configured = Boolean(status.configured);
    const pending = Boolean(status.continuationPending);
    const stateText = !configured ? 'Microsoft Graph connection unavailable' : pending ? 'Tenant import in progress' : connector.status === 'connected' ? 'Tenant connected' : label(connector.status || 'configured');
    const detail = !configured
      ? 'The existing Head Office Microsoft app or secret is not available to the deployed Functions.'
      : pending
        ? `The import is continuing in safe batches. ${Number(status.totals?.discovered || 0).toLocaleString('en-GB')} tenant users have been recorded so far.`
        : connector.last_success_at
          ? `Last reconciled ${formatDate(connector.last_success_at)}. Directory membership does not grant portal access.`
          : 'The existing Head Office Microsoft login app is ready to import the tenant.';
    return `<section class="panel" style="margin-bottom:12px"><div class="panel-header"><div><p class="eyebrow">Microsoft tenant source</p><h2>${escapeHtml(stateText)}</h2><p>${escapeHtml(detail)}</p></div>
      ${hasPermission('administration:write') && configured ? '<button class="button primary" data-action="staff-directory-sync">↻ Synchronise tenant</button>' : ''}</div>
      ${connector.last_error_message ? `<div class="panel-body"><div class="notice danger"><div><strong>Latest Microsoft sync error</strong><br>${escapeHtml(connector.last_error_message)}</div></div></div>` : ''}</section>`;
  }

  function tenantState(item) {
    if (!item.entra_object_id) return '<span class="tag">Manual</span>';
    return tag(item.directory_status || 'unclassified');
  }

  function portalState(item) {
    return item.linked_staff_member_id ? '<span class="tag active">Portal linked</span>' : '<span class="tag">Directory only</span>';
  }

  function detailField(title, value, secondary = '') {
    return `<div class="staff-directory-detail-field"><span>${escapeHtml(title)}</span><strong>${value || '—'}</strong>${secondary ? `<small>${secondary}</small>` : ''}</div>`;
  }

  function staffDetail(item) {
    const roles = (item.role_codes || '').split(',').filter(Boolean).map(label).join(', ') || 'No portal role assigned';
    const tenantIdentifier = item.user_principal_name || item.directory_mail || item.entra_object_id || 'Not linked to Microsoft';
    const telephone = [item.telephone, item.internal_extension ? `Ext. ${item.internal_extension}` : ''].filter(Boolean).join(' · ') || 'Not recorded';
    const dates = [item.start_date ? `Started ${item.start_date}` : '', item.end_date ? `Ended ${item.end_date}` : ''].filter(Boolean).join(' · ') || 'No employment dates recorded';
    const reviewState = Number(item.open_review_count || 0) ? `${Number(item.open_review_count)} open manual review${Number(item.open_review_count) === 1 ? '' : 's'}` : 'No open manual reviews';
    const actions = hasPermission('administration:write') ? `<div class="staff-directory-detail-actions">
      <button class="button secondary small" data-action="staff-directory-edit" data-id="${escapeHtml(item.id)}">Edit profile</button>
      <button class="button secondary small" data-action="staff-directory-review" data-id="${escapeHtml(item.id)}">Open manual review</button>
      ${item.linked_staff_member_id
        ? `<button class="button secondary small" data-action="edit-roles" data-id="${escapeHtml(item.linked_staff_member_id)}">Manage roles</button><button class="button danger small" data-action="staff-directory-unlink" data-id="${escapeHtml(item.id)}">Unlink portal access</button>`
        : `<button class="button secondary small" data-action="staff-directory-link" data-id="${escapeHtml(item.id)}">Link portal access</button>`}
    </div>` : '';
    return `<tr class="staff-directory-detail-row" id="staff-detail-${escapeHtml(item.id)}" hidden><td colspan="5"><div class="staff-directory-detail-panel"><div class="staff-directory-detail-grid">
      ${detailField('Microsoft tenant', tenantState(item), escapeHtml(tenantIdentifier))}
      ${detailField('Portal authority', portalState(item), escapeHtml(roles))}
      ${detailField('Employment', escapeHtml(label(item.employment_type || 'employee')), escapeHtml(dates))}
      ${detailField('Manual assurance', escapeHtml(reviewState), `Updated ${formatDate(item.directory_last_synced_at || item.updated_at)}`)}
      ${detailField('Contact', escapeHtml(telephone), escapeHtml(item.email || ''))}
      ${detailField('Microsoft object ID', item.entra_object_id ? `<code>${escapeHtml(item.entra_object_id)}</code>` : 'Not linked')}
      ${detailField('Organisation', escapeHtml(item.organisation_unit_name || item.division_code || 'Head Office'), escapeHtml(item.department || item.directory_department || 'No department recorded'))}
      ${detailField('Notes', escapeHtml(item.directory_notes || 'No directory notes'))}
    </div>${actions}</div></td></tr>`;
  }

  function staffRows() {
    const staff = directoryData?.staff || [];
    if (!staff.length) return `<tr><td colspan="5">${emptyState('No staff profiles found', 'Synchronise the Microsoft tenant, add the first Staff Directory profile or change the filters.')}</td></tr>`;
    const totalPages = Math.max(1, Math.ceil(staff.length / DIRECTORY_PAGE_SIZE));
    directoryPage = Math.min(directoryPage, totalPages);
    const first = (directoryPage - 1) * DIRECTORY_PAGE_SIZE;
    return staff.slice(first, first + DIRECTORY_PAGE_SIZE).map(item => {
      const role = item.job_title || item.directory_job_title || 'Role not recorded';
      const division = item.organisation_unit_name || item.division_code || 'Head Office';
      const department = item.department || item.directory_department || 'No department recorded';
      const reviewText = Number(item.open_review_count || 0) ? `${Number(item.open_review_count)} open review${Number(item.open_review_count) === 1 ? '' : 's'}` : 'No open reviews';
      return `<tr>
        <td><div class="primary-cell"><div class="mini-avatar">${initials(item.display_name)}</div><div><strong title="${escapeHtml(item.display_name)}">${escapeHtml(item.display_name)}</strong><small title="${escapeHtml(item.email)}">${escapeHtml(item.email)}</small><span class="staff-directory-number mono">${escapeHtml(item.staff_number)}</span></div></div></td>
        <td><div class="staff-directory-role"><strong title="${escapeHtml(role)}">${escapeHtml(role)}</strong><small title="${escapeHtml(`${division} · ${department}`)}">${escapeHtml(division)} · ${escapeHtml(department)}</small></div></td>
        <td><div class="staff-directory-status-line">${tag(item.status)} ${tenantState(item)}</div></td>
        <td><div class="staff-directory-assurance">${portalState(item)}<small>${escapeHtml(reviewText)}</small></div></td>
        <td><div class="staff-directory-row-actions"><button class="button secondary small" data-action="staff-directory-details" data-id="${escapeHtml(item.id)}" aria-expanded="false">View</button></div></td>
      </tr>${staffDetail(item)}`;
    }).join('');
  }

  function staffPageControls() {
    const staff = directoryData?.staff || [];
    const pages = Math.max(1, Math.ceil(staff.length / DIRECTORY_PAGE_SIZE));
    const start = staff.length ? (directoryPage - 1) * DIRECTORY_PAGE_SIZE + 1 : 0;
    const end = Math.min(directoryPage * DIRECTORY_PAGE_SIZE, staff.length);
    return `<div class="staff-directory-page-controls"><span>${start}–${end} of ${staff.length}</span><button class="button secondary small" data-action="staff-directory-page" data-direction="previous" ${directoryPage <= 1 ? 'disabled' : ''}>Previous</button><button class="button secondary small" data-action="staff-directory-page" data-direction="next" ${directoryPage >= pages ? 'disabled' : ''}>Next</button></div>`;
  }

  function reviewRows() {
    const reviews = directoryData?.reviews || [];
    if (!reviews.length) return `<tr><td colspan="5">${emptyState('No manual staff reviews', 'Staff checks only appear when an authorised Head Office user deliberately opens one.')}</td></tr>`;
    return reviews.map(item => `<tr>
      <td><strong>${escapeHtml(item.display_name)}</strong><small>${escapeHtml(item.staff_number)} · ${escapeHtml(item.email)}</small></td>
      <td>${tag(item.review_type)}<small>${tag(item.status)}</small></td>
      <td>${formatDate(item.opened_at)}</td>
      <td><strong>${escapeHtml(item.reason)}</strong><small>${escapeHtml(item.outcome || 'No outcome recorded')}</small></td>
      <td>${['open','in_review'].includes(item.status) && hasPermission('administration:write') ? `<button class="button primary small" data-action="staff-directory-review-close" data-id="${escapeHtml(item.id)}">Close review</button>` : escapeHtml(label(item.status))}</td>
    </tr>`).join('');
  }

  async function loadDirectory() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(directoryFilters)) if (value) params.set(key, value);
    directoryData = await api(`/api/staff-directory?${params}`);
    return directoryData;
  }

  async function synchroniseTenant(button) {
    if (button) button.disabled = true;
    let result = null;
    try {
      for (let batch = 0; batch < 12; batch += 1) {
        result = await api('/api/staff-directory/sync', { method: 'POST', body: JSON.stringify({ mode: 'delta' }) });
        if (!result.partial) break;
      }
      directoryPage = 1;
      if (result?.partial) {
        toast('Microsoft tenant import is continuing', `${Number(result.totals?.discovered || 0).toLocaleString('en-GB')} users recorded. Remaining pages will continue automatically.`);
      } else {
        toast('Microsoft tenant synchronised', `${Number(result?.totals?.discovered || 0).toLocaleString('en-GB')} tenant users are reflected in the Staff Directory.`);
      }
      return renderStaffDirectory();
    } catch (error) {
      toast('Microsoft tenant sync failed', error.message, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function renderStaffDirectory() {
    ensureStaffDirectoryStyles();
    await loadDirectory();
    const metrics = directoryData.metrics || {};
    const divisions = [...new Set((directoryData.staff || []).map(item => item.division_code).filter(Boolean))].sort();
    $('#viewRoot').innerHTML = `<div class="staff-directory-workspace"><div class="page-heading"><div><p class="eyebrow">People and authority</p><h1>Staff Directory</h1><p>Independent operational records for directors, employees, contractors, guests and other authorised workers.</p></div><div class="inline-actions">${hasPermission('administration:write') ? '<button class="button secondary" data-action="staff-directory-sync">↻ Sync tenant</button><button class="button primary" data-action="staff-directory-add">＋ Add staff profile</button>' : ''}</div></div>
      <div class="notice"><div><strong>Staff is staff. Customer is customer.</strong><br>The same email may appear in the Staff Directory and the Unique Customer Register. The records remain separate, use different identifiers and never merge automatically.</div></div>
      ${connectorPanel()}
      <div class="metrics">${metric('Staff profiles', metrics.total, 'Independent operational records')}${metric('Tenant users', metrics.tenant_linked, 'Linked by Microsoft object ID')}${metric('Active staff', metrics.active, 'Operationally active')}${metric('Portal identities', metrics.portal_linked, 'Separately authorised access')}${metric('Guest accounts', metrics.guest_accounts, 'Microsoft tenant guests')}${metric('Inactive tenant users', metrics.inactive_directory_accounts, 'Disabled or deleted at source')}</div>
      <section class="panel"><div class="panel-body"><form class="staff-directory-toolbar" data-form="staff-directory-filter"><label class="search-field"><span>Search</span><input name="q" value="${escapeHtml(directoryFilters.q || '')}" placeholder="Staff number, name, email, title, object ID or department"></label><select name="status"><option value="">All statuses</option>${staffStatuses.map(value => option(value, directoryFilters.status)).join('')}</select><select name="division"><option value="">All divisions</option>${divisions.map(value => option(value, directoryFilters.division, value)).join('')}</select><button class="button secondary">Apply filters</button></form></div>
      <div class="panel-header staff-directory-list-header"><div><h2>Staff records</h2><p>Open a record to view Microsoft, portal-access and assurance details.</p></div>${staffPageControls()}</div>
      <div class="table-wrap staff-directory-table-wrap"><table class="data-table staff-directory-table"><thead><tr><th>Staff member</th><th>Role & division</th><th>Status</th><th>Access & assurance</th><th></th></tr></thead><tbody>${staffRows()}</tbody></table></div></section>
      <section class="panel" style="margin-top:16px"><div class="panel-header"><div><h2>Manual staff assurance reviews</h2><p>No automatic checks are created from Staff Directory records, customer records or matching email addresses.</p></div></div><div class="table-wrap staff-directory-table-wrap"><table class="data-table staff-review-table"><thead><tr><th>Staff member</th><th>Review</th><th>Opened</th><th>Reason & outcome</th><th></th></tr></thead><tbody>${reviewRows()}</tbody></table></div></section></div>`;
  }

  const baseRenderRoute = renderRoute;
  renderRoute = async function staffDirectoryRoute(route = routeFromHash()) {
    if (route !== 'staff') return baseRenderRoute(route);
    state.route = route;
    $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
    $('#sidebar')?.classList.remove('open');
    if (typeof updateOperationsRouteChrome === 'function') updateOperationsRouteChrome(route);
    setLoading('Opening Staff Directory…');
    try { return await renderStaffDirectory(); }
    catch (error) { $('#viewRoot').innerHTML = `<section class="panel"><div class="empty-state"><strong>The Staff Directory could not be opened</strong><span>${escapeHtml(error.message)}</span></div></section>`; }
  };

  const baseHandleClick = handleClick;
  handleClick = async function staffDirectoryClick(target) {
    const element = target.closest('[data-action]');
    if (!element) return baseHandleClick(target);
    const action = element.dataset.action;
    if (!action.startsWith('staff-directory-')) return baseHandleClick(target);
    if (action === 'staff-directory-sync') return synchroniseTenant(element);
    if (action === 'staff-directory-page') {
      directoryPage += element.dataset.direction === 'next' ? 1 : -1;
      return renderStaffDirectory();
    }
    if (action === 'staff-directory-details') {
      const detail = document.getElementById(`staff-detail-${element.dataset.id}`);
      if (!detail) return;
      detail.hidden = !detail.hidden;
      element.setAttribute('aria-expanded', String(!detail.hidden));
      element.textContent = detail.hidden ? 'View' : 'Close';
      return;
    }
    const profile = (directoryData?.staff || []).find(item => item.id === element.dataset.id);
    if (action === 'staff-directory-add') return profileModal();
    if (action === 'staff-directory-edit' && profile) return profileModal(profile);
    if (action === 'staff-directory-review' && profile) return reviewModal(profile);
    if (action === 'staff-directory-link' && profile) return linkPortalModal(profile);
    if (action === 'staff-directory-unlink' && profile) return modalForm('Unlink Microsoft staff access identity', `${profile.staff_number} · ${profile.display_name}`, { form: 'staff-directory-unlink-portal', attributes: `data-profile-id="${escapeHtml(profile.id)}"`, html: '<div class="notice danger"><div><strong>Directory record retained</strong><br>This removes only the staff access link. It does not delete the Staff Directory profile, its Microsoft tenant source or any customer record.</div></div>' }, 'Unlink access identity', 'Staff access authority');
    if (action === 'staff-directory-review-close') {
      const review = (directoryData?.reviews || []).find(item => item.id === element.dataset.id);
      if (review) return closeReviewModal(review);
    }
  };

  const baseHandleForm = handleForm;
  handleForm = async function staffDirectoryForm(form) {
    const name = form.dataset.form;
    if (!name?.startsWith('staff-directory-')) return baseHandleForm(form);
    const data = Object.fromEntries(new FormData(form));
    const submit = $('button[type="submit"],button:not([type])', form);
    const errorElement = $('.form-error', form);
    if (submit) submit.disabled = true;
    if (errorElement) errorElement.textContent = '';
    try {
      if (name === 'staff-directory-filter') { directoryFilters = data; directoryPage = 1; return renderStaffDirectory(); }
      if (name === 'staff-directory-create') {
        const result = await api('/api/staff-directory', { method: 'POST', body: JSON.stringify(data) });
        closeModal(); toast('Staff Directory profile created', result.staff.staff_number); directoryPage = 1; return renderStaffDirectory();
      }
      if (name === 'staff-directory-update') {
        await api('/api/staff-directory', { method: 'PUT', body: JSON.stringify({ ...data, action: 'update', profileId: form.dataset.profileId }) });
        closeModal(); toast('Staff Directory profile updated'); return renderStaffDirectory();
      }
      if (name === 'staff-directory-review-open') {
        await api('/api/staff-directory', { method: 'PUT', body: JSON.stringify({ ...data, action: 'open_review', profileId: form.dataset.profileId }) });
        closeModal(); toast('Manual staff review opened', 'No customer marker or customer identity check was created.'); return renderStaffDirectory();
      }
      if (name === 'staff-directory-review-close') {
        await api('/api/staff-directory', { method: 'PUT', body: JSON.stringify({ ...data, action: 'close_review', profileId: form.dataset.profileId, reviewId: form.dataset.reviewId }) });
        closeModal(); toast('Manual staff review closed'); return renderStaffDirectory();
      }
      if (name === 'staff-directory-link-portal') {
        if (!data.portalStaffId) { closeModal(); return; }
        await api('/api/staff-directory', { method: 'PUT', body: JSON.stringify({ action: 'link_portal_identity', profileId: form.dataset.profileId, portalStaffId: data.portalStaffId }) });
        closeModal(); toast('Microsoft staff access identity linked'); return renderStaffDirectory();
      }
      if (name === 'staff-directory-unlink-portal') {
        await api('/api/staff-directory', { method: 'PUT', body: JSON.stringify({ action: 'unlink_portal_identity', profileId: form.dataset.profileId }) });
        closeModal(); toast('Microsoft staff access identity unlinked', 'The Staff Directory and Microsoft tenant records remain active.'); return renderStaffDirectory();
      }
    } catch (error) {
      if (errorElement) errorElement.textContent = error.message;
      else toast('Staff Directory action failed', error.message, 'error');
    } finally { if (submit) submit.disabled = false; }
  };

  if (typeof OPS_ROUTE_LABELS !== 'undefined') OPS_ROUTE_LABELS.staff = 'Staff Directory';
  window.renderStaffDirectory = renderStaffDirectory;
})();
