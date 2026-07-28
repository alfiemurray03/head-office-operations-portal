const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let customerDirectoryModulePromise = null;
let customerAutomationModulePromise = null;

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
  if (handoff || authResult) history.replaceState({}, '', `${location.pathname}${query.toString() ? `?${query}` : ''}#/control-room`);

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
    await Promise.all([loadCustomerDirectoryModule(), loadCustomerAutomationModule()]);
    ensureCustomerDirectoryNavigation();
    state.reference = await loadReference();
    renderNavigation();
    const initialRoute = location.hash.startsWith('#/') ? routeFromHash() : (hasPermission('risk:read') ? 'control-room' : 'dashboard');
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