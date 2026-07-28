/* Shared modal state repair.
   The same dialog is reused for all controlled actions, so scroll and focus
   state must be reset every time content changes. */
(() => {
  const originalOpenModal = openModal;
  const originalCloseModal = closeModal;

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
    resetModalPosition();
    requestAnimationFrame(() => {
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

  document.getElementById('modal')?.addEventListener('close', resetModalPosition);
})();
