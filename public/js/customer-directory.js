function directoryStateTag(value) {
  const status = String(value || 'unknown');
  return `<span class="tag ${escapeHtml(status.toLowerCase())}">${escapeHtml(label(status))}</span>`;
}

function directoryCount(value) {
  return Number(value || 0).toLocaleString('en-GB');
}

function directoryMetric(labelText, value, detail) {
  return `<article class="enterprise-metric"><span>${escapeHtml(labelText)}</span><strong>${directoryCount(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
}

async function renderCustomerDirectory() {
  const data = await api('/api/customer-directory/status');
  const connector = data.connector || {};
  const counts = data.counts || {};
  const canManage = hasPermission('administration:write');
  const syncInProgress = connector.status === 'syncing';
  const readiness = [
    enterpriseStatus('Cloudflare secrets', data.configured ? 'Configured' : 'Missing', data.configured ? 'Tenant, client and secret are available to the server.' : 'The three CUSTOMER_ENTRA secrets must be configured.'),
    enterpriseStatus('Microsoft Graph', connector.status || 'not configured', connector.lastTestedAt ? `Last tested ${formatDate(connector.lastTestedAt)}` : 'Connection has not been tested.'),
    enterpriseStatus('Change tracking', syncInProgress ? 'Import in progress' : connector.deltaReady ? 'Delta ready' : 'Initial import required', syncInProgress ? 'The directory is being imported in safe batches and will resume automatically.' : connector.deltaReady ? 'Only directory changes will be requested after the first import.' : 'Run the first full import to establish a Microsoft delta position.'),
    enterpriseStatus('Last successful sync', connector.lastSuccessAt ? formatDate(connector.lastSuccessAt) : 'Never', connector.lastErrorMessage || (syncInProgress ? 'No unresolved error. More directory batches remain.' : 'No unresolved connector error.'))
  ].join('');

  const reviewRows = data.reviews.length ? data.reviews.map(item => `<tr>
    <td>${formatDate(item.created_at)}</td>
    <td><strong>${escapeHtml(item.display_name)}</strong><br><small>${escapeHtml(item.primary_email || 'No usable email')}</small></td>
    <td>${directoryStateTag(item.review_type)}</td>
    <td>${escapeHtml(item.reason)}</td>
    <td>${item.proposed_customer_number ? `<strong class="mono">${escapeHtml(item.proposed_customer_number)}</strong><br><small>${escapeHtml(item.proposed_customer_name || '')}</small>` : '—'}</td>
    <td>${canManage ? `<button class="button secondary small" data-action="directory-review" data-id="${escapeHtml(item.id)}" data-customer="${escapeHtml(item.proposed_customer_number || '')}" data-name="${escapeHtml(item.display_name)}">Decide</button>` : ''}</td>
  </tr>`).join('') : `<tr><td colspan="6">${emptyState('No identity reviews are waiting', 'Microsoft identities have either been linked safely or have not yet been imported.')}</td></tr>`;

  const identityRows = data.identities.length ? data.identities.map(item => `<tr>
    <td><strong>${escapeHtml(item.display_name)}</strong><br><small>${escapeHtml(item.primary_email || 'No sign-in email returned')}</small></td>
    <td class="mono">${escapeHtml(item.customer_number || 'Unlinked')}</td>
    <td>${directoryStateTag(item.directory_status)}</td>
    <td>${item.account_enabled ? '<span class="tag active">Enabled</span>' : '<span class="tag suspended">Disabled</span>'}</td>
    <td>${item.account_status ? directoryStateTag(item.account_status) : '—'}</td>
    <td>${formatDate(item.last_synced_at)}</td>
    <td>${canManage ? `<div class="inline-actions">
      <button class="button secondary small" data-action="directory-profile" data-id="${escapeHtml(item.id)}" data-name="${escapeHtml(item.display_name)}">Profile</button>
      <button class="button secondary small" data-action="directory-account" data-id="${escapeHtml(item.id)}" data-command="revoke_sessions" data-name="${escapeHtml(item.display_name)}">Revoke sessions</button>
      <button class="button ${item.account_enabled ? 'danger' : 'primary'} small" data-action="directory-account" data-id="${escapeHtml(item.id)}" data-command="${item.account_enabled ? 'suspend' : 'reactivate'}" data-name="${escapeHtml(item.display_name)}">${item.account_enabled ? 'Suspend' : 'Reactivate'}</button>
    </div>` : ''}</td>
  </tr>`).join('') : `<tr><td colspan="7">${emptyState('No Microsoft customer identities imported', 'Test the connection, then run the initial import.')}</td></tr>`;

  const runRows = data.runs.length ? data.runs.map(run => `<tr>
    <td>${formatDate(run.started_at)}</td><td>${directoryStateTag(run.mode)}</td><td>${directoryStateTag(run.status)}</td>
    <td>${directoryCount(run.users_received)}</td><td>${directoryCount(run.customers_created)}</td><td>${directoryCount(run.identities_linked)}</td>
    <td>${directoryCount(run.review_items_created)}</td><td>${run.error_message ? escapeHtml(run.error_message) : formatDate(run.completed_at)}</td>
  </tr>`).join('') : `<tr><td colspan="8">${emptyState('No synchronisation runs recorded', 'The first import will create the initial evidence record.')}</td></tr>`;

  $('#viewRoot').innerHTML = `${enterpriseCommandBar('Microsoft customer directory', 'Identity source: JA Group Services ID External ID tenant')}
    <div class="page-heading enterprise-heading"><div><p class="eyebrow">Identity and customer linkage</p><h1>External ID customer directory</h1><p>Read and manage customer identities in Microsoft Entra External ID while preserving one Unique Customer Number and one Head Office customer record across every connected service.</p></div>
      <div class="heading-actions">${canManage ? `<button class="button secondary" data-action="directory-test">Test connection</button><button class="button secondary" data-action="directory-sync" data-mode="delta">Synchronise changes</button><button class="button primary" data-action="directory-sync" data-mode="full">Run full import</button>` : ''}</div></div>
    <section class="enterprise-readiness">${readiness}</section>
    <section class="enterprise-metrics-row directory-metrics">
      ${directoryMetric('Directory identities', counts.total, 'Microsoft users discovered')}
      ${directoryMetric('Linked customers', counts.linked, 'Unique customer records linked')}
      ${directoryMetric('Review required', counts.review_required, 'Identity decisions waiting')}
      ${directoryMetric('Disabled accounts', counts.disabled, 'Microsoft accounts currently disabled')}
      ${directoryMetric('Deleted identities', counts.deleted, 'Retained for evidence and reconciliation')}
    </section>
    ${connector.lastErrorMessage ? `<div class="notice danger"><div><strong>Connector requires attention</strong><br>${escapeHtml(connector.lastErrorMessage)}</div></div>` : ''}
    <div class="directory-layout">
      <section class="panel"><div class="panel-header"><div><h2>Identity review queue</h2><p>Possible matches and incomplete identities are never silently merged.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Raised</th><th>Microsoft identity</th><th>Review</th><th>Reason</th><th>Proposed customer</th><th></th></tr></thead><tbody>${reviewRows}</tbody></table></div></section>
      <section class="panel"><div class="panel-header"><div><h2>Directory identity register</h2><p>Microsoft account state, Unique Customer Number link and last reconciliation.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Microsoft identity</th><th>Customer no.</th><th>Directory state</th><th>Microsoft account</th><th>Head Office account</th><th>Last synced</th><th>Controlled actions</th></tr></thead><tbody>${identityRows}</tbody></table></div></section>
      <section class="panel"><div class="panel-header"><div><h2>Synchronisation evidence</h2><p>Every test, initial import and delta run is retained with counts and failures.</p></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Started</th><th>Mode</th><th>Status</th><th>Received</th><th>Created</th><th>Linked</th><th>Review</th><th>Completed / error</th></tr></thead><tbody>${runRows}</tbody></table></div></section>
    </div>`;
}

function directorySyncModal(mode) {
  const full = mode === 'full';
  modalForm(full ? 'Run full customer-directory import' : 'Synchronise Microsoft directory changes',
    full ? 'This reads the full External ID customer directory in safe batches and establishes a new delta position. Existing evidence is not deleted.' : 'This continues any pending import first, then requests users created, changed or removed since the previous successful sync.',
    { form: 'customer-directory-sync', html: `<input type="hidden" name="mode" value="${full ? 'full' : 'delta'}"><div class="notice"><div><strong>${full ? 'Full reconciliation' : 'Incremental reconciliation'}</strong><br>${full ? 'Use this for the initial import or an authorised recovery exercise. Large directories continue automatically across later batches.' : 'This is the normal repeat synchronisation.'}</div></div>` },
    full ? 'Run import batch' : 'Synchronise changes', 'Microsoft External ID');
}

function directoryAccountModal(element) {
  const command = element.dataset.command;
  const title = { suspend: 'Suspend Microsoft customer account', reactivate: 'Reactivate Microsoft customer account', revoke_sessions: 'Revoke Microsoft customer sessions' }[command];
  const copy = { suspend: 'Microsoft sign-in will be disabled. The Head Office customer record and evidence remain available.', reactivate: 'Microsoft sign-in will be re-enabled unless another Head Office restriction still applies.', revoke_sessions: 'Microsoft will invalidate the customer’s active refresh sessions. A short propagation delay may apply.' }[command];
  modalForm(title, `${element.dataset.name}: ${copy}`, { form: 'customer-directory-account', html: `<input type="hidden" name="identityId" value="${escapeHtml(element.dataset.id)}"><input type="hidden" name="action" value="${escapeHtml(command)}"><label class="field"><span>Operational or security reason</span><textarea name="reason" maxlength="1000" required></textarea></label>` },
    command === 'suspend' ? 'Suspend account' : command === 'reactivate' ? 'Reactivate account' : 'Revoke sessions', 'Controlled identity action');
}

function directoryProfileModal(element) {
  modalForm('Update Microsoft customer profile', `Update ordinary profile fields for ${element.dataset.name}. Sign-in email changes use a separate identity-review process.`, {
    form: 'customer-directory-profile', html: `<input type="hidden" name="identityId" value="${escapeHtml(element.dataset.id)}"><input type="hidden" name="action" value="update_profile"><div class="form-grid"><label class="field full"><span>Display name</span><input name="displayName" maxlength="160" value="${escapeHtml(element.dataset.name || '')}"></label><label class="field"><span>Given name</span><input name="givenName" maxlength="100"></label><label class="field"><span>Surname</span><input name="surname" maxlength="100"></label></div><label class="field"><span>Maintenance note</span><textarea name="reason" maxlength="1000">Head Office customer profile maintenance</textarea></label>`
  }, 'Update Microsoft profile', 'Customer identity maintenance');
}

function directoryReviewModal(element) {
  modalForm('Decide customer identity review', `Confirm how the Microsoft identity for ${element.dataset.name} should be handled.`, {
    form: 'customer-directory-review', attributes: `data-review-id="${escapeHtml(element.dataset.id)}"`, html: `<label class="field"><span>Decision</span><select name="decision"><option value="link_existing">Link to an existing unique customer</option><option value="create_new">Create a new unique customer</option><option value="dismiss">Dismiss without linking</option></select></label><label class="field"><span>Existing Unique Customer Number</span><input name="customerId" maxlength="100" value="${escapeHtml(element.dataset.customer || '')}" placeholder="Required when linking to an existing customer"></label><label class="field"><span>Decision reason and evidence</span><textarea name="reason" maxlength="1000" required></textarea></label>`
  }, 'Record identity decision', 'Identity reconciliation');
}

if (typeof OPS_ROUTE_LABELS !== 'undefined') OPS_ROUTE_LABELS['customer-directory'] = 'Customer Directory';

const customerDirectoryBaseRenderRoute = renderRoute;
renderRoute = async function customerDirectoryRoute(route = routeFromHash()) {
  if (route !== 'customer-directory') return customerDirectoryBaseRenderRoute(route);
  state.route = route;
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === route));
  $('#sidebar')?.classList.remove('open');
  if (typeof updateOperationsRouteChrome === 'function') updateOperationsRouteChrome(route);
  setLoading('Opening Microsoft customer directory…');
  try { return await renderCustomerDirectory(); }
  catch (error) { $('#viewRoot').innerHTML = `<section class="panel"><div class="empty-state"><strong>The customer directory could not be opened</strong><span>${escapeHtml(error.message)}</span></div></section>`; }
};

const customerDirectoryBaseHandleClick = handleClick;
handleClick = async function customerDirectoryClick(target) {
  const element = target.closest('[data-action]');
  if (!element) return customerDirectoryBaseHandleClick(target);
  if (element.dataset.action === 'directory-test') {
    element.disabled = true;
    try { const result = await api('/api/customer-directory/test', { method: 'POST', body: '{}' }); toast('Microsoft connection confirmed', result.sampleAvailable ? 'Customer users are available.' : 'Connection succeeded; no customer sample was returned.'); return renderRoute('customer-directory'); }
    finally { element.disabled = false; }
  }
  if (element.dataset.action === 'directory-sync') return directorySyncModal(element.dataset.mode);
  if (element.dataset.action === 'directory-account') return directoryAccountModal(element);
  if (element.dataset.action === 'directory-profile') return directoryProfileModal(element);
  if (element.dataset.action === 'directory-review') return directoryReviewModal(element);
  return customerDirectoryBaseHandleClick(target);
};

const customerDirectoryBaseHandleForm = handleForm;
handleForm = async function customerDirectoryForm(form) {
  const name = form.dataset.form;
  if (!['customer-directory-sync', 'customer-directory-account', 'customer-directory-profile', 'customer-directory-review'].includes(name)) return customerDirectoryBaseHandleForm(form);
  const body = Object.fromEntries(new FormData(form));
  const submit = $('button[type="submit"],button:not([type])', form);
  const errorElement = $('.form-error', form);
  if (submit) submit.disabled = true;
  if (errorElement) errorElement.textContent = '';
  try {
    if (name === 'customer-directory-sync') {
      const result = await api('/api/customer-directory/sync', { method: 'POST', body: JSON.stringify({ mode: body.mode }) });
      closeModal();
      toast(result.partial ? 'Directory batch completed' : 'Customer directory synchronised', result.partial
        ? `${directoryCount(result.stats.received)} Microsoft identities processed. More remain and will continue automatically.`
        : `${directoryCount(result.stats.received)} Microsoft identities processed.`);
      return renderRoute('customer-directory');
    }
    if (name === 'customer-directory-review') {
      body.reviewId = form.dataset.reviewId;
      const result = await api('/api/customer-directory/reviews', { method: 'PUT', body: JSON.stringify(body) });
      closeModal(); toast('Identity decision recorded', result.status); return renderRoute('customer-directory');
    }
    const result = await api('/api/customer-directory/accounts', { method: 'PUT', body: JSON.stringify(body) });
    closeModal(); toast('Microsoft customer account updated', label(result.action)); return renderRoute('customer-directory');
  } catch (error) {
    if (errorElement) errorElement.textContent = error.message;
    else toast('Directory action failed', error.message, 'error');
  } finally { if (submit) submit.disabled = false; }
};
