const originalNewCaseModalV7 = newCaseModal;
newCaseModal = function(forcedType = '') {
  const caseTypes = ['general','security','complaint','refund','payment_dispute','account_recovery',...(hasPermission('data_protection:*') ? ['data_protection'] : []),...(hasPermission('safeguarding:*') ? ['safeguarding'] : [])];
  modalForm('Create Head Office case','Open a controlled workflow with specialist complaint, refund and dispute records where relevant.',{form:'new-case',html:`<div class="form-grid"><label class="field"><span>Case type</span><select name="caseType" required>${caseTypes.map(value=>`<option value="${value}" ${forcedType===value?'selected':''}>${label(value)}</option>`).join('')}</select></label><label class="field"><span>Priority</span><select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option><option value="low">Low</option></select></label><label class="field"><span>Universal customer number</span><input name="customerNumber" maxlength="10" inputmode="numeric"></label><label class="field"><span>Originating division</span><select name="platformId">${options(state.reference.platforms,'id','name','','None / Head Office')}</select></label><label class="field full"><span>Case title</span><input name="title" maxlength="160" required></label><label class="field full"><span>Summary, allegation or requested outcome</span><textarea name="description" maxlength="4000" required></textarea></label><label class="field"><span>Due date</span><input name="dueAt" type="datetime-local"></label></div><fieldset class="form-section"><legend>Refund or dispute details</legend><p class="help-text">Complete these fields for refund and payment-dispute cases.</p><div class="form-grid"><label class="field"><span>Provider</span><input name="provider" value="Stripe" maxlength="100"></label><label class="field"><span>Transaction reference</span><input name="transactionReference" maxlength="180"></label><label class="field"><span>Amount</span><input name="amount" type="number" min="0" step="0.01"></label><label class="field"><span>Currency</span><input name="currency" value="GBP" maxlength="3"></label><label class="field"><span>Reason code</span><input name="reasonCode" maxlength="100"></label><label class="field"><span>Payment fingerprint hash</span><input name="paymentFingerprintHash" maxlength="128"></label></div><label class="check-row"><input type="checkbox" name="fraudSuspected"> Fraud, abuse or account takeover is suspected</label></fieldset>`},'Create case','Head Office workflow');
};

newPaymentModal = function() {
  modalForm('Record payment or refund','Store the provider reference and pass relevant activity through the central risk engine.',{form:'new-payment',html:`<div class="form-grid"><label class="field"><span>Universal customer number</span><input name="customerNumber" maxlength="10"></label><label class="field"><span>Linked case reference</span><input name="caseReference" maxlength="30"></label><label class="field"><span>Provider</span><input name="provider" value="Stripe" maxlength="80" required></label><label class="field"><span>Provider payment reference</span><input name="providerPaymentReference" maxlength="200" required></label><label class="field"><span>Provider customer reference</span><input name="providerCustomerReference" maxlength="200"></label><label class="field"><span>Division</span><select name="platformId">${options(state.reference.platforms,'id','name','','Head Office / none')}</select></label><label class="field"><span>Amount</span><input name="amount" type="number" min="0" step="0.01" required></label><label class="field"><span>Currency</span><input name="currency" value="GBP" maxlength="3" required></label><label class="field"><span>Status</span><select name="status"><option value="captured">Captured</option><option value="pending">Pending</option><option value="authorised">Authorised</option><option value="failed">Failed</option><option value="refund_requested">Refund requested</option><option value="refunded">Refunded</option><option value="disputed">Disputed</option><option value="cancelled">Cancelled</option></select></label><label class="field"><span>Date and time</span><input name="occurredAt" type="datetime-local" value="${formatDateInput(new Date())}"></label><label class="field"><span>Country code</span><input name="countryCode" maxlength="2" placeholder="GB"></label><label class="field"><span>Device hash</span><input name="deviceHash" maxlength="128"></label><label class="field"><span>IP hash</span><input name="ipHash" maxlength="128"></label><label class="field"><span>Payment fingerprint hash</span><input name="paymentFingerprintHash" maxlength="128"></label></div><label class="check-row"><input type="checkbox" name="newDevice"> Newly observed device</label>`},'Record and assess','Payments & risk intelligence');
};

