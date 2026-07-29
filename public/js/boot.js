const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let customerDirectoryModulePromise = null;
let customerAutomationModulePromise = null;
let diditOperationsModulePromise = null;
let securityOperationsModulePromise = null;
let stripeReconciliationModulePromise = null;
let systemControlModulePromise = null;
let automationCentreModulePromise = null;

function loadCustomerDirectoryModule() {
  if (customerDirectoryModulePromise) return customerDirectoryModulePromise;
  customerDirectoryModulePromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-customer-directory]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/customer-directory.css?v=20260728-directory-1';
      style.dataset.customerDirectory = 'true';
      document.head.append(style);
    }
    if (document.querySelector('script[data-customer-directory]')) return resolve();
    const script = document.createElement('script');
    script.src = '/js/customer-directory.js?v=20260728-directory-1';
    script.async = false;
    script.dataset.customerDirectory = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('The Microsoft customer-directory module could not be loaded.')), { once: true });
    document.head.append(script);
  });
  return customerDirectoryModulePromise;
}

function loadCustomerAutomationModule() {
  if (customerAutomationModulePromise) return customerAutomationModulePromise;
  customerAutomationModulePromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-customer-automation]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/customer-automation.css?v=20260728-automation-1';
      style.dataset.customerAutomation = 'true';
      document.head.append(style);
    }
    if (document.querySelector('script[data-customer-automation]')) return resolve();
    const script = document.createElement('script');
    script.src = '/js/customer-automation.js?v=20260728-automation-1';
    script.async = false;
    script.dataset.customerAutomation = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('The automated customer-operations module could not be loaded.')), { once: true });
    document.head.append(script);
  });
  return customerAutomationModulePromise;
}

function loadDiditOperationsModule() {
  if (diditOperationsModulePromise) return diditOperationsModulePromise;
  diditOperationsModulePromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-didit-operations]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/didit-operations.css?v=20260729-didit-1';
      style.dataset.diditOperations = 'true';
      document.head.append(style);
    }
    if (document.querySelector('script[data-didit-operations]')) return resolve();
    const script = document.createElement('script');
    script.src = '/js/didit-operations.js?v=20260729-didit-1';
    script.async = false;
    script.dataset.diditOperations = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('The Didit Identity Verification Centre could not be loaded.')), { once: true });
    document.head.append(script);
  });
  return diditOperationsModulePromise;
}

function loadSecurityOperationsModule() {
  if (securityOperationsModulePromise) return securityOperationsModulePromise;
  securityOperationsModulePromise = new Promise((resolve, reject) => {
    if (document.querySelector('script[data-security-operations-centre]')) return resolve();
    const script = document.createElement('script');
    script.src = '/js/security-operations-centre.js?v=20260729-soc-1';
    script.async = false;
    script.dataset.securityOperationsCentre = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('The Head Office Security Operations Centre could not be loaded.')), { once: true });
    document.head.append(script);
  });
  return securityOperationsModulePromise;
}

function loadStripeReconciliationModule() {
  if (stripeReconciliationModulePromise) return stripeReconciliationModulePromise;
  stripeReconciliationModulePromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-stripe-reconciliation]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/stripe-reconciliation.css?v=20260729-stripe-data-1';
      style.dataset.stripeReconciliation = 'true';
      document.head.append(style);
    }
    if (document.querySelector('script[data-stripe-reconciliation]')) return resolve();
    const script = document.createElement('script');
    script.src = '/js/stripe-reconciliation.js?v=20260729-stripe-data-1';
    script.async = false;
    script.dataset.stripeReconciliation = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('The Stripe reconciliation workspace could not be loaded.')), { once: true });
    document.head.append(script);
  });
  return stripeReconciliationModulePromise;
}

function loadSystemControlModule() {
  if (systemControlModulePromise) return systemControlModulePromise;
  systemControlModulePromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-system-control]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/system-control.css?v=20260729-system-control-1';
      style.dataset.systemControl = 'true';
      document.head.append(style);
    }
    if (document.querySelector('script[data-system-control]')) return resolve();
    const script = document.createElement('script');
    script.src = '/js/system-control.js?v=20260729-system-control-1';
    script.async = false;
    script.dataset.systemControl = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('The System Test Centre and Settings workspace could not be loaded.')), { once: true });
    document.head.append(script);
  });
  return systemControlModulePromise;
}

function loadAutomationCentreModule() {
  if (automationCentreModulePromise) return automationCentreModulePromise;
  automationCentreModulePromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-automation-centre]')) {
      const style = document.createElement('link');
      style.rel = 'stylesheet';
      style.href = '/automation-centre.css?v=20260730-automation-centre-1';
      style.dataset.automationCentre = 'true';
      document.head.append(style);
    }
    if (document.querySelector('script[data-automation-centre]')) return resolve();
    const script = document.createElement('script');
    script.src = '/js/automation-centre.js?v=20260730-automation-centre-1';
    script.async = false;
    script.dataset.automationCentre = 'true';
    script.addEventListener('load', resolve, { once: true });
    script.addEventListener('error', () => reject(new Error('The Automation and Scheduling Centre could not be loaded.')), { once: true });
    document.head.append(script);
  });
  return automationCentreModulePromise;
}

