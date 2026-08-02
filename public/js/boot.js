const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const MODULE_LOAD_TIMEOUT_MS = 8_000;
let principalPinModulePromise = null;
let customerDirectoryModulePromise = null;
let customerAutomationModulePromise = null;
let diditOperationsModulePromise = null;
let securityOperationsModulePromise = null;
let stripeReconciliationModulePromise = null;
let systemControlModulePromise = null;
let automationCentreModulePromise = null;
let automationSettingsExtensionPromise = null;
let bootPromise = null;
let bootGeneration = 0;
let entranceHealthPromise = null;

function ensureModuleStylesheet(selector, href, datasetProperty) {
  if (document.querySelector(selector)) return;
  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = href;
  style.dataset[datasetProperty] = 'true';
  document.head.insertBefore(style, document.getElementById('professionalInterfaceStyles') || null);
}

function loadScriptOnce({ selector, src, datasetProperty, errorMessage }) {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${errorMessage} The request timed out.`));
    }, MODULE_LOAD_TIMEOUT_MS);

    const finish = callback => event => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(event);
    };

    script.src = src;
    script.async = false;
    script.dataset[datasetProperty] = 'true';
    script.addEventListener('load', finish(resolve), { once: true });
    script.addEventListener('error', finish(() => reject(new Error(errorMessage))), { once: true });
    document.head.append(script);
  });
}

function loadPrincipalPinModule() {
  if (principalPinModulePromise) return principalPinModulePromise;
  ensureModuleStylesheet('link[data-principal-pin]', '/principal-pin.css?v=20260802-pin-1', 'principalPin');
  principalPinModulePromise = loadScriptOnce({
    selector: 'script[data-principal-pin]',
    src: '/js/principal-pin.js?v=20260802-pin-1',
    datasetProperty: 'principalPin',
    errorMessage: 'The personal Head Office PIN module could not be loaded.'
  });
  return principalPinModulePromise;
}

function loadCustomerDirectoryModule() {
  if (customerDirectoryModulePromise) return customerDirectoryModulePromise;
  ensureModuleStylesheet('link[data-customer-directory]', '/customer-directory.css?v=20260728-directory-1', 'customerDirectory');
  customerDirectoryModulePromise = loadScriptOnce({
    selector: 'script[data-customer-directory]',
    src: '/js/customer-directory.js?v=20260728-directory-1',
    datasetProperty: 'customerDirectory',
    errorMessage: 'The Microsoft customer-directory module could not be loaded.'
  });
  return customerDirectoryModulePromise;
}

function loadCustomerAutomationModule() {
  if (customerAutomationModulePromise) return customerAutomationModulePromise;
  ensureModuleStylesheet('link[data-customer-automation]', '/customer-automation.css?v=20260728-automation-1', 'customerAutomation');
  customerAutomationModulePromise = loadScriptOnce({
    selector: 'script[data-customer-automation]',
    src: '/js/customer-automation.js?v=20260728-automation-1',
    datasetProperty: 'customerAutomation',
    errorMessage: 'The automated customer-operations module could not be loaded.'
  });
  return customerAutomationModulePromise;
}

function loadDiditOperationsModule() {
  if (diditOperationsModulePromise) return diditOperationsModulePromise;
  ensureModuleStylesheet('link[data-didit-operations]', '/didit-operations.css?v=20260729-didit-1', 'diditOperations');
  diditOperationsModulePromise = loadScriptOnce({
    selector: 'script[data-didit-operations]',
    src: '/js/didit-operations.js?v=20260729-didit-1',
    datasetProperty: 'diditOperations',
    errorMessage: 'The Didit Identity Verification Centre could not be loaded.'
  });
  return diditOperationsModulePromise;
}

function loadSecurityOperationsModule() {
  if (securityOperationsModulePromise) return securityOperationsModulePromise;
  securityOperationsModulePromise = loadScriptOnce({
    selector: 'script[data-security-operations-centre]',
    src: '/js/security-operations-centre.js?v=20260802-control-centre-1',
    datasetProperty: 'securityOperationsCentre',
    errorMessage: 'The Head Office Security Operations Centre could not be loaded.'
  });
  return securityOperationsModulePromise;
}

function loadStripeReconciliationModule() {
  if (stripeReconciliationModulePromise) return stripeReconciliationModulePromise;
  ensureModuleStylesheet('link[data-stripe-reconciliation]', '/stripe-reconciliation.css?v=20260729-stripe-data-1', 'stripeReconciliation');
  stripeReconciliationModulePromise = loadScriptOnce({
    selector: 'script[data-stripe-reconciliation]',
    src: '/js/stripe-reconciliation.js?v=20260729-stripe-data-1',
    datasetProperty: 'stripeReconciliation',
    errorMessage: 'The Stripe reconciliation workspace could not be loaded.'
  });
  return stripeReconciliationModulePromise;
}

function loadSystemControlModule() {
  if (systemControlModulePromise) return systemControlModulePromise;
  ensureModuleStylesheet('link[data-system-control]', '/system-control.css?v=20260729-system-control-1', 'systemControl');
  systemControlModulePromise = loadScriptOnce({
    selector: 'script[data-system-control]',
    src: '/js/system-control.js?v=20260729-system-control-1',
    datasetProperty: 'systemControl',
    errorMessage: 'The System Test Centre and Settings workspace could not be loaded.'
  });
  return systemControlModulePromise;
}

function loadAutomationCentreModule() {
  if (automationCentreModulePromise) return automationCentreModulePromise;
  ensureModuleStylesheet('link[data-automation-centre]', '/automation-centre.css?v=20260730-automation-centre-1', 'automationCentre');
  automationCentreModulePromise = loadScriptOnce({
    selector: 'script[data-automation-centre]',
    src: '/js/automation-centre.js?v=20260730-automation-centre-1',
    datasetProperty: 'automationCentre',
    errorMessage: 'The Automation and Scheduling Centre could not be loaded.'
  });
  return automationCentreModulePromise;
}

function loadAutomationSettingsExtension() {
  if (automationSettingsExtensionPromise) return automationSettingsExtensionPromise;
  automationSettingsExtensionPromise = loadScriptOnce({
    selector: 'script[data-automation-settings-extension]',
    src: '/js/automation-settings-extension.js?v=20260730-automation-centre-1',
    datasetProperty: 'automationSettingsExtension',
    errorMessage: 'The scheduler controls could not be added to System Settings.'
  });
  return automationSettingsExtensionPromise;
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
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result = await api('/api/auth/session', { timeoutMs: 8_000 });
    if (result.authenticated || authResult !== 'success') return result;
    await pause(300 * (attempt + 1));
  }
  return result;
}

async function loadReference() {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await api('/api/reference', { timeoutMs: 8_000 }); }
    catch (error) {
      lastError = error;
      if (error.status === 401 || error.status === 403) throw error;
      if (attempt === 0) await pause(500);
    }
  }
  throw lastError;
}

async function initialiseOptionalModules(generation) {
  const namedLoad = async (name, loader) => {
    await loader();
    return name;
  };

  const primaryResults = await Promise.allSettled([
    namedLoad('customer-directory', loadCustomerDirectoryModule),
    namedLoad('customer-automation', loadCustomerAutomationModule),
    namedLoad('didit-operations', loadDiditOperationsModule),
    namedLoad('system-control', loadSystemControlModule),
    namedLoad('automation-centre', loadAutomationCentreModule)
  ]);

  ensureCustomerDirectoryNavigation();
  ensureSystemControlNavigation();
  window.ensureDiditNavigation?.();
  renderNavigation();

  const extensionResults = await Promise.allSettled([
    namedLoad('automation-settings', loadAutomationSettingsExtension),
    namedLoad('security-operations', loadSecurityOperationsModule),
    namedLoad('stripe-reconciliation', loadStripeReconciliationModule)
  ]);

  window.ensureSecurityOperationsNavigation?.();
  ensureSystemControlNavigation();
  renderNavigation();

  const results = [...primaryResults, ...extensionResults];
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    toast(
      'Some specialist tools are temporarily unavailable',
      `${failures.length} optional module${failures.length === 1 ? '' : 's'} did not load. Core customer and security records remain available.`,
      'error'
    );
  }

  if (generation !== bootGeneration || !state.session?.authenticated) return;
}

const directRoute = /^(?:control-room|dashboard|risk-intelligence|incidents-v7|central-operations|security-levels|security-procedures|customers(?:\/[^/?#]+)?|cases|complaints|data-protection|safeguarding|security|communications|payments|platforms|staff|audit|settings|my-profile|my-security|personalisation|notifications|customer-service-controls|customer-protection|redress-centre)$/;

async function prepareRequestedRoute(route) {
  if (directRoute.test(route)) {
    if (route === 'customer-service-controls') await window.ensureCustomerServiceAssets?.();
    if (route === 'settings') {
      await loadSystemControlModule();
      await loadAutomationSettingsExtension();
    }
    if (route === 'customer-protection' || route === 'redress-centre' || route === 'central-operations') ensureWorkspaceStyles();
    return route;
  }
  const loaders = {
    'customer-directory': loadCustomerDirectoryModule,
    'automation-centre': loadAutomationCentreModule,
    'test-centre': loadSystemControlModule,
    'identity-verifications': loadDiditOperationsModule,
    'security-operations': loadSecurityOperationsModule,
    'stripe-control': loadStripeReconciliationModule,
    'customer-service-centre': () => window.ensureCustomerServiceAssets?.()
  };
  const loader = loaders[route];
  if (!loader) return 'control-room';
  await loader();
  if (route === 'automation-centre') ensureSystemControlNavigation();
  if (route === 'identity-verifications') window.ensureDiditNavigation?.();
  if (route === 'security-operations' || route === 'stripe-control') window.ensureSecurityOperationsNavigation?.();
  return route;
}

function loadEntranceHealth() {
  if (entranceHealthPromise) return entranceHealthPromise;
  entranceHealthPromise = fetch('/api/health', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(async response => ({ response, data: await response.json().catch(() => ({})) }))
    .then(({ response, data }) => {
      const target = document.getElementById('entranceHealth');
      if (!target) return;
      const stateName = response.ok && data.status === 'operational' ? 'operational' : 'degraded';
      target.dataset.state = stateName;
      target.querySelector('strong').textContent = stateName === 'operational' ? 'Control Centre operational' : 'Control Centre requires attention';
      target.querySelector('small').textContent = `${data.environment || 'Production'} · checked ${formatDate(data.checkedAt, 'just now')}`;
    })
    .catch(() => {
      const target = document.getElementById('entranceHealth');
      if (!target) return;
      target.dataset.state = 'degraded';
      target.querySelector('strong').textContent = 'Readiness check unavailable';
      target.querySelector('small').textContent = 'Microsoft sign-in remains available; Head Office APIs will recheck after authentication.';
    });
  return entranceHealthPromise;
}

async function runBoot() {
  const generation = ++bootGeneration;
  loadEntranceHealth();
  showLogin('Checking your authorised Head Office staff session…');

  const query = new URLSearchParams(location.search);
  const authResult = query.get('auth_result');
  query.delete('auth_result');
  if (authResult) history.replaceState({}, '', `${location.pathname}${query.toString() ? `?${query}` : ''}#/dashboard`);

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
    return showLogin(error.message || 'The staff session could not be checked. Please try again.');
  }

  try {
    await loadPrincipalPinModule();
    if (typeof window.ensurePrincipalPin !== 'function') throw new Error('The personal Head Office PIN module did not load.');
    await window.ensurePrincipalPin(state.session);
    state.session = await loadSession();
    if (!state.session.pin?.verified) throw new Error('The personal PIN was not confirmed for this browser session.');
  } catch (error) {
    return showLogin(error.message || 'The personal Head Office PIN could not be confirmed.');
  }

  $('#configurationNote').textContent = 'Microsoft sign-in and personal PIN confirmed. Loading your authorised permissions…';
  try {
    state.reference = await loadReference();
    const accountPreferences = await api('/api/account/preferences', { timeoutMs: 8_000 }).catch(() => null);
    applyPrincipalPreferences(accountPreferences?.preferences);
  } catch (error) {
    return showLogin(`Your identity was confirmed, but Head Office permissions could not be loaded. ${error.message || 'Please try again.'}`);
  }

  if (generation !== bootGeneration) return;

  const requestedRoute = location.hash.startsWith('#/') ? routeFromHash() : (state.preferences?.defaultLandingPage || (hasPermission('risk:read') ? 'control-room' : 'dashboard'));
  showApp();
  renderNavigation();
  setLoading(`Opening ${requestedRoute.replaceAll('-', ' ')}…`);
  let initialRoute = requestedRoute;
  try {
    initialRoute = await prepareRequestedRoute(requestedRoute);
  } catch (error) {
    console.error('The requested Head Office workspace could not be prepared.', error);
    toast('Requested workspace unavailable', 'The live Control Room has opened instead.', 'error');
    initialRoute = 'control-room';
  }
  if (generation !== bootGeneration || !state.session?.authenticated) return;
  navigate(initialRoute, true);
  initialiseOptionalModules(generation).catch(error => {
    console.error('Optional Head Office modules did not finish initialising.', error);
    toast('Specialist tools unavailable', error.message || 'The core portal remains available.', 'error');
  });
}

function boot() {
  if (bootPromise) return bootPromise;
  bootPromise = runBoot().finally(() => { bootPromise = null; });
  return bootPromise;
}

async function signOut() {
  const result = await api('/api/auth/logout', { method: 'POST', body: '{}', timeoutMs: 8_000 }).catch(() => ({}));
  bootGeneration += 1;
  clearSession();
  if (result.redirect) location.assign(result.redirect); else location.reload();
}

$('#signOutButton').addEventListener('click', signOut);
$('#globalSearch').addEventListener('keydown', event => {
  if (event.key === 'Enter') { state.customerFilters.q = event.currentTarget.value.trim(); navigate('customers'); }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#globalSearch').focus(); }
  if (event.key === 'Escape' && $('#modal').open) closeModal();
});
document.addEventListener('click', event => handleClick(event.target).catch(error => toast('Action could not be completed', error.message, 'error')));
document.addEventListener('submit', event => { event.preventDefault(); handleForm(event.target); });
window.addEventListener('hashchange', () => {
  if (!$('#appShell').hidden) renderRoute(routeFromHash());
});
setInterval(() => { $('#systemClock').textContent = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date()); }, 1000);
boot();
