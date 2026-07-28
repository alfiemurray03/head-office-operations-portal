/* Full customer records are workspaces, never modal dialogs. */
(() => {
  const previousRenderRoute = renderRoute;
  renderRoute = async function renderCentralRoute(route = routeFromHash()) {
    const match = /^customers\/([^/?#]+)$/.exec(route);
    if (match) {
      state.route = route;
      document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.route === 'customers'));
      document.querySelector('#sidebar')?.classList.remove('open');
      setLoading('Opening the complete universal customer record…');
      try {
        if (typeof window.renderCustomerRecordWorkspace !== 'function') throw new Error('The customer record workspace is unavailable.');
        return await window.renderCustomerRecordWorkspace(decodeURIComponent(match[1]));
      } catch (error) {
        document.querySelector('#viewRoot').innerHTML = `<div class="panel"><div class="empty-state"><strong>The customer record could not be opened</strong><span>${escapeHtml(error.message || 'The record is temporarily unavailable.')}</span></div></div>`;
        toast('Customer record unavailable', error.message || 'The record could not be opened.', 'error');
      }
      return;
    }
    return previousRenderRoute(route);
  };

  document.addEventListener('click', event => {
    const row = event.target.closest('[data-open="customer"][data-id]');
    if (!row || event.target.closest('button,a,input,select,textarea')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    navigate(`customers/${encodeURIComponent(row.dataset.id)}`);
  }, true);
})();