const priorHandleFormV7Money = handleForm;
handleForm = async function(form) {
  const name = form.dataset.form;
  if (!['new-case','new-payment'].includes(name)) return priorHandleFormV7Money(form);
  const data = Object.fromEntries(new FormData(form));
  const errorElement = $('.form-error',form);
  const submit = $('button[type="submit"],button:not([type])',form);
  if (submit) submit.disabled = true;
  try {
    if (data.amount !== undefined && data.amount !== '') data.amountMinor = Math.round(Number(data.amount) * 100);
    delete data.amount;
    data.fraudSuspected = Boolean($('[name="fraudSuspected"]',form)?.checked);
    data.newDevice = Boolean($('[name="newDevice"]',form)?.checked);
    if (!data.dueAt) delete data.dueAt;
    if (name === 'new-case') {
      const result = await api('/api/cases',{method:'POST',body:JSON.stringify(data)});
      closeModal();
      toast('Case created',result.risk ? `${result.reference} · ${result.risk.riskLevel} risk` : result.reference);
      return renderRoute();
    }
    const result = await api('/api/payments',{method:'POST',body:JSON.stringify(data)});
    closeModal();
    toast('Payment reference recorded',result.risk ? `${result.risk.riskLevel} · score ${result.risk.score}` : (result.approvalId ? 'Approval request created.' : ''));
    return renderRoute();
  } catch (error) {
    if (errorElement) errorElement.textContent = error.message;
    else toast('Action could not be completed',error.message,'error');
  } finally { if (submit) submit.disabled = false; }
};

const priorHandleClickV7Connector = handleClick;
handleClick = async function(target) {
  const element = target.closest('[data-action]');
  if (element?.dataset.action === 'generate-key') {
    return modalForm('Generate connector key',`Issue a scoped API credential for ${element.dataset.name}.`,{form:'generate-key',attributes:`data-id="${element.dataset.id}"`,html:`<label class="field"><span>Credential name</span><input name="name" maxlength="120" placeholder="Production connector" required></label><fieldset class="field"><legend>Scopes</legend><label><input type="checkbox" name="scopes" value="customers:read" checked> Read customer identities</label><label><input type="checkbox" name="scopes" value="customers:write"> Register and link customers</label><label><input type="checkbox" name="scopes" value="security:read" checked> Read enforceable security controls</label><label><input type="checkbox" name="scopes" value="events:write" checked> Submit security, payment and account events</label><label><input type="checkbox" name="scopes" value="platform:write" checked> Submit website health and deployment information</label></fieldset>`},'Generate key','Platform credential');
  }
  return priorHandleClickV7Connector(target);
};

/* Customer records are full workspace pages, not nested scrolling modals.
   The workspace script is already declared in index.html. Detect that script
   by its src as well as its data marker so it can never be loaded twice. The
   transferred Planyx components provide the workspace styling and must remain
   the final CSS layer, so no late legacy stylesheet is injected here. */
const customerRecordWorkspaceReady = new Promise((resolve, reject) => {
  const existing = document.querySelector('script[data-customer-record-workspace],script[src^="/js/customer-record-workspace.js"]');
  if (existing) {
    existing.dataset.customerRecordWorkspace = 'true';
    if (window.renderCustomerRecordWorkspace) return resolve();
    existing.addEventListener('load', resolve, { once: true });
    existing.addEventListener('error', () => reject(new Error('The customer record workspace could not be loaded.')), { once: true });
    return;
  }

  const script = document.createElement('script');
  script.src = '/js/customer-record-workspace.js?v=20260728-central-1';
  script.async = false;
  script.dataset.customerRecordWorkspace = 'true';
  script.addEventListener('load', resolve, { once: true });
  script.addEventListener('error', () => reject(new Error('The customer record workspace could not be loaded.')), { once: true });
  document.head.append(script);
});

const renderRouteBeforeCustomerWorkspace = renderRoute;
renderRoute = async function(route = routeFromHash()) {
  const resolvedRoute = String(route || '');
  if (!resolvedRoute.startsWith('customers/')) return renderRouteBeforeCustomerWorkspace(resolvedRoute);

  state.route = resolvedRoute;
  $$('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === 'customers'));
  $('#sidebar').classList.remove('open');
  setLoading('Opening the universal customer record…');

  try {
    await customerRecordWorkspaceReady;
    const id = decodeURIComponent(resolvedRoute.slice('customers/'.length));
    if (!id) return navigate('customers', true);
    return await window.renderCustomerRecordWorkspace(id);
  } catch (error) {
    $('#viewRoot').innerHTML = `<div class="panel"><div class="empty-state"><strong>The customer record could not be opened</strong><span>${escapeHtml(error.message)}</span><div style="margin-top:14px"><button class="button secondary" data-route="customers">Return to customer register</button></div></div></div>`;
    toast('Customer record unavailable', error.message, 'error');
  }
};

openCustomer = function(id) {
  closeModal();
  return navigate(`customers/${encodeURIComponent(id)}`);
};
