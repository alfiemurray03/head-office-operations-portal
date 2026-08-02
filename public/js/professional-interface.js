(() => {
  const STYLE_ID = 'professionalInterfaceStyles';
  const AUTH_VISIBILITY_STYLE_ID = 'headOfficeAuthVisibilityGuard';
  const CUSTOMER_SERVICE_STYLE_ID = 'customerServiceCentreStyles';
  const CUSTOMER_SERVICE_SCRIPT_SELECTOR = 'script[data-customer-service-centre]';
  const WEBSITE_CONTROLS_STYLE_ID = 'customerServiceWebsiteControlsStyles';
  const WEBSITE_CONTROLS_SCRIPT_SELECTOR = 'script[data-customer-service-website-controls]';
  const ROUTE_TYPES = Object.freeze({
    'control-room': 'overview',
    dashboard: 'overview',
    'central-operations': 'queue',
    customers: 'queue',
    'customer-directory': 'queue',
    'customer-service-centre': 'queue',
    cases: 'queue',
    communications: 'queue',
    payments: 'queue',
    complaints: 'queue',
    'risk-intelligence': 'queue',
    'customer-protection': 'queue',
    'incidents-v7': 'queue',
    security: 'queue',
    'data-protection': 'queue',
    safeguarding: 'queue',
    'security-levels': 'reference',
    platforms: 'administration',
    staff: 'administration',
    audit: 'queue',
    settings: 'administration',
    'redress-centre': 'queue'
  });

  let customerServiceAssetsPromise = null;
  let websiteControlAssetsPromise = null;

  function ensureAuthVisibilityGuard() {
    if (document.getElementById(AUTH_VISIBILITY_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = AUTH_VISIBILITY_STYLE_ID;
    style.textContent = `
      html body.ops-tailwind #appShell.app-shell[hidden],
      html body.ops-tailwind #loginScreen.login-screen[hidden] {
        display: none !important;
      }
    `;
    document.head.append(style);
  }

  function routeFromLocation() {
    const route = String(window.location.hash || '#/control-room')
      .replace(/^#\/?/, '')
      .split(/[/?]/)[0]
      .trim();
    return route || 'control-room';
  }

  function keepGovernedStylesLast() {
    const link = document.getElementById(STYLE_ID);
    if (!link || link.parentElement !== document.head) return;
    if (document.head.lastElementChild !== link) document.head.append(link);
  }

  function setShellIdentity() {
    const heading = document.querySelector('.tools-drawer-heading strong');
    const description = document.querySelector('.tools-drawer-heading span');
    if (heading && heading.textContent !== 'Head Office Operations') {
      heading.textContent = 'Head Office Operations';
    }
    if (description && description.textContent !== 'Security and customer operations') {
      description.textContent = 'Security and customer operations';
    }
  }

  function ensureCustomerServiceNavigation() {
    const navigation = document.getElementById('mainNavigation');
    if (!navigation || navigation.querySelector('[data-route="customer-service-centre"]')) return;
    const communications = navigation.querySelector('[data-route="communications"]');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-item';
    button.dataset.route = 'customer-service-centre';
    button.dataset.permission = 'communications:read';
    button.textContent = 'AI Customer Service Centre';
    if (communications?.parentElement) communications.parentElement.insertBefore(button, communications);
    else navigation.querySelector('.nav-group')?.append(button);
    window.renderNavigation?.();
  }

  function ensureCustomerServiceStylesheet() {
    if (document.getElementById(CUSTOMER_SERVICE_STYLE_ID)) return;
    const stylesheet = document.createElement('link');
    stylesheet.id = CUSTOMER_SERVICE_STYLE_ID;
    stylesheet.rel = 'stylesheet';
    stylesheet.href = '/customer-service-centre.css?v=20260802-csc-2';
    document.head.append(stylesheet);
  }

  function ensureWebsiteControlAssets() {
    if (websiteControlAssetsPromise) return websiteControlAssetsPromise;
    websiteControlAssetsPromise = new Promise((resolve, reject) => {
      if (!document.getElementById(WEBSITE_CONTROLS_STYLE_ID)) {
        const stylesheet = document.createElement('link');
        stylesheet.id = WEBSITE_CONTROLS_STYLE_ID;
        stylesheet.rel = 'stylesheet';
        stylesheet.href = '/customer-service-website-controls.css?v=20260802-four-sites-1';
        document.head.append(stylesheet);
      }

      const existing = document.querySelector(WEBSITE_CONTROLS_SCRIPT_SELECTOR);
      if (existing) return resolve();
      const script = document.createElement('script');
      script.src = '/js/customer-service-website-controls.js?v=20260802-four-sites-1';
      script.async = false;
      script.dataset.customerServiceWebsiteControls = 'true';
      script.addEventListener('load', resolve, { once: true });
      script.addEventListener('error', () => {
        websiteControlAssetsPromise = null;
        reject(new Error('The four-website customer-service controls could not be loaded.'));
      }, { once: true });
      document.head.append(script);
    });
    return websiteControlAssetsPromise;
  }

  function ensureCustomerServiceAssets() {
    if (typeof window.renderCustomerServiceCentre === 'function') {
      ensureCustomerServiceNavigation();
      return ensureWebsiteControlAssets();
    }
    if (customerServiceAssetsPromise) return customerServiceAssetsPromise;

    ensureCustomerServiceStylesheet();
    customerServiceAssetsPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(CUSTOMER_SERVICE_SCRIPT_SELECTOR);
      const script = existing || document.createElement('script');

      const loaded = () => {
        ensureCustomerServiceNavigation();
        ensureWebsiteControlAssets().catch(error => console.error('Full website controls remain unavailable.', error));
        if (routeFromLocation() === 'customer-service-centre') window.renderCustomerServiceCentre?.();
        resolve();
      };
      const failed = () => {
        customerServiceAssetsPromise = null;
        console.error('The AI Customer Service Centre workspace could not be loaded.');
        reject(new Error('The AI Customer Service Centre workspace could not be loaded.'));
      };

      if (typeof window.renderCustomerServiceCentre === 'function') return loaded();
      script.addEventListener('load', loaded, { once: true });
      script.addEventListener('error', failed, { once: true });

      if (!existing) {
        script.src = '/js/customer-service-centre.js?v=20260802-csc-2';
        script.async = false;
        script.dataset.customerServiceCentre = 'true';
        document.head.append(script);
      }
    });
    return customerServiceAssetsPromise;
  }

  function activateCustomerServiceAfterAuthentication() {
    const appShell = document.getElementById('appShell');
    if (!appShell) return;

    const activate = () => {
      if (appShell.hidden) return false;
      ensureCustomerServiceAssets().catch(error => {
        console.error('Customer Service Centre remains unavailable, but the core Head Office Portal is continuing.', error);
      });
      return true;
    };

    if (activate()) return;
    const observer = new MutationObserver(() => {
      if (!activate()) return;
      observer.disconnect();
    });
    observer.observe(appShell, { attributes: true, attributeFilter: ['hidden'] });
  }

  function sectionHeadingId(section, index) {
    const heading = section.querySelector(':scope > .panel-header h2, :scope > .enterprise-panel-header h2, h2');
    if (!heading) return null;
    if (!heading.id) heading.id = `operation-section-${index + 1}`;
    return heading.id;
  }

  function classifySurfaces(root) {
    const surfaces = root.querySelectorAll('.panel, .enterprise-panel');
    surfaces.forEach((surface, index) => {
      surface.classList.toggle('queue-surface', Boolean(surface.querySelector('.data-table')));
      surface.classList.toggle('form-surface', Boolean(surface.querySelector('form')));
      surface.classList.toggle('record-surface', Boolean(surface.querySelector('.summary-list, .timeline, .tabs')));
      const headingId = sectionHeadingId(surface, index);
      if (headingId) {
        surface.setAttribute('role', 'region');
        surface.setAttribute('aria-labelledby', headingId);
      }
    });

    root.querySelectorAll('.data-table').forEach((table, index) => {
      if (!table.getAttribute('aria-label') && !table.getAttribute('aria-labelledby')) {
        const region = table.closest('[aria-labelledby]');
        if (region?.getAttribute('aria-labelledby')) table.setAttribute('aria-labelledby', region.getAttribute('aria-labelledby'));
        else table.setAttribute('aria-label', `Operational queue ${index + 1}`);
      }
    });
  }

  function applyPageModel() {
    const route = routeFromLocation();
    const type = ROUTE_TYPES[route] || 'workspace';
    document.body.dataset.route = route;
    document.body.dataset.pageType = type;
    setShellIdentity();
    const root = document.getElementById('viewRoot');
    if (!root) return;
    root.dataset.route = route;
    root.dataset.pageType = type;
    classifySurfaces(root);
  }

  function start() {
    ensureAuthVisibilityGuard();
    activateCustomerServiceAfterAuthentication();
    keepGovernedStylesLast();
    applyPageModel();

    window.addEventListener('hashchange', () => queueMicrotask(applyPageModel));

    const viewRoot = document.getElementById('viewRoot');
    if (viewRoot) {
      new MutationObserver(() => queueMicrotask(applyPageModel))
        .observe(viewRoot, { childList: true, subtree: true });
    }
  }

  ensureAuthVisibilityGuard();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
