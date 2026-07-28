/* Clean shell compatibility layer.
   Removes the failed stacked workspace chrome and retires the legacy dashboard route. */

(function initialiseCleanOperationsShell() {
  function removeStackedWorkspaceChrome() {
    document.querySelector('#workspaceSwitcher')?.remove();
    document.querySelector('#workspaceContext')?.remove();
  }

  function setText(element, value) {
    if (element && element.textContent !== value) element.textContent = value;
  }

  function tidyPrimaryNavigation() {
    document.querySelectorAll('[data-route="dashboard"]').forEach(item => item.remove());

    setText(document.querySelector('#mainNavigation [data-route="central-operations"]'), 'Customer operations centre');
    setText(document.querySelector('#mainNavigation [data-route="customer-protection"]'), 'Customer protection operations');
    setText(document.querySelector('.tools-drawer-heading strong'), 'Head Office Operations Centre');
    setText(document.querySelector('.tools-drawer-heading span'), 'Customer operations, security, incidents and assurance');

    const sidebar = document.querySelector('#sidebar');
    if (sidebar?.getAttribute('aria-label') !== 'Head Office Operations Centre navigation') {
      sidebar?.setAttribute('aria-label', 'Head Office Operations Centre navigation');
    }
  }

  function cleanRoute(route) {
    return route === 'dashboard' ? 'control-room' : route;
  }

  if (typeof navigate === 'function') {
    const previousNavigate = navigate;
    navigate = function navigateCleanShell(route, replace = false) {
      return previousNavigate(cleanRoute(route), replace);
    };
  }

  if (typeof renderRoute === 'function') {
    const previousRenderRoute = renderRoute;
    renderRoute = function renderCleanShell(route = routeFromHash()) {
      return previousRenderRoute(cleanRoute(route));
    };
  }

  removeStackedWorkspaceChrome();
  tidyPrimaryNavigation();

  // Modules may add one controlled navigation item during authenticated startup.
  const navigation = document.querySelector('#mainNavigation');
  if (navigation) {
    new MutationObserver(() => tidyPrimaryNavigation()).observe(navigation, { childList: true, subtree: true });
  }

  window.addEventListener('hashchange', () => {
    if (routeFromHash() === 'dashboard') navigate('control-room', true);
  });

  if (routeFromHash() === 'dashboard') navigate('control-room', true);
})();