function ensureCustomerDirectoryNavigation() {
  if (document.querySelector('[data-route="customer-directory"]')) return;
  const connectedSystems = document.querySelector('[data-route="platforms"]');
  const button = document.createElement('button');
  button.className = 'nav-item';
  button.dataset.route = 'customer-directory';
  button.dataset.permission = 'platforms:read';
  button.textContent = 'Microsoft customer directory';
  connectedSystems?.parentElement?.insertBefore(button, connectedSystems);
}

function ensureSystemControlNavigation() {
  const settings = document.querySelector('#mainNavigation [data-route="settings"]');
  if (!settings?.parentElement) return;
  if (!document.querySelector('#mainNavigation [data-route="automation-centre"]')) {
    const automation = document.createElement('button');
    automation.type = 'button';
    automation.className = 'nav-item';
    automation.dataset.route = 'automation-centre';
    automation.dataset.permission = 'configuration:read';
    automation.textContent = 'Automation & Scheduling Centre';
    settings.parentElement.insertBefore(automation, settings);
  }
  if (!document.querySelector('#mainNavigation [data-route="test-centre"]')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item';
    button.dataset.route = 'test-centre';
    button.dataset.permission = 'configuration:read';
    button.textContent = 'System Test Centre';
    settings.parentElement.insertBefore(button, settings);
  }
  settings.textContent = 'System Settings';
}

async function loadSession(authResult) {
  let result = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result = await api('/api/auth/session');
    if (result.authenticated || authResult !== 'success') return result;
    await pause(300 * (attempt + 1));
  }
  return result;
}

async function loadReference() {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try { return await api('/api/reference'); }
    catch (error) {
      lastError = error;
      if (error.status === 401 || error.status === 403) throw error;
      await pause(400 * (attempt + 1));
    }
  }
  throw lastError;
}

function showStartupFailure(error) {
  $('#viewRoot').innerHTML = `<div class="panel"><div class="empty-state"><strong>You are signed in, but Head Office services did not finish starting</strong><span>${escapeHtml(error.message || 'The service is temporarily unavailable.')}</span><div style="margin-top:16px"><button class="button primary" id="retryStartupButton">Retry opening Head Office</button></div></div></div>`;
  $('#retryStartupButton')?.addEventListener('click', () => boot());
}

async function boot() {
  const fragment = new URLSearchParams(location.hash.startsWith('#auth_session=') ? location.hash.slice(1) : '');
  const query = new URLSearchParams(location.search);
  const handoff = fragment.get('auth_session') || query.get('auth_session');
  if (handoff) retainSession(handoff);
  const authResult = query.get('auth_result');
  query.delete('auth_result');
  query.delete('auth_session');
  if (handoff || authResult) history.replaceState({}, '', `${location.pathname}${query.toString() ? `?${query}` : ''}#/security-operations`);

  try {
    state.session = await loadSession(authResult);
    if (!state.session.configured) return showLogin('Microsoft staff sign-in has not been configured in Cloudflare.');
    $('#microsoftLogin').hidden = !state.session.microsoft?.configured;
    if (!state.session.authenticated) {
      return showLogin(authResult === 'success'
        ? `Microsoft approved the sign-in, but the Centre could not establish the staff session (${state.session.sessionStatus || 'unknown'}).`
        : '');
    }
  } catch (error) {
    return showLogin(error.message);
  }

  showApp();
  setLoading('Opening automated Head Office services…');
  try {
    await Promise.all([loadCustomerDirectoryModule(), loadCustomerAutomationModule(), loadDiditOperationsModule(), loadSystemControlModule()]);
    await loadAutomationCentreModule();
    ensureCustomerDirectoryNavigation();
    ensureSystemControlNavigation();
    window.ensureDiditNavigation?.();
    state.reference = await loadReference();
    renderNavigation();
    await loadSecurityOperationsModule();
    await loadStripeReconciliationModule();
    window.ensureSecurityOperationsNavigation?.();
    ensureSystemControlNavigation();
    renderNavigation();
    const initialRoute = location.hash.startsWith('#/') ? routeFromHash() : (hasPermission('risk:read') ? 'security-operations' : 'dashboard');
    navigate(initialRoute, true);
  } catch (error) {
    showStartupFailure(error);
  }
}

$('#menuButton').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
$('#signOutButton').addEventListener('click', async () => {
  const result = await api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => ({}));
  clearSession();
  if (result.redirect) location.assign(result.redirect); else location.reload();
});
$('#globalSearch').addEventListener('keydown', event => {
  if (event.key === 'Enter') { state.customerFilters.q = event.currentTarget.value.trim(); navigate('customers'); }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#globalSearch').focus(); }
  if (event.key === 'Escape' && $('#modal').open) closeModal();
});
document.addEventListener('click', event => handleClick(event.target).catch(error => toast('Action could not be completed', error.message, 'error')));
document.addEventListener('submit', event => { event.preventDefault(); handleForm(event.target); });
window.addEventListener('hashchange', () => renderRoute(routeFromHash()));
setInterval(() => { $('#systemClock').textContent = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date()); }, 1000);
boot();
