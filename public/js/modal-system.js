/* Shared modal state repair and final Planyx Admin presentation bootstrap.
   The same dialog is reused for all controlled actions, so scroll and focus
   state must be reset every time content changes. */
(() => {
  const PARITY_HREF = '/planyx-admin-parity.css?v=20260729-planyx-admin-parity-1';
  const originalOpenModal = openModal;
  const originalCloseModal = closeModal;
  let relinkQueued = false;

  function ensureParityStyleLast() {
    let link = document.querySelector('link[data-planyx-admin-parity]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = PARITY_HREF;
      link.dataset.planyxAdminParity = 'true';
      document.head.append(link);
      return link;
    }
    if (link !== document.head.lastElementChild) document.head.append(link);
    return link;
  }

  function queueParityRelink() {
    if (relinkQueued) return;
    relinkQueued = true;
    queueMicrotask(() => {
      relinkQueued = false;
      ensureParityStyleLast();
    });
  }

  function synchroniseTheme() {
    const dark = document.documentElement.dataset.opsTheme === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    document.body.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.body.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#020617' : '#f8fafc');
    const toggle = document.getElementById('themeToggle');
    if (toggle) toggle.setAttribute('aria-label', dark ? 'Switch Admin Centre to light mode' : 'Switch Admin Centre to dark mode');
  }

  function enhanceFooter() {
    const footer = document.querySelector('.system-footer');
    if (!footer || footer.dataset.planyxFooter === 'true') return;
    footer.dataset.planyxFooter = 'true';
    footer.innerHTML = `
      <div class="head-office-footer-brand">
        <div class="brand-mark" aria-hidden="true">JA</div>
        <div><strong>Customer Operations Centre</strong><span>Secure Head Office administration for JA Group Services Ltd.</span></div>
      </div>
      <nav class="head-office-footer-links" aria-label="Head Office footer navigation">
        <button type="button" data-route="control-room">Control Room</button>
        <button type="button" data-route="customers">Customer Register</button>
        <button type="button" data-route="audit">Audit History</button>
        <button type="button" data-route="settings">Configuration</button>
      </nav>
      <div class="head-office-footer-session">
        <span>Signed in as <strong id="footerUserName">Authorised staff</strong></span>
        <span id="systemClock"></span>
      </div>`;

    const headerUser = document.getElementById('userName');
    const footerUser = document.getElementById('footerUserName');
    const syncUser = () => {
      if (footerUser) footerUser.textContent = headerUser?.textContent?.trim() || 'Authorised staff';
    };
    syncUser();
    if (headerUser) new MutationObserver(syncUser).observe(headerUser, { childList: true, characterData: true, subtree: true });
  }

  function enforceAutomaticDiditDelivery() {
    const forms = document.querySelectorAll('form[data-form="didit-start"], form[data-form="didit-random-commit"]');
    forms.forEach(form => {
      const checkbox = form.querySelector('input[name="sendNotificationEmails"]');
      if (!checkbox) return;
      const container = checkbox.closest('label');
      if (!container) {
        checkbox.checked = true;
        return;
      }
      container.className = 'didit-start-auto-email full';
      container.innerHTML = `
        <input type="hidden" name="sendNotificationEmails" value="true">
        <span class="didit-auto-email-icon" aria-hidden="true">✓</span>
        <span><strong>Customer email will be sent automatically</strong><small>Didit sends the secure verification invitation directly to the verified customer email address. The hosted link is also shown once to authorised Head Office staff.</small></span>`;
    });
  }

  function resetModalPosition() {
    const modal = document.getElementById('modal');
    const shell = modal?.querySelector('.modal-shell');
    const header = shell?.querySelector(':scope > header');
    const content = modal?.querySelector('.modal-content');

    for (const element of [modal, shell, header, content]) {
      if (!element) continue;
      element.scrollLeft = 0;
      element.scrollTop = 0;
    }
  }

  function focusFirstUsefulControl() {
    const modal = document.getElementById('modal');
    if (!modal?.open) return;
    const control = modal.querySelector('.modal-content input:not([type="hidden"]):not([disabled]), .modal-content select:not([disabled]), .modal-content textarea:not([disabled]), .modal-content button:not([disabled])');
    if (!control) return;
    try { control.focus({ preventScroll: true }); }
    catch { control.focus(); }
    resetModalPosition();
  }

  openModal = function(...args) {
    originalOpenModal(...args);
    ensureParityStyleLast();
    synchroniseTheme();
    enforceAutomaticDiditDelivery();
    resetModalPosition();
    requestAnimationFrame(() => {
      enforceAutomaticDiditDelivery();
      resetModalPosition();
      focusFirstUsefulControl();
      resetModalPosition();
    });
  };

  closeModal = function(...args) {
    resetModalPosition();
    const result = originalCloseModal(...args);
    resetModalPosition();
    return result;
  };

  ensureParityStyleLast();
  synchroniseTheme();
  enhanceFooter();

  new MutationObserver(mutations => {
    const laterStylesheetAdded = mutations.some(mutation => [...mutation.addedNodes].some(node => (
      node instanceof HTMLLinkElement
      && node.rel === 'stylesheet'
      && !node.dataset.planyxAdminParity
    )));
    if (laterStylesheetAdded) queueParityRelink();
  }).observe(document.head, { childList: true });

  new MutationObserver(() => synchroniseTheme()).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-ops-theme']
  });

  document.getElementById('modal')?.addEventListener('close', resetModalPosition);
})();