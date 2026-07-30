(() => {
  const STYLE_ID = 'professionalInterfaceStyles';
  const ROUTE_TYPES = Object.freeze({
    'control-room': 'overview',
    dashboard: 'overview',
    'central-operations': 'queue',
    customers: 'queue',
    'customer-directory': 'queue',
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
    if (heading) heading.textContent = 'Head Office Operations';
    if (description) description.textContent = 'Security and customer operations';
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
    keepGovernedStylesLast();
    applyPageModel();

    window.addEventListener('hashchange', () => queueMicrotask(applyPageModel));

    const viewRoot = document.getElementById('viewRoot');
    if (viewRoot) {
      new MutationObserver(() => queueMicrotask(applyPageModel))
        .observe(viewRoot, { childList: true, subtree: true });
    }

    const sidebarHeading = document.querySelector('.tools-drawer-heading');
    if (sidebarHeading) {
      new MutationObserver(() => queueMicrotask(setShellIdentity))
        .observe(sidebarHeading, { childList: true, subtree: true, characterData: true });
    }

    new MutationObserver(mutations => {
      const stylesheetAdded = mutations.some(mutation => [...mutation.addedNodes].some(node =>
        node.nodeType === Node.ELEMENT_NODE &&
        ((node.matches?.('link[rel="stylesheet"]')) || node.matches?.('style'))
      ));
      if (stylesheetAdded) queueMicrotask(keepGovernedStylesLast);
    }).observe(document.head, { childList: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
