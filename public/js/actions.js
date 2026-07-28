async function handleForm(form) {
  const formName = form.dataset.form;
  const data = Object.fromEntries(new FormData(form));
  const errorElement = $('.form-error', form);
  if (errorElement) errorElement.textContent = '';
  const submit = $('button[type="submit"],button:not([type])', form);
  if (submit) submit.disabled = true;
  try {
    if (formName === 'customer-filter') { state.customerFilters = data; return await renderCustomers(); }
    if (formName === 'case-filter') { state.caseFilters = data; return await renderCases(state.route); }
    if (formName === 'security-filter') { state.securityQuery = data.q || ''; return await renderSecurity(); }
    if (formName === 'communication-filter') { state.communicationFilters = data; return await renderCommunications(); }
    if (formName === 'payment-filter') { state.paymentFilters = data; return await renderPayments(); }
    if (formName === 'audit-filter') { state.auditFilters = data; return await renderAudit(); }
    if (formName === 'new-customer') {
      const result = await api('/api/customers', { method: 'POST', body: JSON.stringify(data) });
      closeModal(); toast('Customer registered', `Universal Customer Number ${result.customerNumber}`); return await renderRoute();
    }
    if (formName === 'update-customer') {
      await api(`/api/customers/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body: JSON.stringify(data) });
      toast('Central customer record updated');
      if (typeof window.renderCustomerRecordWorkspace === 'function') return await window.renderCustomerRecordWorkspace(form.dataset.id);
      return await renderRoute();
    }
    if (formName === 'new-case') {
      if (!data.dueAt) delete data.dueAt;
      const result = await api('/api/cases', { method: 'POST', body: JSON.stringify(data) });
      closeModal(); toast('Case created', result.reference); return await renderRoute();
    }
    if (formName === 'update-case') {
      if (!data.dueAt) data.dueAt = null;
      await api(`/api/cases/${encodeURIComponent(form.dataset.id)}`, { method: 'PUT', body: JSON.stringify(data) });
      toast('Case updated'); return await openCase(form.dataset.id);
    }
    if (formName === 'case-note') {
      await api(`/api/cases/${encodeURIComponent(form.dataset.id)}/notes`, { method: 'POST', body: JSON.stringify(data) });
      toast('Case note added'); return await openCase(form.dataset.id);
    }
    if (formName === 'new-marker') {
      if (!data.riskLevel) delete data.riskLevel; if (!data.visibility) delete data.visibility; if (!data.reviewAt) delete data.reviewAt;
      await api('/api/security/markers', { method: 'POST', body: JSON.stringify(data) });
      closeModal(); toast('Security marker applied'); return await renderRoute();
    }
    if (formName === 'new-restriction') {
      if (!data.reviewAt) delete data.reviewAt; if (!data.expiresAt) delete data.expiresAt;
      const result = await api('/api/security/restrictions', { method: 'POST', body: JSON.stringify(data) });
      closeModal();
      const targets = result.enforcement?.targetPlatforms?.length ? result.enforcement.targetPlatforms.join(', ') : 'the selected scope';
      const identity = result.enforcement?.microsoft?.status === 'enforced' ? ' JA Group Services ID access and sessions were also controlled.' : '';
      toast('Restriction applied and enforced', `Instructions issued to ${targets}.${identity}`);
      return await renderRoute();
    }
    if (formName === 'new-communication') {
      await api('/api/communications', { method: 'POST', body: JSON.stringify(data) });
      closeModal(); toast('Communication recorded'); return await renderRoute();
    }
    if (formName === 'new-payment') {
      data.amountMinor = Math.round(Number(data.amount) * 100); delete data.amount;
      const result = await api('/api/payments', { method: 'POST', body: JSON.stringify(data) });
      closeModal(); toast('Payment reference recorded', result.approvalId ? 'An approval request was created.' : ''); return await renderRoute();
    }
    if (formName === 'record-action') {
      const action = form.dataset.actionName;
      const id = form.dataset.id;
      if (action === 'marker-review') await api(`/api/security/markers/${id}`, { method: 'PUT', body: JSON.stringify({ action: 'review', reviewAt: data.value || undefined }) });
      if (action === 'marker-clear') await api(`/api/security/markers/${id}`, { method: 'PUT', body: JSON.stringify({ action: 'clear' }) });
      if (action === 'restriction-review') await api(`/api/security/restrictions/${id}`, { method: 'PUT', body: JSON.stringify({ action: 'review', reviewAt: data.value || undefined }) });
      if (action === 'restriction-lift') {
        const result = await api(`/api/security/restrictions/${id}`, { method: 'PUT', body: JSON.stringify({ action: 'lift' }) });
        const identity = result.enforcement?.microsoft?.status === 'enforced' ? ' JA Group Services ID access was restored.' : '';
        toast('Restriction lifted', `Connected websites were instructed to refresh access.${identity}`);
      }
      if (action.startsWith('approval-')) await api(`/api/approvals/${id}`, { method: 'PUT', body: JSON.stringify({ decision: action.slice(9), reason: data.value }) });
      closeModal();
      if (action !== 'restriction-lift') toast('Controlled action recorded');
      return await renderRoute();
    }
    if (formName === 'register-platform') {
      await api('/api/platforms', { method: 'POST', body: JSON.stringify(data) });
      closeModal(); toast('Platform registered'); state.reference = await api('/api/reference'); renderNavigation(); return await renderPlatforms();
    }
    if (formName === 'generate-key') {
      const scopes = [...new FormData(form).getAll('scopes')];
      const result = await api(`/api/platforms/${encodeURIComponent(form.dataset.id)}/credentials`, { method: 'POST', body: JSON.stringify({ name: data.name, scopes }) });
      openModal('Copy connector key now', 'This secret cannot be viewed again after the window is closed.', `<div class="notice danger"><span>!</span><div><strong>Secret credential</strong><br>Store this key securely. Do not send it by email or place it in source code.</div></div><pre class="key-output" id="generatedKey">${escapeHtml(result.credential.token)}</pre><div class="form-actions"><button class="button primary" data-action="copy-key">Copy key</button><button class="button secondary" data-close-modal>Close</button></div>`, 'Platform credential');
      return await renderPlatforms();
    }
    if (formName === 'edit-roles') {
      const roles = [...new FormData(form).getAll('roles')];
      await api(`/api/administration/staff/${encodeURIComponent(form.dataset.id)}/roles`, { method: 'PUT', body: JSON.stringify({ roles }) });
      closeModal(); toast('Staff roles updated'); state.reference = await api('/api/reference'); renderNavigation(); return await renderStaff();
    }
    if (formName === 'settings') {
      const status = $('[data-form-status]', form); status.textContent = 'Saving configuration…';
      const values = {};
      for (const element of form.elements) if (element.name) values[element.name] = element.type === 'checkbox' ? element.checked : element.type === 'number' ? Number(element.value) : element.value;
      await Promise.all(Object.entries(values).map(([key, value]) => api('/api/configuration', { method: 'PUT', body: JSON.stringify({ key, value }) })));
      status.textContent = 'Configuration saved and recorded in the audit history.';
      state.reference = await api('/api/reference');
    }
  } catch (error) {
    if (errorElement) errorElement.textContent = error.message; else toast('Action could not be completed', error.message, 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
}

async function handleClick(target) {
  const route = target.closest('[data-route]')?.dataset.route;
  if (route) return navigate(route);
  if (target.closest('[data-close-modal]')) return closeModal();
  const row = target.closest('[data-open]');
  if (row && !target.closest('button')) return row.dataset.open === 'customer' ? navigate(`customers/${encodeURIComponent(row.dataset.id)}`) : openCase(row.dataset.id);
  const element = target.closest('[data-action]');
  if (!element) return;
  const action = element.dataset.action;
  if (action === 'new-customer') return newCustomerModal();
  if (action === 'new-case') return newCaseModal(element.dataset.caseType || '');
  if (action === 'new-marker') return newMarkerModal();
  if (action === 'new-restriction') return newRestrictionModal();
  if (action === 'new-communication') return newCommunicationModal();
  if (action === 'new-payment') return newPaymentModal();
  if (action === 'new-case-for-customer') { closeModal(); newCaseModal(); $('[name="customerNumber"]', $('#modalContent')).value = element.dataset.customer; return; }
  if (action === 'new-communication-for-customer') return newCommunicationModal(element.dataset.customer, '');
  if (action === 'new-marker-for-customer') return newMarkerModal(element.dataset.customer, '');
  if (action === 'new-restriction-for-customer') return newRestrictionModal(element.dataset.customer, '');
  if (action === 'new-communication-for-case') return newCommunicationModal(element.dataset.customer, element.dataset.case);
  if (action === 'new-marker-for-case') return newMarkerModal(element.dataset.customer, element.dataset.case);
  if (action === 'new-restriction-for-case') return newRestrictionModal(element.dataset.customer, element.dataset.case);
  if (['marker-review','marker-clear','restriction-review','restriction-lift'].includes(action)) return actionConfirmation(label(action), 'This decision will be written to the immutable audit history and sent to connected websites.', action, element.dataset.id, label(action), ['marker-clear','restriction-lift'].includes(action));
  if (action === 'approval-decision') return actionConfirmation(`${label(element.dataset.decision)} approval`, 'Record the reason for this formal decision.', `approval-${element.dataset.decision}`, element.dataset.id, label(element.dataset.decision), element.dataset.decision === 'declined');
  if (action === 'register-platform') return modalForm('Register platform', 'Create the Head Office identity for a connected website or service.', { form: 'register-platform', html: '<div class="form-grid"><label class="field"><span>Platform name</span><input name="name" maxlength="120" required></label><label class="field"><span>Platform code</span><input name="code" maxlength="40" pattern="[A-Za-z0-9_-]+" required></label></div>' }, 'Register platform', 'Connected websites & services');
  if (action === 'generate-key') return modalForm('Generate connector key', `Issue a scoped API credential for ${element.dataset.name}.`, { form: 'generate-key', attributes: `data-id="${element.dataset.id}"`, html: '<label class="field"><span>Credential name</span><input name="name" maxlength="120" placeholder="Production connector" required></label><fieldset class="field"><legend>Scopes</legend><label><input type="checkbox" name="scopes" value="customers:read" checked> Read customer identities</label><label><input type="checkbox" name="scopes" value="customers:write"> Register and link customers</label><label><input type="checkbox" name="scopes" value="security:read" checked> Read enforceable security controls</label></fieldset>' }, 'Generate key', 'Platform credential');
  if (action === 'copy-key') { await navigator.clipboard.writeText($('#generatedKey').textContent); return toast('Connector key copied'); }
  if (action === 'edit-roles') {
    const data = await api('/api/administration');
    const staff = data.staff.find(item => item.id === element.dataset.id);
    const assigned = new Set((staff.role_codes || '').split(',').map(value => value.trim().toUpperCase()).filter(Boolean));
    return openModal('Edit staff roles', `${staff.display_name} · ${staff.email}`, `<form data-form="edit-roles" data-id="${staff.id}"><div class="summary-list">${data.roles.filter(role => role.status === 'active').map(role => `<label class="summary-item"><span>${escapeHtml(role.code)}</span><strong><input type="checkbox" name="roles" value="${escapeHtml(role.code)}" ${assigned.has(role.code.toUpperCase()) ? 'checked' : ''}> ${escapeHtml(role.name)}</strong><small>${escapeHtml(role.description)}</small></label>`).join('')}</div><p class="form-error"></p><div class="form-actions"><button type="button" class="button secondary" data-close-modal>Cancel</button><button class="button primary">Save roles</button></div></form>`, 'Staff & access');
  }
}
