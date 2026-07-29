(() => {
  const DEFAULT_PAGE_SIZE = 10;
  const PAGE_SIZES = [10, 25, 50];
  const states = new WeakMap();
  let scheduled = false;

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function tableRows(table) {
    const body = table.tBodies?.[0];
    if (!body) return [];
    return [...body.rows].filter(row => !row.querySelector('.empty-state') && row.cells.length > 0);
  }

  function headerLabels(table) {
    const row = table.tHead?.rows?.[0];
    if (!row) return [];
    return [...row.cells].map((cell, index) => text(cell.textContent) || (index === row.cells.length - 1 ? 'Actions' : `Field ${index + 1}`));
  }

  function ensureLabels(table, labels) {
    for (const row of tableRows(table)) {
      [...row.cells].forEach((cell, index) => {
        if (!cell.dataset.label) cell.dataset.label = labels[index] || `Field ${index + 1}`;
      });
    }
  }

  function removePagination(table) {
    const wrap = table.closest('.table-wrap');
    const controls = wrap?.nextElementSibling;
    if (controls?.classList.contains('table-pagination') && controls.dataset.owner === table.dataset.tableWorkspaceId) {
      controls.remove();
    }
  }

  function paginationMarkup(table, state, totalRows) {
    const pages = Math.max(1, Math.ceil(totalRows / state.pageSize));
    const page = Math.min(state.page, pages);
    const start = totalRows ? (page - 1) * state.pageSize + 1 : 0;
    const end = Math.min(page * state.pageSize, totalRows);
    const options = PAGE_SIZES.map(size => `<option value="${size}"${size === state.pageSize ? ' selected' : ''}>${size}</option>`).join('');
    return `<div class="table-page-size"><span>Rows</span><select data-table-page-size aria-label="Rows per page">${options}</select></div>
      <span data-table-page-summary>${start}–${end} of ${totalRows}</span>
      <div class="table-pagination-controls">
        <button type="button" data-table-page="first" aria-label="First page"${page <= 1 ? ' disabled' : ''}>«</button>
        <button type="button" data-table-page="previous" aria-label="Previous page"${page <= 1 ? ' disabled' : ''}>‹</button>
        <span>Page ${page} of ${pages}</span>
        <button type="button" data-table-page="next" aria-label="Next page"${page >= pages ? ' disabled' : ''}>›</button>
        <button type="button" data-table-page="last" aria-label="Last page"${page >= pages ? ' disabled' : ''}>»</button>
      </div>`;
  }

  function renderPage(table) {
    const rows = tableRows(table);
    const state = states.get(table) || { page: 1, pageSize: DEFAULT_PAGE_SIZE };
    const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
    state.page = Math.max(1, Math.min(state.page, pages));
    states.set(table, state);

    const first = (state.page - 1) * state.pageSize;
    const last = first + state.pageSize;
    rows.forEach((row, index) => { row.hidden = index < first || index >= last; });

    const wrap = table.closest('.table-wrap');
    if (!wrap) return;
    let controls = wrap.nextElementSibling;
    if (!controls?.classList.contains('table-pagination') || controls.dataset.owner !== table.dataset.tableWorkspaceId) {
      controls = document.createElement('div');
      controls.className = 'table-pagination';
      controls.dataset.owner = table.dataset.tableWorkspaceId;
      wrap.insertAdjacentElement('afterend', controls);
    }
    controls.innerHTML = paginationMarkup(table, state, rows.length);
  }

  function bindPagination(table) {
    const wrap = table.closest('.table-wrap');
    const controls = wrap?.nextElementSibling;
    if (!controls?.classList.contains('table-pagination') || controls.dataset.bound === 'true') return;
    controls.dataset.bound = 'true';

    controls.addEventListener('click', event => {
      const button = event.target.closest('[data-table-page]');
      if (!button) return;
      const rows = tableRows(table);
      const state = states.get(table) || { page: 1, pageSize: DEFAULT_PAGE_SIZE };
      const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
      if (button.dataset.tablePage === 'first') state.page = 1;
      if (button.dataset.tablePage === 'previous') state.page -= 1;
      if (button.dataset.tablePage === 'next') state.page += 1;
      if (button.dataset.tablePage === 'last') state.page = pages;
      states.set(table, state);
      renderPage(table);
      bindPagination(table);
    });

    controls.addEventListener('change', event => {
      const select = event.target.closest('[data-table-page-size]');
      if (!select) return;
      const state = states.get(table) || { page: 1, pageSize: DEFAULT_PAGE_SIZE };
      state.pageSize = PAGE_SIZES.includes(Number(select.value)) ? Number(select.value) : DEFAULT_PAGE_SIZE;
      state.page = 1;
      states.set(table, state);
      renderPage(table);
      bindPagination(table);
    });
  }

  function enhance(table, index) {
    if (!(table instanceof HTMLTableElement)) return;
    const wrap = table.closest('.table-wrap');
    if (!wrap) return;

    const labels = headerLabels(table);
    const rows = tableRows(table);
    const workspaceId = table.dataset.tableWorkspaceId || `table-${Date.now()}-${index}`;
    table.dataset.tableWorkspaceId = workspaceId;
    table.dataset.columns = String(labels.length);
    table.classList.add('adaptive-table');
    table.classList.toggle('adaptive-wide', labels.length >= 7);
    table.classList.toggle('adaptive-very-wide', labels.length >= 10);
    wrap.dataset.tableWorkspace = 'true';
    wrap.dataset.scrollable = rows.length > DEFAULT_PAGE_SIZE ? 'true' : 'false';
    ensureLabels(table, labels);

    if (table.dataset.noPagination === 'true' || rows.length <= DEFAULT_PAGE_SIZE) {
      rows.forEach(row => { row.hidden = false; });
      removePagination(table);
      return;
    }

    const current = states.get(table) || { page: 1, pageSize: DEFAULT_PAGE_SIZE };
    states.set(table, current);
    renderPage(table);
    bindPagination(table);
  }

  function enhanceAll() {
    scheduled = false;
    document.querySelectorAll('.data-table').forEach(enhance);
  }

  function scheduleEnhancement() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(enhanceAll);
  }

  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.addedNodes.length || mutation.removedNodes.length)) scheduleEnhancement();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      enhanceAll();
      observer.observe(document.body, { childList: true, subtree: true });
    }, { once: true });
  } else {
    enhanceAll();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.enhanceOperationalTables = enhanceAll;
})();
